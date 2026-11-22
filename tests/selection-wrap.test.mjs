import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection, NodeSelection } from '@milkdown/kit/prose/state'
import { CellSelection, tableNodes } from '@milkdown/kit/prose/tables'
import { history, undo, redo, undoDepth, redoDepth } from '@milkdown/kit/prose/history'
import { planSelectionWrap, installWritingSelectionWrap } from '../packages/editor/src/writingSelectionWrap.js'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' },
    code_block: { group: 'block', content: 'text*', marks: '', code: true },
    plain: { group: 'block', content: 'text*', marks: '' },
    text: { group: 'inline' }, math_inline: { group: 'inline', inline: true, atom: true, attrs: { value: {} } },
    image: { group: 'inline', inline: true, atom: true }, hard_break: { group: 'inline', inline: true },
    ...tableNodes({ tableGroup: 'block', cellContent: 'paragraph+' }),
  },
  marks: {
    emphasis: {}, strong: {}, strike_through: {}, inlineCode: { code: true, excludes: '_' }, link: {},
    writing_kbd: {}, writing_u: {}, writing_mark: {}, note_sub: {}, note_sup: {},
    incompatible: { excludes: 'emphasis strong strike_through' },
  },
})
const text = (value, marks = []) => schema.text(value, marks.map(name => schema.marks[name].create()))
const paragraph = children => schema.nodes.paragraph.create(null, children)
const protect = { handled: true, tr: null }, pass = { handled: false }
function stateFor(children, from = 1, to) {
  const doc = schema.nodes.doc.create(null, children)
  return EditorState.create({ doc, selection: TextSelection.create(doc, from, to ?? doc.content.size - 1), plugins: [history()] })
}
const applyWrap = (state, key) => state.apply(planSelectionWrap(state, key).tr)

test('math protects atoms, hard breaks, code marks, dollar and newline selections', () => {
  for (const children of [
    [text('a'), schema.nodes.image.create(), text('b')],
    [text('a'), schema.nodes.math_inline.create({ value: 'x' })],
    [text('a'), schema.nodes.hard_break.create(), text('b')],
    [text('a'), text('b', ['inlineCode'])], [text('a$b')], [text('a\nb')], [text('a\rb')],
  ]) assert.deepEqual(planSelectionWrap(stateFor(paragraph(children)), '$'), protect)
})

test('math trims only the converted interval, preserving marked outer whitespace', () => {
  const state = stateFor(paragraph([text(' \t', ['strong']), text('X + Y'), text(' ', ['emphasis'])]))
  const { tr } = planSelectionWrap(state, '$')
  assert.deepEqual(tr.doc.firstChild.toJSON().content, [
    text(' \t', ['strong']).toJSON(), schema.nodes.math_inline.create({ value: 'X + Y' }).toJSON(), text(' ', ['emphasis']).toJSON(),
  ])
  assert.equal(tr.selection.from, 4)
  tr.doc.check()
})

test('adjacent math is protected on either side; actual separating whitespace allows conversion', () => {
  const math = schema.nodes.math_inline.create({ value: 'y' })
  assert.deepEqual(planSelectionWrap(stateFor(paragraph([text('x'), math]), 1, 2), '$'), protect)
  assert.deepEqual(planSelectionWrap(stateFor(paragraph([math, text('x')]), 2, 3), '$'), protect)
  for (const state of [stateFor(paragraph([text('x '), math]), 1, 3), stateFor(paragraph([math, text(' x')]), 2, 4)]) {
    const next = applyWrap(state, '$'); next.doc.check()
    assert.equal(next.doc.firstChild.childCount, 3)
    assert.equal(next.doc.firstChild.child(1).text, ' ')
  }
})

test('math retains uniform permitted marks and protects mixed or unsupported marks', () => {
  for (const name of ['emphasis', 'strong', 'strike_through', 'link', 'note_sub', 'note_sup', 'writing_u', 'writing_mark']) {
    const state = stateFor(paragraph(text('abc', [name])))
    const next = applyWrap(state, '$'); next.doc.check()
    assert.deepEqual(next.doc.firstChild.firstChild.marks, state.doc.firstChild.firstChild.marks)
  }
  for (const children of [[text('a', ['strong']), text('b')], [text('a', ['link']), text('b')], [text('a', ['writing_kbd'])], [text('a', ['inlineCode'])]]) {
    assert.deepEqual(planSelectionWrap(stateFor(paragraph(children)), '$'), protect)
  }
})

