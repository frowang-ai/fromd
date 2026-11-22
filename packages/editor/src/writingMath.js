import { registerEmbeddedView, trackCodeBlockView } from './writingViewState.js'
import { renderMathPreview } from './writingMathPreview.js'
import remarkMath from 'remark-math'
import { $nodeSchema, $remark } from '@milkdown/kit/utils'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import { TextSelection } from '@milkdown/kit/prose/state'
import { closeHistory, undo, redo } from '@milkdown/kit/prose/history'
import { createInlineMathPresentation } from './writingInlineMathPresentation.js'
import { blockFormulaView } from './writingBlockMath.js'
import { sourceCaretGeometry, verticalMathTarget, moveBodyVertically } from './writingMathNavigation.js'

// The experiment keeps Crepe's document model, but owns formula editing instead
// of enabling Crepe's separate inline-LaTeX popup.
export const writingMathSchema = $nodeSchema('math_inline', () => ({
  group: 'inline', inline: true, atom: true,
  attrs: { value: { default: '' } },
  parseDOM: [{ tag: 'span[data-type="math_inline"]', getAttrs: dom => ({ value: dom.dataset.value || '' }) }],
  toDOM: node => ['span', { 'data-type': 'math_inline', 'data-value': node.attrs.value }, node.attrs.value],
  parseMarkdown: { match: node => node.type === 'inlineMath', runner: (state, node, type) => state.addNode(type, { value: node.value }) },
  toMarkdown: { match: node => node.type.name === 'math_inline', runner: (state, node) => state.addNode('inlineMath', undefined, node.attrs.value) },
}))
const blockMath = $remark('writing-block-math', () => () => tree => {
  function visit(node) {
    if (node.type === 'math') { node.type = 'code'; node.lang = 'LaTeX' }
    node.children?.forEach(visit)
  }
  visit(tree)
})
export const writingMathPlugins = [
  $remark('writing-math', () => remarkMath), blockMath, writingMathSchema,
  codeBlockSchema.extendSchema(previous => ctx => {
    const schema = previous(ctx)
    return { ...schema, toMarkdown: { ...schema.toMarkdown, runner(state, node) {
      if (String(node.attrs.language).toLowerCase() === 'latex') state.addNode('math', undefined, node.textContent)
      else schema.toMarkdown.runner(state, node)
    } } }
  }),
]

