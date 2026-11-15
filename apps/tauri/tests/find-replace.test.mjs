import test from 'node:test'
import assert from 'node:assert/strict'
import {DocumentCoordinator} from '../src/documents/coordinator.mjs'

test('queued replace rejects a target whose page changed before execution', async () => {
  const rows = new Map([
    ['a', {id: 'a', title: 'A', path: null, markdown: 'needle a', revision: 0, shelved: false}],
    ['b', {id: 'b', title: 'B', path: null, markdown: 'b', revision: 0, shelved: false}],
  ])
  const state = {}, api = {
    list: async () => ({documents: [...rows.values()], activeId: 'a', layoutRevision: 0}),
    read: async id => rows.get(id),
    update: async (id, markdown, revision) => { rows.get(id).markdown = markdown; rows.get(id).revision = revision; return {documents: [...rows.values()], activeId: id, layoutRevision: 0} },
    view: async () => ({}),
  }
  const port = {
    current: null, ready: async () => {}, waitComposition: async () => {}, freeze: async () => () => {},
    capture: () => port.current, activate: async doc => { port.current = {id: doc.id, generation: doc.generation, markdown: doc.markdown, viewState: {mode: 'rendered'}} },
    clear: () => {}, replaceFind: async () => { throw Error('must not replace') },
  }
  const coordinator = new DocumentCoordinator(api, port, state, {autosaveMs: 1})
  await coordinator.boot()
  const target = {id: 'a', generation: port.current.generation, mode: 'rendered', query: 'needle'}
  port.current = {id: 'b', generation: target.generation + 1, markdown: 'b', viewState: {mode: 'rendered'}}
  await assert.rejects(coordinator.replaceFind('needle', 'X', 0, false, target), /查找结果已失效/)
  assert.equal(rows.get('a').markdown, 'needle a')
  assert.equal(rows.get('b').markdown, 'b')
  coordinator.dispose()
})

test('cancelled queued read-only find is a no-op without reporting an error', async () => {
  const rows = new Map([
    ['a', {id: 'a', title: 'A', path: null, markdown: 'needle a', revision: 0, shelved: false}],
  ])
  let releaseWait
  const wait = new Promise(resolve => { releaseWait = resolve })
  let executed = 0
  const state = {}, api = {
    list: async () => ({documents: [...rows.values()], activeId: 'a', layoutRevision: 0}),
    read: async id => rows.get(id),
    update: async () => ({documents: [...rows.values()], activeId: 'a', layoutRevision: 0}),
    view: async () => ({}),
  }
  const port = {
    current: null,
    ready: async () => {},
    waitComposition: async () => wait,
    freeze: async () => () => {},
    capture: () => port.current,
    activate: async doc => { port.current = {id: doc.id, generation: doc.generation, markdown: doc.markdown, viewState: {mode: 'rendered'}} },
    clear: () => {},
    findReplace: async () => { executed++; return {count: 1, index: 0, limited: false, mode: 'rendered'} },
  }
  const coordinator = new DocumentCoordinator(api, port, state, {autosaveMs: 1})
  await coordinator.boot()
  const target = {id: 'a', generation: port.current.generation, mode: 'rendered', query: 'needle', cancelled: false}
  const request = coordinator.findReplace('needle', 0, target)
  await new Promise(resolve => setImmediate(resolve))
  target.cancelled = true
  releaseWait()
  const result = await request
  assert.equal(result.cancelled, true)
  assert.equal(executed, 0)
  assert.equal(state.error, '')
  coordinator.dispose()
})