test('cross-block, atomic and schema-incompatible formatting selections are protected', () => {
  const state = stateFor([paragraph(text('one')), paragraph(text('two'))])
  for (const key of ['$', '`', '(', '*', '_', '~']) assert.deepEqual(planSelectionWrap(state, key), protect)
  const plain = stateFor(schema.nodes.plain.create(null, text('text')))
  for (const key of ['$', '`', '*', '~']) assert.deepEqual(planSelectionWrap(plain, key), protect)
  const atomic = stateFor(paragraph([text('a'), schema.nodes.image.create(), text('b')]))
  for (const key of ['$', '`', '*', '_', '~']) assert.deepEqual(planSelectionWrap(atomic, key), protect)
  const incompatible = stateFor(paragraph(text('text', ['incompatible'])))
  for (const key of ['$', '*', '~']) assert.deepEqual(planSelectionWrap(incompatible, key), protect)
})

for (const codeFirst of [true, false]) for (const reverse of [false, true]) {
  test(`code/body cross-block selection is protected: codeFirst=${codeFirst}, reverse=${reverse}`, () => {
    const code = schema.nodes.code_block.create(null, text('code')), body = paragraph(text('body'))
    const nodes = codeFirst ? [code, body] : [body, code]
    const end = nodes.reduce((size, node) => size + node.nodeSize, 0) - 1
    const state = stateFor(nodes, reverse ? end : 1, reverse ? 1 : end)
    const view = viewFor(state)
    installWritingSelectionWrap(view)
    for (const symbol of ['$', '*', '_', '`', '~', '(', '[', '{', '"', "'"]) {
      assert.deepEqual(planSelectionWrap(state, symbol), protect)
      assert.deepEqual(key(view, symbol), { handled: true, prevented: true })
      assert.equal(view.state, state)
    }
  })
}

test('code blocks pass through, fully coded body selections are protected', () => {
  for (const key of ['$', '*', '_', '`', '~', '(', '"']) {
    assert.deepEqual(planSelectionWrap(stateFor(schema.nodes.code_block.create(null, text('code'))), key), pass)
    assert.deepEqual(planSelectionWrap(stateFor(paragraph(text('code', ['inlineCode']))), key), protect)
  }
})

test('backtick completes partially coded text but protects it from other formatting', () => {
  const state = stateFor(paragraph([text('a'), text('code', ['inlineCode'])]))
  const next = applyWrap(state, '`'); next.doc.check()
  assert.equal(next.doc.firstChild.childCount, 1)
  assert.deepEqual(next.doc.firstChild.firstChild.toJSON(), text('acode', ['inlineCode']).toJSON())
  for (const key of ['$', '*', '_', '~', '(']) assert.deepEqual(planSelectionWrap(state, key), protect)
})

test('empty, whitespace, node and cell selections plus unrelated keys pass through', () => {
  const state = stateFor(paragraph(text('abc')), 1, 1)
  assert.deepEqual(planSelectionWrap(state, '*'), pass)
  const node = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))
  assert.deepEqual(planSelectionWrap(node, '*'), pass)
  assert.deepEqual(planSelectionWrap(stateFor(paragraph(text('abc'))), 'a'), pass)
  for (const key of ['$', '*', '_', '`', '~', '(', '"']) {
    assert.deepEqual(planSelectionWrap(stateFor(paragraph(text(' \t '))), key), pass)
  }
  const cell = schema.nodes.table_cell.create(null, paragraph(text('cell')))
  const table = schema.nodes.table.create(null, schema.nodes.table_row.create(null, [cell, cell]))
  const tableDoc = schema.nodes.doc.create(null, table)
  const cells = CellSelection.create(tableDoc, 2, 2 + cell.nodeSize)
  assert.equal(cells instanceof TextSelection, false)
  const tableState = EditorState.create({ doc: tableDoc, selection: cells })
  for (const key of ['$', '*', '`', '(']) assert.deepEqual(planSelectionWrap(tableState, key), pass)
})

test('styles trim target whitespace, retain its marks and preserve the full reverse selection', () => {
  for (const [key, mark] of [['*', 'emphasis'], ['_', 'emphasis'], ['~', 'strike_through'], ['`', 'inlineCode']]) {
    const state = stateFor(paragraph([text(' ', ['link']), text('abc'), text(' ', ['strong'])]), 6, 1)
    const next = applyWrap(state, key); next.doc.check()
    assert.deepEqual(next.selection.toJSON(), state.selection.toJSON())
    assert.deepEqual(next.doc.firstChild.child(0).toJSON(), state.doc.firstChild.child(0).toJSON())
    assert.deepEqual(next.doc.firstChild.child(2).toJSON(), state.doc.firstChild.child(2).toJSON())
    assert.deepEqual(next.doc.firstChild.child(1).marks.map(mark => mark.type.name), [mark])
  }
})

