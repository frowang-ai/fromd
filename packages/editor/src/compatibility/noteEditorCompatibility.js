import { isEscaped } from '../markdown/normalize/pipeline.js'

export function replaceNoteMathInputRules(rules, { InputRule, TextSelection }, schema) {
  const crepeInlinePattern = /(?:\$)([^$]+)(?:\$)$/.source
  return rules.flatMap(rule => {
    if (rule.match.source !== crepeInlinePattern) return [rule]
    const block = new InputRule(/^\$\$([^$\n\uFFFC]+)\$\$$/, (state, match, start, end) => {
      const position = state.doc.resolve(start)
      if (position.parent.type !== schema.nodes.paragraph || !match[1].trim()) return null
      // Input rules only match text before the cursor. Whole-paragraph
      // replacement is safe only when no unmatched prefix or suffix remains.
      if (position.parentOffset !== 0 || end !== position.end()) return null
      const before = position.before(), node = schema.nodes.code_block.create({ language: 'LaTeX' }, schema.text(match[1]))
      const tr = state.tr.replaceWith(before, position.after(), node)
      return tr.setSelection(TextSelection.create(tr.doc, before + 1 + match[1].length))
    })
    const inline = new InputRule(/(^|[^$])\$([^$\n\uFFFC]+)\$$/, (state, match, start, end) => {
      const from = start + match[1].length, position = state.doc.resolve(from)
      const prefix = position.parent.textBetween(0, position.parentOffset, undefined, '\uFFFC')
      if (!match[2].trim() || isEscaped(prefix + '$', prefix.length)) return null
      let containsAtomOrCode = false
      state.doc.nodesBetween(from, end, node => {
        if ((node.isInline && !node.isText) || node.marks.some(mark => mark.type.spec.code)) containsAtomOrCode = true
      })
      if (containsAtomOrCode) return null
      return state.tr.replaceWith(from, end, schema.nodes.math_inline.create({ value: match[2] }))
    })
    // A double-dollar run must reach its own closing delimiter before it can
    // become math. Crepe's generic inline rule otherwise consumes its middle,
    // then wraps the resulting atom's U+FFFC placeholder on the final dollar.
    return [block, inline]
  })
}

// Use the editor's Markdown parser to locate literal code, rather than rewriting
// backslashes globally. Positions refer to the original, unescaped input.
export function normalizeNoteBracketMath(markdown, parseMarkdown) {
  const protectedRanges = [], textContainers = [], replacements = []
  function visit(node, parent) {
    const start = node.position?.start.offset, end = node.position?.end.offset
    if (['code', 'inlineCode', 'html', 'math', 'inlineMath', 'image', 'definition'].includes(node.type)) {
      // remark treats a one-line $$...$$ as inline math. An independent root
      // paragraph is a display formula and must enter Crepe's block preview.
      const rootParagraph = node.type === 'inlineMath' && parent?.type === 'paragraph' && parent.children.length === 1
        && textContainers.some(range => range.topLevelParagraph && range.start === parent.position.start.offset)
      if (rootParagraph && markdown.slice(start, start + 2) === '$$' && markdown[start + 2] !== '$'
        && markdown.slice(end - 2, end) === '$$' && markdown[end - 3] !== '$') {
        replacements.push({ start, end: start + 2, value: '$$\n' }, { start: end - 2, end, value: '\n$$' })
      }
      if (start != null && end != null) protectedRanges.push([start, end])
      return
    }
    if (start != null && end != null) {
      if (['paragraph', 'heading', 'tableCell'].includes(node.type)) {
        textContainers.push({ start, end, paragraph: node.type === 'paragraph', topLevelParagraph: node.type === 'paragraph' && parent?.type === 'root' })
      }
      if (node.type === 'link') {
        // Managed attachment labels are literal filenames, not formula input.
        if (/^\.frowd-assets\/[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(node.url || '')) {
          protectedRanges.push([start, end]); return
        }
        const labelStart = node.children?.[0]?.position?.start.offset
        const labelEnd = node.children?.at(-1)?.position?.end.offset
        // Link labels are visible phrasing content. Only their surrounding
        // syntax, destination and optional title stay outside math conversion.
        if (labelStart != null && labelEnd != null) {
          protectedRanges.push([start, labelStart], [labelEnd, end])
          textContainers.push({ start: labelStart, end: labelEnd, topLevelParagraph: false })
        } else protectedRanges.push([start, end])
      }
    }
    node.children?.forEach(child => visit(child, node))
  }
  visit(parseMarkdown(markdown))
  protectedRanges.sort((a, b) => a[0] - b[0])
  const protectedAt = index => protectedRanges.some(([start, end]) => index >= start && index < end)
  for (let index = 0; index < markdown.length; index++) {
    if (markdown[index] !== '\\' || isEscaped(markdown, index) || protectedAt(index)) continue
    const bracket = markdown[index + 1]
    if (bracket !== '(' && bracket !== '[') continue
    const container = textContainers.filter(range => index >= range.start && index < range.end)
      .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]
    if (!container) continue
    const closing = bracket === '(' ? ')' : ']'
    let end = index + 2
    while (end + 1 < container.end) {
      if (markdown[end] === '\\' && markdown[end + 1] === closing && !isEscaped(markdown, end) && !protectedAt(end)) break
      end++
    }
    if (end + 1 >= container.end || protectedRanges.some(([start, stop]) => start < end && stop > index)) continue
    const body = markdown.slice(index + 2, end)
    if (!body.trim() || (bracket === '(' && /\r?\n/.test(body))) continue
    const standalone = bracket === '[' && container.paragraph
      && !markdown.slice(container.start, index).trim() && !markdown.slice(end + 2, container.end).trim()
    const multiline = /\r?\n/.test(body)
    const block = standalone && (container.topLevelParagraph || multiline)
    // Only edit delimiters. The body, line endings and container prefixes stay
    // in the source for remark to interpret; a quote's `> ` is never LaTeX.
    // A one-line root paragraph can safely gain math fence line breaks. Nested
    // one-line/mixed content remains inline and gains no block boundaries.
    replacements.push(
      { start: index, end: index + 2, value: block ? (multiline ? '$$' : '$$\n') : '$' },
      { start: end, end: end + 2, value: block ? (multiline ? '$$' : '\n$$') : '$' },
    )
    index = end + 1
  }
  let cursor = 0
  const chunks = []
  replacements.sort((a, b) => a.start - b.start)
  for (const replacement of replacements) {
    chunks.push(markdown.slice(cursor, replacement.start), replacement.value)
    cursor = replacement.end
  }
  return chunks.join('') + markdown.slice(cursor)
}

