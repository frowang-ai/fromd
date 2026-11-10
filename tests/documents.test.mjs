import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentStore, suggestedFilename } from '../apps/desktop/src/main/documentStore.js'
import { DatabaseSync } from 'node:sqlite'
import { operationQueue, openFileArguments } from '../apps/desktop/src/main/lifecycle.js'

const stores = new WeakMap()
function makeStore(t, ...args) {
  const store = new DocumentStore(...args)
  if (!stores.has(t)) stores.set(t, [])
  stores.get(t).push(store)
  return store
}
function storedDocument(store, id) {
  const db = new DatabaseSync(store.databasePath, { readOnly: true })
  try { return db.prepare('SELECT * FROM documents WHERE id=?').get(id) }
  finally { db.close() }
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-docs-'))
  t.after(async () => { for (const store of stores.get(t) || []) await store.dispose(); await rm(directory, { recursive: true, force: true }) })
  const store = makeStore(t, join(directory, 'profile')); await store.restore()
  return { directory, store }
}
test('打开去重、保存保留 BOM/CRLF、另存为不修改原文件', async t => {
  const { directory, store } = await fixture(t), path = join(directory, '中文 文件.md')
  await writeFile(path, '\ufeff# 标题\r\n\r\n原文\r\n')
  const doc = (await store.openFile(path)).documents.at(-1)
  await store.openFile(path)
  assert.equal(store.documents.length, 2)
  await store.update(doc.id, '# 标题\n\n修改\n', 1)
  assert.equal((await store.save(doc.id)).saved, true)
  assert.equal(await readFile(path, 'utf8'), '\ufeff# 标题\r\n\r\n修改\r\n')
  await store.update(doc.id, '另存正文', 2)
  const target = join(directory, '另存.md'); await store.save(doc.id, target)
  assert.equal(await readFile(target, 'utf8'), '\ufeff另存正文')
  assert.equal(await readFile(path, 'utf8'), '\ufeff# 标题\r\n\r\n修改\r\n')
})
test('外部修改或删除不被静默覆盖，另存可保留草稿', async t => {
  const { directory, store } = await fixture(t), path = join(directory, 'note.md')
  await writeFile(path, '原文')
  const doc = (await store.openFile(path)).documents.at(-1)
  await store.update(doc.id, '本机草稿', 1); await writeFile(path, '外部修改')
  assert.equal((await store.save(doc.id)).conflict, true)
  assert.equal(await readFile(path, 'utf8'), '外部修改')
  assert.equal((await store.read(doc.id)).markdown, '本机草稿')
  await store.save(doc.id, join(directory, 'copy.md'))
  assert.equal(store.get(doc.id).conflict, false)
  await rm(store.get(doc.id).path); await store.update(doc.id, '新草稿', 2)
  assert.equal((await store.save(doc.id)).conflict, true)
})
test('恢复全部草稿与活动标签，并保留磁盘基线冲突', async t => {
  const { directory, store } = await fixture(t), path = join(directory, 'note.md')
  const first = store.documents[0]; await store.update(first.id, '未命名草稿', 1)
  await writeFile(path, '磁盘原文'); const second = (await store.openFile(path)).documents.at(-1)
  await store.update(second.id, '未保存修改', 1); await writeFile(path, '别人修改')
  const restored = makeStore(t, store.directory), snapshot = await restored.restore()
  assert.equal(snapshot.activeId, second.id)
  assert.equal((await restored.read(snapshot.documents[0].id)).markdown, '未命名草稿')
  assert.equal((await restored.read(snapshot.documents[1].id)).markdown, '未保存修改')
  assert.equal((await restored.read(snapshot.documents[1].id)).conflict, true)
  assert.equal((await restored.save(second.id)).conflict, true)
})
test('旧版本更新不能回退草稿，关闭最后一篇创建空白', async t => {
  const { store } = await fixture(t), doc = store.documents[0]
  await store.update(doc.id, '新版本', 2); await store.update(doc.id, '旧版本', 1)
  assert.equal((await store.read(doc.id)).markdown, '新版本')
  await assert.rejects(store.update(doc.id, '冲突版本', 2), /版本冲突/)
  await store.close(doc.id)
  assert.equal(store.documents.length, 1); assert.equal((await store.read(store.documents[0].id)).markdown, '')
})
test('损坏恢复文件保留原件，仍可另存当前内容', async t => {
  const { directory } = await fixture(t)
  const legacy = join(directory, 'legacy'); await mkdir(legacy)
  await writeFile(join(legacy, 'session.json'), 'broken recovery')
  const next = makeStore(t, legacy); await next.restore()
  assert.equal(next.recoveryWritable, false)
  const doc = next.documents[0]; await next.update(doc.id, '保留内容', 1)
  assert.equal((await next.save(doc.id, join(directory, 'rescue.md'))).saved, true)
  assert.equal(await readFile(next.sessionPath, 'utf8'), 'broken recovery')
})
test('备份容量读写一致，超限不覆盖可恢复的旧会话', async t => {
  const { directory } = await fixture(t)
  const store = makeStore(t, join(directory, 'bounded'), { maxSessionBytes: 1400 })
  await store.restore(); const doc = store.documents[0]
  assert.equal((await store.update(doc.id, 'A'.repeat(500), 1)).backedUp, true)
  const previous = storedDocument(store, doc.id)
  assert.equal((await store.update(doc.id, 'B'.repeat(1600), 2)).backedUp, false)
  assert.deepEqual(storedDocument(store, doc.id), previous)
  const restored = makeStore(t, store.directory, { maxSessionBytes: 1400 })
  await restored.restore(); assert.equal((await restored.read(doc.id)).markdown, 'A'.repeat(500))
  assert.equal((await store.read(doc.id)).markdown, 'B'.repeat(1600))
  assert.equal((await store.save(doc.id, join(directory, 'large.md'))).saved, true)
})
test('CRLF保存膨胀超限时不覆盖原文件，草稿仍在', async t => {
  const { directory, store } = await fixture(t), path = join(directory, 'crlf.md')
  await writeFile(path, 'original\r\n'); const doc = (await store.openFile(path)).documents.at(-1)
  await store.update(doc.id, 'x\n'.repeat(4 * 1024 * 1024), 1)
  await assert.rejects(store.save(doc.id), /超过 10 MB/)
  assert.equal(await readFile(path, 'utf8'), 'original\r\n')
  assert.equal((await store.read(doc.id)).markdown.length, 8 * 1024 * 1024)
})
test('首次恢复目录不可写仍能编辑并保存到其他目录', async t => {
  const { directory } = await fixture(t), badDirectory = join(directory, 'not-a-directory')
  await writeFile(badDirectory, 'keep')
  const store = makeStore(t, badDirectory); await store.restore()
  assert.equal(store.documents.length, 1)
  const doc = store.documents[0]; await store.update(doc.id, 'rescue', 1)
  assert.equal((await store.save(doc.id, join(directory, 'rescue.md'))).saved, true)
  assert.equal(store.snapshot().documents[0].dirty, false)
  assert.equal(await store.tryPersist(), false)
  await store.close(doc.id)
  assert.equal(store.canExitWithoutRecovery(), true, '从未成功备份的标签关闭不产生待删除数据库行')
})
test('恢复完成前二次启动请求排队，旧草稿先恢复再追加文件', async t => {
  const { directory, store } = await fixture(t), draft = store.documents[0]
  await store.update(draft.id, '不能丢失', 1)
  const path = join(directory, 'second.md'); await writeFile(path, '新文件')
  let release
  const gate = new Promise(resolve => { release = resolve })
  const restored = makeStore(t, store.directory)
  const initialization = gate.then(() => restored.restore())
  const serialize = operationQueue(initialization)
  const second = serialize(() => restored.openFile(path))
  assert.equal(restored.documents.length, 0)
  release(); await second
  assert.equal((await restored.read(restored.documents[0].id)).markdown, '不能丢失')
  assert.equal((await restored.read(restored.documents[1].id)).markdown, '新文件')
  assert.deepEqual(openFileArguments(['note.md'], directory), [join(directory, 'note.md')])
})

