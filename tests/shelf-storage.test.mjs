import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { DocumentStore } from '../apps/desktop/src/main/documentStore.js'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-shelf-')), stores = []
  t.after(async () => { for (const store of stores) await store.dispose(); await rm(directory, { recursive: true, force: true }) })
  const make = () => { const store = new DocumentStore(join(directory, 'profile')); stores.push(store); return store }
  const store = make(); await store.restore()
  return { directory, store, make }
}

test('收起保留正文与阅读位置；全部收起后重启保持空桌面，恢复不重复创建', async t => {
  const { store, make } = await fixture(t), first = store.activeId
  const text = '# 标题\n\n' + '正文'.repeat(3000)
  await store.update(first, text, 1); await store.rename(first, '保留的页面')
  await store.setViewState(first, { mode: 'source', scrollTop: 180, sourceSelection: { start: 2, end: 5 } })
  const second = (await store.newDocument('另一篇')).activeId
  await store.shelve(first)
  assert.equal(store.activeId, second)
  await store.shelve(second)
  assert.equal(store.activeId, null)
  const next = make(), saved = await next.restore()
  assert.equal(saved.documents.length, 2); assert.equal(saved.activeId, null)
  assert.ok(saved.documents.every(doc => doc.shelved && !Object.hasOwn(doc, 'markdown')))
  assert.equal(saved.documents[0].preview, text.slice(0, 1200))
  assert.equal((await next.read(first)).markdown, text)
  assert.equal(next.get(first).viewState.scrollTop, 180)
  await next.activate(first)
  const last = make(); await last.restore()
  assert.equal(last.activeId, first); assert.equal(last.get(first).shelved, false)
  assert.equal(last.get(second).shelved, true)
})

test('外部文件收起后重新打开复用原页面；移除和撤销从不删除磁盘原件', async t => {
  const { directory, store } = await fixture(t), path = join(directory, '原件.md')
  await writeFile(path, '磁盘正文')
  const id = (await store.openFile(path)).activeId
  await store.update(id, '尚未写回的正文', 1)
  await store.shelve(id); await store.openFile(path)
  assert.equal(store.activeId, id); assert.equal(store.get(id).shelved, false)
  assert.equal(store.documents.filter(doc => doc.path).length, 1)
  await store.remove(id)
  assert.equal(await readFile(path, 'utf8'), '磁盘正文')
  assert.equal(store.snapshot().undoRemoval, '原件.md')
  const restored = await store.undoRemove(), newId = restored.activeId
  assert.notEqual(newId, id)
  assert.equal((await store.read(newId)).markdown, '尚未写回的正文')
  assert.equal(store.get(newId).path, path)
  await assert.rejects(store.update(id, '迟到覆盖', 10), /已经关闭/)
  assert.equal(await readFile(path, 'utf8'), '磁盘正文')
})

test('移除的文件被重新打开后，撤销把旧修改恢复成独立草稿而不覆盖新页面', async t => {
  const { directory, store } = await fixture(t), path = join(directory, '重开.md')
  await writeFile(path, '磁盘原文')
  const removedId = (await store.openFile(path)).activeId
  await store.update(removedId, '要撤销恢复的修改', 1)
  await store.remove(removedId)
  const reopenedId = (await store.openFile(path)).activeId
  const result = await store.undoRemove(), restoredId = result.activeId
  assert.notEqual(restoredId, reopenedId)
  assert.equal(store.get(restoredId).path, null)
  assert.equal((await store.read(restoredId)).markdown, '要撤销恢复的修改')
  assert.equal((await store.read(reopenedId)).markdown, '磁盘原文')
  assert.equal(store.documents.filter(doc => doc.path === path).length, 1)
  assert.match(result.info, /独立草稿/)
})

test('删除收起页面后撤销仍为收起；最后一篇删除不隐式创建新页', async t => {
  const { store } = await fixture(t), id = store.activeId
  await store.update(id, '恢复这段', 1); await store.shelve(id)
  await store.remove(id)
  assert.equal(store.documents.length, 0); assert.equal(store.activeId, null)
  const result = await store.undoRemove()
  assert.equal(result.documents.length, 1); assert.equal(result.activeId, null)
  assert.equal(result.documents[0].shelved, true)
  assert.equal((await store.read(result.documents[0].id)).markdown, '恢复这段')
  assert.equal(result.undoRemoval, null)
})

for (const operation of ['shelve', 'remove']) test(`${operation}提交失败保留页面，后续普通flush不会偷偷执行失败操作`, async t => {
  const { store, make } = await fixture(t), id = store.activeId
  await store.update(id, '不能丢', 1)
  const db = new DatabaseSync(store.databasePath)
  try {
    db.exec("CREATE TRIGGER reject_layout BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT,'write rejected'); END")
    await assert.rejects(store[operation](id), /备份失败/)
    assert.equal(store.get(id).shelved, false); assert.equal(store.activeId, id)
    assert.equal((await store.read(id)).markdown, '不能丢')
    assert.equal(store.lastRemoved, null)
    db.exec('DROP TRIGGER reject_layout')
    await store.persist()
    const next = make(); await next.restore()
    assert.equal(next.activeId, id); assert.equal(next.get(id).shelved, false)
    assert.equal((await next.read(id)).markdown, '不能丢')
  } finally { db.close() }
})

test('撤销失败不消耗恢复内容，重试成功后只恢复一篇', async t => {
  const { store } = await fixture(t), id = store.activeId
  await store.update(id, '保留撤销', 1); await store.remove(id)
  const db = new DatabaseSync(store.databasePath)
  try {
    db.exec("CREATE TRIGGER reject_insert BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT,'write rejected'); END")
    await assert.rejects(store.undoRemove(), /备份失败/)
    assert.equal(store.documents.length, 0); assert.ok(store.lastRemoved)
    db.exec('DROP TRIGGER reject_insert')
    await store.undoRemove()
    assert.equal(store.documents.length, 1)
    assert.equal((await store.read(store.activeId)).markdown, '保留撤销')
    await store.undoRemove(); assert.equal(store.documents.length, 1)
  } finally { db.close() }
})

test('schema 2 原数据迁移为打开状态且不重导旧JSON', async t => {
  const { directory, store, make } = await fixture(t)
  await store.dispose()
  const profile = join(directory, 'profile'), hash = value => createHash('sha256').update(value).digest('hex')
  const db = new DatabaseSync(join(profile, 'drafts.sqlite'))
  try {
    db.exec("DELETE FROM documents; ALTER TABLE documents DROP COLUMN shelved; UPDATE settings SET value='2' WHERE key='version'; UPDATE settings SET value='old' WHERE key='activeId'")
    db.prepare('INSERT INTO documents(id,title,path,markdown,savedHash,contentHash,baseline,bom,eol,revision,conflict,viewState,position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('old', '旧草稿', null, '旧正文', hash(''), hash('旧正文'), null, 0, '\n', 3, 0, 'null', 0)
  } finally { db.close() }
  await writeFile(join(profile, 'session.json'), '不能重新导入')
  const next = make(); await next.restore()
  assert.equal(next.activeId, 'old'); assert.equal(next.get('old').shelved, false)
  assert.equal((await next.read('old')).markdown, '旧正文')
  const check = new DatabaseSync(next.databasePath)
  try { assert.equal(check.prepare("SELECT value FROM settings WHERE key='version'").get().value, '3') } finally { check.close() }
})