function inlineFormulaView(initial, view, getPos) {
  let node = initial, opened = false, original = '', destroyed = false, composing = false
  const dom = document.createElement('span')
  dom.className = 'writing-math writing-math-inline'
  dom.contentEditable = 'false'
  const preview = document.createElement('span')
  preview.className = 'writing-math-preview'
  preview.tabIndex = 0
  preview.setAttribute('role', 'button')
  preview.setAttribute('aria-label', '编辑行内公式')
  preview.title = '点击编辑公式'
  const source = document.createElement('textarea')
  source.rows = 1
  source.wrap = 'soft'
  source.className = 'writing-math-source'
  source.setAttribute('aria-label', '行内公式 LaTeX')
  source.spellcheck = false
  source.hidden = true
  dom.append(preview, source)
  const inlineUi = createInlineMathPresentation(dom, source)
  const value = () => node.attrs.value
  function render() {
    if (!opened) renderMathPreview(preview, value())
    if (source.value !== value()) {
      const start = source.selectionStart, end = source.selectionEnd
      source.value = value()
      if (opened) source.setSelectionRange(Math.min(start, source.value.length), Math.min(end, source.value.length))
    }
    inlineUi.refresh()
  }
  function updateValue(text) {
    const pos = getPos()
    if (typeof pos !== 'number' || destroyed) return
    const current = view.state.doc.nodeAt(pos)
    if (current?.type !== node.type || text === value()) return
    const tr = view.state.tr
    tr.setNodeAttribute(pos, 'value', text)
    view.dispatch(tr)
  }
  function open(entry = 'end', focus = true) {
    if (opened || !view.editable || destroyed) return
    let caret = entry === 'start' ? 0 : source.value.length
    if (typeof entry === 'object' && entry.detail > 0) {
      const box = preview.getBoundingClientRect()
      caret = Math.round(Math.max(0, Math.min(1, (entry.clientX - box.left) / Math.max(box.width, 1))) * source.value.length)
    }
    opened = true; original = value()
    view.dispatch(closeHistory(view.state.tr))
    dom.classList.add('is-editing'); preview.hidden = true; source.hidden = false
    inlineUi?.open()
    if (focus) source.focus({ preventScroll: true })
    source.setSelectionRange(caret, caret)
  }
  function close(focus = false, direction = 1) {
    if (!opened) return
    opened = false; dom.classList.remove('is-editing'); source.hidden = true; preview.hidden = false
    inlineUi?.close(); render()
    const pos = getPos()
    if (focus && typeof pos === 'number' && !destroyed) {
      const target = direction < 0 ? pos : pos + node.nodeSize
      const tr = closeHistory(view.state.tr)
      tr.setSelection(TextSelection.near(tr.doc.resolve(target), direction))
      view.dispatch(tr); view.focus()
    }
  }
  dom.addEventListener('writing-math-enter', event => open(event.detail))
  preview.addEventListener('click', open)
  preview.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() }
  })
  source.addEventListener('compositionstart', () => { composing = true })
  source.addEventListener('compositionend', () => { composing = false; updateValue(source.value); inlineUi?.refresh() })
  source.addEventListener('input', () => { if (!composing) updateValue(source.value); inlineUi?.refresh() })
  source.addEventListener('blur', () => { updateValue(source.value); close() })
  source.addEventListener('keydown', event => {
    if (event.isComposing || composing) return
    const mod = event.ctrlKey || event.metaKey
    if (mod && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      const action = event.key.toLowerCase() === 'y' || event.shiftKey ? redo : undo
      action(view.state, view.dispatch.bind(view)); return
    }
    if (event.key === 'Escape') { event.preventDefault(); updateValue(original); close(true); return }
    if (!source.value && ['Backspace', 'Delete'].includes(event.key)) {
      const pos = getPos()
      if (typeof pos !== 'number') return
      event.preventDefault()
      const tr = closeHistory(view.state.tr).delete(pos, pos + node.nodeSize)
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos)))
      view.dispatch(tr); view.focus(); return
    }
    if (!event.shiftKey && !mod && !event.altKey && source.selectionStart === source.selectionEnd && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      const direction = event.key === 'ArrowUp' ? -1 : 1
      const caret = sourceCaretGeometry(source)
      if (direction < 0 ? caret.row === 0 : caret.row >= caret.lastRow) {
        event.preventDefault()
        close(true, direction)
        moveBodyVertically(view, direction, caret.x)
        return
      }
      // Within a wrapped/multiline source, keep native textarea movement.
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault(); close(true, event.shiftKey ? -1 : 1); return
    }
    if (!event.shiftKey && source.selectionStart === source.selectionEnd && (
      (event.key === 'ArrowLeft' && source.selectionStart === 0) ||
      (event.key === 'ArrowRight' && source.selectionEnd === source.value.length)
    )) { event.preventDefault(); close(true, event.key === 'ArrowLeft' ? -1 : 1) }
  })
  const unregister = registerEmbeddedView(view, dom, getPos, () => opened ? {
    kind: 'inline', original, start: source.selectionStart, end: source.selectionEnd, scrollTop: source.scrollTop,
  } : null, snapshot => {
    if (snapshot.kind !== 'inline') return
    open('end', false); original = snapshot.original
    source.setSelectionRange(snapshot.start, snapshot.end); source.scrollTop = snapshot.scrollTop
  }, () => source.focus({ preventScroll: true }))
  render()
  return {
    dom, stopEvent: event => dom.contains(event.target), ignoreMutation: () => true,
    selectNode() { queueMicrotask(() => { if (!destroyed) open() }) },
    deselectNode() { if (document.activeElement !== source) close() },
    update(next) {
      if (next.type !== node.type) return false
      node = next; render(); return true
    },
    destroy() { destroyed = true; unregister(); inlineUi?.destroy() },
  }
}
export function installWritingMathViews(view) {
  const previous = view.props.nodeViews || {}, previousKeydown = view.props.handleKeyDown
  view.setProps({
    handleKeyDown(editor, event) {
      const selection = editor.state.selection
      if (editor.editable && selection.empty && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        const direction = event.key === 'ArrowUp' ? -1 : 1
        const target = verticalMathTarget(editor, direction)
        if (target) {
          event.preventDefault()
          target.dispatchEvent(new CustomEvent('writing-math-enter', { detail: direction < 0 ? 'end' : 'start' }))
          return true
        }
      }
      if (editor.editable && selection.empty && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const right = event.key === 'ArrowRight'
        const adjacent = right ? selection.$from.nodeAfter : selection.$from.nodeBefore
        if (adjacent?.type.name === 'math_inline') {
          const pos = right ? selection.from : selection.from - adjacent.nodeSize
          const target = editor.nodeDOM(pos)
          if (target?.classList?.contains('writing-math-inline')) {
            event.preventDefault()
            target.dispatchEvent(new CustomEvent('writing-math-enter', { detail: right ? 'start' : 'end' }))
            return true
          }
        }
      }
      return previousKeydown?.(editor, event) || false
    },
    nodeViews: {
    ...previous,
    math_inline: (node, editor, getPos) => inlineFormulaView(node, editor, getPos),
    code_block: (node, editor, getPos, decorations, innerDecorations) => {
      if (String(node.attrs.language).toLowerCase() === 'latex') return blockFormulaView(node, editor, getPos)
      return trackCodeBlockView(previous.code_block?.(node, editor, getPos, decorations, innerDecorations), editor, getPos) || null
    },
  } })
}