test('不同标签不能另存覆盖同一个打开文件，拒绝二进制和非UTF8', async t => {
  const { directory, store } = await fixture(t), path = join(directory, 'note.md')
  await writeFile(path, 'one'); await store.openFile(path)
  await assert.rejects(store.save(store.documents[0].id, path), /另一标签/)
  const invalid = join(directory, 'invalid.md'); await writeFile(invalid, Buffer.from([0xff, 0xfe, 0x00]))
  await assert.rejects(store.openFile(invalid), /UTF-8/)
  await writeFile(invalid, '\0'); await assert.rejects(store.openFile(invalid), /二进制/)
})

test('旧JSON整批迁移一次，关闭草稿后重启不会重新导入', async t => {
  const { directory } = await fixture(t), profile = join(directory, 'legacy')
  await mkdir(profile)
  const original = JSON.stringify({ version: 1, activeId: 'second', documents: ['first', 'second'].map((id, index) => ({
    id, title: `草稿${index}`, path: null, markdown: `正文${index}`, savedText: '', baseline: null,
    eol: '\n', bom: false, revision: index + 1, conflict: false,
  })) })
  await writeFile(join(profile, 'session.json'), original)
  const store = makeStore(t, profile); await store.restore()
  assert.equal(store.activeId, 'second'); assert.deepEqual(store.documents.map(d => d.id), ['first', 'second'])
  assert.equal((await store.read('first')).dirty, true)
  await store.close('first')
  await assert.rejects(store.update('first', '迟到正文', 10), /已经关闭/)
  await assert.rejects(store.rename('first', '迟到名称'), /已经关闭/)
  await assert.rejects(store.setViewState('first', { mode: 'source', scrollTop: 0 }), /已经关闭/)
  const next = makeStore(t, profile); await next.restore()
  assert.deepEqual(next.documents.map(d => d.id), ['second'])
  assert.equal(await readFile(join(profile, 'session.json'), 'utf8'), original)
  assert.equal('savedText' in next.get('second'), false)
})

