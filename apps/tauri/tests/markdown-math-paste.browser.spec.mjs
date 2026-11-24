// Synthetic MIME payloads through the real PM paste path + mock native IPC.
// From the repo root (cmd): set FROWD_BROWSER_PORT=15673&& npm --prefix apps/tauri run test:browser -- markdown-math-paste.browser.spec.mjs
// Shared four-entry comparison: npm run test:editor -- --grep "数学粘贴保真"
// The Paseo copy-button cases reproduce the installed Desktop 0.17.3 payload
// factory/configuration, verified in isolation; no OS clipboard/native claim.
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'
import { installMockHost } from './mock-host.mjs'
import { mathPasteMarkdown, mathPasteValues } from '../../../tests/fixtures/writing-math-paste.mjs'
import { createPaseoMarkdownClipboardContent } from '../../../tests/fixtures/paseo-clipboard.mjs'

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

for (const [name, extra, link] of [
  ['standard', '', null],
  ['autolink', '\n\n资料：https://example.com/paper?q=base#methods', 'https://example.com/paper?q=base#methods'],
  ['local-link', '\n\n[本地合成参考](file:///C:/synthetic/reference.md "合成标题")', 'file:///C:/synthetic/reference.md'],
]) test(`Paseo copy button 0.17.3 preserves math with ${name}`, async ({ page }, testInfo) => {
  const payload = createPaseoMarkdownClipboardContent(mathPasteMarkdown + extra)
  expect(payload.html).toMatch(/^<meta charset="utf-8">/)
  if (link) expect(payload.html).toContain(`href="${link}"`)
  await boot(page)
  const initial = (await capture(page)).doc
  await paste(page, payload.plainText, payload.html)
  await page.screenshot({ path: testInfo.outputPath(`paseo-${name}.png`), fullPage: true })
  const after = await capture(page)
  expect(mathNodes(after.doc)).toEqual(expectedMath)
  await expect(body(page).locator('.katex-error,.is-incomplete,.is-empty')).toHaveCount(0)
  await expect(body(page).locator('strong')).toHaveCount(2)
  if (link) {
    expect(after.markdown).toContain(link)
    await expect(body(page).locator('a')).toHaveAttribute('href', link.startsWith('file:') ? '' : link)
  }
  await page.keyboard.press('Control+z')
  expect((await capture(page)).doc).toEqual(initial)
  await page.keyboard.press('Control+y')
  expect(mathNodes((await capture(page)).doc)).toEqual(expectedMath)
  await page.keyboard.press('Control+/')
  const source = page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
  await source.fill((await source.inputValue()) + '\n')
  await page.keyboard.press('Control+/')
  expect(mathNodes((await capture(page)).doc)).toEqual(expectedMath)
  await page.keyboard.press('Control+s')
  const saved = (await capture(page)).markdown
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.rows.get('a').savedText)).toBe(saved)
  await page.addInitScript(installMockHost, { markdown: saved })
  await page.reload()
  await expect(body(page)).toHaveAttribute('contenteditable', 'true')
  expect(mathNodes((await capture(page)).doc)).toEqual(expectedMath)
  if (link) {
    expect((await capture(page)).markdown).toContain(link)
    await expect(body(page).locator('a')).toHaveAttribute('href', link.startsWith('file:') ? '' : link)
  }
})

test('Paseo charset witness accepts only a single leading UTF-8 declaration', async ({ page }) => {
  await boot(page)
  const text = mathPasteMarkdown + '\n\n资料：https://example.com/paper?q=base#methods'
  const payload = createPaseoMarkdownClipboardContent(text), meta = '<meta charset="utf-8">'
  const content = payload.html.slice(meta.length)
  const cases = [
    ['verified prefix', payload.html, true],
    ['no prefix', content, true],
    ['whitespace and fragment sentinel', ' \n<!--StartFragment-->\n' + payload.html + '<!--EndFragment-->', true],
    ['ASCII case and single quotes', "<META charset = 'UTF-8'>" + content, true],
    ['unquoted charset', '<meta charset=utf-8>' + content, true],
    ['self-closing charset', '<meta charset="utf-8"/>' + content, true],
    ['unquoted self-closing charset', '<meta charset=utf-8 />' + content, true],
    ['slash inside unquoted value', '<meta charset=utf-8/>' + content, false],
    ['http-equiv', '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">' + content, false],
    ['other metadata', '<meta name="author" content="HTML-only">' + content, false],
    ['extra attribute', '<meta charset="utf-8" data-owner="external">' + content, false],
    ['duplicate attribute', '<meta charset="utf-8" charset="utf-16">' + content, false],
    ['different charset', '<meta charset="utf-16">' + content, false],
    ['two charset metas', meta + meta + content, false],
    ['trailing charset', content + meta, false],
    ['nested paragraph', content.replace('<p>', '<p>' + meta), false],
    ['nested head', '<head>' + meta + '</head>' + content, false],
    ['unknown wrapper', '<div class="producer">' + payload.html + '</div>', false],
    ['ordinary comment', '<!--HTML-only-->' + payload.html, false],
    ['changed link destination', payload.html.replace('href="https://example.com/paper', 'href="https://example.com/other'), false],
    ['extra text', payload.html + '<p>HTML-only</p>', false],
  ]
  const module = '/@fs/' + fileURLToPath(new URL('../../../packages/editor/src/writingClipboardRecovery.js', import.meta.url)).replaceAll('\\', '/')
  const results = await page.evaluate(async ({ module, text, cases }) => {
    const { isRenderedMarkdownClipboard } = await import(module)
    return cases.map(([name, html]) => [name, isRenderedMarkdownClipboard(text, html, document)])
  }, { module, text, cases })
  expect(results).toEqual(cases.map(([name, , accepted]) => [name, accepted]))
})

