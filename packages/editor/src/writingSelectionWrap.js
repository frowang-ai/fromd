import { TextSelection } from '@milkdown/kit/prose/state'
import { Mark } from '@milkdown/kit/prose/model'
import { closeHistory } from '@milkdown/kit/prose/history'

const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" }
const wrapKeys = new Set(['$', '*', '_', '`', '~', ...Object.keys(pairs)])
// These marks can enclose inline math in both our serializer and parser. Code
// and kbd are literal contexts; unknown marks must not silently lose semantics.
const mathMarks = new Set(['emphasis', 'strong', 'strike_through', 'link', 'note_sub', 'note_sup', 'writing_u', 'writing_mark'])
const pass = { handled: false }, protect = { handled: true, tr: null }
const change = tr => ({ handled: true, tr })

// Three outcomes: ordinary input, protected refusal (no transaction), or one
// undoable transform. Refusing unsafe wrapping must never delete the selection.
export function planSelectionWrap(state, key) {
  if (!wrapKeys.has(key)) return pass
  const { selection, schema, doc } = state
  if (!(selection instanceof TextSelection) || selection.empty) return pass
  const { from, to, $from, $to } = selection
  if ($from.sameParent($to) && $from.parent.type.spec.code) return pass
  const texts = []
  let hasCodeBlock = false, hasInlineNode = false
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.spec.code) hasCodeBlock = true
    if (node.isInline && !node.isText) hasInlineNode = true
    if (node.isText) texts.push({ node, parent, from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize) })
  })
  const text = doc.textBetween(from, to, '\n')
  if (!hasInlineNode && !text.trim()) return pass
  if (hasCodeBlock || !$from.sameParent($to) || !$from.parent.isTextblock) return protect
  if (pairs[key]) {
    if (texts.some(({ node }) => node.marks.some(mark => mark.type.spec.code))) return protect
    const tr = state.tr.insert(to, schema.text(pairs[key])).insert(from, schema.text(key))
    return change(tr.setSelection(TextSelection.create(tr.doc, selection.anchor + 1, selection.head + 1)))
  }
  if (hasInlineNode || !texts.length) return protect
  // Text-only, same-parent positions correspond directly to UTF-16 text offsets.
  // Keep outer whitespace and the user's original (possibly reverse) selection.
  const trimmed = text.trim(), start = from + text.length - text.trimStart().length, end = start + trimmed.length
  const targets = texts.filter(range => range.from < end && range.to > start)
    .map(range => ({ ...range, from: Math.max(range.from, start), to: Math.min(range.to, end) }))
  const hasCodeMark = targets.some(({ node }) => node.marks.some(mark => mark.type.spec.code))
  if (hasCodeMark && key !== '`') return protect
  if (key === '$') {
    const type = schema.nodes.math_inline, $start = doc.resolve(start), $end = doc.resolve(end)
    if (!type || /[\r\n$]/.test(text)) return protect
    // Adjacent math serializes as $x$$y$, which reparses as one different formula.
    if ($start.nodeBefore?.type === type || $end.nodeAfter?.type === type) return protect
    const marks = targets[0].node.marks
    if (marks.some(mark => !mathMarks.has(mark.type.name))
      || targets.some(({ node }) => !Mark.sameSet(marks, node.marks))
      || !$from.parent.canReplaceWith($start.index(), $end.indexAfter(), type, marks)) return protect
    const tr = state.tr.replaceWith(start, end, type.create({ value: trimmed }, null, marks))
    return change(tr.setSelection(TextSelection.create(tr.doc, start + 1)))
  }
  const compatible = type => type && targets.every(({ parent, node }) => parent.type.allowsMarkType(type)
    && node.marks.every(mark => mark.type === type || (!mark.type.excludes(type) && !type.excludes(mark.type))))
  const allHave = type => targets.every(({ node }) => type.isInSet(node.marks))
  const add = (tr, type) => {
    for (const range of targets) tr.addMark(range.from, range.to, type.create())
    return change(tr)
  }
  if (key === '*' || key === '_') {
    const { emphasis, strong } = schema.marks
    if (!compatible(emphasis) || !compatible(strong)) return protect
    const italic = allHave(emphasis), bold = allHave(strong)
    if (italic && bold) return protect
    const tr = state.tr
    if (italic && !bold) {
      for (const range of targets) tr.removeMark(range.from, range.to, emphasis)
      return add(tr, strong)
    }
    return add(tr, emphasis)
  }
  if (key === '~') {
    const type = schema.marks.strike_through
    return compatible(type) && !allHave(type) ? add(state.tr, type) : protect
  }
  if (key === '`') {
    const type = schema.marks.inlineCode
    if (!type || !$from.parent.type.allowsMarkType(type) || allHave(type)) return protect
    const tr = state.tr
    // Match Milkdown's inline-code command: code spans contain literal text.
    // Only the trimmed target loses rich marks; outer whitespace is untouched.
    for (const range of targets) tr.removeMark(range.from, range.to)
    return add(tr, type)
  }
  return protect
}

export function installWritingSelectionWrap(view, isComposing = () => false) {
  const previous = view.props.handleKeyDown
  view.setProps({ handleKeyDown(editor, event) {
    if (!event.isComposing && !editor.composing && !isComposing() && editor.editable
      && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const { handled, tr } = planSelectionWrap(editor.state, event.key)
      if (handled) {
        event.preventDefault()
        if (tr?.docChanged) {
          editor.dispatch(closeHistory(tr).scrollIntoView())
          editor.dispatch(closeHistory(editor.state.tr))
        }
        return true
      }
    }
    return previous?.(editor, event) || false
  } })
}
