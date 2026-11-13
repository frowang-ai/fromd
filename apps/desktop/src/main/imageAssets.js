import { createHash, randomUUID } from 'node:crypto'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { copyFile, link, mkdir, open, readFile, realpath, stat, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import MarkdownIt from 'markdown-it'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MANAGED_IMAGE = /^_frowd-assets\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/
const IMAGE_EXTENSION = /^\.(png|jpg|jpeg|gif|webp)$/i
const markdownParser = new MarkdownIt({ html: true })
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

function within(root, path) {
  const delta = relative(root, path)
  return delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta)
}

function localSource(source) {
  if (typeof source !== 'string' || !source || /^[a-z][\w+.-]*:|^[/\\]/i.test(source)) return null
  let decoded
  try { decoded = decodeURIComponent(source) } catch { return null }
  if (/^[a-z][\w+.-]*:|^[/\\]/i.test(decoded) || decoded.includes('\0') || decoded.includes(':')) return null
  return decoded.replaceAll('\\', '/')
}

function imageFormat(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ['image/png', 'png']
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['image/jpeg', 'jpg']
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return ['image/gif', 'gif']
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return ['image/webp', 'webp']
  throw new Error('仅支持 PNG、JPEG、GIF 和 WebP 图片。')
}

async function readImage(path) {
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_IMAGE_BYTES) throw new Error('图片需为 10 MB 以内的文件。')
  const bytes = await readFile(path)
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('图片需为 10 MB 以内的文件。')
  return bytes
}

// Publish a fully flushed file without replacing an existing attachment. A
// competing identical write is reusable, while a name collision is reported.
async function writeAttachment(path, bytes) {
  const temporary = join(dirname(path), `.frowd-image-${randomUUID()}.tmp`)
  let file
  try {
    file = await open(temporary, 'wx', 0o600)
    await file.writeFile(bytes)
    await file.sync()
    await file.close()
    file = null
    try {
      try { await link(temporary, path) }
      catch (error) {
        // FAT/exFAT and some network filesystems do not support hard links.
        // Exclusive copy still refuses an existing destination. Markdown is
        // published only after this new attachment has been copied and flushed.
        if (!['EPERM', 'ENOTSUP', 'ENOSYS', 'EINVAL'].includes(error.code)) throw error
        await copyFile(temporary, path, constants.COPYFILE_EXCL)
        const copied = await open(path, 'r+')
        try { await copied.sync() } finally { await copied.close() }
      }
    }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (!(await readImage(path)).equals(bytes)) throw new Error('附件目标已有同名且内容不同的图片，请选择其他保存位置。')
    }
  } finally {
    await file?.close().catch(() => {})
    await unlink(temporary).catch(() => {})
  }
}

async function existingImage(root, source) {
  const canonicalRoot = await realpath(root)
  const candidate = resolve(canonicalRoot, source)
  if (!within(canonicalRoot, candidate) || !IMAGE_EXTENSION.test(extname(candidate))) throw new Error('图片必须位于文档目录内。')
  const path = await realpath(candidate)
  if (!within(canonicalRoot, path)) throw new Error('图片必须位于文档目录内。')
  return { path, bytes: await readImage(path) }
}

