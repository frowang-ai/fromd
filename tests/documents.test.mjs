import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentStore } from '../apps/desktop/src/main/documentStore.js'
import { operationQueue, openFileArguments } from '../apps/desktop/src/main/lifecycle.js'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-docs-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new DocumentStore(join(directory, 'profile')); await store.restore()
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
  assert.equal(store.get(doc.id).markdown, '本机草稿')
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
  const restored = new DocumentStore(store.directory), snapshot = await restored.restore()
  assert.equal(snapshot.activeId, second.id)
  assert.equal(snapshot.documents[0].markdown, '未命名草稿')
  assert.equal(snapshot.documents[1].markdown, '未保存修改')
  assert.equal(snapshot.documents[1].conflict, true)
  assert.equal((await restored.save(second.id)).conflict, true)
})
test('旧版本更新不能回退草稿，关闭最后一篇创建空白', async t => {
  const { store } = await fixture(t), doc = store.documents[0]
  await store.update(doc.id, '新版本', 2); await store.update(doc.id, '旧版本', 1)
  assert.equal(store.get(doc.id).markdown, '新版本')
  await assert.rejects(store.update(doc.id, '冲突版本', 2), /版本冲突/)
  await store.close(doc.id)
  assert.equal(store.documents.length, 1); assert.equal(store.documents[0].markdown, '')
})
test('损坏恢复文件保留原件，仍可另存当前内容', async t => {
  const { directory, store } = await fixture(t)
  await writeFile(store.sessionPath, 'broken recovery')
  const next = new DocumentStore(store.directory); await next.restore()
  assert.equal(next.recoveryWritable, false)
  const doc = next.documents[0]; await next.update(doc.id, '保留内容', 1)
  assert.equal((await next.save(doc.id, join(directory, 'rescue.md'))).saved, true)
  assert.equal(await readFile(store.sessionPath, 'utf8'), 'broken recovery')
})
test('备份容量读写一致，超限不覆盖可恢复的旧会话', async t => {
  const { directory } = await fixture(t)
  const store = new DocumentStore(join(directory, 'bounded'), { maxSessionBytes: 1400 })
  await store.restore(); const doc = store.documents[0]
  assert.equal((await store.update(doc.id, 'A'.repeat(500), 1)).backedUp, true)
  const previous = await readFile(store.sessionPath, 'utf8')
  assert.equal((await store.update(doc.id, 'B'.repeat(1600), 2)).backedUp, false)
  assert.equal(await readFile(store.sessionPath, 'utf8'), previous)
  const restored = new DocumentStore(store.directory, { maxSessionBytes: 1400 })
  await restored.restore(); assert.equal(restored.get(doc.id).markdown, 'A'.repeat(500))
  assert.equal(store.get(doc.id).markdown, 'B'.repeat(1600))
  assert.equal((await store.save(doc.id, join(directory, 'large.md'))).saved, true)
})
test('CRLF保存膨胀超限时不覆盖原文件，草稿仍在', async t => {
  const { directory, store } = await fixture(t), path = join(directory, 'crlf.md')
  await writeFile(path, 'original\r\n'); const doc = (await store.openFile(path)).documents.at(-1)
  await store.update(doc.id, 'x\n'.repeat(4 * 1024 * 1024), 1)
  await assert.rejects(store.save(doc.id), /超过 10 MB/)
  assert.equal(await readFile(path, 'utf8'), 'original\r\n')
  assert.equal(store.get(doc.id).markdown.length, 8 * 1024 * 1024)
})
test('首次恢复目录不可写仍能编辑并保存到其他目录', async t => {
  const { directory } = await fixture(t), badDirectory = join(directory, 'not-a-directory')
  await writeFile(badDirectory, 'keep')
  const store = new DocumentStore(badDirectory); await store.restore()
  assert.equal(store.documents.length, 1)
  const doc = store.documents[0]; await store.update(doc.id, 'rescue', 1)
  assert.equal((await store.save(doc.id, join(directory, 'rescue.md'))).saved, true)
  assert.equal(store.snapshot().documents[0].dirty, false)
  assert.equal(await store.tryPersist(), false)
})
test('恢复完成前二次启动请求排队，旧草稿先恢复再追加文件', async t => {
  const { directory, store } = await fixture(t), draft = store.documents[0]
  await store.update(draft.id, '不能丢失', 1)
  const path = join(directory, 'second.md'); await writeFile(path, '新文件')
  let release
  const gate = new Promise(resolve => { release = resolve })
  const restored = new DocumentStore(store.directory)
  const initialization = gate.then(() => restored.restore())
  const serialize = operationQueue(initialization)
  const second = serialize(() => restored.openFile(path))
  assert.equal(restored.documents.length, 0)
  release(); await second
  assert.equal(restored.documents[0].markdown, '不能丢失')
  assert.equal(restored.documents[1].markdown, '新文件')
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
