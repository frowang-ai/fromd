import { commandsCtx } from '@milkdown/kit/core'
import { Fragment } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { hardbreakFilterNodes, insertHardbreakCommand, paragraphSchema, headingSchema } from '@milkdown/kit/preset/commonmark'
import { tableCellSchema, tableHeaderSchema } from '@milkdown/kit/preset/gfm'
import { $remark } from '@milkdown/kit/utils'

const blankLine = 'writingBlankLine'
const preserveRootBlankLines = $remark('writingRootBlankLines', () => function () {
  const data = this.data()
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions || []), {
    handlers: {
      [blankLine]: () => '',
      root(node, _, state, info) {
        const children = []
        let pending = 0
        for (const child of node.children) {
          if (child.type === blankLine) { pending++; continue }
          const left = children.at(-1)
          if (left) {
            // CommonMark joins same-kind lists across any number of blank lines.
            const splitLists = left.type === 'list' && child.type === 'list' && left.ordered === child.ordered
            for (let i = 0; i < pending; i++) {
              children.push(splitLists ? { type: 'html', value: '<br />' } : { type: blankLine })
            }
          }
          pending = 0
          children.push(child)
        }
        return state.containerFlow({ ...node, children }, info)
      },
    },
    join: [(_left, right) => right.type === blankLine ? 0 : undefined],
  }]
  return (tree, file) => {
    const source = String(file)
    const children = []
    for (const child of tree.children) {
      const left = children.at(-1)
      const from = left?.position?.end.offset, to = child.position?.start.offset
      if (left?.type !== 'yaml' && from != null && to != null && from < to) {
        const gap = source.slice(from, to)
        if (/^[ \t\r\n]+$/.test(gap)) {
          const breaks = (gap.match(/\r\n|\r|\n/g) || []).length
          for (let i = 2; i < breaks; i++) children.push({ type: 'paragraph', children: [] })
        }
      }
      children.push(child)
    }
    tree.children = children
  }
})

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
// Root gaps are resolved when the serializer has both neighboring blocks.
// Explicit breaks and cells keep their own serialization.
const textblocks = [paragraphSchema, headingSchema].map(schema => schema.extendSchema(previous => ctx => {
  const spec = previous(ctx)
  return { ...spec, toMarkdown: { ...spec.toMarkdown, runner(state, node) {
    if (node.type.name === 'paragraph' && !node.content.size) {
      if (state.top()?.type === 'root') state.addNode(blankLine)
      return
    }
    if (!endsInBreak(node)) return spec.toMarkdown.runner(state, node)
    state.openNode(node.type.name, undefined, node.type.name === 'heading' ? { depth: node.attrs.level } : undefined)
    serializeLines(state, node)
    state.closeNode()
  } } }
}))

export function configureWritingLineBreaks(editor) {
  editor.config(ctx => ctx.set(hardbreakFilterNodes.key, ['code_block']))
  editor.use(preserveRootBlankLines).use([...cells, ...textblocks].flat())
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
