import { isEscaped } from './markdown/normalize/pipeline.js'
import { normalizeWritingMath } from './writingMathCompatibility.js'

// Narrow AI-output compatibility: **text. ** -> **text.** . Move trailing
// spaces outside an explicit pair; leave already-valid emphasis, code, math,
// HTML, link targets, escaped stars and unmatched/triple delimiters untouched.
export function normalizeWritingMarkdown(markdown, parseMarkdown) {
  const source = normalizeWritingMath(markdown, parseMarkdown)
  const protectedRanges = [], containers = []
  function visit(node) {
    const start = node.position?.start.offset, end = node.position?.end.offset
    if (['code', 'inlineCode', 'html', 'math', 'inlineMath', 'strong', 'emphasis', 'link', 'image', 'definition'].includes(node.type)) {
      if (start != null && end != null) protectedRanges.push([start, end])
      return
    }
    if (['paragraph', 'heading', 'tableCell'].includes(node.type) && start != null && end != null) containers.push([start, end])
    node.children?.forEach(visit)
  }
  visit(parseMarkdown(source))
  const edits = []
  for (const [start, end] of containers) {
    let text = source.slice(start, end)
    for (const [a, b] of protectedRanges) {
      if (a >= end || b <= start) continue
      const left = Math.max(start, a) - start, right = Math.min(end, b) - start
      text = text.slice(0, left) + '\uFFFC'.repeat(right - left) + text.slice(right)
    }
    for (const match of text.matchAll(/\*\*(?!\*)([^\r\n]*?\S)([ \t]+)\*\*(?!\*)/g)) {
      const from = start + match.index, closing = from + match[0].length - 2, to = closing + 2
      // Moving spaces out would let a trailing backslash escape the closing stars.
      const trailingBackslashes = /\\+$/.exec(match[1])?.[0].length ?? 0
      if (trailingBackslashes % 2) continue
      if (/^\s/.test(match[1]) || source[from - 1] === '*' || isEscaped(source, from) || isEscaped(source, closing)) continue
      if (match[1].includes('**') || protectedRanges.some(([a, b]) => a < to && b > from)) continue
      edits.push({ from, to, value: `**${match[1]}**${match[2]}` })
    }
  }
  let cursor = 0, result = ''
  for (const edit of edits.sort((a, b) => a.from - b.from)) {
    if (edit.from < cursor) continue
    result += source.slice(cursor, edit.from) + edit.value; cursor = edit.to
  }
  return result + source.slice(cursor)
}
