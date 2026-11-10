import { liftListItem, sinkListItem } from '@milkdown/kit/prose/schema-list'
import { TextSelection, Plugin } from '@milkdown/kit/prose/state'
import { closeHistory } from '@milkdown/kit/prose/history'

// List-item label/listType are derived display data. The parent list is the
// authority, including during input rules, Enter, paste and undo/redo, whose
// transactions may carry metadata. Never infer/change a list type from a stale
// item label. No-op when already consistent; derived updates add no undo step.
export function writingListLabels({ $prose }) {
  return $prose(() => new Plugin({ appendTransaction(transactions, _previous, state) {
    if (!transactions.some(transaction => transaction.docChanged)) return null
    const tr = state.tr
    state.doc.descendants((node, pos, parent, index) => {
      if (node.type.name !== 'list_item') return
      const ordered = parent?.type.name === 'ordered_list'
      if (!ordered && parent?.type.name !== 'bullet_list') return
      const listType = ordered ? 'ordered' : 'bullet'
      const label = ordered ? `${(parent.attrs.order ?? 1) + index}.` : '•'
      if (node.attrs.label !== label || node.attrs.listType !== listType) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, label, listType })
      }
    })
    return tr.docChanged ? tr.setMeta('addToHistory', false) : null
  } }))
}

function syncNativeTextSelection(editor, event) {
  const owner = editor.dom.ownerDocument, KeyboardEvent = owner.defaultView?.KeyboardEvent
  // Native selectionchange may arrive after the next keydown. Only synchronize
  // real keyboard events: ProseMirror also invokes handlers with synthetic
  // Events while interpreting a DOM deletion that has already happened.
  if (!KeyboardEvent || !(event instanceof KeyboardEvent) || owner.activeElement !== editor.dom || !(editor.state.selection instanceof TextSelection)) return
  const native = owner.getSelection()
  if (!native?.anchorNode || !editor.dom.contains(native.anchorNode) || !editor.dom.contains(native.focusNode)) return
  try {
    const anchor = editor.state.doc.resolve(editor.posAtDOM(native.anchorNode, native.anchorOffset))
    const head = editor.state.doc.resolve(editor.posAtDOM(native.focusNode, native.focusOffset))
    if (!anchor.parent.isTextblock || !head.parent.isTextblock) return
    const selection = TextSelection.between(anchor, head)
    if (!selection.eq(editor.state.selection)) editor.dispatch(editor.state.tr.setSelection(selection).setMeta('addToHistory', false))
  } catch { /* Replaced DOM or non-text selections retain ProseMirror's state. */ }
}

export function installWritingListKeys(view) {
  const previous = view.props.handleKeyDown
  view.setProps({ handleKeyDown(editor, event) {
    const fallback = () => previous?.(editor, event) || false
    if (!editor.editable || editor.composing || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return fallback()
    if (!['Tab', 'Backspace'].includes(event.key) || (event.key === 'Backspace' && event.shiftKey)) return fallback()
    syncNativeTextSelection(editor, event)
    const { state } = editor, { selection } = state
    if (!(selection instanceof TextSelection)) return fallback()
    const { $from } = selection, itemType = state.schema.nodes.list_item
    let itemDepth = 0
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth)
      // Tables and code keep their own Tab/Backspace behavior, including when
      // nested inside a list. Formula source inputs stop events in their view.
      if (node.type.spec.code || ['table', 'table_row', 'table_cell', 'table_header'].includes(node.type.name)) return fallback()
      if (!itemDepth && node.type === itemType) itemDepth = depth
    }
    if (!itemDepth) return fallback()
    if (event.key === 'Backspace' && (!selection.empty || $from.parentOffset !== 0 || $from.parent.type.name !== 'paragraph' || $from.depth !== itemDepth + 1 || $from.index(itemDepth) !== 0)) return fallback()
    const command = event.key === 'Tab' && !event.shiftKey ? sinkListItem(itemType) : liftListItem(itemType)
    const handled = command(state, transaction => {
      // Keep each structural action separate from surrounding typing history.
      editor.dispatch(closeHistory(editor.state.tr))
      editor.dispatch(transaction.scrollIntoView())
      editor.dispatch(closeHistory(editor.state.tr))
    }, editor)
    if (handled || event.key === 'Tab') {
      // The first item cannot nest without a preceding parent; don't fall back
      // to inserting spaces that only look like a structural list indentation.
      event.preventDefault(); return true
    }
    return fallback()
  } })
}
