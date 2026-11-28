import { commandsCtx } from '@milkdown/kit/core'
import { toggleMark } from '@milkdown/kit/prose/commands'
import { closeHistory } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import {
  createCodeBlockCommand, toggleEmphasisCommand, toggleInlineCodeCommand,
  toggleStrongCommand, wrapInBlockquoteCommand, wrapInBulletListCommand,
  wrapInHeadingCommand, wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { createTable, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { toggleLinkCommand } from '@milkdown/kit/component/link-tooltip'

const commands = {
  bold: toggleStrongCommand, italic: toggleEmphasisCommand, inlineCode: toggleInlineCodeCommand,
  strike: toggleStrikethroughCommand, link: toggleLinkCommand, quote: wrapInBlockquoteCommand,
  orderedList: wrapInOrderedListCommand, bulletList: wrapInBulletListCommand,
  codeBlock: createCodeBlockCommand, mathBlock: createCodeBlockCommand,
}

export function formatWriting(view, ctx, { name, level }) {
  const { state, dispatch } = view
  const { selection } = state
  const { $from, from, to, empty } = selection
  if (!(selection instanceof TextSelection)) return
  const run = (command, payload) => ctx.get(commandsCtx).call(command.key, payload)
  const currentLevel = $from.parent.type.name === 'heading' ? $from.parent.attrs.level : 0
  if (name === 'heading') return run(wrapInHeadingCommand, level === currentLevel && $from.sameParent(selection.$to) ? 0 : level)
  if (name === 'raiseHeading' || name === 'lowerHeading') {
    const next = Math.max(0, Math.min(6, currentLevel + (name === 'raiseHeading' ? 1 : -1)))
    if (next !== currentLevel) return run(wrapInHeadingCommand, next)
    return
  }
  if (name === 'clear') {
    const tr = empty ? state.tr.setStoredMarks([]) : state.tr.removeMark(from, to)
    if (tr.docChanged || tr.storedMarksSet) dispatch(tr)
    return
  }
  if (name === 'underline') return toggleMark(state.schema.marks.writing_u)(state, dispatch, view)
  if (name === 'table' && selection.$to.depth) {
    const at = selection.$to.after(1)
    const tr = closeHistory(state.tr.insert(at, createTable(ctx)))
    tr.setSelection(TextSelection.findFrom(tr.doc.resolve(at), 1, true))
    dispatch(tr.scrollIntoView())
    dispatch(closeHistory(view.state.tr))
    return
  }
  if (name === 'link' && !$from.sameParent(selection.$to)) return
  if (name === 'codeBlock' || name === 'mathBlock') {
    // setBlockType drops inline nodes that cannot fit inside a code block.
    let hasInlineNodes = false
    const inspect = node => node.forEach(child => { if (child.isInline && !child.isText) hasInlineNodes = true })
    if (empty) inspect($from.parent)
    else state.doc.nodesBetween(from, to, node => { if (node.isTextblock) { inspect(node); return false } })
    if (hasInlineNodes) return
  }
  if (commands[name]) return run(commands[name], name === 'mathBlock' ? 'latex' : undefined)
}
