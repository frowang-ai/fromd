// Map source line/Unicode character locations to PM textblocks. This boundary
// uses the original Markdown AST; no PM coordinates escape into persistence.
const fold = text => text.replace(/[A-Z]/g, char => char.toLowerCase())
export function sourceOffset(markdown, {line, column}) {
  const lines = markdown.split('\n'), index = Math.max(0, Math.min(line - 1, lines.length - 1))
  return lines.slice(0, index).reduce((n, text) => n + text.length + 1, 0) +
    [...lines[index]].slice(0, column).join('').length
}
function occurrences(text, needle) {
  const found = [], source = fold(text), query = fold(needle)
  if (!query) return found
  for (let index = source.indexOf(query); index >= 0; index = source.indexOf(query, index + query.length)) found.push(index)
  return found
}
export function markdownRange(doc, ast, markdown, offset, needle = '') {
  const blocks = []
  const visit = node => {
    if (['paragraph', 'heading', 'tableCell', 'code'].includes(node.type)) {
      if (node.position) blocks.push(node.position)
      return
    }
    node.children?.forEach(visit)
  }
  visit(ast)
  const pm = []
  doc.descendants((node, pos) => { if (node.isTextblock) { pm.push({node,pos}); return false } })
  const index = blocks.findIndex(span => offset >= span.start.offset && offset <= span.end.offset)
  if (index < 0 || blocks.length !== pm.length) return null
  const {node,pos} = pm[index], span = blocks[index]
  if (!needle) return {from:pos + 1, to:pos + 1, exact:true}
  // Include atom placeholders so offsets after inline math/images stay correct.
  const text = node.textBetween(0, node.content.size, '', '\uFFFC')
  const visible = occurrences(text, needle), raw = markdown.slice(span.start.offset, span.end.offset)
  const source = occurrences(raw, needle), ordinal = source.indexOf(offset - span.start.offset)
  if (ordinal >= 0 && source.length === visible.length)
    return {from:pos + 1 + visible[ordinal], to:pos + 1 + visible[ordinal] + needle.length, exact:true}
  // Syntax-only matches are located at their block; keep source range for the
  // existing View > Source entry rather than introducing an automatic mode switch.
  return {from:pos + 1, to:pos + 1 + node.content.size, exact:false}
}