async function destinationPath(root, source) {
  const canonicalRoot = await realpath(root)
  const destination = resolve(canonicalRoot, source)
  if (!within(canonicalRoot, destination) || !IMAGE_EXTENSION.test(extname(destination))) throw new Error('附件目标必须位于保存目录内。')
  // Walk one directory at a time so an existing junction cannot redirect mkdir
  // or the final attachment write outside the chosen document directory.
  let directory = canonicalRoot
  for (const part of relative(canonicalRoot, dirname(destination)).split(sep).filter(Boolean)) {
    directory = join(directory, part)
    try { await mkdir(directory) } catch (error) { if (error.code !== 'EEXIST') throw error }
    directory = await realpath(directory)
    if (!within(canonicalRoot, directory)) throw new Error('附件目录指向保存目录之外。')
  }
  try {
    const existing = await realpath(destination)
    if (!within(canonicalRoot, existing)) throw new Error('附件目标指向保存目录之外。')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  return destination
}

function htmlImages(html) {
  const sources = []
  let rawTag = null
  // MarkdownIt has already separated code fences and literal inline code.
  // Keep quoted attributes and comments intact while inspecting HTML tokens.
  const tags = /<!--[\s\S]*?(?:-->|$)|<\/?[a-z][a-z0-9-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
  for (const [tag] of html.matchAll(tags)) {
    if (tag.startsWith('<!--')) continue
    const name = /^<\/?([a-z][a-z0-9-]*)/i.exec(tag)?.[1].toLowerCase()
    if (rawTag) {
      if (name === rawTag && tag.startsWith('</')) rawTag = null
      continue
    }
    if (['script', 'style', 'textarea', 'title'].includes(name) && !tag.startsWith('</')) { rawTag = name; continue }
    if (name !== 'img' || tag.startsWith('</')) continue
    const attributes = tag.slice(4, -1)
    const attribute = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
    for (const match of attributes.matchAll(attribute)) {
      if (match[1].toLowerCase() === 'src') {
        sources.push(markdownParser.utils.unescapeAll(match[2] ?? match[3] ?? match[4] ?? ''))
        break
      }
    }
  }
  return sources
}

export function imageSources(markdown) {
  const sources = new Set()
  function inspect(tokens) {
    for (const token of tokens) {
      if (token.type === 'image') sources.add(token.attrGet('src'))
      if (token.type === 'html_inline' || token.type === 'html_block') htmlImages(token.content).forEach(source => sources.add(source))
      if (token.children) inspect(token.children)
    }
  }
  inspect(markdownParser.parse(markdown, {}))
  return [...sources].map(localSource).filter(source => source && IMAGE_EXTENSION.test(extname(source)))
}

export async function importImages(directory, images) {
  if (!Array.isArray(images) || !images.length || images.length > 20) throw new Error('每次可插入 1–20 张图片。')
  let total = 0
  const validated = images.map(image => {
    if (!image || !(image.bytes instanceof Uint8Array) || !image.bytes.length || image.bytes.length > MAX_IMAGE_BYTES) throw new Error('图片需为 10 MB 以内的文件。')
    const bytes = Buffer.from(image.bytes), [mime, extension] = imageFormat(bytes)
    if (image.mime !== mime) throw new Error('图片内容与文件类型不一致。')
    total += bytes.length
    if (total > 50 * 1024 * 1024) throw new Error('本次图片总量超过 50 MB，请分批插入。')
    return { bytes, source: `_frowd-assets/${digest(bytes)}.${extension}` }
  })
  for (const { bytes, source } of validated) await writeAttachment(await destinationPath(directory, source), bytes)
  return validated.map(image => image.source)
}

export async function readDocumentImage(directory, doc, source) {
  const normalized = localSource(source)
  if (!normalized) throw new Error('图片路径无效。')
  if (doc.path) {
    try { return await existingImage(dirname(doc.path), normalized) }
    catch (error) { if (error.code !== 'ENOENT' || !MANAGED_IMAGE.test(normalized)) throw error }
  }
  if (!MANAGED_IMAGE.test(normalized)) throw new Error('草稿图片路径无效。')
  return existingImage(directory, normalized)
}

export async function copyDocumentImages(directory, doc, markdown, targetPath) {
  const targetRoot = dirname(targetPath)
  for (const source of new Set(imageSources(markdown))) {
    // Relative links typed into an unsaved page are resolved from the chosen
    // destination, as before. Only imported draft assets have a source to copy.
    if (!doc.path && !MANAGED_IMAGE.test(source)) continue
    // Ordinary same-directory images already live at their final destination.
    // Managed images may still be in the draft store after a paste.
    if (doc.path && dirname(doc.path) === targetRoot && !MANAGED_IMAGE.test(source)) continue
    const image = await readDocumentImage(directory, doc, source)
    const destination = await destinationPath(targetRoot, source)
    if (image.path === destination) continue
    await writeAttachment(destination, image.bytes)
  }
}
