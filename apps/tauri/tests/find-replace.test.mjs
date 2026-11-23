import test from 'node:test'
import assert from 'node:assert/strict'
import {DocumentCoordinator} from '../src/documents/coordinator.mjs'

test('case sensitivity travels through find and replace and belongs to the result target', async () => {
  const calls = [], owner = {id: 'a', generation: 1, markdown: 'Aa aa', viewState: {mode: 'rendered'}}
  const port = {
    capture: () => owner, waitComposition: async () => {}, freeze: async () => () => {},
    findReplace: (...args) => { calls.push(args); return {count: 1, index: 0} },
    replaceFind: (...args) => { calls.push(args); return {replaced: 1} },
  }
  const state = {}, coordinator = new DocumentCoordinator({}, port, state)
  state.loaded = true; coordinator.flush = async () => {}
  const target = {id: owner.id, generation: owner.generation, mode: 'rendered', query: 'aa', matchCase: true}
  try {
    await coordinator.findReplace('aa', 0, target, true)
    await coordinator.findPassive('aa', 0, target, true)
    assert.deepEqual(calls, [['aa', 0, true, true], ['aa', 0, false, true]])
    await assert.rejects(coordinator.replaceFind('aa', 'X', 0, false, target, false), /查找条件已变化/)
    assert.equal(calls.length, 2)
    await coordinator.replaceFind('aa', 'X', 0, false, target, true)
    assert.deepEqual(calls.at(-1), ['aa', 'X', 0, false, true])
  } finally { coordinator.dispose() }
})

for (const mode of ['rendered', 'source']) test(`queued ${mode} replacement rejects body changes while waiting for composition`, async () => {
  const row = {id: 'a', title: 'A', path: null, markdown: 'needle needle', revision: 0, shelved: false}
  let releaseFreeze, enteredFreeze, holdFreeze = false, replaced = false
  const entered = new Promise(resolve => { enteredFreeze = resolve })
  const gate = new Promise(resolve => { releaseFreeze = resolve })
  const state = {}, api = {
    list: async () => ({documents: [row], activeId: row.id, layoutRevision: 0}),
    read: async () => row,
  }
  const port = {
    current: null, ready: async () => {}, waitComposition: async () => {},
    freeze: async () => { if (holdFreeze) { enteredFreeze(); await gate } return () => {} },
    capture: () => port.current,
    activate: async doc => { port.current = {id: doc.id, generation: doc.generation, markdown: doc.markdown, viewState: {mode}} },
    findReplace: () => ({count: 2, index: 1, limited: false, mode}),
    replaceFind: () => { replaced = true; throw Error('must not replace a changed body') },
    clear: () => {},
  }
  const coordinator = new DocumentCoordinator(api, port, state)
  try {
    await coordinator.boot()
    const target = {id: row.id, generation: port.current.generation, mode, query: 'needle', pinned: true}
    await coordinator[mode === 'source' ? 'findPassive' : 'findReplace']('needle', 1, target)
    assert.equal(target.markdown, 'needle needle')
    holdFreeze = true
    const request = coordinator.replaceFind('needle', 'X', 1, false, target)
    await entered
    // A committed IME edit shifts the old second hit while the operation waits.
    port.current = {...port.current, markdown: 'needle inserted needle needle'}
    releaseFreeze()
    await assert.rejects(request, /正文已变化/)
    assert.equal(replaced, false)
    assert.equal(port.current.markdown, 'needle inserted needle needle')
    assert.equal(row.markdown, 'needle needle')
  } finally { releaseFreeze(); coordinator.dispose() }
})

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
