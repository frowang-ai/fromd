import { getMarkdownRenderer } from './renderer.js'

const cjkCharacter = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const wordSegments = new Intl.Segmenter('en', { granularity: 'word' })

// Count rendered text, including code and formula source. Links contribute their
// labels; Markdown delimiters, image paths and hidden HTML comments contribute no text.
function inlineText(tokens = []) {
  return tokens.map(token => {
    if (token.type === 'softbreak' || token.type === 'hardbreak') return '\n'
    if (token.type === 'html_inline') return ''
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
  const tokens = getMarkdownRenderer().parse(markdown, {})
  const offsets = [0]
  for (let index = 0; index < markdown.length; index++) {
    if (markdown[index] === '\n') offsets.push(index + 1)
  }
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
      text.push(token.content.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ''))
    }
  }
  return { headings, ...countWritingText(text.join('\n')) }
}
