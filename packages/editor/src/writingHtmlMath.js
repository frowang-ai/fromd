import { isEscaped } from './markdown/normalize/pipeline.js'

const literal = 'pre,code,kbd,samp,script,style,[data-type="math_inline"]'
export function mathElement(document, value, display = false) {
  if (display) {
    const pre = document.createElement('pre'), code = document.createElement('code')
    pre.dataset.language = 'LaTeX'; code.textContent = value; pre.appendChild(code)
    return pre
  }
  const span = document.createElement('span')
  span.dataset.type = 'math_inline'; span.dataset.value = value
  return span
}
function unwrapSource(value) {
  const source = value.trim()
  if ((source.startsWith('\\(') && source.endsWith('\\)')) || (source.startsWith('\\[') && source.endsWith('\\]'))) return source.slice(2, -2).trim()
  if (source.startsWith('$$') && source.endsWith('$$') && source.length > 4) return source.slice(2, -2).trim()
  if (source.startsWith('$') && source.endsWith('$') && source.length > 2) return source.slice(1, -1).trim()
  return source
}

// Read explicit source metadata only. Never derive TeX from rendered glyphs or
// execute clipboard markup; template nodes are inert and the result is text.
export function recoverRenderedMath(root, document) {
  const counts = { convertedDisplay: 0, convertedInline: 0 }
  function replace(target, source, display) {
    const value = unwrapSource(source)
    if (!value || !root.contains(target) || target.closest(literal)) return
    target.replaceWith(mathElement(document, value, display))
    counts[display ? 'convertedDisplay' : 'convertedInline']++
  }
  for (const annotation of [...root.querySelectorAll('annotation[encoding="application/x-tex"],annotation[encoding="application/x-latex"]')]) {
    if (!root.contains(annotation) || annotation.closest(literal)) continue
    const math = annotation.closest('math')
    if (!math) continue
    const target = math.closest('.katex-display') || math.closest('.katex') || math.closest('mjx-container') || math
    const display = target.classList.contains('katex-display') || math.getAttribute('display') === 'block' || target.getAttribute('display') === 'true'
    replace(target, annotation.textContent, display)
  }
  for (const element of [...root.querySelectorAll('[data-latex],[data-tex]')]) {
    if (!root.contains(element) || element.closest(literal)) continue
    // Restrict attributes to small math wrappers, not entire articles/tables.
    if (!['SPAN', 'DIV', 'MATH', 'MJX-CONTAINER'].includes(element.tagName.toUpperCase()) || element.querySelector('p,div,table,ul,ol,pre,code')) continue
    const source = element.getAttribute('data-latex') ?? element.getAttribute('data-tex')
    const display = element.matches('.math-display,.katex-display,[data-display="true"],[display="block"]') || source.trim().startsWith('\\[') || source.trim().startsWith('$$')
    replace(element, source, display)
  }
  return counts
}

// Promoting a paragraph to a math block cannot preserve inline rich marks or
// non-text payloads. Such content stays inline instead of being flattened.
// Class/line metadata on a span is a transport wrapper, not a PM mark. Keep
// style, semantic/data attributes and known math/comment carriers out: promoting
// those could flatten genuine bold/italic, links or hidden payloads.
function neutralMathSpan(element) {
  return element.tagName === 'SPAN' && !element.matches(`${literal},math,.writing-html-comment,.katex,.katex-display`)
    && [...element.attributes].every(attribute => ['class', 'data-line', 'data-line-number'].includes(attribute.name))
}

export function isPlainMathContainer(element) {
  return ['P', 'DIV'].includes(element.nodeName) && !element.closest('td,th,a,strong,b,em,i,u,mark,s,del,sub,sup,[style]')
    && [...element.querySelectorAll('*')].every(child => child.tagName === 'BR' || neutralMathSpan(child))
}

// A formula can span several styling spans. Build offsets within one logical
// paragraph/cell, then replace only its paired delimiters using DOM Range.
export function recoverFragmentedMath(root, document, remark) {
  const counts = { convertedDisplay: 0, convertedInline: 0 }
  const blocks = 'p,td,th,li,h1,h2,h3,h4,h5,h6,div,blockquote'
  const candidates = [...root.querySelectorAll(`${blocks},a`), root]
  for (const container of candidates) {
    if (container !== root && (!root.contains(container) || container.closest(`${literal},math`))) continue
    if (container.querySelector(blocks)) continue
    const segments = []
    let text = ''
    function collect(node) {
      if (node.nodeType === 3) {
        segments.push({ node, start: text.length, end: text.length + node.nodeValue.length }); text += node.nodeValue
      } else if (node.nodeType === 8 || (node.nodeType === 1 && node.matches(`${literal},math,a,img,hr,.writing-html-comment`))) text += '\uFFFC'
      else if (node.nodeName === 'BR') text += '\n'
      else node.childNodes.forEach(collect)
    }
    container.childNodes.forEach(collect)
    const matches = [], openings = /\\([([])/g
    for (const match of text.matchAll(openings)) {
      const start = match.index
      if (isEscaped(text, start) || matches.some(previous => start < previous.end)) continue
      const closing = match[1] === '(' ? '\\)' : '\\]'
      let end = text.indexOf(closing, start + 2)
      while (end >= 0 && isEscaped(text, end)) end = text.indexOf(closing, end + 2)
      if (end < 0) continue
      const value = text.slice(start + 2, end)
      if (!value.trim() || /[\r\n\uFFFC]/.test(value)) continue
      matches.push({ start, end: end + 2, value, display: match[1] === '[' && !text.slice(0, start).trim() && !text.slice(end + 2).trim() && isPlainMathContainer(container) })
    }
    // Parse dollars over the logical text run, not individual DOM text nodes.
    // remark owns escaping, delimiter-run and code rules. Never cross an atom,
    // link, literal region or comment, and keep mixed/cell content inline.
    function dollars(node) {
      if (node.type === 'math' || node.type === 'inlineMath') {
        const start = node.position.start.offset, end = node.position.end.offset
        if (node.type === 'math' && !/^(\${2,})[^\n]*\n[\s\S]*\n\1[ \t]*$/.test(text.slice(start, end))) return
        if (text.slice(start, end).includes('\uFFFC') || matches.some(match => start < match.end && end > match.start)) return
        const display = text.slice(start, start + 2) === '$$' && !text.slice(0, start).trim() && !text.slice(end).trim()
          && isPlainMathContainer(container)
        matches.push({ start, end, value: node.value, display })
        return
      }
      node.children?.forEach(dollars)
    }
    dollars(remark.parse(text))
    for (const match of matches.sort((a, b) => b.start - a.start)) {
      const from = segments.find(segment => match.start >= segment.start && match.start < segment.end)
      const to = segments.find(segment => match.end > segment.start && match.end <= segment.end)
      if (!from || !to) continue
      const formula = mathElement(document, match.value, match.display)
      if (match.display) container.replaceWith(formula)
      else {
        const range = document.createRange()
        range.setStart(from.node, match.start - from.start); range.setEnd(to.node, match.end - to.start)
        range.deleteContents(); range.insertNode(formula)
      }
      counts[match.display ? 'convertedDisplay' : 'convertedInline']++
    }
  }
  return counts
}