test('mixed emphasis is completed before bold upgrade, retaining unrelated marks', () => {
  let state = stateFor(paragraph([text('a', ['emphasis', 'link']), text('b', ['link'])]))
  state = applyWrap(state, '*')
  assert.equal(state.doc.firstChild.childCount, 1)
  assert.deepEqual(state.doc.firstChild.firstChild.marks.map(mark => mark.type.name), ['emphasis', 'link'])
  state = applyWrap(state, '*')
  assert.deepEqual(state.doc.firstChild.firstChild.marks.map(mark => mark.type.name), ['strong', 'link'])
})

test('inline code removes conflicting marks, while delimiters retain original marked nodes', () => {
  const state = stateFor(paragraph([text('abc', ['strong', 'link'])]))
  const code = applyWrap(state, '`'); code.doc.check()
  assert.deepEqual(code.doc.firstChild.firstChild.marks.map(mark => mark.type.name), ['inlineCode'])
  assert.deepEqual(code.selection.toJSON(), state.selection.toJSON())
  const wrapped = applyWrap(state, '(')
  assert.deepEqual(wrapped.doc.firstChild.child(1).toJSON(), state.doc.firstChild.firstChild.toJSON())
})

function viewFor(state) {
  return { state, editable: true, composing: false, props: {}, setProps(props) { this.props = { ...this.props, ...props } }, dispatch(tr) { this.state = this.state.apply(tr) } }
}
function key(view, value, extra = {}) {
  const event = { key: value, preventDefault() { this.prevented = true }, ...extra }
  const handled = view.props.handleKeyDown(view, event)
  return { handled, prevented: Boolean(event.prevented) }
}

test('protected rejection dispatches nothing and preserves existing undo and redo histories', () => {
  const view = viewFor(stateFor(paragraph(text('a$b')), 4, 4))
  installWritingSelectionWrap(view)
  view.dispatch(view.state.tr.insertText('c'))
  undo(view.state, tr => view.dispatch(tr))
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4)))
  const before = view.state, depths = [undoDepth(before), redoDepth(before)]
  assert.deepEqual(key(view, '$'), { handled: true, prevented: true })
  assert.equal(view.state, before)
  assert.deepEqual([undoDepth(view.state), redoDepth(view.state)], depths)
  assert.equal(redo(view.state, tr => view.dispatch(tr)), true)
  assert.equal(view.state.doc.textContent, 'a$bc')
})

test('keypress history isolates each formatting step from preceding and following typing', () => {
  const view = viewFor(stateFor(paragraph(text('abc')), 4, 4))
  installWritingSelectionWrap(view)
  view.dispatch(view.state.tr.insertText('d'))
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)))
  const original = view.state
  key(view, '*'); const italic = view.state
  key(view, '*'); const bold = view.state
  view.dispatch(view.state.tr.insertText('next'))
  const dispatch = tr => view.dispatch(tr)
  for (const previous of [bold, italic, original]) {
    assert.equal(undo(view.state, dispatch), true)
    assert.deepEqual(view.state.doc.toJSON(), previous.doc.toJSON())
    assert.deepEqual(view.state.selection.toJSON(), previous.selection.toJSON())
  }
  assert.equal(redo(view.state, dispatch), true)
  assert.deepEqual(view.state.doc.toJSON(), italic.doc.toJSON())
})

test('each rich wrapping operation undoes both document and reverse selection in one step', () => {
  for (const value of ['$', '*', '_', '`', '~', '(', '[', '{', '"', "'"]) {
    const view = viewFor(stateFor(paragraph(text('abc')), 4, 1)), before = view.state
    installWritingSelectionWrap(view)
    assert.deepEqual(key(view, value), { handled: true, prevented: true })
    const wrapped = view.state
    undo(view.state, tr => view.dispatch(tr))
    assert.deepEqual(view.state.doc.toJSON(), before.doc.toJSON())
    assert.deepEqual(view.state.selection.toJSON(), before.selection.toJSON())
    redo(view.state, tr => view.dispatch(tr))
    assert.deepEqual(view.state.doc.toJSON(), wrapped.doc.toJSON())
  }
})

test('event, view and outer composition plus readonly/modifier guards preserve the previous handler', () => {
  for (const guard of ['event', 'view', 'outer', 'readonly', 'ctrlKey', 'metaKey', 'altKey']) {
    const view = viewFor(stateFor(paragraph(text('abc')))), original = view.state
    let called = 0
    view.props.handleKeyDown = () => { called++; return false }
    if (guard === 'view') view.composing = true
    if (guard === 'readonly') view.editable = false
    installWritingSelectionWrap(view, () => guard === 'outer')
    assert.deepEqual(key(view, '$', { isComposing: guard === 'event', [guard]: true }), { handled: false, prevented: false })
    assert.equal(view.state, original); assert.equal(called, 1)
  }
})
