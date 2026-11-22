import { registerEmbeddedView } from './writingViewState.js'
import { renderMathPreview } from './writingMathPreview.js'
import { EditorState as CodeState } from '@codemirror/state'
import { EditorView as CodeView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language'
import { stexMath } from '@codemirror/legacy-modes/mode/stex'
import { tags } from '@lezer/highlight'
import { TextSelection } from '@milkdown/kit/prose/state'
import { closeHistory, undo, redo } from '@milkdown/kit/prose/history'

const sourceTheme = CodeView.theme({
  '&': { backgroundColor: '#f4f6f8', fontSize: '14px', color: '#253246' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'visible', fontFamily: 'var(--editor-font-mono)', lineHeight: '1.7' },
  '.cm-content': { padding: '8px 12px', caretColor: '#184c91' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#184c91', borderLeftWidth: '2px' },
  '.cm-activeLine': { backgroundColor: '#e3ebf4' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#cbdcf1' },
})
const sourceHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.tagName], color: 'var(--writing-code-keyword, #176a36)' },
  { tag: [tags.atom, tags.string], color: 'var(--writing-code-string, #8b3e95)' },
  { tag: tags.number, color: 'var(--writing-code-number, #9a521e)' },
  { tag: [tags.bracket, tags.operator], color: 'var(--writing-code-operator, #2463ae)' },
  { tag: tags.comment, color: 'var(--writing-code-comment, #7a8490)', fontStyle: 'italic' },
])

