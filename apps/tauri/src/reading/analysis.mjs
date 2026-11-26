import { analyzeMarkdown } from '../../../../packages/editor/src/markdown/analysis.js'

import { maskFrontMatter } from '../../../../packages/editor/src/markdown/frontmatter.js'

// Match body/PDF recognition without shifting UTF-16 navigation offsets.
export const withoutFrontMatter = maskFrontMatter

export function analyzeReading(markdown = '') {
  const result = analyzeMarkdown(withoutFrontMatter(markdown))
  return { ...result, headings: result.headings.map(heading => ({ ...heading, start: heading.offset, title: heading.text })) }
}
