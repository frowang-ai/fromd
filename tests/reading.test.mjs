import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeMarkdown, countWritingText } from '../packages/editor/src/markdown/analysis.js'
import {
  DEFAULT_READING_PREFERENCES, normalizeReadingPreferences, loadReadingPreferences,
  saveReadingPreferences, resolvedReadingTheme, readingStyle,
} from '../apps/desktop/src/renderer/readingPreferences.js'

test('outline recognizes ATX, Setext and quoted headings while ignoring code and comments', () => {
  const markdown = '# 标题 **加粗**\n\n```md\n# 代码里的标题\n```\n\n第二节\n---\n\n> ### 引用标题\n\n<!-- # 隐藏 -->\n'
  const result = analyzeMarkdown(markdown)
  assert.deepEqual(result.headings, [
    { index: 0, offset: 0, level: 1, text: '标题 加粗' },
    { index: 1, offset: markdown.indexOf('第二节'), level: 2, text: '第二节' },
    { index: 2, offset: markdown.indexOf('> ###'), level: 3, text: '引用标题' },
  ])
  assert.equal(analyzeMarkdown('').headings.length, 0)
})

test('outline offsets retain UTF-16 source positions with emoji, CRLF and repeated headings', () => {
  const markdown = '😀开头\r\n\r\n## 相同\r\n\r\n## 相同\r\n'
  const { headings } = analyzeMarkdown(markdown)
  assert.deepEqual(headings.map(item => item.offset), [markdown.indexOf('##'), markdown.lastIndexOf('##')])
  assert.deepEqual(headings.map(item => item.index), [0, 1])
})

test('word count uses individual CJK characters and non-CJK words, with nonspace Unicode character count', () => {
  assert.deepEqual(countWritingText('你好 world 123！'), { wordCount: 4, characterCount: 11 })
  assert.deepEqual(countWritingText('😀 e\u0301'), { wordCount: 1, characterCount: 3 })
  assert.equal(countWritingText('日本語 한글').wordCount, 5)
  assert.deepEqual(countWritingText(''), { wordCount: 0, characterCount: 0 })
})

test('Markdown analysis excludes syntax, URLs and hidden comments while counting code and formulas', () => {
  const result = analyzeMarkdown('**你好** [world](https://example.com) <!-- hidden -->\n\n```js\nhello\n```\n\n$x+1$')
  assert.deepEqual(result, { headings: [], wordCount: 6, characterCount: 15 })
  assert.equal(analyzeMarkdown('<div><!-- hidden -->visible</div>').wordCount, 1)
})

test('preferences validate untrusted storage and write only supported settings', () => {
  assert.deepEqual(normalizeReadingPreferences({ fontSize: 99, width: '720', theme: 'unknown', markdown: 'private' }), DEFAULT_READING_PREFERENCES)
  let stored
  const storage = { getItem: () => stored, setItem: (key, value) => { assert.equal(key, 'frowd.reading-preferences.v1'); stored = value } }
  const preferences = { fontSize: 20, width: 720, theme: 'system' }
  assert.deepEqual(loadReadingPreferences(storage), { preferences: DEFAULT_READING_PREFERENCES, error: '' })
  assert.equal(saveReadingPreferences({ ...preferences, markdown: 'private' }, storage).error, '')
  assert.deepEqual(JSON.parse(stored), preferences)
  assert.deepEqual(loadReadingPreferences(storage).preferences, preferences)
  assert.equal(resolvedReadingTheme(preferences, true), 'dark')
  assert.equal(resolvedReadingTheme(preferences, false), 'light')
  assert.deepEqual(readingStyle(preferences), { '--reading-font-size': '20px', '--reading-column-width': '720px' })
})

test('corrupt or unavailable preference storage preserves usable defaults or current values with feedback', () => {
  assert.match(loadReadingPreferences({ getItem: () => '{' }).error, /无法读取/)
  const storage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.deepEqual(loadReadingPreferences(storage).preferences, DEFAULT_READING_PREFERENCES)
  const result = saveReadingPreferences({ fontSize: 18, width: 1080, theme: 'dark' }, storage)
  assert.equal(result.preferences.theme, 'dark')
  assert.match(result.error, /保存失败/)
})
