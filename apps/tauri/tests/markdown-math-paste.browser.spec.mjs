// Synthetic MIME payloads through the real PM paste path + mock native IPC.
// From the repo root (cmd): set FROWD_BROWSER_PORT=15673&& npm --prefix apps/tauri run test:browser -- markdown-math-paste.browser.spec.mjs
// Shared four-entry comparison: npm run test:editor -- --grep "数学粘贴保真"
// No OS clipboard or real Paseo capture: MarkdownIt without math simulates a
// producer that supplies intact Markdown alongside prematurely rendered HTML.
import { test, expect } from '@playwright/test'
import MarkdownIt from 'markdown-it'
import { installMockHost } from './mock-host.mjs'
import { mathPasteMarkdown, mathPasteValues } from '../../../tests/fixtures/writing-math-paste.mjs'

const body = page => page.locator('.ProseMirror:visible')
async function boot(page, markdown = '') {
  await page.addInitScript(installMockHost, { markdown })
  await page.goto('/?testHost=1')
  await expect(body(page)).toHaveAttribute('contenteditable', 'true')
}
async function capture(page) {
  return page.locator('.pm-port').evaluate(el => {
    const captured = el.__vueParentComponent.exposed.capture()
    return { markdown: captured.markdown, doc: captured.pm.state.doc.toJSON() }
  })
}
async function paste(page, text, html) {
  await body(page).locator('p').first().click()
  await body(page).evaluate((el, { text, html }) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', text)
    clipboardData.setData('text/html', html)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  }, { text, html })
}
function mathNodes(doc) {
  const result = []
  function visit(node) {
    if (node.type === 'math_inline') result.push({ display: false, value: node.attrs.value })
    if (node.type === 'code_block' && node.attrs.language?.toLowerCase() === 'latex') result.push({ display: true, value: node.content?.map(n => n.text || '').join('') || '' })
    node.content?.forEach(visit)
  }
  visit(doc)
  return result
}
const expectedMath = Object.entries(mathPasteValues).map(([key, value]) => ({ display: key === 'fraction', value }))

test('standard dollar math paste keeps exact nodes, single undo and source/save/reload semantics', async ({ page }, testInfo) => {
  await boot(page)
  const initial = (await capture(page)).doc
  await paste(page, mathPasteMarkdown, new MarkdownIt().render(mathPasteMarkdown))
  await page.screenshot({ path: testInfo.outputPath('dollar-paste.png'), fullPage: true })
  expect(mathNodes((await capture(page)).doc)).toEqual(expectedMath)
  await expect(body(page).locator('.katex-error,.is-incomplete,.is-empty')).toHaveCount(0)
  await expect(body(page).locator('strong')).toHaveCount(2)
  await page.keyboard.press('Control+z')
  expect((await capture(page)).doc).toEqual(initial)
  await page.keyboard.press('Control+y')
  expect(mathNodes((await capture(page)).doc)).toEqual(expectedMath)
  await page.keyboard.press('Control+/')
  const source = page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
  await expect(source).toBeVisible()
  await source.fill((await source.inputValue()) + '\n')
  await page.keyboard.press('Control+/')
  const roundtrip = await capture(page)
  expect(mathNodes(roundtrip.doc)).toEqual(expectedMath)
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.rows.get('a').savedText)).toBe(roundtrip.markdown)
  await page.addInitScript(installMockHost, { markdown: roundtrip.markdown })
  await page.reload()
  await expect(body(page)).toHaveAttribute('contenteditable', 'true')
  expect(mathNodes((await capture(page)).doc)).toEqual(expectedMath)
  await expect(body(page).locator('strong')).toHaveCount(2)
})

for (const [name, extra, check] of [
  ['strong', '<p><strong>HTML 专属格式</strong></p>', 'strong'],
  ['link', '<p><a href="https://example.com/authoritative" title="HTML title">相同标签</a></p>', 'a'],
  ['table', '<table><tr><th>HTML 列</th></tr><tr><td>HTML 值</td></tr></table>', 'table.children'],
  ['comment', '<!-- HTML-only metadata -->', null],
  ['math metadata', '<p><span data-latex="z_{html}">字形</span></p>', null],
]) test(`math recovery preserves HTML-only ${name}`, async ({ page }) => {
  const text = '**源文本已有粗体。 **\n\n**另一个粗体。 **\n\n\\(q_{base}\\)\n\n[相同标签](https://example.com/plain)'
  const html = '<p>**源文本已有粗体。 **</p><p>\\(q_{base}\\)</p>' + extra
  await boot(page)
  await paste(page, text, html)
  if (check) await expect(body(page).locator(check)).toHaveCount(1)
  const result = await capture(page)
  if (name === 'strong') await expect(body(page).locator('strong')).toHaveText('HTML 专属格式')
  if (name === 'link') {
    await expect(body(page).locator('a')).toHaveAttribute('href', 'https://example.com/authoritative')
    await expect(body(page).locator('a')).toHaveAttribute('title', 'HTML title')
  }
  if (name === 'comment') expect(result.markdown).toContain('<!-- HTML-only metadata -->')
  if (name === 'math metadata') expect(mathNodes(result.doc)).toContainEqual({ display: false, value: 'z_{html}' })
})

