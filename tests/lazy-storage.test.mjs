import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { DocumentStore } from '../apps/desktop/src/main/documentStore.js'
import { RecoveryDatabase } from '../apps/desktop/src/main/recoveryDatabase.js'
const hash = text => createHash('sha256').update(text).digest('hex')
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-lazy-')), stores = []
  t.after(async () => { for (const store of stores) await store.dispose(); await rm(directory, { recursive: true, force: true }) })
  const make = (profile = join(directory, 'profile')) => { const store = new DocumentStore(profile); stores.push(store); return store }
  return { directory, make }
}
test('正式启动、全部快照和worker初始化只含元数据；正文按ID读取后不常驻main', async t => {
  const { make } = await fixture(t), store = make(); await store.restore()
  for (let i = 0; i < 5; i++) await store.newDocument(('正文' + i).repeat(10000), `note-${i}`)
  const restored = make(), snapshot = await restored.restore()
  assert.equal(snapshot.documents.length, 6)
  assert.ok(snapshot.documents.every(doc => !Object.hasOwn(doc, 'markdown')))
  assert.ok(restored.documents.every(doc => !Object.hasOwn(doc, 'markdown')))
  const worker = new RecoveryDatabase(store.directory, 100 * 1024 * 1024)
  const workerResult = await worker.request('initialize'); await worker.dispose()
  assert.ok(workerResult.documents.every(doc => !Object.hasOwn(doc, 'markdown') && doc.contentHash))
  const reads = [], request = restored.database.request.bind(restored.database)
  restored.database.request = (operation, payload) => { if (operation === 'read') reads.push(payload.id); return request(operation, payload) }
  const id = snapshot.documents[3].id
  assert.equal((await restored.read(id)).markdown, '正文2'.repeat(10000))
  assert.deepEqual(reads, [id]); assert.equal(restored.pending.size, 0)
  assert.ok(restored.documents.every(doc => !Object.hasOwn(doc, 'markdown')))
  await restored.update(id, '新正文', 1)
  assert.equal(restored.pending.size, 0)
  assert.ok((await restored.close(id)).documents.every(doc => !Object.hasOwn(doc, 'markdown')))
})
async function oldDatabase(profile, fail = false) {
  await mkdir(profile, { recursive: true })
  const db = new DatabaseSync(join(profile, 'drafts.sqlite'))
  db.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO settings VALUES('version','1'),('activeId','old');
    CREATE TABLE documents(id TEXT PRIMARY KEY,title TEXT NOT NULL,path TEXT,markdown TEXT NOT NULL,savedHash TEXT NOT NULL,baseline TEXT,bom INTEGER NOT NULL,eol TEXT NOT NULL,revision INTEGER NOT NULL,conflict INTEGER NOT NULL,viewState TEXT NOT NULL,position INTEGER NOT NULL,size INTEGER NOT NULL DEFAULT 0);`)
  db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('old','旧草稿',null,'保留旧正文',hash(''),null,0,'\n',7,0,'null',0,300)
  if (fail) db.exec("CREATE TRIGGER reject_migration BEFORE UPDATE ON documents BEGIN SELECT RAISE(ABORT,'migration failure'); END")
  db.close()
  await writeFile(join(profile, 'session.json'), 'already migrated; must not read this again')
}
for (const fail of [false, true]) test(`旧SQLite hash迁移${fail ? '失败回滚后可重试' : '保留数据'}且绝不重复导入旧JSON`, async t => {
  const { directory, make } = await fixture(t), profile = join(directory, 'old')
  await oldDatabase(profile, fail)
  let store = make(profile); await store.restore()
  if (fail) {
    assert.equal(store.recoveryWritable, false)
    const db = new DatabaseSync(store.databasePath)
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='version'").get().value, '1')
    assert.equal(db.prepare('SELECT markdown FROM documents WHERE id=?').get('old').markdown, '保留旧正文')
    assert.equal(db.prepare('PRAGMA table_info(documents)').all().some(row => row.name === 'contentHash'), false)
    db.exec('DROP TRIGGER reject_migration'); db.close()
    store = make(profile); await store.restore()
  }
  assert.equal(store.recoveryWritable, true)
  assert.deepEqual(store.documents.map(doc => doc.id), ['old'])
  assert.equal(store.get('old').contentHash, hash('保留旧正文'))
  assert.equal((await store.read('old')).markdown, '保留旧正文')
  assert.equal(store.get('old').revision, 7)
  await store.close('old')
  const next = make(profile); await next.restore()
  assert.equal(next.documents.some(doc => doc.id === 'old'), false)
  assert.equal(await readFile(join(profile, 'session.json'), 'utf8'), 'already migrated; must not read this again')
})
test('首次按需读取与保存核对外部文件：clean跟随、dirty/缺失/非法编码保留草稿', async t => {
  const { directory, make } = await fixture(t), file = join(directory, 'disk.md'), store = make()
  await store.restore(); await writeFile(file, 'old')
  const id = (await store.openFile(file)).activeId
  await writeFile(file, '\ufeffnew\r\n')
  const fresh = make(); await fresh.restore()
  assert.equal(fresh.get(id).revision, 0, '启动不扫描外部正文')
  assert.equal((await fresh.read(id)).markdown, 'new\n')
  assert.equal(fresh.get(id).bom, true); assert.equal(fresh.get(id).eol, '\r\n')
  await writeFile(file, 'saved outside')
  assert.equal((await fresh.save(id)).saved, true)
  assert.equal((await fresh.read(id)).markdown, 'saved outside')
  await fresh.update(id, 'keep dirty', fresh.get(id).revision + 1)
  await writeFile(file, Buffer.from([0xff]))
  assert.equal((await fresh.read(id)).markdown, 'keep dirty'); assert.equal(fresh.get(id).conflict, true)
  await rm(file)
  assert.equal((await fresh.save(id)).conflict, true)
  const rescue = join(directory, 'rescue.md'); await fresh.save(id, rescue)
  assert.equal(await readFile(rescue, 'utf8'), 'keep dirty')
})
test('关闭后的迟到正文读取被拒绝，不复活文档', async t => {
  const { make } = await fixture(t), store = make(); await store.restore()
  const id = store.activeId, request = store.database.request.bind(store.database)
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), waiting = new Promise(resolve => { entered = resolve })
  store.database.request = async (operation, payload) => {
    const result = await request(operation, payload)
    if (operation === 'read') { entered(); await gate }
    return result
  }
  const reading = store.read(id); await waiting; await store.close(id); release()
  await assert.rejects(reading, /已经关闭/)
  assert.equal(store.documents.some(doc => doc.id === id), false)
})
