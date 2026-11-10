import { readFile, open, rename, unlink, mkdir, realpath, stat } from 'node:fs/promises'
import { dirname, basename, resolve, join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_SESSION_BYTES = 100 * 1024 * 1024
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const pathKey = path => process.platform === 'win32' ? path.toLowerCase() : path
export async function canonicalPath(path) {
  try { return await realpath(resolve(path)) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    return join(await realpath(dirname(resolve(path))), basename(path))
  }
}
export async function atomicWrite(path, bytes) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  let file
  try {
    file = await open(temporary, 'wx', 0o600)
    await file.writeFile(bytes); await file.sync(); await file.close(); file = null
    await rename(temporary, path)
  } finally { await file?.close().catch(() => {}); await unlink(temporary).catch(() => {}) }
}
async function fileBytes(path) {
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_BYTES) throw new Error('首版支持 10 MB 以内的文本文件。')
  const bytes = await readFile(path)
  if (bytes.length > MAX_BYTES) throw new Error('首版支持 10 MB 以内的文本文件。')
  return bytes
}
function decode(bytes) {
  const bom = bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191]))
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error('文件不是 UTF-8 编码。请先以 UTF-8 保存，再打开。') }
  if (text.includes('\0')) throw new Error('不能打开二进制文件。')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  return { text: text.replace(/\r\n?/g, '\n'), bom, eol }
}
export class DocumentStore {
  constructor(directory, { maxSessionBytes = MAX_SESSION_BYTES } = {}) {
    this.maxSessionBytes = maxSessionBytes
    this.directory = directory; this.sessionPath = join(directory, 'session.json')
    this.documents = []; this.activeId = null; this.warning = ''; this.recoveryWritable = true
  }
  get(id) {
    const doc = this.documents.find(doc => doc.id === id)
    if (!doc) throw new Error('笔记已经关闭。')
    return doc
  }
  snapshot() {
    return { documents: this.documents.map(doc => ({ id: doc.id, title: doc.title, path: doc.path, markdown: doc.markdown,
      revision: doc.revision, dirty: doc.markdown !== doc.savedText, conflict: doc.conflict })), activeId: this.activeId, warning: this.warning }
  }
  async restore() {
    try {
      await mkdir(this.directory, { recursive: true })
      if ((await stat(this.sessionPath)).size > this.maxSessionBytes) throw new Error('Recovery too large')
      const bytes = await readFile(this.sessionPath)
      if (bytes.length > this.maxSessionBytes) throw new Error('Recovery too large')
      const saved = JSON.parse(bytes.toString('utf8'))
      if (saved.version !== 1 || !Array.isArray(saved.documents) || saved.documents.some(doc => !doc || typeof doc.id !== 'string' || typeof doc.markdown !== 'string' || typeof doc.savedText !== 'string' || typeof doc.title !== 'string' || !Number.isSafeInteger(doc.revision) || doc.revision < 0 || (doc.path !== null && typeof doc.path !== 'string') || !['\n', '\r\n'].includes(doc.eol) || typeof doc.bom !== 'boolean' || (doc.baseline !== null && !/^[0-9a-f]{64}$/.test(doc.baseline)))) throw new Error('Invalid recovery file')
      if (new Set(saved.documents.map(doc => doc.id)).size !== saved.documents.length) throw new Error('Duplicate documents')
      this.documents = saved.documents
      this.activeId = this.documents.some(doc => doc.id === saved.activeId) ? saved.activeId : this.documents[0]?.id
      // If clean, reload latest disk content. If dirty, retain recovery text and
      // refuse a later Save when the disk has diverged from the saved baseline.
      for (const doc of this.documents) {
        if (!doc.path) continue
        try {
          const bytes = await fileBytes(doc.path)
          if (doc.markdown === doc.savedText) {
            const format = decode(bytes); Object.assign(doc, { ...format, markdown: format.text, savedText: format.text, baseline: digest(bytes), conflict: false })
          } else doc.conflict = digest(bytes) !== doc.baseline
        } catch { doc.conflict = true }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.warning = '恢复文件无法读取，原文件已保留。本次会话不能自动备份，请用保存或另存为保留内容。'
        this.recoveryWritable = false; this.documents = []; this.activeId = null
      }
    }
    if (!this.documents.length) await this.newDocument()
    return this.snapshot()
  }
  async persist() {
    if (!this.recoveryWritable) return false
    try {
      const content = JSON.stringify({ version: 1, activeId: this.activeId, documents: this.documents })
      if (Buffer.byteLength(content) > this.maxSessionBytes) throw new Error('会话备份超过容量上限，请先保存并关闭部分笔记。')
      await atomicWrite(this.sessionPath, content)
      this.warning = ''
      return true
    } catch (error) { this.warning = error.message.includes('容量上限') ? error.message : '草稿备份失败。请保存到文件；当前页面内容仍保留。'; throw new Error(this.warning, { cause: error }) }
  }
  async tryPersist() {
    try { return await this.persist() } catch { return false }
  }
  async newDocument(markdown = '', title = '未命名笔记') {
    const doc = { id: randomUUID(), title, markdown, savedText: '', path: null, baseline: null, bom: false, eol: '\n', revision: 0, conflict: false }
    this.documents.push(doc); this.activeId = doc.id; await this.tryPersist(); return this.snapshot()
  }
  async openFile(path) {
    const canonical = await canonicalPath(path)
    const existing = this.documents.find(doc => doc.path && pathKey(doc.path) === pathKey(canonical))
    if (existing) { this.activeId = existing.id; await this.tryPersist(); return this.snapshot() }
    const bytes = await fileBytes(canonical), format = decode(bytes)
    const doc = { id: randomUUID(), title: basename(canonical), markdown: format.text, savedText: format.text, path: canonical, baseline: digest(bytes), bom: format.bom, eol: format.eol, revision: 0, conflict: false }
    this.documents.push(doc); this.activeId = doc.id; await this.tryPersist(); return this.snapshot()
  }
  async update(id, markdown, revision) {
    if (typeof markdown !== 'string' || Buffer.byteLength(markdown) > MAX_BYTES || !Number.isSafeInteger(revision) || revision < 0) throw new Error('笔记内容或版本无效。')
    const doc = this.get(id)
    if (revision < doc.revision) return { backedUp: false, stale: true }
    if (revision === doc.revision && markdown !== doc.markdown) throw new Error('笔记版本冲突，请先另存当前内容。')
    doc.markdown = markdown; doc.revision = revision
    let backedUp = false
    try { backedUp = await this.persist() } catch { /* Disk Save remains available if recovery storage fails. */ }
    return { backedUp, dirty: doc.markdown !== doc.savedText, warning: backedUp ? '' : this.warning }
  }
  async activate(id) { this.get(id); this.activeId = id; await this.tryPersist(); return true }
  async save(id, targetPath) {
    const doc = this.get(id), path = await canonicalPath(targetPath || doc.path)
    if (this.documents.some(other => other.id !== id && other.path && pathKey(other.path) === pathKey(path))) throw new Error('该文件已经在另一标签中打开，请切到那一篇保存。')
    const sameFile = doc.path && pathKey(doc.path) === pathKey(path)
    if (sameFile) {
      let current
      try { current = digest(await fileBytes(path)) } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (current !== doc.baseline) {
        doc.conflict = true; await this.tryPersist()
        return { conflict: true, snapshot: this.snapshot() }
      }
      if (doc.markdown === doc.savedText) return { saved: true, snapshot: this.snapshot() }
    }
    const normalized = doc.markdown.replace(/\r\n?/g, '\n').replace(/\n/g, doc.eol)
    const bytes = Buffer.from((doc.bom ? '\ufeff' : '') + normalized)
    if (bytes.length > MAX_BYTES) throw new Error('保存后的文件超过 10 MB（包括换行和 BOM），请精简或拆分。原文件未修改。')
    await atomicWrite(path, bytes)
    Object.assign(doc, { path, title: basename(path), baseline: digest(bytes), savedText: doc.markdown, conflict: false })
    // A disk save succeeded even if recovery failed; report that separately.
    let warning = ''
    try { await this.persist() } catch (error) { warning = error.message }
    return { saved: true, warning, snapshot: this.snapshot() }
  }
  async reload(id) {
    const doc = this.get(id)
    if (!doc.path) throw new Error('未命名笔记没有磁盘文件。')
    const bytes = await fileBytes(doc.path), format = decode(bytes)
    Object.assign(doc, { markdown: format.text, savedText: format.text, bom: format.bom, eol: format.eol, baseline: digest(bytes), conflict: false, revision: doc.revision + 1 })
    await this.tryPersist(); return this.snapshot()
  }
  async close(id) {
    const index = this.documents.findIndex(doc => doc.id === id); if (index < 0) return this.snapshot()
    this.documents.splice(index, 1)
    if (this.activeId === id) this.activeId = this.documents[Math.min(index, this.documents.length - 1)]?.id
    if (!this.documents.length) return this.newDocument()
    await this.tryPersist(); return this.snapshot()
  }
}