test('HTML dollar fences across blocks and spans preserve links, table cells and literal barriers', async ({ page }) => {
  await boot(page)
  const html = String.raw`<p>$$</p><p><span>\frac{q_{base}}</span><span>{q_{model}}</span></p><p>$$</p><p><a href="https://example.com/math"><span>$</span>q_{link}<span>$</span></a>，<strong>真粗体</strong></p><table><tr><th>值</th></tr><tr><td><span>$</span><em>q_{cell}</em><span>$</span></td></tr></table><p>$<code>code</code>$ $<a href="https://example.com/literal">link</a>$ $<!-- keep -->x$</p><p>$$</p>`
  await paste(page, '', html)
  const result = await capture(page)
  expect(mathNodes(result.doc)).toEqual([
    { display: true, value: String.raw`\frac{q_{base}}{q_{model}}` },
    { display: false, value: 'q_{link}' },
    { display: false, value: 'q_{cell}' },
  ])
  await expect(body(page).locator('a').first()).toHaveAttribute('href', 'https://example.com/math')
  await expect(body(page).locator('strong')).toHaveText('真粗体')
  await expect(body(page).locator('code')).toHaveText('code')
  expect(result.markdown).toContain('<!-- keep -->')
  await expect(body(page).locator('.is-empty,.is-incomplete,.katex-error')).toHaveCount(0)
})

for (const delimiters of ['dollar', 'bracket']) test(`Markdown HTML recovery protects escaped dollars and code with ${delimiters} math`, async ({ page }) => {
  const inline = delimiters === 'dollar' ? '$q_{base}+q_{model}$' : String.raw`\(q_{base}+q_{model}\)`
  const block = delimiters === 'dollar' ? '$$q_{base}+q_{model}$$' : String.raw`\[q_{base}+q_{model}\]`
  const text = '**真正粗体** *真正斜体* ' + inline + '\n\n' + block + '\n\n' + String.raw`\$escaped\$ 和 \*\*字面\*\*` + '\n\n`$code$`\n\n```text\n$q_{literal}$\n```'
  await boot(page)
  await paste(page, text, new MarkdownIt().render(text))
  expect(mathNodes((await capture(page)).doc)).toEqual([{ display: false, value: 'q_{base}+q_{model}' }, { display: true, value: 'q_{base}+q_{model}' }])
  await expect(body(page).locator('strong')).toHaveText('真正粗体')
  await expect(body(page).locator('em')).toHaveText('真正斜体')
  await expect(body(page)).toContainText('$escaped$ 和 **字面**')
  await expect(body(page).locator('code')).toHaveText('$code$')
  await expect(body(page).locator('.milkdown-code-block')).toContainText('$q_{literal}$')
})

test('block-like dollar text never flattens real bold, comments or images', async ({ page }) => {
  await page.route('https://example.com/**', route => route.abort())
  await boot(page)
  await paste(page, '', '<p><strong>$$q_{bold}$$</strong></p><p>$$<br>q<!-- hidden payload --><br>$$</p><p>$$<br><img src="https://example.com/inside.png" alt="inside"><br>$$</p>')
  const captured = await capture(page)
  expect(mathNodes(captured.doc)).toEqual([{ display: false, value: 'q_{bold}' }])
  await expect(body(page).locator('strong .writing-math-inline')).toHaveCount(1)
  expect(captured.markdown).toContain('<!-- hidden payload -->')
  expect(captured.markdown).toContain('https://example.com/inside.png')
})

test('math recovery never substitutes a different HTML-only image', async ({ page }) => {
  await page.route('https://example.com/**', route => route.abort())
  await boot(page)
  await paste(page, '**粗体。 **\\(q\\) ![plain](https://example.com/plain.png)', '<p>**粗体。 **\\(q\\) <img src="https://example.com/html.png" alt="HTML image" title="HTML title"></p>')
  const captured = await capture(page)
  expect(captured.markdown).toContain('https://example.com/html.png')
  expect(captured.markdown).not.toContain('https://example.com/plain.png')
  expect(captured.markdown).toContain('HTML image')
})
