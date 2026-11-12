import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const { directory, maxSessionBytes } = workerData
const columns = ['title', 'path', 'markdown', 'contentHash', 'savedHash', 'baseline', 'bom', 'eol', 'revision', 'conflict', 'viewState', 'position', 'shelved']
const digest = text => createHash('sha256').update(text).digest('hex')
let db
function transaction(action) {
  db.exec('BEGIN IMMEDIATE')
  try { const result = action(); db.exec('COMMIT'); return result }
  catch (error) { db.exec('ROLLBACK'); throw error }
}
function encode(key, value) {
  if (key === 'viewState') return JSON.stringify(value ?? null)
  if (key === 'bom' || key === 'conflict' || key === 'shelved') return value ? 1 : 0
  return value
}
function insert(doc) {
  db.prepare(`INSERT INTO documents (id, ${columns.join(',')}) VALUES (${Array(columns.length + 1).fill('?').join(',')})`)
    .run(doc.id, ...columns.map(key => encode(key, doc[key])))
}
function checkCapacity() {
  // size is updated only on the changed row; the aggregate never scans body text.
  const total = db.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM documents').get().total
  if (total > maxSessionBytes) throw new Error('会话备份超过容量上限，请先保存并从页面列表移除部分笔记（仅收起不会释放容量）。')
}
function legacySession() {
  const path = join(directory, 'session.json')
  let bytes
  try {
    if (statSync(path).size > maxSessionBytes) throw new Error('Recovery too large')
    bytes = readFileSync(path)
  } catch (error) { if (error.code === 'ENOENT') return { documents: [], activeId: null }; throw error }
  if (bytes.length > maxSessionBytes) throw new Error('Recovery too large')
  const saved = JSON.parse(bytes.toString('utf8'))
  if (saved.version !== 1 || !Array.isArray(saved.documents) || saved.documents.some(doc => !doc || typeof doc.id !== 'string' || typeof doc.markdown !== 'string' || typeof doc.savedText !== 'string' || typeof doc.title !== 'string' || !Number.isSafeInteger(doc.revision) || doc.revision < 0 || (doc.path !== null && typeof doc.path !== 'string') || !['\n', '\r\n'].includes(doc.eol) || typeof doc.bom !== 'boolean' || (doc.baseline !== null && !/^[0-9a-f]{64}$/.test(doc.baseline)))) throw new Error('Invalid recovery file')
  if (new Set(saved.documents.map(doc => doc.id)).size !== saved.documents.length) throw new Error('Duplicate documents')
  return { activeId: saved.activeId, documents: saved.documents.map((doc, position) => ({
    id: doc.id, title: doc.title, path: doc.path, markdown: doc.markdown,
    savedHash: digest(doc.savedText), contentHash: digest(doc.markdown), baseline: doc.baseline, bom: doc.bom, eol: doc.eol,
    revision: doc.revision, conflict: Boolean(doc.conflict), viewState: null, position,
  })) }
}
function initialize() {
  mkdirSync(directory, { recursive: true })
  db = new DatabaseSync(join(directory, 'drafts.sqlite'))
  db.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, path TEXT, markdown TEXT NOT NULL,
      savedHash TEXT NOT NULL, contentHash TEXT NOT NULL DEFAULT '', baseline TEXT, bom INTEGER NOT NULL, eol TEXT NOT NULL,
      revision INTEGER NOT NULL, conflict INTEGER NOT NULL, viewState TEXT NOT NULL,
      position INTEGER NOT NULL, size INTEGER NOT NULL DEFAULT 0, shelved INTEGER NOT NULL DEFAULT 0
    );
    CREATE TRIGGER IF NOT EXISTS document_insert_size AFTER INSERT ON documents BEGIN
      UPDATE documents SET size=length(CAST(NEW.markdown AS BLOB))+length(CAST(NEW.title AS BLOB))+length(CAST(COALESCE(NEW.path,'') AS BLOB))+length(CAST(NEW.viewState AS BLOB))+256 WHERE id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS document_update_size AFTER UPDATE OF markdown,title,path,viewState ON documents BEGIN
      UPDATE documents SET size=length(CAST(NEW.markdown AS BLOB))+length(CAST(NEW.title AS BLOB))+length(CAST(COALESCE(NEW.path,'') AS BLOB))+length(CAST(NEW.viewState AS BLOB))+256 WHERE id=NEW.id;
    END;`)
  const version = db.prepare("SELECT value FROM settings WHERE key='version'").get()?.value
  if (version && !['1', '2', '3'].includes(version)) throw new Error('Unsupported recovery version')
  // Old databases already record JSON migration. Never import that JSON again.
  // Backfill one bounded row at a time, atomically with the schema/version change.
  if (version === '1') transaction(() => {
    if (!db.prepare('PRAGMA table_info(documents)').all().some(column => column.name === 'contentHash'))
      db.exec("ALTER TABLE documents ADD COLUMN contentHash TEXT NOT NULL DEFAULT ''")
    const update = db.prepare('UPDATE documents SET contentHash=? WHERE id=?')
    for (const doc of db.prepare('SELECT id, markdown FROM documents').iterate()) update.run(digest(doc.markdown), doc.id)
    db.prepare("UPDATE settings SET value='2' WHERE key='version'").run()
  })
  if (!version) {
    const saved = legacySession()
    transaction(() => {
      if (!db.prepare('PRAGMA table_info(documents)').all().some(column => column.name === 'contentHash'))
        db.exec("ALTER TABLE documents ADD COLUMN contentHash TEXT NOT NULL DEFAULT ''")
      for (const doc of saved.documents) insert(doc)
      checkCapacity()
      db.prepare("INSERT INTO settings (key,value) VALUES ('version','2'),('activeId',?)").run(typeof saved.activeId === 'string' ? saved.activeId : null)
    })
  }
  if (version !== '3') transaction(() => {
    if (!db.prepare('PRAGMA table_info(documents)').all().some(column => column.name === 'shelved'))
      db.exec('ALTER TABLE documents ADD COLUMN shelved INTEGER NOT NULL DEFAULT 0')
    db.prepare("UPDATE settings SET value='3' WHERE key='version'").run()
  })
  checkCapacity()
  return {
    // Bounded previews are metadata; no full body crosses the startup boundary.
    documents: db.prepare(`SELECT id, ${columns.filter(key => key !== 'markdown').join(',')}, substr(markdown,1,1200) AS preview FROM documents ORDER BY position`).all().map(doc => ({ ...doc, bom: Boolean(doc.bom), conflict: Boolean(doc.conflict), shelved: Boolean(doc.shelved), viewState: JSON.parse(doc.viewState) })),
    activeId: db.prepare("SELECT value FROM settings WHERE key='activeId'").get()?.value,
  }
}
function apply({ changes, deletions, activeId }) {
  return transaction(() => {
    for (const id of deletions) db.prepare('DELETE FROM documents WHERE id=?').run(id)
    for (const change of changes) {
      if (change.insert) insert(change.document)
      else {
        const keys = Object.keys(change.fields)
        if (!keys.length || keys.some(key => !columns.includes(key))) throw new Error('Invalid document update')
        const result = db.prepare(`UPDATE documents SET ${keys.map(key => `${key}=?`).join(',')} WHERE id=?`)
          .run(...keys.map(key => encode(key, change.fields[key])), change.id)
        if (!result.changes) throw new Error('笔记已经关闭。')
      }
    }
    checkCapacity()
    db.prepare("UPDATE settings SET value=? WHERE key='activeId'").run(activeId)
    return true
  })
}
// Each message finishes its short synchronous transaction before the next message.
parentPort.on('message', ({ id, operation, payload }) => {
  try {
    let result
    if (operation === 'initialize') result = initialize()
    else if (operation === 'read') {
      const row = db.prepare('SELECT markdown FROM documents WHERE id=?').get(payload.id)
      if (!row) throw new Error('笔记已经关闭。')
      result = row.markdown
    }
    else if (operation === 'apply') result = apply(payload)
    else if (operation === 'close') { db?.close(); db = null; result = true }
    else throw new Error('Unknown storage operation')
    parentPort.postMessage({ id, result })
  } catch (error) { parentPort.postMessage({ id, error: error.message }) }
})
