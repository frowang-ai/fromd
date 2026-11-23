import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import { fixTables, tableEditingKey } from '@milkdown/kit/prose/tables'
export const ordinary = event => event.button === 0 && !event.ctrlKey && !event.metaKey && !event.altKey
export function textCell(event, view) {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement
  return target?.closest('td, th') && view.dom.contains(target) &&
    !target.closest('button, [data-role], .column-resize-handle, [contenteditable="false"]')
}
// Same key, state, index and original handlers; only the two tested selection
// policies change. In particular keep fixTables, paste, keys and explicit cells.
export function textFirstTablePlugins(plugins) {
  const index = plugins.findIndex(plugin => plugin.key === tableEditingKey.key)
  if (index < 0) throw new Error('Existing tableEditing plugin was not found')
  if (plugins[index].spec.frowdTextFirst) return plugins
  const base = plugins[index]
  const wrapped = new Plugin({
    ...base.spec, frowdTextFirst: true,
    props: { ...base.spec.props, handleDOMEvents: {
      ...base.spec.props.handleDOMEvents,
      mousedown(view, event) {
        if (ordinary(event) && textCell(event, view)) return false
        return base.spec.props.handleDOMEvents.mousedown.call(base, view, event)
      },
    } },
    appendTransaction(transactions, oldState, state) {
      const s = state.selection
      if (s instanceof TextSelection && s.$anchor.parent.isTextblock && s.$head.parent.isTextblock)
        return fixTables(state, oldState)
      return base.spec.appendTransaction.call(base, transactions, oldState, state)
    },
  })
  const result = plugins.slice(); result[index] = wrapped
  return result
}
