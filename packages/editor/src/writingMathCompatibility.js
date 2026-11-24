import { normalizeNoteBracketMath } from './compatibility/noteEditorCompatibility.js'
import { recoverRenderedMath, recoverFragmentedMath, isPlainMathContainer } from './writingHtmlMath.js'

// Bracket display fences must be recognized across Markdown block boundaries:
// an equation's standalone '=' / '-' can already have become a setext heading.
// The initial AST is used only to protect literal code, HTML and existing math.
export function normalizeWritingMath(markdown, parseMarkdown) {
  const protectedRanges = []
  function protect(node) {
    if (['code', 'inlineCode', 'html', 'math', 'inlineMath', 'image', 'definition', 'link'].includes(node.type)) {
      if (node.position) protectedRanges.push([node.position.start.offset, node.position.end.offset])
      return
    }
    node.children?.forEach(protect)
  }
  protect(parseMarkdown(markdown))
  const overlaps = (start, end) => protectedRanges.some(([from, to]) => from < end && to > start)
  const delimiters = /^ {0,3}\\([\[\]])[ \t]*\r?$/gm
  const replacements = []
  let opening
  for (const match of markdown.matchAll(delimiters)) {
    const start = match.index + match[0].indexOf('\\')
    if (overlaps(start, start + 2)) { opening = undefined; continue }
    if (match[1] === '[') { opening = start; continue }
    if (opening !== undefined) {
      if (markdown.slice(opening + 2, start).trim() && !overlaps(opening, start + 2)) {
        replacements.push({ start: opening, end: opening + 2 }, { start, end: start + 2 })
      }
      opening = undefined
    }
  }
  let cursor = 0, result = ''
  for (const replacement of replacements) {
    result += markdown.slice(cursor, replacement.start) + '$$'
    cursor = replacement.end
  }
  result += markdown.slice(cursor)
  // Existing adapter handles inline brackets, single-line display formulas and
  // nested containers. Only the unambiguous standalone fences above are new.
  return normalizeNoteBracketMath(result, parseMarkdown)
}

export function normalizeWritingPastedMath(html, remark, document, onRecovery = () => {}) {
  const template = document.createElement('template')
  template.innerHTML = html
  const recovered = recoverRenderedMath(template.content, document)
  const excluded = 'pre,code,kbd,samp,script,style,math,[data-type="math_inline"]'
  function textWithBreaks(element) {
    const clone = element.cloneNode(true)
    clone.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode('\n')))
    return clone.textContent
  }
  const eligible = element => isPlainMathContainer(element) && !element.closest(excluded)
  function displayValue(text) {
    const bracketFence = /^ {0,3}\\\[[ \t]*\r?\n/.test(text) && /\n {0,3}\\\][ \t]*$/.test(text)
    const dollarFence = /^ {0,3}\$\$[ \t]*\r?\n/.test(text) && /\n {0,3}\$\$[ \t]*$/.test(text)
    if (!bracketFence && !dollarFence) return null
    const normalized = normalizeWritingMath(text, value => remark.parse(value))
    const tree = remark.parse(normalized)
    return tree.children.length === 1 && tree.children[0].type === 'math' ? tree.children[0].value : null
  }
  function replaceBlocks(blocks, value) {
    const pre = document.createElement('pre'), code = document.createElement('code')
    pre.dataset.language = 'LaTeX'; code.textContent = value; pre.appendChild(code)
    blocks[0].replaceWith(pre)
    blocks.slice(1).forEach(block => block.remove())
  }
  for (const element of [...template.content.querySelectorAll('p,div')]) {
    if (!template.content.contains(element) || !eligible(element)) continue
    const text = textWithBreaks(element)
    const value = displayValue(text)
    if (value !== null) { replaceBlocks([element], value); continue }
    // Some clipboard producers use one paragraph per equation line. Consume
    // only adjacent simple blocks inside one parent, with both explicit fences.
    const opening = /^ {0,3}(\\\[|\$\$)[ \t]*$/.exec(text)
    if (!opening) continue
    const closing = opening[1] === '$$' ? '$$' : '\\]'
    const blocks = [element], lines = [text]
    let next = element.nextSibling
    while (next) {
      if (next.nodeType === 3 && !next.textContent.trim()) { next = next.nextSibling; continue }
      if (next.nodeType !== 1 || !eligible(next)) break
      const line = textWithBreaks(next)
      if (opening[1] !== '$$' && /^ {0,3}\\\[[ \t]*$/.test(line)) break
      blocks.push(next); lines.push(line)
      if (line.trim() === closing) {
        const combined = displayValue(lines.join('\n'))
        if (combined !== null) replaceBlocks(blocks, combined)
        break
      }
      next = next.nextSibling
    }
  }
  const fragments = recoverFragmentedMath(template.content, document, remark)
  recovered.convertedDisplay += fragments.convertedDisplay
  recovered.convertedInline += fragments.convertedInline
  if (recovered.convertedDisplay || recovered.convertedInline) onRecovery(recovered)
  return template.innerHTML
}
