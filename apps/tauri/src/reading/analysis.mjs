import { analyzeMarkdown } from '../../../../packages/editor/src/markdown/analysis.js'

// The existing outline hides a leading YAML metadata block, including an
// unfinished one. Mask it without shifting UTF-16 offsets used by EditorPort.
export function withoutFrontMatter(markdown) {
  const lines = markdown.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || []
  if (!/^---[ \t]*(?:\r\n|\r|\n|$)$/.test(lines[0] || '')) return markdown
  let end = lines[0].length
  for (const line of lines.slice(1)) {
    end += line.length
    if (/^(?:---|\.\.\.)[ \t]*(?:\r\n|\r|\n|$)$/.test(line)) break
  }
  return markdown.slice(0, end).replace(/[^\r\n]/g, ' ') + markdown.slice(end)
}

export function analyzeReading(markdown = '') {
  const result = analyzeMarkdown(withoutFrontMatter(markdown))
  return { ...result, headings: result.headings.map(heading => ({ ...heading, start: heading.offset, title: heading.text })) }
}
