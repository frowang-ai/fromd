import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMarkdownRenderer } from '../packages/editor/src/markdown/renderer.js'
import { yamlHeader, yamlMarkdown } from './fixtures/writing-frontmatter.mjs'
import { unified } from 'unified'
import parse from 'remark-parse'
import stringify from 'remark-stringify'
import { leadingFrontMatter, maskFrontMatter, remarkFrontMatter, preserveFrontMatterSource } from '../packages/editor/src/markdown/frontmatter.js'
import { normalizeWritingMarkdown } from '../packages/editor/src/writingMarkdownCompatibility.js'
import { analyzeReading } from '../apps/tauri/src/reading/analysis.mjs'
const remark = unified().use(parse).use(remarkFrontMatter).use(stringify)

test('leading YAML renders as literal metadata, never a Setext heading or executable HTML', () => {
  const md = createMarkdownRenderer()
  const html = md.render(yamlMarkdown)
  assert.match(html, /class="writing-frontmatter"/)
  assert.doesNotMatch(html, /<h2>|<hr>|<strong>|katex/)
  assert.match(html, /description: &gt;-\n  开始重要任务/)
  assert.match(html, /<h1>Agent Memory<\/h1>/)
  const hostile = md.render('---\nhtml: <img src="https://invalid.example/yaml.png" onerror="alert(1)">\nscript: <script>alert(1)</script>\n---\n\n正文')
  assert.doesNotMatch(hostile, /<img|<script|<a /)
  assert.match(hostile, /&lt;img/)
})

test('closed fences accept BOM, line endings, trailing spaces, empty and invalid YAML without evaluating it', () => {
  for (const newline of ['\n', '\r\n', '\r']) for (const close of ['---', '...']) {
    for (const value of ['', 'name: [unfinished\n# comment', '!!js/function >\n  function() {}']) {
      const prefix = '\uFEFF--- \t' + newline + value.replaceAll('\n', newline) + newline + close + ' \t' + newline
      const markdown = prefix + '# Body'
      const front = leadingFrontMatter(markdown)
      assert.equal(front.prefix, prefix)
      assert.equal(maskFrontMatter(markdown).length, markdown.length)
      assert.equal(remark.parse(markdown).children[0].type, 'yaml')
      assert.deepEqual(analyzeReading(markdown).headings.map(h => h.title), ['Body'])
      assert.match(createMarkdownRenderer().render(markdown), /writing-frontmatter/)
    }
  }
})

test('unclosed, indented, later fences, Setext headings and fenced code remain Markdown', () => {
  const md = createMarkdownRenderer()
  for (const source of ['---', '---\nname: x\n\n# Body', '\n---\nx: y\n---', ' ---\nx: y\n---', 'Intro\n\n---\nx: y\n---', 'Heading\n---', '```yaml\n---\nx: y\n---\n```']) {
    assert.equal(leadingFrontMatter(source), null, source)
    assert.doesNotMatch(md.render(source), /writing-frontmatter/, source)
    assert.notEqual(remark.parse(source).children[0].type, 'yaml', source)
  }
  assert.equal(analyzeReading('---\nname: x\n\n# Body').headings[0].title, 'Body')
  assert.match(md.render('Intro\n\n---'), /<hr>/)
  assert.match(md.render('Heading\n---'), /<h2>Heading/)
})

test('textarea LF normalization preserves unedited source and metadata, while YAML edits stay explicit', () => {
  const lf = yamlMarkdown.replaceAll('\r\n', '\n')
  assert.equal(preserveFrontMatterSource(lf, yamlMarkdown), yamlMarkdown)
  assert.equal(preserveFrontMatterSource(lf + 'More body', yamlMarkdown), yamlMarkdown + 'More body')
  const edit = lf.replace('agent-memory', 'new-name')
  assert.equal(preserveFrontMatterSource(edit, yamlMarkdown), edit)
})

test('YAML is opaque to normalization, resource parsing and navigation positions', () => {
  const source = yamlHeader + '**body **\n\n# Body\n'
  const normalized = normalizeWritingMarkdown(source, value => remark.parse(value))
  assert.ok(normalized.startsWith(yamlHeader))
  assert.match(normalized.slice(yamlHeader.length), /\*\*body\*\* /)
  const tree = remark.parse(source)
  assert.equal(tree.children[0].value, yamlHeader)
  assert.equal(tree.children[1].position.start.offset, yamlHeader.length)
  assert.equal(tree.children[2].position.start.offset, source.indexOf('# Body'))
  assert.equal(remark.stringify(tree).slice(0, yamlHeader.length), yamlHeader)
  const dangerous = '---\nimage: ![x](https://invalid.example/x)\nref: [x]: https://invalid.example\n---\n\n# Body'
  assert.equal(remark.parse(dangerous).children.length, 2)
  assert.equal(analyzeReading(dangerous).characterCount, analyzeReading('# Body').characterCount)
  const second = yamlHeader + '---\nText **bold ** \\(x\\)\n---\n'
  const fixed = normalizeWritingMarkdown(second, value => remark.parse(value))
  assert.ok(fixed.startsWith(yamlHeader))
  assert.match(fixed.slice(yamlHeader.length), /Text \*\*bold\*\*  \$x\$/)
})
