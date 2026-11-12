import { readFile, open, rename, unlink, realpath, stat } from 'node:fs/promises'
import { dirname, basename, resolve, join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { RecoveryDatabase } from './recoveryDatabase.js'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_SESSION_BYTES = 100 * 1024 * 1024
const UNTITLED = '未命名笔记'
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
  return { markdown: text.replace(/\r\n?/g, '\n'), bom, eol }
}
export function suggestedFilename(title, extension = 'md') {
  let name = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim()
  name = name.replace(/\.(md|markdown|txt)$/i, '').slice(0, 120).replace(/[. ]+$/g, '')
  if (!name) name = UNTITLED
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name = '_' + name
  return `${name}.${extension}`
}
function viewState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || Object.keys(state).some(key => !['mode', 'scrollTop', 'selection', 'sourceSelection', 'sourceScrollTop'].includes(key))) throw new Error('阅读状态无效。')
  if (!['rendered', 'source'].includes(state.mode) || !Number.isFinite(state.scrollTop) || state.scrollTop < 0 || state.scrollTop > Number.MAX_SAFE_INTEGER) throw new Error('阅读状态无效。')
  const result = { mode: state.mode, scrollTop: state.scrollTop }
  if (state.sourceScrollTop !== undefined) {
    if (!Number.isFinite(state.sourceScrollTop) || state.sourceScrollTop < 0 || state.sourceScrollTop > Number.MAX_SAFE_INTEGER) throw new Error('阅读状态无效。')
    result.sourceScrollTop = state.sourceScrollTop
  }
  for (const [key, names] of [['selection', ['anchor', 'head']], ['sourceSelection', ['start', 'end']]]) {
    if (state[key] === undefined) continue
    const value = state[key]
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(name => !names.includes(name)) || names.some(name => !Number.isSafeInteger(value[name]) || value[name] < 0)) throw new Error('阅读状态无效。')
    result[key] = Object.fromEntries(names.map(name => [name, value[name]]))
  }
  return result
}
export class DocumentStore {
  constructor(directory, { maxSessionBytes = MAX_SESSION_BYTES } = {}) {
    this.maxSessionBytes = maxSessionBytes
    this.directory = directory; this.sessionPath = join(directory, 'session.json'); this.databasePath = join(directory, 'drafts.sqlite')
    this.documents = []; this.activeId = null; this.warning = ''; this.recoveryWritable = true
    this.pending = new Map(); this.deleted = new Set(); this.persistedIds = new Set(); this.position = 0
    this.lastRemoved = null
  }
  get(id) {
    const doc = this.documents.find(doc => doc.id === id)
    if (!doc) throw new Error('笔记已经关闭。')
    return doc
  }
  isDirty(doc) { return doc.contentHash !== doc.savedHash }
  needsRecovery(doc) {
    // External-file dirtiness alone cannot detect a draft reset to empty/default:
    // the database may still contain its previous body or name after a failed commit.
    return this.isDirty(doc) || (!doc.path && (doc.title !== UNTITLED ||
      (this.persistedIds.has(doc.id) && this.pending.has(doc.id))))
  }
  canExitWithoutRecovery() { return !this.deleted.size && !this.documents.some(doc => this.needsRecovery(doc)) }
  metadata(doc) {
    return { id: doc.id, title: doc.title, path: doc.path, revision: doc.revision,
      dirty: this.isDirty(doc), conflict: doc.conflict, viewState: structuredClone(doc.viewState), shelved: Boolean(doc.shelved), preview: doc.preview || '' }
  }
  listMetadata() { return { documents: this.documents.map(doc => this.metadata(doc)), activeId: this.activeId, warning: this.warning, undoRemoval: this.lastRemoved?.doc.title || null } }
  async body(id) {
    this.get(id)
    const pending = this.pending.get(id)?.fields
    const markdown = pending && Object.hasOwn(pending, 'markdown') ? pending.markdown : await this.database.request('read', { id })
    this.get(id)
    return markdown
  }
  async read(id) {
    const doc = this.get(id)
    await this.checkExternal(doc)
    const markdown = await this.body(id)
    return { ...this.metadata(doc), markdown, warning: this.warning }
  }
  snapshot() { return this.listMetadata() }
  async checkExternal(doc) {
    if (!doc.path) return
    try {
      const bytes = await fileBytes(doc.path), baseline = digest(bytes), format = decode(bytes)
      if (!this.isDirty(doc) && baseline !== doc.baseline) {
        const { markdown, ...formatMetadata } = format
        const fields = { ...formatMetadata, baseline, savedHash: digest(markdown), contentHash: digest(markdown), conflict: false, revision: doc.revision + 1 }
        Object.assign(doc, fields, { preview: markdown.slice(0, 1200) }); this.mark(doc, { ...fields, markdown })
      } else if (doc.conflict !== (baseline !== doc.baseline)) {
        doc.conflict = baseline !== doc.baseline; this.mark(doc, { conflict: doc.conflict })
      }
    } catch { if (!doc.conflict) { doc.conflict = true; this.mark(doc, { conflict: true }) } }
    if (this.pending.has(doc.id)) await this.tryPersist()
  }
  mark(doc, fields, insert = false) {
    const previous = this.pending.get(doc.id)
    this.pending.set(doc.id, { insert: insert || previous?.insert || false, fields: { ...previous?.fields, ...fields } })
  }
  async restore() {
    try {
      this.database = new RecoveryDatabase(this.directory, this.maxSessionBytes)
      const saved = await this.database.request('initialize')
      this.documents = saved.documents
      this.persistedIds = new Set(this.documents.map(doc => doc.id))
      this.position = Math.max(-1, ...this.documents.map(doc => doc.position)) + 1
      this.activeId = this.documents.some(doc => doc.id === saved.activeId && !doc.shelved) ? saved.activeId : this.documents.find(doc => !doc.shelved)?.id || null
      // Check disk only when this document is read or saved.
    } catch {
      this.warning = '恢复文件无法读取，原文件已保留。本次会话不能自动备份，请用保存或另存为保留内容。'
      this.recoveryWritable = false; this.documents = []; this.activeId = null
    }
    if (!this.documents.length) await this.newDocument()
    else await this.tryPersist()
    return this.snapshot()
  }
  async persist() {
    if (!this.recoveryWritable) return false
    // Capture only modified columns. A rename/activation never transfers other bodies.
    const pending = new Map(this.pending), deletions = [...this.deleted]
    const changes = [...pending].map(([id, change]) => {
      if (!change.insert) return { id, fields: change.fields }
      return { insert: true, document: { ...this.get(id), ...change.fields } }
    })
    try {
      await this.database.request('apply', { changes, deletions, activeId: this.activeId })
      for (const change of changes) if (change.insert) this.persistedIds.add(change.document.id)
      for (const [id, value] of pending) if (this.pending.get(id) === value) this.pending.delete(id)
      for (const id of deletions) { this.deleted.delete(id); this.persistedIds.delete(id) }
      this.warning = ''
      return true
    } catch (error) {
      this.warning = error.message.includes('容量上限') ? error.message : '草稿备份失败。请保存到文件；当前页面内容仍保留。'
      throw new Error(this.warning, { cause: error })
    }
  }
  async tryPersist() { try { return await this.persist() } catch { return false } }
  async dispose() { await this.database?.dispose() }
  async newDocument(markdown = '', title = UNTITLED) {
    const doc = { id: randomUUID(), title, savedHash: digest(''), contentHash: digest(markdown), path: null, baseline: null, bom: false, eol: '\n', revision: 0, conflict: false, viewState: null, position: this.position++, shelved: false, preview: markdown.slice(0, 1200) }
    this.documents.push(doc); this.activeId = doc.id; this.mark(doc, { markdown }, true)
    await this.tryPersist(); return this.snapshot()
  }
  async openFile(path) {
    const canonical = await canonicalPath(path)
    const existing = this.documents.find(doc => doc.path && pathKey(doc.path) === pathKey(canonical))
    if (existing) { await this.activate(existing.id); return this.snapshot() }
    const bytes = await fileBytes(canonical), { markdown, ...format } = decode(bytes)
    const doc = { id: randomUUID(), title: basename(canonical), ...format, savedHash: digest(markdown), contentHash: digest(markdown), path: canonical, baseline: digest(bytes), revision: 0, conflict: false, viewState: null, position: this.position++, shelved: false, preview: markdown.slice(0, 1200) }
    this.documents.push(doc); this.activeId = doc.id; this.mark(doc, { markdown }, true)
    await this.tryPersist(); return this.snapshot()
  }
  async update(id, markdown, revision) {
    if (typeof markdown !== 'string' || Buffer.byteLength(markdown) > MAX_BYTES || !Number.isSafeInteger(revision) || revision < 0) throw new Error('笔记内容或版本无效。')
    const doc = this.get(id)
    if (revision < doc.revision) return { backedUp: false, stale: true }
    const contentHash = digest(markdown)
    if (revision === doc.revision && contentHash !== doc.contentHash) throw new Error('笔记版本冲突，请先另存当前内容。')
    if (contentHash !== doc.contentHash || revision !== doc.revision) {
      doc.revision = revision; doc.contentHash = contentHash; doc.preview = markdown.slice(0, 1200)
      this.mark(doc, { markdown, revision, contentHash })
    }
    const backedUp = await this.tryPersist()
    return { backedUp, dirty: this.isDirty(doc), warning: backedUp ? '' : this.warning }
  }
  async rename(id, title) {
    const doc = this.get(id)
    if (doc.path) throw new Error('只能命名未关联文件的草稿。')
    if (typeof title !== 'string' || Buffer.byteLength(title) > 1024) throw new Error('笔记名称无效或过长。')
    doc.title = title.trim() || UNTITLED; this.mark(doc, { title: doc.title })
    const backedUp = await this.tryPersist()
    return { id, title: doc.title, backedUp, warning: backedUp ? '' : this.warning }
  }
  async setViewState(id, state) {
    const doc = this.get(id); doc.viewState = viewState(state); this.mark(doc, { viewState: doc.viewState })
    const saved = await this.tryPersist()
    return { saved, warning: saved ? '' : this.warning }
  }
  // Shelf/removal changes only become visible after a confirmed commit. Failed
  // mutations restore both metadata and pending writes, so a later flush cannot delete a visible page.
  async changeLayout(change) {
    const previous = { documents: this.documents.map(doc => ({ ...doc })), activeId: this.activeId,
      pending: new Map(this.pending), deleted: new Set(this.deleted) }
    try {
      change()
      if (!await this.persist()) throw new Error(this.warning || '页面状态无法保存，请恢复备份后重试。')
    } catch (error) {
      Object.assign(this, previous)
      throw error
    }
  }
  async activate(id) {
    const doc = this.get(id)
    if (doc.shelved) await this.changeLayout(() => { doc.shelved = false; this.mark(doc, { shelved: false }); this.activeId = id })
    else { this.activeId = id; await this.tryPersist() }
    return true
  }
  async shelve(id) {
    const doc = this.get(id)
    await this.changeLayout(() => {
      doc.shelved = true; this.mark(doc, { shelved: true })
      if (this.activeId === id) {
        const index = this.documents.indexOf(doc), visible = this.documents.filter(other => !other.shelved)
        this.activeId = visible.find(other => this.documents.indexOf(other) > index)?.id || visible.at(-1)?.id || null
      }
    })
    return this.snapshot()
  }
  async changeShelved(select, activeId) {
    await this.changeLayout(() => {
      for (const doc of this.documents) {
        const shelved = select(doc)
        if (doc.shelved === shelved) continue
        doc.shelved = shelved; this.mark(doc, { shelved })
      }
      this.activeId = activeId
    })
    return this.snapshot()
  }
  async expandAll() {
    return this.changeShelved(() => false, this.activeId || this.documents[0]?.id || null)
  }
  async shelveOthers(id) {
    this.get(id)
    return this.changeShelved(doc => doc.id !== id, id)
  }
  async shelveAll() {
    return this.changeShelved(() => true, null)
  }
  async remove(id) {
    const doc = this.get(id), index = this.documents.indexOf(doc), markdown = await this.body(id)
    const removed = { doc: structuredClone(doc), markdown, index, wasActive: this.activeId === id }
    await this.changeLayout(() => {
      this.documents.splice(index, 1); this.pending.delete(id)
      if (this.persistedIds.has(id)) this.deleted.add(id)
      if (this.activeId === id) this.activeId = this.documents.slice(index).find(other => !other.shelved)?.id || this.documents.findLast(other => !other.shelved)?.id || null
    })
    this.lastRemoved = removed
    return this.snapshot()
  }
  async undoRemove() {
    const removed = this.lastRemoved
    if (!removed) return this.snapshot()
    const reopened = removed.doc.path && this.documents.some(doc => doc.path && pathKey(doc.path) === pathKey(removed.doc.path))
    // A fresh ID prevents pre-deletion replies/updates from targeting the restored page.
    const doc = { ...structuredClone(removed.doc), id: randomUUID() }
    if (reopened) Object.assign(doc, { path: null, title: `${doc.title}（恢复的草稿）`, baseline: null, savedHash: digest(''), conflict: false })
    await this.changeLayout(() => {
      this.documents.splice(Math.min(removed.index, this.documents.length), 0, doc)
      this.mark(doc, { markdown: removed.markdown }, true)
      if (removed.wasActive || (!this.activeId && !doc.shelved)) this.activeId = doc.id
    })
    this.lastRemoved = null
    return { ...this.snapshot(), ...(reopened ? { info: '文件已经重新打开，旧内容已恢复为独立草稿。' } : {}) }
  }
  async save(id, targetPath) {
    const doc = this.get(id), path = await canonicalPath(targetPath || doc.path)
    if (this.documents.some(other => other.id !== id && other.path && pathKey(other.path) === pathKey(path))) throw new Error('该文件已经在另一标签中打开，请切到那一篇保存。')
    const sameFile = doc.path && pathKey(doc.path) === pathKey(path)
    await this.checkExternal(doc)
    if (sameFile) {
      if (doc.conflict) return { conflict: true, snapshot: this.snapshot() }
      if (!this.isDirty(doc)) return { saved: true, warning: this.warning, snapshot: this.snapshot() }
    }
    const markdown = await this.body(id)
    const normalized = markdown.replace(/\r\n?/g, '\n').replace(/\n/g, doc.eol)
    const bytes = Buffer.from((doc.bom ? '\ufeff' : '') + normalized)
    if (bytes.length > MAX_BYTES) throw new Error('保存后的文件超过 10 MB（包括换行和 BOM），请精简或拆分。原文件未修改。')
    await atomicWrite(path, bytes)
    const fields = { path, title: basename(path), baseline: digest(bytes), savedHash: doc.contentHash, conflict: false }
    Object.assign(doc, fields); this.mark(doc, fields)
    // Successful external file writes remain usable even when SQLite is unavailable.
    const backedUp = await this.tryPersist()
    return { saved: true, warning: backedUp ? '' : this.warning, snapshot: this.snapshot() }
  }
  async reload(id) {
    const doc = this.get(id)
    if (!doc.path) throw new Error('未命名笔记没有磁盘文件。')
    const bytes = await fileBytes(doc.path), { markdown, ...format } = decode(bytes)
    const fields = { ...format, savedHash: digest(markdown), contentHash: digest(markdown), baseline: digest(bytes), conflict: false, revision: doc.revision + 1 }
    Object.assign(doc, fields, { preview: markdown.slice(0, 1200) }); this.mark(doc, { ...fields, markdown })
    await this.tryPersist(); return this.snapshot()
  }
  async close(id) {
    const index = this.documents.findIndex(doc => doc.id === id); if (index < 0) return this.snapshot()
    this.documents.splice(index, 1); this.pending.delete(id)
    if (this.persistedIds.has(id)) this.deleted.add(id)
    if (this.activeId === id) this.activeId = this.documents[Math.min(index, this.documents.length - 1)]?.id
    // Delete and replacement creation commit together, including activeId.
    if (!this.documents.length) return this.newDocument()
    await this.tryPersist(); return this.snapshot()
  }
}
