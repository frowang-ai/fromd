import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { history, undo } from '@milkdown/kit/prose/history'
import { findTextMatches, findDocumentMatches, findInView, replaceInView, writingSearchPlugin } from '../packages/editor/src/writingSearch.js'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    code_block: { group: 'block', content: 'text*', code: true },
    text: { group: 'inline' },
    math_inline: { group: 'inline', inline: true, atom: true, attrs: { value: {} } },
    image: { group: 'inline', inline: true, atom: true, attrs: { src: {} } },
  },
  marks: { strong: {} },
})
const paragraph = children => schema.nodes.paragraph.create(null, children)
const text = value => schema.text(value)
function fakeView(children) {
  return {
    state: EditorState.create({ schema, doc: schema.nodes.doc.create(null, children), plugins: [history(), writingSearchPlugin] }),
    dispatch(transaction) { this.state = this.state.apply(transaction) },
  }
}

test('字面量搜索处理正则字符、中文、emoji与大小写，偏移仍为UTF-16', () => {
  assert.deepEqual(findTextMatches('前😀A.*后a.*', 'a.*').matches, [{ from: 3, to: 6 }, { from: 7, to: 10 }])
  assert.equal(findTextMatches('İ i I', 'i').matches[0].from, 2)
  assert.equal(findTextMatches('A a', 'A', true).matches.length, 1)
  assert.deepEqual(findTextMatches('正文', '').matches, [])
})

test('查找跨行内格式、覆盖代码与公式，隔开图片和段落', () => {
  const view = fakeView([
    paragraph([text('前ab'), schema.text('cd', [schema.marks.strong.create()]), text('ef后'), schema.nodes.image.create({ src: 'x' }), text('后ab')]),
    schema.nodes.code_block.create(null, text('abcdef')),
    paragraph([schema.nodes.math_inline.create({ value: 'abcdef+abcdef' })]),
  ])
  const result = findDocumentMatches(view.state.doc, 'abcdef')
  assert.equal(result.matches.length, 4)
  assert.deepEqual(result.matches.map(match => match.kind), ['text', 'text', 'math', 'math'])
  assert.equal(findDocumentMatches(view.state.doc, '后后').matches.length, 0)
})

test('替换跨格式文本保留其他内容和撤销历史', () => {
  const view = fakeView([paragraph([text('前ab'), schema.text('cd', [schema.marks.strong.create()]), text('ef后')])])
  const original = view.state.doc
  assert.equal(replaceInView(view, 'abcdef', '替换').replaced, 1)
  assert.equal(view.state.doc.textContent, '前替换后')
  assert.equal(undo(view.state, transaction => view.dispatch(transaction)), true)
  assert.ok(view.state.doc.eq(original))
})

test('全部替换公式内部多个匹配与普通文本，一次撤销完整恢复', () => {
  const view = fakeView([paragraph([text('x and x'), schema.nodes.math_inline.create({ value: 'x+x' })]), schema.nodes.code_block.create(null, text('x'))])
  const original = view.state.doc
  assert.equal(replaceInView(view, 'x', '中文', false, 0, true).replaced, 5)
  assert.equal(view.state.doc.firstChild.lastChild.attrs.value, '中文+中文')
  assert.equal(view.state.doc.lastChild.textContent, '中文')
  undo(view.state, transaction => view.dispatch(transaction))
  assert.ok(view.state.doc.eq(original))
})

test('导航循环匹配且不进入撤销历史', () => {
  const view = fakeView([paragraph([text('one one')])])
  assert.equal(findInView(view, 'one', false, -1).index, 1)
  assert.equal(view.state.selection.from, 5)
  assert.equal(undo(view.state, transaction => view.dispatch(transaction)), false)
  assert.equal(findInView(view, 'absent').count, 0)
})

test('有界匹配禁止部分执行全部替换', () => {
  const view = fakeView([paragraph([text('x'.repeat(10001))])]), original = view.state.doc
  const result = findDocumentMatches(view.state.doc, 'x')
  assert.equal(result.matches.length, 10000); assert.equal(result.truncated, true)
  assert.throws(() => replaceInView(view, 'x', 'y', false, 0, true), /10,000/)
  assert.ok(view.state.doc.eq(original))
})