export function normalizeNotePastedMath(html, remark, document) {
  if (!html.includes('$')) return html
  // A template is inert: preserving pasted image attributes here cannot load
  // them. Image schema rendering still applies the shared resource policy.
  const template = document.createElement('template')
  template.innerHTML = html
  const walker = document.createTreeWalker(template.content, 4), texts = []
  while (walker.nextNode()) texts.push(walker.currentNode)
  let changed = false
  for (const text of texts) {
    if (!template.content.contains(text) || text.parentElement?.closest('pre,code,kbd,samp,script,style,math,[data-type="math_inline"]')) continue
    const source = text.nodeValue, formulas = []
    function visit(node) {
      if (node.type === 'math' || node.type === 'inlineMath') { formulas.push(node); return }
      node.children?.forEach(visit)
    }
    visit(remark.parse(source))
    if (!formulas.length) continue
    const only = formulas.length === 1 ? formulas[0] : null, paragraph = text.parentElement?.closest('p')
    const wholeBlock = only && source.slice(only.position.start.offset, only.position.start.offset + 2) === '$$'
      && !source.slice(0, only.position.start.offset).trim() && !source.slice(only.position.end.offset).trim()
      && paragraph?.textContent === source && !paragraph.closest('td,th,a')
      && [...paragraph.querySelectorAll('*')].every(element => element.tagName === 'SPAN')
    if (wholeBlock) {
      const pre = document.createElement('pre'), code = document.createElement('code')
      pre.dataset.language = 'LaTeX'; code.textContent = only.value; pre.appendChild(code); paragraph.replaceWith(pre)
    } else {
      const fragment = document.createDocumentFragment()
      let cursor = 0
      for (const formula of formulas) {
        fragment.appendChild(document.createTextNode(source.slice(cursor, formula.position.start.offset)))
        const span = document.createElement('span')
        span.dataset.type = 'math_inline'; span.dataset.value = formula.value; fragment.appendChild(span)
        cursor = formula.position.end.offset
      }
      fragment.appendChild(document.createTextNode(source.slice(cursor))); text.replaceWith(fragment)
    }
    changed = true
  }
  return changed ? template.innerHTML : html
}

export function serializeNoteNestedMath(markdown, remark) {
  const replacements = []
  function visit(node, parent) {
    // The shared reader consumes raw multi-line block math before quote/list
    // prefixes are removed. Export nested math as a phrasing node instead,
    // using remark's semantic value (never source containing those prefixes).
    if (node.type === 'math' && parent?.type !== 'root') {
      replacements.push({
        start: node.position.start.offset, end: node.position.end.offset,
        value: remark.stringify({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'inlineMath', value: node.value }] }] }).trimEnd(),
      })
      return
    }
    node.children?.forEach(child => visit(child, node))
  }
  visit(remark.parse(markdown))
  let cursor = 0
  const chunks = []
  for (const replacement of replacements) {
    chunks.push(markdown.slice(cursor, replacement.start), replacement.value)
    cursor = replacement.end
  }
  return chunks.join('') + markdown.slice(cursor)
}
