import { EditorView as CodeView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'

// Only live node views are registered. Sleeping sessions retain plain descriptors,
// never a DOM node, CodeMirror view or the previous view's event closures.
const views = new WeakMap()
export function registerEmbeddedView(view, dom, getPos, capture, restore, focus) {
  let entries = views.get(view)
  if (!entries) views.set(view, entries = new Map())
  entries.set(dom, { getPos, capture, restore, focus })
  return () => entries.delete(dom)
}
export function captureEmbeddedViews(view) {
  return [...(views.get(view)?.values() || [])].flatMap(entry => {
    const value = entry.capture(), pos = entry.getPos()
    return value && typeof pos === 'number' ? [{ pos, ...value }] : []
  })
}
export function restoreEmbeddedViews(view, snapshots = []) {
  for (const snapshot of snapshots) {
    const entry = views.get(view)?.get(view.nodeDOM(snapshot.pos))
    entry?.restore(snapshot)
  }
}
export function focusEmbeddedView(view, snapshots = []) {
  const snapshot = snapshots.at(-1)
  const entry = snapshot && views.get(view)?.get(view.nodeDOM(snapshot.pos))
  if (entry?.focus) entry.focus()
  else view.focus()
}
export function trackCodeBlockView(nodeView, view, getPos) {
  if (!nodeView) return nodeView
  const code = () => {
    const dom = nodeView.dom.querySelector('.cm-editor')
    return dom ? CodeView.findFromDOM(dom) : null
  }
  const unregister = registerEmbeddedView(view, nodeView.dom, getPos, () => {
    const cm = code()
    return cm?.hasFocus ? { kind: 'code', selection: cm.state.selection.toJSON(), scrollTop: cm.scrollDOM.scrollTop, scrollLeft: cm.scrollDOM.scrollLeft } : null
  }, snapshot => {
    if (snapshot.kind !== 'code') return
    const range = snapshot.selection.ranges[snapshot.selection.main]
    // The existing node view lazily creates CM here. PM's from/to mapping loses
    // backwards selection direction, so restore the CM anchor/head explicitly.
    nodeView.setSelection?.(range.anchor, range.head)
    const cm = code()
    if (cm) {
      cm.dispatch({ selection: EditorSelection.fromJSON(snapshot.selection) })
      cm.scrollDOM.scrollTop = snapshot.scrollTop; cm.scrollDOM.scrollLeft = snapshot.scrollLeft
    }
  }, () => code()?.focus())
  const destroy = nodeView.destroy
  nodeView.destroy = () => { unregister(); destroy?.call(nodeView) }
  return nodeView
}
