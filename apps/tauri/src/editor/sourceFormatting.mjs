import {leadingFrontMatter} from '../../../../packages/editor/src/markdown/frontmatter.js'

const headingShortcut = name => ['heading', 'raiseHeading', 'lowerHeading'].includes(name)
const inlineDelimiters = {bold: ['**', '**'], italic: ['*', '*'], underline: ['<u>', '</u>'], strike: ['~~', '~~']}
const markNames = {strong: 'bold', emphasis: 'italic', delete: 'strike', link: 'link', linkReference: 'link', inlineCode: 'inlineCode'}
const offsets = node => [node.position.start.offset, node.position.end.offset]
const lineStart = (text, at) => at ? text.lastIndexOf('\n', at - 1) + 1 : 0
const lineEnd = (text, at) => { const end = text.indexOf('\n', at); return end === -1 ? text.length : end }

export function sourceBodyStart(text) {
  const front = leadingFrontMatter(text)
  // A caret immediately after the closing fence still belongs to that line.
  return front ? Math.max(front.end + 1, front.bodyStart) : 0
}

function replace(text, from, to, value, start = from, end = start) {
  return {text: text.slice(0, from) + value + text.slice(to), start, end}
}

function applyEdits(text, {start, end}, edits) {
  let cursor = 0, movedStart = start, movedEnd = end
  const parts = []
  for (const {from, to, value} of edits.sort((a, b) => a.from - b.from)) {
    const shift = at => at < from ? 0 : value.length - (Math.min(to, at) - from)
    movedStart += shift(start)
    movedEnd += shift(end)
    parts.push(text.slice(cursor, from), value)
    cursor = to
  }
  parts.push(text.slice(cursor))
  return {text: parts.join(''), start: movedStart, end: movedEnd}
}

function sourceBlock(text, {start, end}, syntax) {
  const from = lineStart(text, start)
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end
  const to = lineEnd(text, last)
  // A block includes continuation lines, indentation and a Setext underline.
  for (const node of syntax.children) {
    if (node.type === 'yaml') continue
    const [start, end] = offsets(node)
    const blockFrom = lineStart(text, start), blockTo = lineEnd(text, end)
    if (blockFrom > to) break
    if (blockTo < from) continue
    if (from < blockFrom || to > blockTo || !['heading', 'paragraph'].includes(node.type)) return null
    return {from: blockFrom, to: blockTo, node}
  }
  if (from === lineStart(text, last) && !text.slice(from, to).trim()) return {from, to}
  return null
}

function formatHeading(text, range, shortcut, {from, to, node}) {
  const previous = node?.depth ?? 0
  const next = shortcut.name === 'heading' ? (shortcut.level === previous ? 0 : shortcut.level) :
    Math.max(0, Math.min(6, previous + (shortcut.name === 'raiseHeading' ? 1 : -1)))
  if (next === previous) return null
  const at = node?.position.start.offset ?? from
  const atx = previous ? /^#{1,6}(?:[ \t]+|$)/.exec(text.slice(at, to)) : null
  const edits = []
  let contentEnd = to
  if (previous && !atx) {
    const underline = lineStart(text, to)
    if (next === 1 || next === 2) {
      return applyEdits(text, range, [{from: underline, to, value: next === 1 ? '===' : '---'}])
    }
    contentEnd = underline - 1
    edits.push({from: contentEnd, to, value: ''})
  }
  // ATX headings are single-line. Leave multiline text intact if changing to
  // ATX would split the block or require rewriting the title.
  if (next && lineEnd(text, at) < contentEnd) return null
  const insertAt = at + (atx?.[0].length ?? 0)
  if (next) edits.push({from: at, to: insertAt, value: '#'.repeat(next) + ' '})
  else {
    const closing = atx && /(?:^|[ \t]+)#+[ \t]*$/.exec(text.slice(insertAt, to))
    if (closing) edits.push({from: insertAt + closing.index, to, value: ''})
    // A heading may directly follow or precede prose. Keep the resulting
    // paragraph distinct on both sides.
    const before = from > sourceBodyStart(text) && text[from - 2] !== '\n' ? '\n' : ''
    const after = to + 1 < text.length && text[to + 1] !== '\n' ? '\n' : ''
    edits.push({from, to: insertAt, value: before})
    if (after) edits.push({from: to, to, value: after})
  }
  return applyEdits(text, range, edits)
}

function visibleEdge(node, end) {
  if (markNames[node.type] && node.children?.length) return visibleEdge(end ? node.children.at(-1) : node.children[0], end)
  return node.position[end ? 'end' : 'start'].offset
}

