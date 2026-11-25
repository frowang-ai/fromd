import { commandsCtx } from '@milkdown/kit/core'
import { Fragment } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { hardbreakFilterNodes, insertHardbreakCommand, paragraphSchema, headingSchema } from '@milkdown/kit/preset/commonmark'
import { tableCellSchema, tableHeaderSchema } from '@milkdown/kit/preset/gfm'

const explicitBreak = node => node?.type.name === 'hardbreak' && !node.attrs.isInline
function endsInBreak(node) {
  for (let index = node.childCount - 1; index >= 0; index--) {
    const child = node.child(index)
    if (child.type.name !== 'writing_comment_inline') return explicitBreak(child)
  }
  return false
}

function serializeLines(state, paragraph, cell = false) {
  const children = []
  paragraph.forEach(node => {
    // Milkdown's soft line breaks render as spaces. A pasted internal span can
    // carry one into a cell, where a naked newline would serialize as &#xA;.
    children.push(cell && node.type.name === 'hardbreak' && node.attrs.isInline
      ? state.schema.text(' ', node.marks) : node)
  })
  state.next(Fragment.fromArray(children))
  // HTML needs one terminating br after a trailing break to display its empty
  // line. Parsing removes only this terminator, matching PM's trailingBreak DOM.
  if (endsInBreak(paragraph)) state.addNode('html', undefined, '<br>')
}

const cells = [tableCellSchema, tableHeaderSchema].map(schema => schema.extendSchema(previous => ctx => {
  const spec = previous(ctx)
  return { ...spec, toMarkdown: { ...spec.toMarkdown, runner(state, node) {
    if (node.childCount !== 1 || node.firstChild?.type.name !== 'paragraph') return spec.toMarkdown.runner(state, node)
    state.openNode('tableCell')
    serializeLines(state, node.firstChild, true)
    state.closeNode()
  } } }
}))
// Keep the upstream empty-paragraph placeholder and ordinary prose behavior.
// Only a real trailing break needs to bypass upstream's unconditional trimming.
const textblocks = [paragraphSchema, headingSchema].map(schema => schema.extendSchema(previous => ctx => {
  const spec = previous(ctx)
  return { ...spec, toMarkdown: { ...spec.toMarkdown, runner(state, node) {
    if (!endsInBreak(node)) return spec.toMarkdown.runner(state, node)
    state.openNode(node.type.name, undefined, node.type.name === 'heading' ? { depth: node.attrs.level } : undefined)
    serializeLines(state, node)
    state.closeNode()
  } } }
}))

export function configureWritingLineBreaks(editor) {
  editor.config(ctx => ctx.set(hardbreakFilterNodes.key, ['code_block']))
  editor.use([...cells, ...textblocks].flat())
}

// Wrap the public command after creation so keymaps and command callers share
// the same rule. A cell permits one paragraph: never run upstream's second-break
// branch there, which tries to replace a hardbreak with a new paragraph.
export function installWritingLineBreakCommand(ctx) {
  const commands = ctx.get(commandsCtx), previous = commands.get(insertHardbreakCommand.key)
  commands.create(insertHardbreakCommand.key, payload => (state, dispatch, view) => {
    const { selection } = state
    if (selection instanceof TextSelection) {
      for (let depth = selection.$from.depth; depth > 0; depth--) {
        if (['table_cell', 'table_header'].includes(selection.$from.node(depth).type.name)) {
          if (!selection.$from.sameParent(selection.$to)) return false
          dispatch?.(state.tr.setMeta('hardbreak', true)
            .replaceSelectionWith(state.schema.nodes.hardbreak.create()).scrollIntoView())
          return true
        }
      }
    }
    return previous(payload)(state, dispatch, view)
  })
}
