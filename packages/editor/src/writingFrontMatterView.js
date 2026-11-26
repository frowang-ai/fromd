import { Compartment, EditorState as CodeState } from '@codemirror/state'
import { EditorView as CodeView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import { closeHistory, undo, redo } from '@milkdown/kit/prose/history'
import { leadingFrontMatter } from './markdown/frontmatter.js'
import { registerEmbeddedView } from './writingViewState.js'

// Keep fences and the separator outside the editable content. Only a real edit
// normalizes this prefix to LF; merely constructing/focusing CM changes no bytes.
function parts(source) {
  const text = source.replace(/\r\n?/g, '\n'), front = leadingFrontMatter(text)
  const end = text.lastIndexOf('\n', front.end - 1) + 1
  return { opening: text.slice(0, front.contentStart), content: text.slice(front.contentStart, end).replace(/\n$/, ''), closing: text.slice(end) }
}

const theme = CodeView.theme({
  '&': { color: 'inherit', backgroundColor: 'transparent', fontSize: 'inherit' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'visible', fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-content': { padding: '0', minHeight: '1.65em', caretColor: 'var(--md-link, #32567b)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--md-link, #32567b)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--md-selection, #cbdcf1)' },
})

export function frontMatterView(initial, view, getPos, onBlocked) {
  let node = initial, syncing = false, destroyed = false, composing = false, active = false, restoreFocus = false
  const dom = document.createElement('div'); dom.className = 'writing-frontmatter-block'; dom.contentEditable = 'false'
  const surface = document.createElement('div'); surface.className = 'writing-frontmatter'
  const start = document.createElement('pre'), end = document.createElement('pre')
  start.className = end.className = 'writing-frontmatter-fence'
  const host = document.createElement('div')
  surface.append(start, host, end); dom.append(surface)
  const lock = new Compartment()
  const editability = editable => [CodeState.readOnly.of(!editable), CodeView.editable.of(editable)]
  const initialParts = parts(node.attrs.source)
  function renderFences(value) {
    start.textContent = value.opening.replace(/^\uFEFF/, '').replace(/\n$/, '')
    end.textContent = value.closing.split('\n')[0]
  }
  renderFences(initialParts)

  function travel(action) {
    if (!view.editable || composing || code.composing) return true
    action(view.state, view.dispatch.bind(view)); return true
  }
  function leave(direction) {
    if (composing || code.composing || !view.editable) return false
    const pos = getPos()
    if (typeof pos !== 'number') return false
    let tr = closeHistory(view.state.tr)
    let at = direction < 0 ? pos : pos + node.nodeSize
    // A metadata-only page needs somewhere to continue writing.
    if (direction > 0 && at === tr.doc.content.size) tr = tr.insert(at, view.state.schema.nodes.paragraph.create())
    const selection = TextSelection.near(tr.doc.resolve(at), direction)
    if (selection instanceof NodeSelection && selection.from === pos) return false
    view.dispatch(tr.setSelection(selection).scrollIntoView()); view.focus(); return true
  }
  function exitVertically(forward) {
    if (!code.state.selection.main.empty || composing || code.composing) return false
    const current = code.state.selection.main, next = code.moveVertically(current, forward)
    const before = code.coordsAtPos(current.head), after = code.coordsAtPos(next.head)
    if (next.head !== current.head && (!before || !after || Math.abs(before.top - after.top) > 2)) return false
    return leave(forward ? 1 : -1)
  }
  function exitHorizontally(forward) {
    const range = code.state.selection.main
    return range.empty && range.head === (forward ? code.state.doc.length : 0) && leave(forward ? 1 : -1)
  }
  const code = new CodeView({ parent: host, state: CodeState.create({ doc: initialParts.content, extensions: [
    theme, CodeView.lineWrapping, drawSelection(), indentUnit.of('  '), CodeState.tabSize.of(4),
    lock.of(editability(view.editable)),
    CodeView.contentAttributes.of({ 'aria-label': 'YAML 元数据', 'aria-multiline': 'true', spellcheck: 'false' }),
    CodeView.scrollMargins.of(() => ({ top: 64, bottom: 20 })),
    // CM's own clipboard handler consumes only text/plain. A full metadata-only
    // paste contributes its contents, without duplicating the fixed fences.
    CodeView.clipboardInputFilter.of(text => {
      const front = leadingFrontMatter(text)
      return front && front.bodyStart === text.length ? parts(text).content : text
    }),
    CodeState.transactionFilter.of(tr => {
      if (!tr.docChanged || syncing) return tr
      if (!view.editable) return []
      if (/^(?:---|\.\.\.)[ \t]*$/m.test(tr.newDoc.toString())) {
        onBlocked?.('YAML 内不能插入独立的结束围栏；修改围栏请使用完整 Markdown 源码。')
        return []
      }
      return tr
    }),
    keymap.of([
      { key: 'Mod-z', run: () => travel(undo) },
      { key: 'Mod-Shift-z', run: () => travel(redo) },
      { key: 'Mod-y', run: () => travel(redo) },
      { key: 'ArrowUp', run: () => exitVertically(false) },
      { key: 'ArrowDown', run: () => exitVertically(true) },
      { key: 'ArrowLeft', run: () => exitHorizontally(false) },
      { key: 'ArrowRight', run: () => exitHorizontally(true) },
      { key: 'Mod-Enter', run: () => leave(1) },
      indentWithTab, ...defaultKeymap,
    ]),
    CodeView.domEventHandlers({
      focus() {
        if (destroyed || !view.editable) return
        active = true
        const pos = getPos()
        if (typeof pos === 'number') view.dispatch(closeHistory(view.state.tr).setSelection(NodeSelection.create(view.state.doc, pos)))
      },
      blur() { if (!destroyed) view.dispatch(closeHistory(view.state.tr)) },
      compositionstart() { composing = true },
      compositionend() { composing = false },
    }),
    CodeView.updateListener.of(update => {
      if (!update.docChanged || syncing || destroyed || !view.editable) return
      const pos = getPos()
      if (typeof pos !== 'number' || view.state.doc.nodeAt(pos)?.type !== node.type) return
      const value = parts(node.attrs.source), text = update.state.doc.toString()
      const source = value.opening + (text ? text + '\n' : '') + value.closing
      let tr = view.state.tr
      if (update.transactions.some(tr => tr.isUserEvent('input.paste'))) tr = closeHistory(tr)
      // A replacement map lets PM group adjacent typing into one undo event.
      // Attribute-only steps have empty maps and would undo every keystroke.
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, source })
      tr.setSelection(NodeSelection.create(tr.doc, pos))
      view.dispatch(tr)
    }),
  ] }) })
  function enter(at = 'end') {
    if (destroyed || !view.editable) return
    code.dispatch({ selection: { anchor: at === 'start' ? 0 : code.state.doc.length }, scrollIntoView: true })
    code.focus()
  }
  dom.addEventListener('writing-frontmatter-enter', event => enter(event.detail))
  // The fence is a small, natural block-selection target; content clicks stay in CM.
  for (const fence of [start, end]) fence.addEventListener('mousedown', event => {
    if (!view.editable || event.button !== 0) return
    const pos = getPos()
    if (typeof pos !== 'number') return
    active = false
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))); view.focus()
  })
  const unregister = registerEmbeddedView(view, dom, getPos, () => active ? {
    kind: 'frontmatter', anchor: code.state.selection.main.anchor, head: code.state.selection.main.head,
    scrollTop: code.scrollDOM.scrollTop, scrollLeft: code.scrollDOM.scrollLeft,
  } : null, snapshot => {
    if (snapshot.kind !== 'frontmatter') return
    active = true; restoreFocus = true
    code.dispatch({ selection: { anchor: Math.min(snapshot.anchor, code.state.doc.length), head: Math.min(snapshot.head, code.state.doc.length) } })
    code.scrollDOM.scrollTop = snapshot.scrollTop; code.scrollDOM.scrollLeft = snapshot.scrollLeft
  }, () => code.focus(), editable => {
    code.dispatch({ effects: lock.reconfigure(editability(editable)) })
    if (editable && restoreFocus) {
      restoreFocus = false
      queueMicrotask(() => { if (!destroyed && view.editable) code.focus() })
    }
  })
  return {
    dom, stopEvent: event => host.contains(event.target), ignoreMutation: () => true,
    selectNode() { dom.classList.add('ProseMirror-selectednode'); dom.draggable = true },
    deselectNode() { active = false; dom.classList.remove('ProseMirror-selectednode'); dom.removeAttribute('draggable') },
    update(next) {
      if (next.type !== node.type) return false
      node = next
      const value = parts(node.attrs.source); renderFences(value)
      if (code.state.doc.toString() !== value.content) {
        const selection = code.state.selection.main
        syncing = true
        try { code.dispatch({ changes: { from: 0, to: code.state.doc.length, insert: value.content }, selection: { anchor: Math.min(selection.anchor, value.content.length), head: Math.min(selection.head, value.content.length) } }) }
        finally { syncing = false }
      }
      return true
    },
    destroy() { destroyed = true; unregister(); code.destroy() },
  }
}
