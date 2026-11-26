import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeReading, withoutFrontMatter } from '../src/reading/analysis.mjs'
import { getMarkdownRenderer } from '../../../packages/editor/src/markdown/renderer.js'
import { DEFAULT_READING_PREFERENCES, normalizeReadingPreferences, loadReadingPreferences, saveReadingPreferences, resolvedReadingTheme, readingStyle } from '../src/reading/preferences.mjs'

test('outline adds Setext and quoted headings while preserving offsets and metadata exclusion', () => {
  const markdown = '---\r\ntitle: metadata\r\n# hidden\r\n---\r\n\r\n# 😀 开始\r\n\r\n同名\r\n---\r\n\r\n```md\r\n# code\r\n```\r\n\r\n## 同名\r\n\r\n> ### 引用\r\n'
  const {headings} = analyzeReading(markdown)
  assert.deepEqual(headings.map(({start,title,level}) => ({start,title,level})), [
    {start: markdown.indexOf('# 😀'), title: '😀 开始', level: 1},
    {start: markdown.indexOf('同名'), title: '同名', level: 2},
    {start: markdown.indexOf('## 同名'), title: '同名', level: 2},
    {start: markdown.indexOf('> ###'), title: '引用', level: 3},
  ])
  assert.equal(withoutFrontMatter(markdown).length, markdown.length)
  assert.equal(analyzeReading('---\n# unfinished metadata').headings[0].title, 'unfinished metadata')
  assert.equal(analyzeReading('---\n# metadata\n...\n# body').headings[0].start, 19)
  assert.equal(analyzeReading('first\r\r## second').headings[0].start, 7)
})

test('counts use CJK characters, non-CJK words and nonspace Unicode codepoints, including math/code', () => {
  const result = analyzeReading('---\ntitle: excluded\n---\n\n**你好** [world](https://example.com) <!-- hidden -->\n\n```js\nhello\n```\n\n$x+1$')
  assert.equal(result.wordCount, 6)
  assert.equal(result.characterCount, 15)
  assert.equal(analyzeReading('日本語 한글').wordCount, 5)
  assert.equal(analyzeReading('😀 e\u0301').characterCount, 3)
  assert.equal(analyzeReading('<div>A &amp; B<script>hidden()</script></div>').wordCount, 2)
})

test('statistics and heading labels retain punctuation without mutating preview typography', () => {
  const preview = getMarkdownRenderer()
  assert.equal(preview.render('hello... (c)'), '<p>hello… ©</p>\n')
  const result = analyzeReading('# hello... (c)')
  assert.equal(result.headings[0].title, 'hello... (c)')
  assert.equal(result.characterCount, 11)
  assert.equal(result.wordCount, 2)
  assert.equal(preview.render('hello... (c)'), '<p>hello… ©</p>\n')
})

test('preferences preserve Tauri defaults and only persist allowlisted values', () => {
  assert.deepEqual(DEFAULT_READING_PREFERENCES, {fontSize:16,width:860,theme:'light'})
  assert.deepEqual(normalizeReadingPreferences({fontSize:99,width:'720',theme:'invalid'}), DEFAULT_READING_PREFERENCES)
  let stored
  const storage = {getItem: () => stored, setItem: (key,value) => {assert.equal(key,'frowd.tauri.reading-preferences.v1');stored=value}}
  assert.deepEqual(loadReadingPreferences(storage).preferences, DEFAULT_READING_PREFERENCES)
  const preferences = {fontSize:20,width:1080,theme:'system'}
  assert.equal(saveReadingPreferences({...preferences,markdown:'private'},storage).error,'')
  assert.deepEqual(JSON.parse(stored),preferences)
  assert.deepEqual(loadReadingPreferences(storage).preferences,preferences)
  assert.equal(resolvedReadingTheme(preferences,true),'dark')
  assert.equal(resolvedReadingTheme(preferences,false),'light')
  assert.deepEqual(readingStyle(preferences), {'--reading-font-size':'20px','--reading-column-width':'1080px'})
})

test('unavailable or corrupt settings fall back or retain the current selection with feedback', () => {
  assert.match(loadReadingPreferences({getItem: () => '{'}).error,/无法读取/)
  const storage = {getItem(){throw Error('denied')},setItem(){throw Error('denied')}}
  assert.deepEqual(loadReadingPreferences(storage).preferences,DEFAULT_READING_PREFERENCES)
  const result = saveReadingPreferences({fontSize:18,width:720,theme:'dark'},storage)
  assert.equal(result.preferences.theme,'dark')
  assert.match(result.error,/保存失败/)
})
