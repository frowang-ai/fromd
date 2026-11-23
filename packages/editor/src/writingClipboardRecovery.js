import MarkdownIt from 'markdown-it'

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
        } else append([node.nodeType, node.nodeValue])
      }
      return result
    }
    return JSON.stringify(children(template.content))
  }
  return shape(html) === shape(plainRenderer.render(text))
}

// Counts cannot establish fidelity: two links can have different URLs, two
// comments different text, and an underscore misparsed as <em> is not evidence
// that the Markdown source is less faithful. Preserve actual rich values and
// marked runs when there is no exact rendering witness above.
export function richContentPreserved(before, after) {
  function features(fragment) {
    const values = new Map()
    const add = value => { const key = JSON.stringify(value); values.set(key, (values.get(key) || 0) + 1) }
    fragment.descendants(node => {
      if (['table', 'image', 'bullet_list', 'ordered_list', 'blockquote', 'code_block', 'math_inline', 'writing_comment_inline', 'writing_comment_block'].includes(node.type.name)) add(['node', node.toJSON()])
      if (!node.isTextblock) return
      const active = new Map()
      const flush = key => { add(['mark', key, active.get(key)]); active.delete(key) }
      node.forEach(child => {
        const marks = new Set(child.marks.map(mark => JSON.stringify(mark.toJSON())))
        for (const key of active.keys()) if (!marks.has(key)) flush(key)
        // An atom's value participates in its surrounding mark, not just its
        // empty textContent. Adjacent text node splitting is immaterial.
        const value = child.isText ? child.text : JSON.stringify({ type: child.type.name, attrs: child.attrs, text: child.textContent })
        for (const key of marks) active.set(key, (active.get(key) || '') + value)
      })
      for (const key of active.keys()) flush(key)
    })
    return values
  }
  const expected = features(before), available = features(after)
  return [...expected].every(([key, count]) => (available.get(key) || 0) >= count)
}

export function mathContent(fragment) {
  const values = []
  fragment.descendants(node => {
    if (node.type.name === 'math_inline') values.push(['inline', node.attrs.value])
    if (node.type.name === 'code_block' && String(node.attrs.language).toLowerCase() === 'latex') values.push(['display', node.textContent])
  })
  return JSON.stringify(values)
}