test('Paseo charset prefix preserves HTML-only text, links and comments', async ({ page }) => {
  await boot(page)
  const payload = createPaseoMarkdownClipboardContent(mathPasteMarkdown)
  await paste(page, payload.plainText, payload.html + '<p>HTML-only <strong>专属粗体</strong> <a href="https://example.com/authoritative" title="HTML title">链接</a></p><!--HTML-only metadata-->')
  await expect(body(page)).toContainText('HTML-only')
  await expect(body(page).locator('strong').last()).toHaveText('专属粗体')
  await expect(body(page).locator('a')).toHaveAttribute('href', 'https://example.com/authoritative')
  await expect(body(page).locator('a')).toHaveAttribute('title', 'HTML title')
  expect((await capture(page)).markdown).toContain('<!--HTML-only metadata-->')
})

for (const [name, text, html, expectedText, structure] of [
  ['plain suffix', '正文 $x$', '<p>正文 x HTML-only</p>', '正文 x HTML-only', null],
  ['same-length text', '甲乙 $x$', '<p>乙甲</p>', '乙甲', null],
  ['hard break', '第一行第二行 $x$', '<p>第一行<br>第二行</p>', '第一行第二行', 'hardbreak'],
  ['heading level', '# 标题 $x$', '<h2>标题</h2>', '标题', 'heading'],
  ['paragraph boundary', '甲乙 $x$', '<p>甲</p><p>乙</p>', '甲乙', 'paragraphs'],
]) test(`review H1 preserves HTML ${name} without a full rendering witness`, async ({ page }, testInfo) => {
  await boot(page)
  await paste(page, text, html)
  await page.screenshot({ path: testInfo.outputPath('review-h1.png'), fullPage: true })
  const captured = await capture(page)
  function plain(node) { return node.text || (node.content || []).map(plain).join('') }
  expect(plain(captured.doc)).toBe(expectedText)
  expect(mathNodes(captured.doc)).toEqual([])
  if (structure === 'hardbreak') expect(captured.doc.content[0].content.some(node => node.type === 'hardbreak')).toBe(true)
  if (structure === 'heading') expect(captured.doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
  if (structure === 'paragraphs') expect(captured.doc.content.map(node => node.type)).toEqual(['paragraph', 'paragraph'])
})

for (const delimiter of ['dollar', 'bracket']) test(`review M1 preserves display math inside neutral spans: ${delimiter}`, async ({ page }, testInfo) => {
  const [open, close] = delimiter === 'dollar' ? ['$$', '$$'] : [String.raw`\[`, String.raw`\]`]
  await boot(page)
  await paste(page, '', `<p><span class="line">${open}</span><br><span class="line" data-line="2">a=b</span><br><span class="line">${close}</span></p>`)
  await page.screenshot({ path: testInfo.outputPath('review-m1.png'), fullPage: true })
  expect(mathNodes((await capture(page)).doc)).toEqual([{ display: true, value: 'a=b' }])
  expect((await capture(page)).markdown).toContain('$$\na=b\n$$')
})

test('review M2 recognizes clipboard fragment sentinels without discarding document comments', async ({ page }, testInfo) => {
  await boot(page)
  await paste(page, mathPasteMarkdown, '<!--StartFragment-->' + new MarkdownIt().render(mathPasteMarkdown) + '<!--EndFragment-->')
  await page.screenshot({ path: testInfo.outputPath('review-m2.png'), fullPage: true })
  expect(mathNodes((await capture(page)).doc)).toEqual(expectedMath)
  await expect(body(page).locator('strong')).toHaveCount(2)
})

test('review H1 retains trailing HTML breaks while supplying an absent formula', async ({ page }) => {
  await boot(page)
  const html = '<p>正文 </p><p><br><br></p>'
  await paste(page, '', html)
  const originalTail = (await capture(page)).doc.content[1]
  await page.keyboard.press('Control+z')
  await paste(page, '正文 $x$', html)
  const result = await capture(page)
  expect(mathNodes(result.doc)).toEqual([{ display: false, value: 'x' }])
  expect(result.doc.content).toHaveLength(2)
  // PM treats the last <br> as a trailing cursor placeholder. Compare with
  // its HTML-only control instead of assuming one PM node per DOM <br>.
  expect(result.doc.content[1]).toEqual(originalTail)
})

for (const tag of ['span', 'p']) for (const [style, mark] of [['font-weight:700', 'strong'], ['font-style:italic', 'em']]) {
  test(`review M1 keeps semantic ${tag} style ${style}`, async ({ page }) => {
    await boot(page)
    const styled = `<${tag} class="line" style="${style}">$$a=b$$</${tag}>`
    await paste(page, '', tag === 'p' ? styled : `<p>${styled}</p>`)
    expect(mathNodes((await capture(page)).doc)).toEqual([{ display: false, value: 'a=b' }])
    await expect(body(page).locator(`${mark} .writing-math-inline`)).toHaveCount(1)
  })
}

test('review M2 preserves ordinary comments and unknown wrappers', async ({ page }) => {
  await boot(page)
  const html = '<div data-owner="external"><!--StartFragment extra-->' + new MarkdownIt().render(mathPasteMarkdown) + '<!--EndFragment--></div>'
  await paste(page, mathPasteMarkdown, html)
  expect((await capture(page)).markdown).toContain('<!--StartFragment extra-->')
})

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
