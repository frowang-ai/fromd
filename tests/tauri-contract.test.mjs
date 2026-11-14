import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../apps/tauri/src/App.vue', import.meta.url), 'utf8')
const rust = await readFile(new URL('../apps/tauri/src-tauri/src/lib.rs', import.meta.url), 'utf8')
const config = await readFile(new URL('../apps/tauri/src-tauri/tauri.conf.json', import.meta.url), 'utf8')

test('Tauri surface keeps one frowd document authority', () => {
  assert.doesNotMatch(app, /localStorage|sessionStorage/)
  assert.doesNotMatch(app, /electron/)
  for (const command of ['list_metadata', 'read_document', 'update_document', 'rename_document', 'shelve_document', 'expand_all', 'remove_document', 'undo_remove']) {
    assert.match(app, new RegExp(command))
    assert.match(rust, new RegExp(command))
  }
})

test('page workbar exposes the confirmed first-unit behavior', () => {
  for (const text of ['页面', '大纲', '全部展开', '已展开', '已收起', '源码', '−', 'removeDocument']) assert.match(app, new RegExp(text))
  assert.match(rust, /contentHash/)
  assert.match(rust, /shelved/)
  assert.match(rust, /unchecked_transaction/)
})

test('Tauri configuration is desktop-only for this implementation unit', () => {
  const parsed = JSON.parse(config)
  assert.equal(parsed.productName, 'frowd')
  assert.equal(parsed.bundle.active, false)
  assert.equal(parsed.build.frontendDist, '../dist')
})
