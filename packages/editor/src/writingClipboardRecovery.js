import MarkdownIt from 'markdown-it'
import { Fragment, Mark } from '@milkdown/kit/prose/model'

// A non-math Markdown renderer can consume TeX underscores/backslashes as
// emphasis/escapes before our HTML parser sees them. Only discard those marks
// when the *entire* clipboard HTML is accounted for by this source rendering.
// Raw HTML is disabled: source containing HTML-only metadata must not qualify
// merely because rendering it verbatim happens to reproduce the clipboard.
const plainRenderer = new MarkdownIt()
export function isRenderedMarkdownClipboard(text, html, document) {
  if (!document) return false
  function shape(markup) {
    const template = document.createElement('template')
    template.innerHTML = markup
    function children(parent) {
      const result = []
      function append(value) {
        if (typeof value === 'string' && typeof result.at(-1) === 'string') result[result.length - 1] += value
        else result.push(value)
      }
      for (const node of parent.childNodes) {
        if (node.nodeType === 3) {
          // Transport whitespace outside blocks is not document text.
          if (!node.nodeValue.trim() && (parent.nodeType === 11 || ['UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TR'].includes(parent.nodeName))) continue
          append(node.nodeValue)
        } else if (node.nodeType === 1) {
          const content = children(node)
          // Producers may split text into neutral spans. Attributes, real
          // formatting, links, images, comments and metadata remain exact.
          if (node.tagName === 'SPAN' && !node.attributes.length) content.forEach(append)
          else append([node.tagName, [...node.attributes].map(attr => [attr.name, attr.value]).sort(), content])
        } else if (node.nodeType === 8 && /^(StartFragment|EndFragment)$/.test(node.nodeValue.trim())
          && !parent.closest?.('pre,code,kbd,samp,script,style,math')) {
          // Same transport sentinels excluded by preservePastedComments. No
          // other comment, wrapper or attribute is ignored by this witness.
          continue
        } else append([node.nodeType, node.nodeValue])
      }
      return result
    }
    return JSON.stringify(children(template.content))
  }
  return shape(html) === shape(plainRenderer.render(text))
}

// Without a complete rendering witness, every HTML character, mark, atom and
// block boundary must match in order. The candidate may supply missing math or
// images (still qualified by the resource pipeline), but may not replace plain
// words, collapse breaks, change heading levels or drop unmarked paragraphs.
// Trailing empty HTML paragraphs are retained, not counted away.
export function preservedClipboardContent(before, after, { parse, normalize, toPaste } = {}) {
  function explicitStrong(node) {
    if (!parse || !node.isText || node.marks.length || !node.text.includes('**')) return Fragment.from(node)
    // Recognize only explicit strong syntax, using the existing normalization
    // and parser. Sentinels prevent paragraph-edge whitespace from disappearing.
    // Reconstructing the spelling proves that no escapes/links/other syntax was
    // consumed while interpreting these markers. This is a comparison only.
    const source = normalize('z' + node.text + 'z'), parsed = parse(source)
    if (parsed?.childCount !== 1 || parsed.firstChild.type.name !== 'paragraph') return Fragment.from(node)
    const paragraph = parsed.firstChild
    let spelling = '', valid = true
    paragraph.forEach(child => {
      if (!child.isText || child.marks.some(mark => mark.type.name !== 'strong')) { valid = false; return }
      spelling += child.marks.length ? '**' + child.text + '**' : child.text
    })
    if (!valid || spelling !== source || paragraph.firstChild.marks.length || paragraph.lastChild.marks.length) return Fragment.from(node)
    // Use the same whitespace handling as the actual paste candidate, including
    // the spaces moved outside a malformed closing ** pair by normalize().
    const content = (toPaste ? toPaste(parsed).firstChild : paragraph).content
    return content.cut(1, content.size - 1)
  }
  function tokens(fragment, interpretStrong = false) {
    const result = []
    fragment.forEach(node => {
      const content = interpretStrong ? explicitStrong(node) : Fragment.from(node)
      content.forEach(child => {
        if (child.isText) for (const text of child.text) result.push({ text, marks: child.marks })
        else result.push({ node: child })
      })
    })
    return result
  }
  const addition = token => ['math_inline', 'image'].includes(token?.node?.type.name)
  const space = token => token?.text === ' ' || token?.text === '\t'
  function inlinePreserved(original, candidate) {
    const left = tokens(original, true), right = tokens(candidate)
    let i = 0, adjacentAddition = false
    for (let j = 0; j < right.length; j++) {
      const a = left[i], b = right[j]
      const equal = a && (a.node ? b.node && a.node.eq(b.node)
        : b.text === a.text && Mark.sameSet(a.marks, b.marks))
      if (equal) { i++; adjacentAddition = false; continue }
      if (addition(b)) { adjacentAddition = true; continue }
      // Additional spacing around a newly supplied formula/resource is safe;
      // existing whitespace and hard_break nodes still have to be consumed.
      if (space(b)) {
        let next = j + 1
        while (space(right[next])) next++
        if (adjacentAddition || addition(right[next])) continue
      }
      return false
    }
    return i === left.length
  }
  const displayMath = node => node.type.name === 'code_block' && String(node.attrs.language).toLowerCase() === 'latex'
  function emptyParagraph(node) {
    if (node.type.name !== 'paragraph' || node.marks.length) return false
    let empty = true
    node.forEach(child => { if (!(child.type.name === 'hardbreak' || (child.isText && !child.marks.length && /^[ \t\r\n]*$/.test(child.text)))) empty = false })
    return empty
  }
  function matchNode(original, candidate) {
    if (original.eq(candidate)) return candidate
    if (!original.sameMarkup(candidate) || original.isLeaf || original.type.spec.code) return null
    if (original.isTextblock) return inlinePreserved(original.content, candidate.content) ? candidate : null
    const content = matchChildren(original.content, candidate.content)
    return content && candidate.type.validContent(content) ? candidate.copy(content) : null
  }
  function matchChildren(original, candidate) {
    const merged = []
    let i = 0
    for (let j = 0; j < candidate.childCount; j++) {
      const next = candidate.child(j), matched = i < original.childCount ? matchNode(original.child(i), next) : null
      if (matched) { merged.push(matched); i++; continue }
      if (displayMath(next)) { merged.push(next); continue }
      return null
    }
    for (; i < original.childCount; i++) {
      const extra = original.child(i)
      if (!emptyParagraph(extra)) return null
      merged.push(extra)
    }
    return Fragment.fromArray(merged)
  }
  return matchChildren(before, after)
}

export function richContentPreserved(before, after, options) {
  return preservedClipboardContent(before, after, options) !== null
}

export function mathContent(fragment) {
  const values = []
  fragment.descendants(node => {
    if (node.type.name === 'math_inline') values.push(['inline', node.attrs.value])
    if (node.type.name === 'code_block' && String(node.attrs.language).toLowerCase() === 'latex') values.push(['display', node.textContent])
  })
  return JSON.stringify(values)
}