function unwrapMarks(text, range, syntax, name) {
  const edits = []
  let blockedLink = false
  function add(mark, from, to, innerFrom, innerTo, visibleFrom = innerFrom, visibleTo = innerTo) {
    const {start, end} = range
    if (name === 'link' && mark === 'link') {
      // Toggle only when the full label or full link is selected.
      const label = start >= innerFrom && end <= innerTo && start <= visibleFrom && end >= visibleTo
      const full = start === from && end === to
      if (!(end > start && (label || full))) {
        if (start === end ? start > from && start < to : start < to && end > from) blockedLink = true
        return
      }
    }
    const complete = start <= visibleFrom && end >= visibleTo
    if (name !== 'clear' && name !== mark || !complete && !(start === end && start >= innerFrom && start <= innerTo)) return
    if (from < innerFrom) edits.push({from, to: innerFrom, value: ''})
    if (innerTo < to) edits.push({from: innerTo, to, value: ''})
  }
  function visit(node) {
    const mark = markNames[node.type]
    if (mark && node.children?.length) {
      const [from, to] = offsets(node)
      const first = node.children[0], last = node.children.at(-1)
      const [innerFrom] = offsets(first), [, innerTo] = offsets(last)
      if (mark === 'link' && name === 'link' && (innerFrom === from || innerTo === to)) {
        // Autolinks have no separately delimited label.
        if (range.start < to && range.end > from) blockedLink = true
      } else {
        add(mark, from, to, innerFrom, innerTo,
          name === 'clear' || mark === 'link' ? visibleEdge(first, false) : innerFrom,
          name === 'clear' || mark === 'link' ? visibleEdge(last, true) : innerTo)
      }
    } else if (name === 'link' && ['link', 'linkReference', 'image', 'imageReference'].includes(node.type)) {
      const [from, to] = offsets(node)
      if (range.start < to && range.end > from) blockedLink = true
    } else if (mark === 'inlineCode') {
      const [from, to] = offsets(node), fence = /^`+/.exec(text.slice(from, to))[0].length
      let innerFrom = from + fence, innerTo = to - fence
      const inner = text.slice(innerFrom, innerTo)
      if (inner.startsWith(' ') && inner.endsWith(' ') && inner.trim()) { innerFrom++; innerTo-- }
      add(mark, from, to, innerFrom, innerTo)
    }
    // Pair the attribute-free HTML marks supported by the writing editor.
    const tags = []
    for (const child of node.children ?? []) {
      const tag = child.type === 'html' && /^<(\/?)(u|sub|sup|mark|kbd)\s*>$/i.exec(child.value)
      if (!tag) continue
      if (!tag[1]) tags.push(child)
      else if (tag[2].toLowerCase() === tags.at(-1)?.value.match(/^<([a-z]+)/i)[1].toLowerCase()) {
        const [from, innerFrom] = offsets(tags.pop()), [innerTo, to] = offsets(child)
        add(tag[2].toLowerCase() === 'u' ? 'underline' : 'htmlMark', from, to, innerFrom, innerTo)
      }
    }
    node.children?.forEach(visit)
  }
  visit(syntax)
  return blockedLink ? null : edits
}

function inlineEdit(text, range, name, syntax) {
  const edits = unwrapMarks(text, range, syntax, name)
  if (!edits) return null
  if (edits.length) return applyEdits(text, range, edits)
  const {start, end} = range
  const selected = text.slice(start, end)
  if (name === 'clear' || selected.includes('\n')) return null
  if (name === 'link') {
    const label = selected.replace(/[\\[\]]/g, '\\$&'), caret = start + (label ? label.length + 3 : 1)
    return replace(text, start, end, '[' + label + ']()', caret)
  }
  let [left, right] = inlineDelimiters[name] ?? []
  if (name === 'inlineCode') {
    const runs = selected.match(/`+/g) ?? []
    const delimiter = '`'.repeat(1 + runs.reduce((max, run) => Math.max(max, run.length), 0))
    const pad = selected.startsWith('`') || selected.endsWith('`') || /^ .* $/.test(selected) && selected.trim()
    left = delimiter + (pad ? ' ' : '')
    right = (pad ? ' ' : '') + delimiter
  }
  if (name in inlineDelimiters && selected) {
    const content = selected.trim()
    if (!content) return null
    const leading = selected.slice(0, selected.length - selected.trimStart().length)
    const trailing = selected.slice(selected.trimEnd().length)
    return replace(text, start, end, leading + left + content + right + trailing,
      start + (leading ? 0 : left.length), end + left.length + (trailing ? right.length : 0))
  }
  return replace(text, start, end, left + selected + right, start + left.length, end + left.length)
}

export function formatSource(text, range, shortcut, syntax) {
  const {start, end} = range, {name} = shortcut
  if (start < sourceBodyStart(text)) return null
  if (name in inlineDelimiters || ['clear', 'link', 'inlineCode'].includes(name)) {
    function touchesLiteral(node) {
      const [from, to] = offsets(node)
      if (start > to || end < from) return false
      return ['code', 'math'].includes(node.type) || node.children?.some(touchesLiteral)
    }
    return syntax.children.some(touchesLiteral) ? null : inlineEdit(text, range, name, syntax)
  }
  const block = sourceBlock(text, range, syntax)
  if (!block) return null
  if (headingShortcut(name)) return formatHeading(text, range, shortcut, block)
  const {from, to, node} = block
  const lines = text.slice(from, to)
  if (name === 'table') {
    const gap = lines.trim() ? '\n\n' : ''
    const table = '|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |'
    const at = gap ? to : from
    return replace(text, at, to, gap + table + '\n', at + gap.length + 2)
  }
  if (node?.type === 'heading') return null
  if (name === 'codeBlock' || name === 'mathBlock') {
    const fence = name === 'mathBlock' ? '$$' : '`'.repeat(Math.max(3, 1 + (lines.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0)))
    const before = (from && text[from - 2] !== '\n' && from > sourceBodyStart(text) ? '\n' : '') + fence + '\n'
    const after = '\n' + fence + (to < text.length ? '\n' : '')
    return replace(text, from, to, before + lines + after, start + before.length, end + before.length)
  }
  const edits = []
  let at = from
  for (const [index, line] of lines.split('\n').entries()) {
    const prefix = name === 'quote' ? '> ' : name === 'orderedList' ? (index ? '   ' : '1. ') : (index ? '  ' : '- ')
    edits.push({from: at, to: at, value: prefix})
    at += line.length + 1
  }
  return applyEdits(text, range, edits)
}