test('迁移超限事务回滚，重试可以导入完整旧会话', async t => {
  const { directory } = await fixture(t), profile = join(directory, 'migration-failure')
  await mkdir(profile)
  const original = JSON.stringify({ version: 1, activeId: 'a', documents: ['a', 'b'].map(id => ({
    id, title: id, path: null, markdown: '', savedText: '', baseline: null, eol: '\n', bom: false, revision: 0,
  })) })
  await writeFile(join(profile, 'session.json'), original)
  // JSON fits the limit; SQLite's row accounting rejects the imported batch after inserts.
  const store = makeStore(t, profile, { maxSessionBytes: Buffer.byteLength(original) }); await store.restore()
  assert.equal(store.recoveryWritable, false)
  const db = new DatabaseSync(store.databasePath)
  try {
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='version'").get(), undefined)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM documents').get().count, 0)
  } finally { db.close() }
  const next = makeStore(t, profile); await next.restore()
  assert.equal(next.recoveryWritable, true)
  assert.deepEqual(next.documents.map(doc => doc.id), ['a', 'b'])
  assert.equal(await readFile(join(profile, 'session.json'), 'utf8'), original)
})

test('按篇更新、独立命名和阅读状态不重写其他正文，元数据不带正文', async t => {
  const { store } = await fixture(t), first = store.documents[0]
  await store.update(first.id, '第一篇', 1); await store.newDocument('第二篇', 'Second')
  const second = store.documents[1]
  const db = new DatabaseSync(store.databasePath)
  try {
    db.exec('CREATE TABLE body_writes(id TEXT); CREATE TRIGGER observe_body AFTER UPDATE OF markdown ON documents BEGIN INSERT INTO body_writes VALUES (NEW.id); END;')
    await store.update(first.id, '修改第一篇', 2)
    await store.update(first.id, '修改第一篇', 2)
    const renamed = await store.rename(first.id, '  命名草稿  ')
    assert.deepEqual(renamed, { id: first.id, title: '命名草稿', backedUp: true, warning: '' })
    assert.equal((await store.read(first.id)).revision, 2)
    assert.equal('markdown' in renamed, false)
    const state = { mode: 'source', scrollTop: 120.5, selection: { anchor: 3, head: 4 }, sourceSelection: { start: 1, end: 2 } }
    assert.equal((await store.setViewState(first.id, state)).saved, true)
    await store.activate(first.id)
    assert.deepEqual(db.prepare('SELECT id FROM body_writes').all().map(row => row.id), [first.id])
    assert.equal(storedDocument(store, second.id).markdown, '第二篇')
    assert.ok(store.listMetadata().documents.every(doc => !('markdown' in doc) && !('savedText' in doc) && !('savedHash' in doc)))
    const next = makeStore(t, store.directory); await next.restore()
    assert.equal(next.activeId, first.id); assert.equal((await next.read(first.id)).title, '命名草稿')
    assert.deepEqual((await next.read(first.id)).viewState, state)
    assert.equal((await store.rename(first.id, '  ')).title, '未命名笔记')
    await assert.rejects(store.rename(first.id, null), /名称无效/)
    await assert.rejects(store.rename(first.id, '长'.repeat(400)), /过长/)
    await assert.rejects(store.setViewState(first.id, { mode: 'source', scrollTop: 0, history: [] }), /阅读状态无效/)
    await assert.rejects(store.setViewState(first.id, { mode: 'source', scrollTop: NaN }), /阅读状态无效/)
  } finally { db.close() }
})

