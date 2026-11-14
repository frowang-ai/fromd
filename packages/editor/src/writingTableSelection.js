import { TableNodeView, tableBlockView } from '@milkdown/kit/component/table-block'
import { tableSchema } from '@milkdown/kit/preset/gfm'
import { $view } from '@milkdown/kit/utils'
import { editorStateOptionsCtx, prosePluginsCtx } from '@milkdown/kit/core'
import {ordinary,textCell,textFirstTablePlugins} from './writingTableSelectionPolicy.js'

export async function configureWritingTables(editor) {
  // The original view stays responsible for controls/DOM/lifecycle. Wrap its
  // public stopEvent; never patch the dependency or rebuild the table.
  await editor.remove(tableBlockView)
  editor.use($view(tableSchema.node, ctx => (node, view, getPos) => {
    const instance = new TableNodeView(ctx, node, view, getPos)
    const stop = instance.stopEvent.bind(instance)
    instance.stopEvent = event => {
      if (['mousedown', 'pointerdown'].includes(event.type) && ordinary(event) && textCell(event, view)) return false
      return stop(event)
    }
    return instance
  }))
  // Runs during state creation, before EditorView and before allPlugins is saved.
  // Also covers replaceAll(flush=true), and all later session states reuse these.
  editor.config(ctx => ctx.update(editorStateOptionsCtx, previous => options => {
    const configured = previous(options)
    const plugins = textFirstTablePlugins(configured.plugins)
    ctx.set(prosePluginsCtx, plugins)
    return { ...configured, plugins }
  }))
}
