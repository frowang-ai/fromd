// Front matter is an opaque source block, not a YAML object. Only a complete
// pair of unindented fences at the very start (optionally after BOM) qualifies.
// Invalid YAML inside closed fences is still editable literal metadata. An
// unfinished prefix is ordinary Markdown; it must never hide the rest of a file.
export function leadingFrontMatter(markdown) {
  const opening = /^\uFEFF?---[ \t]*(?:\r\n|\n|\r)/.exec(markdown)
  if (!opening) return null
  const lines = /([^\r\n]*)(\r\n|\n|\r|$)/g
  lines.lastIndex = opening[0].length
  let line
  while ((line = lines.exec(markdown)) && line[0]) {
    if (!/^(?:---|\.\.\.)[ \t]*$/.test(line[1])) continue
    const end = line.index + line[1].length
    // Preserve the separator too: a body-only edit cannot change the metadata's
    // CRLF, trailing spaces or the blank lines after its closing fence.
    const gap = /^(?:[ \t]*(?:\r\n|\n|\r))*/.exec(markdown.slice(end))[0]
    const bodyStart = end + gap.length
    return { raw: markdown.slice(0, end), prefix: markdown.slice(0, bodyStart), end, bodyStart, contentStart: opening[0].length }
  }
  return null
}

export function maskFrontMatter(markdown) {
  const front = leadingFrontMatter(markdown)
  return front ? markdown.slice(0, front.bodyStart).replace(/[^\r\n]/g, ' ') + markdown.slice(front.bodyStart) : markdown
}

// A textarea exposes LF even when its assigned value contains CRLF. Keep an
// unchanged source (and an unchanged metadata prefix after body edits) verbatim.
export function preserveFrontMatterSource(next, previous) {
  const lf = value => value.replace(/\r\n?/g, '\n')
  if (next === lf(previous)) return previous
  const before = leadingFrontMatter(previous), after = leadingFrontMatter(next)
  return before && after && lf(before.prefix) === lf(after.prefix)
    ? before.prefix + next.slice(after.bodyStart) : next
}

export function mapMarkdownBody(markdown, transform) {
  const front = leadingFrontMatter(markdown)
  if (!front) return transform(markdown)
  // Keep the body at its original line/offset. Parsing a detached body could
  // incorrectly recognize its leading horizontal rule as a second YAML block.
  const transformed = transform(maskFrontMatter(markdown))
  return front.prefix + transformed.slice(front.bodyStart)
}

// Wrap the parser, rather than repairing an already parsed YAML-shaped tree:
// Markdown inside YAML must not create headings, links, images or definitions.
// Masking preserves source offsets used by outline/search adapters.
export function remarkFrontMatter() {
  const parse = this.parser
  this.parser = (source, file) => {
    const front = leadingFrontMatter(source)
    if (!front) return parse(source, file)
    const tree = parse(maskFrontMatter(source), file)
    const line = 1 + (front.prefix.match(/\r\n|\n|\r/g) || []).length
    tree.children.unshift({ type: 'yaml', value: front.prefix, position: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line, column: front.prefix.length - Math.max(front.prefix.lastIndexOf('\n'), front.prefix.lastIndexOf('\r')), offset: front.bodyStart },
    } })
    return tree
  }
  const data = this.data()
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions || []), { handlers: { yaml: node => node.value } }]
}
