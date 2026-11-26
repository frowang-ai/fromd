import { createMarkdownRenderer } from './renderer.js'

// Counts and outline labels must retain the punctuation shown by the editor.
// Keep this parser separate from the shared preview/PDF typography settings.
let analysisRenderer
function getAnalysisRenderer() {
  return analysisRenderer ??= createMarkdownRenderer().set({ typographer: false })
}

const cjkCharacter = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const wordSegments = new Intl.Segmenter('en', { granularity: 'word' })

// Count rendered text, including code and formula source. Links contribute their
// labels; Markdown delimiters, image paths and hidden HTML comments contribute no text.
function inlineText(tokens = []) {
  return tokens.map(token => {
    if (token.type === 'softbreak' || token.type === 'hardbreak') return '\n'
    if (token.type === 'html_inline') return /^<br\s*\/?\s*>$/i.test(token.content) ? '\n' : ''
    if (token.children) return inlineText(token.children)
    return token.content || ''
  }).join('')
}

export function countWritingText(text) {
  let wordCount = 0, characterCount = 0
  for (const character of text) {
    if (!/\s/u.test(character)) characterCount++
  }
  for (const segment of wordSegments.segment(text)) {
    if (!segment.isWordLike) continue
    let hasOtherLetters = false
    for (const character of segment.segment) {
      if (cjkCharacter.test(character)) wordCount++
      else if (/[\p{Letter}\p{Number}]/u.test(character)) hasOtherLetters = true
    }
    if (hasOtherLetters) wordCount++
  }
  return { wordCount, characterCount }
}

export function analyzeMarkdown(markdown = '') {
  const tokens = getAnalysisRenderer().parse(markdown, {})
  const offsets = [0]
  for (const match of markdown.matchAll(/\r\n|\r|\n/g)) offsets.push(match.index + match[0].length)
  const headings = []
  const text = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.type === 'heading_open' && token.map) {
      headings.push({
        index: headings.length,
        offset: offsets[token.map[0]] ?? 0,
        level: Number(token.tag.slice(1)),
        text: inlineText(tokens[index + 1]?.children).trim() || '空标题',
      })
    }
    if (token.type === 'inline') text.push(inlineText(token.children))
    else if (token.type === 'code_block' || token.type === 'fence' || token.type.startsWith('math_block')) text.push(token.content)
    else if (token.type === 'html_block') {
      // This plain-text pass also works in the storage/unit-test environment.
      // Rich HTML rendering and sanitization remain owned by the renderer.
      const content = token.content.replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<\/?(?:p|div|br|h[1-6]|li|tr|td|th|pre|blockquote)\b[^>]*>/gi, '\n')
        .replace(/<[^>]*>/g, '')
      text.push(getAnalysisRenderer().utils.unescapeAll(content))
    }
  }
  return { headings, ...countWritingText(text.join('\n')) }
}