export function blockFormulaView(initial, view, getPos, { doneShortcut = 'Ctrl+Enter' } = {}) {
  let node = initial, code, opened = false, original = '', syncing = false, destroyed = false, frame = 0
  const dom = document.createElement('div'); dom.className = 'writing-math writing-math-block'; dom.contentEditable = 'false'
  const panel = document.createElement('div'); panel.className = 'writing-block-source'; panel.hidden = true
  const header = document.createElement('div'); header.className = 'writing-block-header'
  const start = document.createElement('span'); start.className = 'writing-block-fence'; start.textContent = '$$'; start.setAttribute('aria-hidden', 'true')
  const done = document.createElement('button'); done.type = 'button'; done.className = 'writing-block-done'; done.textContent = '✓'; done.title = `完成编辑（${doneShortcut}）`; done.setAttribute('aria-label', '完成公式编辑')
  header.append(start, done)
  const host = document.createElement('div'); host.className = 'writing-block-code'
  const end = start.cloneNode(true); end.classList.add('is-ending')
  panel.append(header, host, end)
  const preview = document.createElement('div'); preview.className = 'writing-math-preview'
  preview.tabIndex = 0; preview.setAttribute('role', 'button'); preview.setAttribute('aria-label', '编辑行间公式')
  dom.append(panel, preview)

  function renderPreview() {
    cancelAnimationFrame(frame); frame = 0
    if (destroyed) return
    renderMathPreview(preview, node.textContent, { displayMode: true })
  }
  function updateValue(text) {
    if (destroyed || text === node.textContent) return
    const pos = getPos()
    if (typeof pos !== 'number' || view.state.doc.nodeAt(pos)?.type !== node.type) return
    view.dispatch(view.state.tr.replaceWith(pos + 1, pos + node.nodeSize - 1, text ? view.state.schema.text(text) : []))
  }
  function close(focus = false, direction = 1) {
    if (!opened) return
    opened = false; panel.hidden = true; dom.classList.remove('is-editing'); renderPreview()
    const pos = getPos()
    if (focus && typeof pos === 'number' && !destroyed) {
      const at = direction < 0 ? pos : pos + node.nodeSize
      const tr = closeHistory(view.state.tr)
      view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at), direction)).scrollIntoView()); view.focus()
    }
  }
  function exitVertically(forward) {
    if (!code || code.composing || !code.state.selection.main.empty) return false
    const current = code.state.selection.main, next = code.moveVertically(current, forward)
    const before = code.coordsAtPos(current.head), after = code.coordsAtPos(next.head)
    if (next.head !== current.head && (!before || !after || Math.abs(before.top - after.top) > 2)) return false
    close(true, forward ? 1 : -1); return true
  }
  function createCode() {
    code = new CodeView({ parent: host, state: CodeState.create({ doc: node.textContent, extensions: [
      sourceTheme, StreamLanguage.define(stexMath), syntaxHighlighting(sourceHighlight), bracketMatching(),
      drawSelection({ cursorBlinkRate: 1000 }), highlightActiveLine(), CodeView.lineWrapping,
      CodeView.contentAttributes.of({ 'aria-label': '行间公式 LaTeX', 'aria-multiline': 'true', spellcheck: 'false' }),
      CodeView.scrollMargins.of(() => ({ top: 64, bottom: 20 })),
      keymap.of([
        { key: 'Mod-Enter', run: () => { close(true); return true } },
        { key: 'Escape', run: () => { updateValue(original); close(true); return true } },
        { key: 'Mod-z', run: () => { undo(view.state, view.dispatch.bind(view)); return true } },
        { key: 'Mod-Shift-z', run: () => { redo(view.state, view.dispatch.bind(view)); return true } },
        { key: 'Mod-y', run: () => { redo(view.state, view.dispatch.bind(view)); return true } },
        { key: 'ArrowUp', run: () => exitVertically(false) },
        { key: 'ArrowDown', run: () => exitVertically(true) },
        indentWithTab, ...defaultKeymap,
      ]),
      CodeView.updateListener.of(update => {
        if (update.docChanged && !syncing && !destroyed) updateValue(update.state.doc.toString())
      }),
    ] }) })
  }
  function open(entry = 'start', focus = true) {
    if (opened || destroyed || !view.editable) return
    opened = true; original = node.textContent
    view.dispatch(closeHistory(view.state.tr)); panel.hidden = false; dom.classList.add('is-editing')
    if (!code) createCode()
    const at = entry === 'end' ? code.state.doc.length : 0
    code.dispatch({ selection: { anchor: at }, scrollIntoView: focus })
    if (focus) code.focus()
  }
  done.addEventListener('click', () => close(true))
  preview.addEventListener('click', () => { if (opened) close(); else open() })
  preview.addEventListener('keydown', event => {
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); open() }
  })
  dom.addEventListener('writing-math-enter', event => open(event.detail))
  dom.addEventListener('focusout', () => queueMicrotask(() => {
    if (!destroyed && opened && !dom.contains(document.activeElement)) close()
  }))
  const unregister = registerEmbeddedView(view, dom, getPos, () => opened && code ? {
    kind: 'block', original, anchor: code.state.selection.main.anchor, head: code.state.selection.main.head,
    scrollTop: code.scrollDOM.scrollTop, scrollLeft: code.scrollDOM.scrollLeft,
  } : null, snapshot => {
    if (snapshot.kind !== 'block') return
    open('start', false); original = snapshot.original
    code.dispatch({ selection: { anchor: snapshot.anchor, head: snapshot.head } })
    code.scrollDOM.scrollTop = snapshot.scrollTop; code.scrollDOM.scrollLeft = snapshot.scrollLeft
  }, () => code?.focus())
  renderPreview()
  return {
    dom, stopEvent: event => dom.contains(event.target), ignoreMutation: () => true,
    selectNode() { queueMicrotask(() => { if (!destroyed) open() }) },
    deselectNode() { if (!code?.hasFocus) close() },
    update(next) {
      if (next.type !== node.type || String(next.attrs.language).toLowerCase() !== 'latex') return false
      node = next
      if (code && code.state.doc.toString() !== node.textContent) {
        const selection = code.state.selection.main
        syncing = true
        try { code.dispatch({ changes: { from: 0, to: code.state.doc.length, insert: node.textContent }, selection: { anchor: Math.min(selection.anchor, node.textContent.length), head: Math.min(selection.head, node.textContent.length) } }) }
        finally { syncing = false }
      }
      cancelAnimationFrame(frame); frame = requestAnimationFrame(renderPreview)
      return true
    },
    destroy() { destroyed = true; unregister(); cancelAnimationFrame(frame); code?.destroy() },
  }
}