test('数据库拒绝写入仍可编辑另存，失败删除阻止正常退出直到持久化', async t => {
  const { directory, store } = await fixture(t), doc = store.documents[0]
  await store.update(doc.id, '已备份', 1)
  const db = new DatabaseSync(store.databasePath)
  try {
    db.exec("CREATE TRIGGER deny_update BEFORE UPDATE ON documents BEGIN SELECT RAISE(ABORT, 'readonly test'); END; CREATE TRIGGER deny_delete BEFORE DELETE ON documents BEGIN SELECT RAISE(ABORT, 'readonly test'); END;")
    const changed = await store.update(doc.id, '未备份修改', 2)
    assert.equal(changed.backedUp, false); assert.match(changed.warning, /备份失败/)
    assert.equal((await store.read(doc.id)).markdown, '未备份修改')
    assert.equal(storedDocument(store, doc.id).markdown, '已备份')
    assert.equal(store.canExitWithoutRecovery(), false)
    const file = join(directory, 'rescue.md'), saved = await store.save(doc.id, file)
    assert.equal(saved.saved, true); assert.match(saved.warning, /备份失败/)
    assert.equal(await readFile(file, 'utf8'), '未备份修改')
    assert.equal((await store.read(doc.id)).dirty, false)
    assert.equal(store.canExitWithoutRecovery(), true)
    await assert.rejects(store.rename(doc.id, '不是磁盘重命名'), /只能命名/)
    await store.close(doc.id)
    assert.equal(store.canExitWithoutRecovery(), false)
    await assert.rejects(store.update(doc.id, '迟到', 3), /已经关闭/)
    db.exec('DROP TRIGGER deny_update; DROP TRIGGER deny_delete;')
    assert.equal(await store.tryPersist(), true)
    assert.equal(storedDocument(store, doc.id), undefined)
    const next = makeStore(t, store.directory); await next.restore()
    assert.equal(next.documents.length, 1); assert.equal((await next.read(next.documents[0].id)).markdown, '')
  } finally { db.close() }
})

for (const change of ['清空正文', '恢复默认名称']) {
  test(`备份失败时${change}不能绕过退出保护，重试后恢复最新状态`, async t => {
    const { store } = await fixture(t), doc = store.documents[0]
    if (change === '清空正文') await store.update(doc.id, '待清空正文', 1)
    else await store.rename(doc.id, '旧草稿名')
    const db = new DatabaseSync(store.databasePath)
    try {
      db.exec("CREATE TRIGGER deny_settings BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;")
      const result = change === '清空正文' ? await store.update(doc.id, '', 2) : await store.rename(doc.id, '')
      assert.equal(result.backedUp, false)
      assert.equal((await store.read(doc.id)).dirty, false)
      assert.equal((await store.read(doc.id)).title, '未命名笔记')
      assert.equal(change === '清空正文' ? storedDocument(store, doc.id).markdown : storedDocument(store, doc.id).title,
        change === '清空正文' ? '待清空正文' : '旧草稿名')
      assert.equal(store.canExitWithoutRecovery(), false, '已备份草稿仍有未提交变更，不能按当前空内容放行')
      assert.equal(store.needsRecovery(doc), true, '页面崩溃后的退出兜底也必须保护未提交变更')
      db.exec('DROP TRIGGER deny_settings;')
      assert.equal(await store.tryPersist(), true)
      assert.equal(store.canExitWithoutRecovery(), true)
      const next = makeStore(t, store.directory); await next.restore()
      assert.equal((await next.read(doc.id)).markdown, '')
      assert.equal((await next.read(doc.id)).title, '未命名笔记')
    } finally { db.close() }
  })
}

test('命名空草稿需持久化，Windows保存建议名称不包含路径或设备名', async t => {
  const { store } = await fixture(t), doc = store.documents[0]
  await store.rename(doc.id, '空白但命名')
  assert.equal(store.needsRecovery(doc), true)
  assert.equal((await store.read(doc.id)).dirty, false)
  assert.equal(suggestedFilename('../a\\b:<c>?*|\".  '), '.._a_b__c_____.md')
  assert.equal(suggestedFilename('CON.txt'), '_CON.md')
  assert.equal(suggestedFilename('   '), '未命名笔记.md')
  assert.equal(suggestedFilename('报告.md', 'pdf'), '报告.pdf')
})
