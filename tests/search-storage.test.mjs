import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DocumentStore } from '../apps/desktop/src/main/documentStore.js'
import { searchDocumentText } from '../apps/desktop/src/main/documentSearch.js'

test('页面全文搜索覆盖未访问与收起正文，只传回有界片段', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'frowd-search-'))
  const stores = []
  t.after(async () => { for (const store of stores) await store.dispose(); await rm(directory, { recursive: true, force: true }) })
  const store = new DocumentStore(directory); stores.push(store); await store.restore()
  const body = '# 文章\n\n' + '前言 '.repeat(1500) + '真正的关键词 😀 结尾'
  const id = (await store.newDocument(body, '测试页')).activeId
  await store.shelve(id)
  const restored = new DocumentStore(directory); stores.push(restored); await restored.restore()
  const operations = [], request = restored.database.request.bind(restored.database)
  restored.database.request = (operation, payload) => { operations.push(operation); return request(operation, payload) }
  const results = await restored.search('关键词')
  assert.equal(results.length, 1)
  assert.equal(results[0].id, id)
  assert.equal(results[0].offset, body.indexOf('关键词'))
  assert.ok(results[0].snippet.includes('关键词'))
  assert.ok(results[0].snippet.length < 150)
  assert.equal(Object.hasOwn(results[0], 'markdown'), false)
  assert.deepEqual(operations, ['search'])
  assert.ok(restored.documents.every(doc => !Object.hasOwn(doc, 'markdown')))

  restored.database.request = (operation, payload) => operation === 'apply'
    ? Promise.reject(new Error('synthetic failure')) : request(operation, payload)
  await restored.update(id, '尚未成功备份的文字', 1)
  assert.equal((await restored.search('关键词')).length, 0)
  assert.equal((await restored.search('尚未成功')).length, 1)
  const pendingId = (await restored.newDocument('新建未落盘内容', '待备份')).activeId
  assert.equal((await restored.search('未落盘'))[0].id, pendingId)
  restored.database.request = request
  await restored.tryPersist()
  await restored.remove(id)
  assert.equal((await restored.search('尚未成功')).length, 0)
  await assert.rejects(restored.search('a'.repeat(1025)), /1024/)
})

test('全文检索字面量与Unicode偏移正确，标题命中可用', () => {
  const doc = { id: 'a', title: '标题', revision: 1, markdown: 'İ 😀 Aa.*[内容]' }
  const hit = searchDocumentText(doc, 'aA.*[')
  assert.equal(hit.offset, 5)
  assert.equal(hit.length, 5)
  assert.equal(searchDocumentText(doc, '标题').matchIn, 'title')
  assert.equal(searchDocumentText(doc, '不存在'), null)
  const spaced = searchDocumentText({ ...doc, markdown: '前文 a  b 后文' }, 'a  b')
  assert.ok(spaced.snippet.includes('a  b'))
})
