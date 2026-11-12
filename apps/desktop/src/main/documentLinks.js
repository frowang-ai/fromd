import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { realpath, stat } from 'node:fs/promises'

const controls = /[\u0000-\u001f\u007f-\u009f]/
const scheme = /^[a-z][a-z\d+.-]*:/i

// Resolve against the owning document, never the application or process cwd.
export function resolveDocumentLink(href, documentPath) {
  if (typeof href !== 'string' || !href.trim() || href.length > 16384 || controls.test(href))
    throw new Error('链接地址无效。')
  const value = href.trim()
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value)
    if (!url.hostname || url.href.length > 2081) throw new Error('网页地址无效或过长。')
    return { kind: 'web', url: url.href }
  }
  if (value.startsWith('#')) throw new Error('这是文内锚点链接。')
  let target
  if (/^file:/i.test(value)) {
    try { target = fileURLToPath(new URL(value)) }
    catch { throw new Error('本地文件链接格式无效。') }
  } else {
    try { target = decodeURIComponent(value.split(/[?#]/, 1)[0]) }
    catch { throw new Error('本地路径编码无效，请检查链接地址。') }
    // Markdown links emitted by desktop tools may use /C:/folder/file.md.
    if (process.platform === 'win32' && /^\/[a-z]:[\\/]/i.test(target)) target = target.slice(1)
    if (scheme.test(target) && !/^[a-z]:[\\/]/i.test(target))
      throw new Error('目前只支持网页和本地文件、文件夹链接。')
  }
  if (!target || controls.test(target)) throw new Error('本地路径无效。')
  // Network shares and Windows device paths are outside the local-file contract.
  if (/^[\\/]{2}/.test(target)) throw new Error('目前只支持本机文件和文件夹链接。')
  if (process.platform === 'win32') {
    if (/^[\\/]/.test(target)) throw new Error('请使用包含盘符的完整路径，或使用相对路径。')
    if (target.replace(/^[a-z]:/i, '').includes(':')) throw new Error('本地路径无效。')
  }
  if (!path.isAbsolute(target)) {
    if (!documentPath || !path.isAbsolute(documentPath))
      throw new Error('相对链接需要当前笔记的位置，请先保存为 Markdown 文件，或改用绝对路径。')
    target = path.resolve(path.dirname(documentPath), target)
  }
  return { kind: 'local', path: path.normalize(target) }
}

export async function openDocumentLink(href, documentPath, shell) {
  const target = resolveDocumentLink(href, documentPath)
  if (target.kind === 'web') {
    try { await shell.openExternal(target.url) }
    catch { throw new Error('无法打开网页，请检查默认浏览器设置。') }
    return { action: 'browser' }
  }
  let location, info
  try { location = await realpath(target.path); info = await stat(location) }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new Error('链接目标不存在，可能已移动或删除。')
    throw new Error('无法访问链接目标，请检查路径和访问权限。')
  }
  if (info.isDirectory()) {
    const error = await shell.openPath(location)
    if (error) throw new Error('无法打开文件夹，请检查路径和访问权限。')
    return { action: 'folder' }
  }
  if (!info.isFile()) throw new Error('链接目标不是普通文件或文件夹。')
  // Files are always revealed, including executable/shortcut files. Never launch.
  shell.showItemInFolder(location)
  return { action: 'reveal' }
}
