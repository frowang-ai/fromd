// Isolated writing experiment: real editor, no website/account APIs.
import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { tableBreakMarkdown } from './fixtures/writing-table-breaks.mjs'
import MarkdownIt from 'markdown-it'
import katex from 'katex'
import { mathPasteMarkdown, mathPasteValues, mathPasteHtml } from './fixtures/writing-math-paste.mjs'
import { createPaseoMarkdownClipboardContent } from './fixtures/paseo-clipboard.mjs'
import { displayMathEditingSample } from './fixtures/writing-display-math.mjs'
import { startWritingPreview } from './browser-harness/start-preview.mjs'
import { yamlMarkdown } from './fixtures/writing-frontmatter.mjs'
import { inlineCodeWrapMarkdown, measureInlineCodeWrap, expectInlineCodeWrap } from './fixtures/writing-inline-code-wrap.mjs'

const rootBlanks = page => body(page).locator(':scope > p').filter({ hasText: /^$/ })
async function reopenMarkdown(page, markdown) {
  await page.locator('input[type=file]').setInputFiles({
    name: 'reopened.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown),
  })
  await expect(page.getByRole('tab', { name: 'reopened' })).toHaveAttribute('aria-selected', 'true')
}

test('root blank lines round-trip after three Enters and trim leading and trailing empty paragraphs', async ({ page }) => {
  await open(page, '')
  await body(page).focus()
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('first')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Enter')
  await page.keyboard.insertText('second')
  await page.keyboard.press('Enter')
  await expect(rootBlanks(page)).toHaveCount(4)
  const saved = 'first\n\n\n\nsecond\n'
  await expect(await source(page)).toHaveValue(saved)
  await reopenMarkdown(page, saved)
  await expect(rootBlanks(page)).toHaveCount(2)
})

for (const eol of ['\n', '\r\n']) test(`source blank lines and YAML prefix stay intact (${JSON.stringify(eol)})`, async ({ page }) => {
  const prefix = ['---', 'name: blank-lines', '---', '', '\t', '', ''].join(eol)
  const original = prefix + ['first', '  ', '\t', '', 'second', '', '', ''].join(eol)
  await open(page, original)
  await expect(rootBlanks(page)).toHaveCount(2)
  const raw = await source(page)
  await expect(raw).toHaveValue(original.replaceAll('\r\n', '\n'))
  const readSaved = () => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('frowang-writing-probe-v2'))
    return saved.documents.find(doc => doc.id === saved.activeId).markdown
  })
  await raw.press('Control+s')
  expect(await readSaved()).toBe(original)
  await page.getByRole('button', { name: '返回正文' }).click()
  await body(page).locator('p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' edited')
  await expect(await source(page)).toHaveValue(prefix.replaceAll('\r\n', '\n') + 'first\n\n\n\nsecond edited\n')
  await expect.poll(readSaved)
    .toBe(prefix + 'first\n\n\n\nsecond edited\n')
})

for (const [list, tag] of [['-', 'ul'], ['1.', 'ol']]) test(`same-kind lists stay separate across historical placeholders (${tag})`, async ({ page }) => {
  const initial = `${list} first\n\n<br>\n\n<br />\n\n${list} second\n`
  await open(page, initial)
  await expect(body(page).locator(tag)).toHaveCount(2)
  await expect(rootBlanks(page)).toHaveCount(2)
  await body(page).getByText('first', {exact:true}).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' edited')
  const saved = await (await source(page)).inputValue()
  expect(saved).toContain('first edited\n\n<br />\n\n<br />\n\n')
  await reopenMarkdown(page, saved)
  await expect(body(page).locator(tag)).toHaveCount(2)
  await expect(rootBlanks(page)).toHaveCount(2)
})

test('markdown paste keeps root gaps, discards empty nested paragraphs on edit and preserves block literals', async ({ page }) => {
  const blocks = ['```text\none\n\ntwo\n```', '$$\nx\n\ny\n$$', '<pre>one\n\ntwo</pre>']
  const pasted = ['first\n\n<br />\n\nsecond', '> quote\n>\n> <br />\n>\n> tail',
    '- item\n\n  <br />\n\n  tail', ...blocks].join('\n\n\n') + '\n'
  await open(page, '')
  await pasteContent(page, pasted)
  await expect(rootBlanks(page)).toHaveCount(6)
  await expect(body(page).locator('blockquote > p')).toHaveCount(3)
  await expect(body(page).locator('li p')).toHaveCount(3)
  const saved = await (await source(page)).inputValue()
  expect(saved).not.toContain('<br')
  expect(saved).toContain('first\n\n\nsecond')
  for (const block of blocks) expect(saved).toContain(block)
  await reopenMarkdown(page, saved)
  await expect(rootBlanks(page)).toHaveCount(6)
  await expect(body(page).locator('blockquote > p')).toHaveCount(2)
  await expect(body(page).locator('li p')).toHaveCount(2)
})

for (const route of ['load', 'paste']) test(`YAML metadata stays literal through shared editor body edits (${route})`, async ({ page }) => {
  const markdown = yamlMarkdown.replaceAll('\r\n', '\n')
  await open(page, route === 'load' ? markdown : '')
  if (route === 'paste') await pasteContent(page, markdown)
  await expect(body(page).locator('.writing-frontmatter .cm-line')).toContainText(['description: >-', '  开始重要任务'])
  await expect(body(page).locator('h1')).toHaveText('Agent Memory')
  await expect(body(page).locator('h2,hr,.writing-math-inline')).toHaveCount(0)
  await body(page).locator('p').filter({ hasText: '正文结尾' }).click()
  await page.keyboard.press('End'); await page.keyboard.insertText('追加')
  const raw = await source(page)
  expect((await raw.inputValue()).split('# Agent Memory')[0]).toBe(markdown.split('# Agent Memory')[0])
  await page.getByRole('button', { name: '返回正文' }).click()
  await expect(body(page).locator('.writing-frontmatter')).toContainText('name: "agent-memory"')
  const yaml = page.getByRole('textbox', { name: 'YAML 元数据', exact: true })
  await yaml.click(); await page.keyboard.press('Control+a')
  await page.keyboard.insertText('name: "edited-yaml"\ndescription: >-\n  保留原位编辑')
  await expect(body(page).locator('.writing-frontmatter')).toContainText('edited-yaml')
  const edited = await source(page)
  expect(await edited.inputValue()).toContain('name: "edited-yaml"\ndescription: >-\n  保留原位编辑')
})

test('a YAML metadata-only document can grow a body without losing its closing fence', async ({ page }) => {
  await open(page, '---\nname: empty-body\n...')
  await expect(body(page).locator('.writing-frontmatter')).toBeVisible()
  await body(page).focus(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter')
  await page.keyboard.insertText('New body')
  await expect(body(page).locator('p')).toContainText(['New body'])
  const raw = await source(page)
  await expect(raw).toHaveValue('---\nname: empty-body\n...\n\nNew body\n')
})

test('YAML pasted after prose follows ordinary Markdown semantics on screen and reopening', async ({ page }) => {
  await open(page, 'Existing body\n\n')
  await body(page).locator('p').first().click(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter')
  await pasteContent(page, '---\nname: metadata\n---\n\nAfter paste')
  await expect(body(page).locator('.writing-frontmatter')).toHaveCount(0)
  const raw = await source(page), saved = await raw.inputValue()
  expect(saved).toContain('name: metadata')
  await page.getByRole('button', { name: '返回正文' }).click()
  await expect(body(page).locator('.writing-frontmatter')).toHaveCount(0)
  await expect(body(page)).toContainText('After paste')
})

test('inline code wraps within standalone table cells and prose', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 560, height: 950 })
  await open(page, inlineCodeWrapMarkdown)
  await expect(body(page).locator('td code')).toHaveCount(2)
  await page.evaluate(() => document.fonts.ready)
  const layout = await body(page).evaluate(measureInlineCodeWrap)
  await testInfo.attach('inline-code-layout', { body: JSON.stringify(layout, null, 2), contentType: 'application/json' })
  expectInlineCodeWrap(expect, layout)
  await expect(await source(page)).toHaveValue(inlineCodeWrapMarkdown)
})

test('inline code wraps in the real PDF document without starving adjacent columns', async ({ page }, testInfo) => {
  await open(page, inlineCodeWrapMarkdown)
  const html = await page.evaluate(async markdown => {
    const { buildPdfDocument } = await import('/packages/editor/src/markdown/pdfDocument.js')
    return buildPdfDocument({ markdown })
  }, inlineCodeWrapMarkdown)
  // A separate document uses only the generated PDF CSS, with no editor/host styles.
  const pdf = await page.context().newPage()
  await pdf.setViewportSize({ width: 1000, height: 1100 })
  await pdf.setContent(html)
  await pdf.evaluate(() => document.fonts.ready)
  const article = pdf.locator('.markdown-body')
  const layout = await article.evaluate(measureInlineCodeWrap)
  await testInfo.attach('pdf-inline-code-layout', { body: JSON.stringify(layout, null, 2), contentType: 'application/json' })
  expectInlineCodeWrap(expect, layout)
  const contentRight = await article.evaluate(el => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight))
  expect(layout.table.right).toBeLessThanOrEqual(contentRight + .5)
  for (const cell of layout.cells) for (const fragment of cell.fragments) expect(fragment.right).toBeLessThanOrEqual(contentRight + .5)
  for (const column of layout.columns) expect(column.width).toBeGreaterThan(column.fontSize * 3)
  await expect(article.locator('pre')).toHaveCSS('white-space', 'pre-wrap')
  await expect(article.locator('pre > code')).toHaveCSS('box-decoration-break', 'slice')
  await pdf.close()
})

const textStyles = await readFile(new URL('./fixtures/writing-text-styles.md', import.meta.url), 'utf8')
for (const mode of ['source', 'plain', 'html']) {
  test(`文本样式样例支持下划线高亮键帽与隐藏注释 ${mode}`, async ({ page }) => {
    await open(page, mode === 'source' ? textStyles : '')
    if (mode !== 'source') await pasteContent(page, textStyles, mode === 'html' ? new MarkdownIt({ html: true }).render(textStyles) : '')
    const content = body(page)
    await expect(content.locator('u')).toHaveText(['这是下划线样式', 'This is the underline style'])
    await expect(content.locator('mark')).toHaveText(['这是文字高亮效果', 'This is the text highlighting effect'])
    await expect(content.locator('kbd')).toHaveText(['Command+Q', 'Command+Q'])
    await expect(content.locator('sub')).toHaveCount(2); await expect(content.locator('sup')).toHaveCount(2)
    await expect(content.locator('strong')).toHaveCount(2); await expect(content.locator('em')).toHaveCount(2)
    await expect(content.locator('del')).toHaveCount(2); await expect(content.locator('code')).toHaveCount(2)
    await expect(content.locator('.writing-math-inline')).toHaveCount(2)
    await expect(content.locator('a')).toHaveCount(2)
    await expect(content).toContainText('🐳 😀 CN')
    await expect(content).not.toContainText('这是注释内容')
    expect(await content.locator('u').first().evaluate(el => getComputedStyle(el).textDecorationLine)).toContain('underline')
    expect(await content.locator('mark').first().evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
    expect(await content.locator('kbd').first().evaluate(el => getComputedStyle(el).borderBottomWidth)).not.toBe('0px')
    // Editing inside the marks must serialize their edited text with tags intact.
    await content.locator('u').first().evaluate(el => {
      el.closest('[contenteditable=true]').focus()
      const range = document.createRange(); range.selectNodeContents(el)
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range)
    })
    await page.keyboard.insertText('修改后的下划线')
    const raw = await source(page)
    await expect(raw).toHaveValue(/<u>修改后的下划线<\/u>/)
    await expect(raw).toHaveValue(/<mark>这是文字高亮效果<\/mark>/)
    await expect(raw).toHaveValue(/<kbd>Command\+Q<\/kbd>/)
    await expect(raw).toHaveValue(/<!-- 这是注释内容......，This is the annotation content -->/)
    await page.getByRole('button', { name: '返回正文' }).click()
    await expect(content.locator('u').first()).toHaveText('修改后的下划线')
    await page.getByRole('textbox', { name: '文档名称' }).press('ControlOrMeta+s')
    await page.reload()
    await expect(body(page).locator('kbd')).toHaveCount(2)
    await expect(body(page)).not.toContainText('这是注释内容')
  })
}

test('文本样式 PDF 导出保留标签样式且不显示注释', async ({ page }, testInfo) => {
  await open(page, textStyles)
  const requestPromise = page.waitForRequest(request => request.url().endsWith('/__notes-export/pdf') && request.method() === 'POST')
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 })
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
  const request = await requestPromise, { html } = request.postDataJSON()
  const result = await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return { underline: doc.querySelectorAll('u').length, highlight: doc.querySelectorAll('mark').length, keys: doc.querySelectorAll('kbd').length,
      body: doc.body.textContent, css: [...doc.querySelectorAll('style')].map(style => style.textContent).join('\n') }
  }, html)
  expect(result.underline).toBe(2); expect(result.highlight).toBe(2); expect(result.keys).toBe(2)
  expect(result.body).not.toContain('这是注释内容'); expect(result.body).toContain('Command+Q')
  expect(result.css).toContain('border-bottom-width: 2px')
  const pdf = await downloadPromise, path = testInfo.outputPath('text-styles.pdf')
  await pdf.saveAs(path)
  expect((await readFile(path)).subarray(0, 5).toString()).toBe('%PDF-')
})

test('HTML 文本样式保留嵌套与注释，代码和转义标签保持字面', async ({ page }) => {
  const markdown = String.raw`<u>下划线 <mark>重点</mark> **加粗**</u> 和前文<!-- inline <img src=x onerror=alert(1)> -->后文。

| 标记 | 内容 |
|---|---|
| <kbd>Ctrl</kbd> | <mark>高亮</mark> |

\<u>转义\</u> ` + '`<mark>代码</mark>`' + '\n\n```html\n<kbd>code</kbd>\n<!-- visible code -->\n```\n\n' + String.raw`<u onclick="alert(1)">带属性的标签</u>

<!-- 多行
注释保留 -->

结尾`
  await open(page, markdown)
  await expect(body(page).locator('u mark')).toHaveText('重点')
  await expect(body(page).locator('u strong, strong u')).toHaveText('加粗')
  await expect(body(page).locator('table.children kbd')).toHaveText('Ctrl')
  await expect(body(page)).toContainText('<u>转义</u>')
  await expect(body(page)).toContainText('<mark>代码</mark>')
  await expect(body(page).locator('.milkdown-code-block')).toContainText('<!-- visible code -->')
  await expect(body(page).locator('img[src="x"],[onclick]')).toHaveCount(0)
  await expect(body(page)).not.toContainText('inline <img')
  await body(page).locator('p').filter({ hasText: /^结尾$/ }).click()
  await page.keyboard.press('End'); await page.keyboard.insertText('追加')
  const raw = await source(page)
  await expect(raw).toHaveValue(/<!-- inline <img src=x onerror=alert\(1\)> -->/)
  await expect(raw).toHaveValue(/<!-- 多行\n注释保留 -->/)
  await expect(raw).toHaveValue(/<kbd>Ctrl<\/kbd>/)
})


for (const tag of ['u', 'mark', 'kbd']) {
  test(`同类 HTML 文本格式嵌套不提前关闭 ${tag}`, async ({ page }) => {
    const other = tag === 'mark' ? 'u' : 'mark'
    await open(page, `<${tag}>A<${tag}>B</${tag}>C</${tag}> / <${tag}>A<${other}>B<${tag}>C</${tag}>D</${other}>E</${tag}>\n\n结尾`)
    const markedText = () => body(page).locator(tag).evaluateAll(nodes => nodes.map(node => node.textContent).join(''))
    await expect.poll(markedText).toBe('ABCABCDE')
    await body(page).locator('p').filter({ hasText: /^结尾$/ }).evaluate(el => {
      el.closest('[contenteditable=true]').focus()
      const range = document.createRange(); range.selectNodeContents(el); range.collapse(false)
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range)
    })
    await page.keyboard.insertText('追加')
    const raw = await source(page)
    await expect(raw).toHaveValue(new RegExp(`<${tag}>ABC</${tag}>`))
    await page.getByRole('button', { name: '返回正文' }).click()
    await expect.poll(markedText).toBe('ABCABCDE')
    await expect(body(page)).toContainText('结尾追加')
  })
}

for (const mode of ['source', 'plain']) {
  test(`行首注释带尾文及相邻多条注释隐藏并保留 ${mode}`, async ({ page }) => {
    const markdown = '<!-- hidden -->visible text\n\n<!-- A --><!-- B -->\n\n<!-- safe --><script>window.commentExecuted = true</script>\n\n`<!-- literal -->`\n\n结尾\n\n<!-- incomplete'
    await open(page, mode === 'source' ? markdown : '')
    if (mode === 'plain') await pasteContent(page, markdown)
    await expect(body(page)).toContainText('visible text')
    await expect(body(page)).not.toContainText('<!-- hidden -->')
    await expect(body(page)).not.toContainText('<!-- A -->')
    await expect(body(page)).not.toContainText('<!-- B -->')
    await expect(body(page)).not.toContainText('<!-- safe -->')
    await expect(body(page)).toContainText('<script>window.commentExecuted = true</script>')
    await expect(body(page)).toContainText('<!-- incomplete')
    await expect(body(page).locator('code')).toHaveText('<!-- literal -->')
    await expect(body(page).locator('script')).toHaveCount(0)
    expect(await page.evaluate(() => window.commentExecuted)).toBeUndefined()
    await body(page).locator('p').filter({ hasText: /^结尾$/ }).evaluate(el => {
      el.closest('[contenteditable=true]').focus()
      const range = document.createRange(); range.selectNodeContents(el); range.collapse(false)
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range)
    })
    await page.keyboard.insertText('追加')
    const raw = await source(page)
    await expect(raw).toHaveValue(/<!-- hidden -->visible text/)
    await expect(raw).toHaveValue(/<!-- A -->\s*<!-- B -->/)
    await expect(raw).toHaveValue(/<!-- safe --><script>window.commentExecuted = true<\/script>/)
    await page.getByRole('button', { name: '返回正文' }).click()
    await expect(body(page)).not.toContainText('<!-- hidden -->')
    await expect(body(page)).not.toContainText('<!-- A -->')
    await expect(body(page)).toContainText('visible text')
  })
}

for (const mode of ['source', 'plain', 'html']) {
  test(`AI 加粗结束符前空格兼容且代码与转义不误改 ${mode}`, async ({ page }) => {
    const sentence = '以港大为例，真正“自动被考虑”的是 HKU-PS；PGS 则需要在入学申请表里表示申请，只是不用另外交一份申请表。'
    const markdown = `**${sentence} **两者都不是申请博士就自动获得。\n\n正常 **加粗**。\n\n` + '`**代码 **`' + '\n\n```text\n**保留代码 **\n```\n\n' + String.raw`\*\*字面\*\*`
    await open(page, mode === 'source' ? markdown : '')
    if (mode !== 'source') await pasteContent(page, markdown, mode === 'html' ? new MarkdownIt().render(markdown) : '')
    await expect(body(page).locator('strong').first()).toHaveText(sentence)
    await expect(body(page).locator('strong')).toHaveCount(2)
    await expect(body(page)).toContainText('两者都不是申请博士就自动获得。')
    await expect(body(page).locator('code').first()).toHaveText('**代码 **')
    await expect(body(page).locator('.milkdown-code-block')).toContainText('**保留代码 **')
    await expect(body(page)).toContainText('**字面**')
  })
}

test('长行间公式源码在上自动展开、高亮光标与当前行，预览在下', async ({ page }, testInfo) => {
  await open(page, `前文。\n\n$$\n${displayMathEditingSample}\n$$\n\n后文。`)
  await page.getByRole('button', { name: '编辑行间公式' }).click()
  const input = page.getByRole('textbox', { name: '行间公式 LaTeX' })
  const block = body(page).locator('.writing-math-block')
  await expect(input).toBeFocused()
  await expect(block.locator('.cm-activeLine')).toHaveCount(1)
  await expect(block.locator('.cm-cursor')).toBeVisible()
  const sourceBox = await block.locator('.cm-editor').boundingBox()
  const previewBox = await block.locator('.writing-math-preview').boundingBox()
  expect(sourceBox.y + sourceBox.height).toBeLessThanOrEqual(previewBox.y)
  expect(sourceBox.height).toBeGreaterThan(400)
  expect(await block.locator('.cm-scroller').evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2)
  expect(await input.locator('.cm-line span').count()).toBeGreaterThan(0)
  await input.press('ControlOrMeta+End')
  await expect.poll(async () => { const rect = await block.locator('.cm-cursor').boundingBox(); return rect && rect.y >= 48 && rect.y < 780 }).toBeTruthy()
  await page.screenshot({ path: testInfo.outputPath('display-math-caret.png') })
  await page.getByRole('button', { name: '完成公式编辑' }).click()
  await expect(input).toBeHidden()
  await expect(block.locator('.writing-math-preview .katex')).toHaveCount(1)
})

test('加粗恢复保留 HTML 已有公式，末尾反斜杠候选不移动空格', async ({ page }) => {
  await open(page, '')
  await pasteContent(page, '**说明。 ** 值为 $x^2$。',
    '<p>**说明。 ** 值为 <span data-latex="x^2">x²</span>。</p>')
  await expect(body(page).locator('.writing-math-inline .katex')).toHaveCount(1)
  // 公式计数达标时，同一候选可同时恢复 HTML 丢失的加粗，两者互不覆盖。
  await expect(body(page).locator('strong')).toHaveText('说明。')
  expect(await page.evaluate(() => window.__writingDebug.read().filter(row => row.event === 'paste-route').at(-1).route)).toBe('markdown-format-recovery')
  const backslash = String.raw`路径 **C:\temp\ ** 保留。`
  await page.addInitScript(() => localStorage.clear())
  await open(page, backslash)
  await expect(body(page).locator('strong')).toHaveCount(0)
  await expect(body(page)).toContainText('C:\\temp\\')
  const raw = await source(page)
  await expect(raw).toHaveValue(/C:\\temp\\ \*\*/)
})

test('HTML 独有公式使加粗候选落选，公式源码不丢', async ({ page }) => {
  await open(page, '')
  // 纯文本只含字形（无 $ 或括号边界），HTML 保留 LaTeX 源码；此时不能用 Markdown 覆盖。
  await pasteContent(page, '**说明。 ** 值为 x²。',
    '<p>**说明。 ** 值为 <span data-latex="x^2">x²</span>。</p>')
  await expect(body(page).locator('.writing-math-inline .katex')).toHaveCount(1)
  await expect(body(page).locator('strong')).toHaveCount(0)
  expect(await page.evaluate(() => window.__writingDebug.read().filter(row => row.event === 'paste-route').at(-1).route)).toBe('html')
  expect(await body(page).locator('.writing-math-inline annotation').textContent()).toBe('x^2')
})

test('行间公式取消与撤销保留内容，窄屏代码区不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 })
  await open(page, '前文\n\n$$\na=1\n$$\n\n后文')
  const formula = page.getByRole('button', { name: '编辑行间公式' })
  const input = page.getByRole('textbox', { name: '行间公式 LaTeX' })
  await formula.click(); await input.fill('a=2'); await input.press('ControlOrMeta+Enter')
  await expect(body(page).locator('.writing-math-block annotation')).toHaveText('a=2')
  await body(page).press('ControlOrMeta+z')
  await expect(body(page).locator('.writing-math-block annotation')).toHaveText('a=1')
  await body(page).press('ControlOrMeta+Shift+z')
  await expect(body(page).locator('.writing-math-block annotation')).toHaveText('a=2')
  await formula.click(); await input.fill('a=3'); await input.press('Escape')
  await expect(body(page).locator('.writing-math-block annotation')).toHaveText('a=2')
  await formula.click(); await input.fill(displayMathEditingSample)
  const box = await body(page).locator('.writing-block-code').boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('tab', { name: '验证笔记' }).click()
  await expect(input).toBeHidden()
  await expect(body(page)).toContainText('后文')
})

test('加粗兼容不改变同段已有强调、转义星号和公式内容', async ({ page }) => {
  await open(page, String.raw`正常 **有效**；**新内容。 **尾文。\n\n\*\*字面 \*\*；\(\text{**星号 **}\)。`.replaceAll('\\n', '\n'))
  await expect(body(page).locator('strong')).toHaveText(['有效', '新内容。'])
  await expect(body(page)).toContainText('**字面 **')
  await expect(body(page).locator('.writing-math-inline annotation')).toHaveText('\\text{**星号 **}')
})

for (const mode of ['source', 'plain', 'markdown-html', 'katex-html', 'paseo-copy']) {
  test(`数学粘贴保真：标准美元公式、下标和内含公式的粗体 ${mode}`, async ({ page }, testInfo) => {
    await open(page, mode === 'source' ? mathPasteMarkdown : '')
    const html = mode === 'paseo-copy' ? createPaseoMarkdownClipboardContent(mathPasteMarkdown).html
      : mode === 'markdown-html' ? new MarkdownIt().render(mathPasteMarkdown)
      : mode === 'katex-html' ? mathPasteHtml((value, displayMode = false) => katex.renderToString(value, { displayMode })) : ''
    if (mode !== 'source') await pasteContent(page, mathPasteMarkdown, html)
    await page.screenshot({ path: testInfo.outputPath(`math-paste-${mode}.png`), fullPage: true })
    await expect(body(page).locator('.writing-math-inline annotation')).toHaveText([mathPasteValues.base, mathPasteValues.model, mathPasteValues.noise])
    await expect(body(page).locator('.writing-math-block annotation')).toHaveText(mathPasteValues.fraction)
    await expect(body(page).locator('.katex-error,.is-empty,.is-incomplete')).toHaveCount(0)
    await expect(body(page).locator('strong')).toHaveCount(2)
    await expect(body(page).locator('em')).toHaveCount(0)
    const raw = await source(page)
    for (const value of Object.values(mathPasteValues)) expect(await raw.inputValue()).toContain(value)
    await raw.fill((await raw.inputValue()) + '\n') // Force a parse, not just cached view restoration.
    await page.getByRole('button', { name: '返回正文' }).click()
    await expect(body(page).locator('.writing-math-inline annotation')).toHaveText([mathPasteValues.base, mathPasteValues.model, mathPasteValues.noise])
    await expect(body(page).locator('.writing-math-block annotation')).toHaveText(mathPasteValues.fraction)
  })
}

test('数学粘贴保真：HTML 跨 span 的美元边界与块公式', async ({ page }) => {
  await open(page, '')
  await pasteContent(page, '', String.raw`<p><strong>值 <span>$</span><span>q_{base}</span><span>$</span> 保留。</strong> <em>真实强调</em></p><p><span>$$</span><span>\frac{q_{base}}{q_{model}}</span><span>$$</span></p><p><code>$literal$</code>；\$escaped\$；<span>$</span><code>blocked</code><span>$</span>；<span>$</span><span>unpaired</span></p>`)
  await expect(body(page).locator('.writing-math-inline annotation')).toHaveText('q_{base}')
  await expect(body(page).locator('.writing-math-block annotation')).toHaveText(String.raw`\frac{q_{base}}{q_{model}}`)
  await expect(body(page).locator('strong')).toContainText('保留。')
  await expect(body(page).locator('em')).toHaveText('真实强调')
  await expect(body(page).locator('code')).toHaveText(['$literal$', 'blocked'])
  await expect(body(page)).toContainText(String.raw`\$escaped\$`)
})

const reporterComparison = await readFile(new URL('./fixtures/writing-reporter-comparison.md', import.meta.url), 'utf8')
test('完整 reporter 说明直接粘贴：原始 Markdown 与已误解析 HTML 同时存在', async ({ page, context }, testInfo) => {
  await open(page, '')
  const html = new MarkdownIt().render(reporterComparison)
  expect(html).toContain('<h1>')
  expect(html).toContain('<h2>')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: preview.origin })
  await page.evaluate(async ({ text, html }) => {
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([text], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    })])
  }, { text: reporterComparison, html })
  await body(page).click()
  await page.keyboard.press('ControlOrMeta+v')
  await expect(body(page).locator('.writing-math-block .katex')).toHaveCount(1)
  await expect(body(page).locator('.writing-math-inline .katex')).toHaveCount(1)
  await expect(body(page).locator('h1,h2')).toHaveCount(0)
  await expect(body(page).locator('table.children')).toHaveCount(2)
  await expect(body(page).locator('table.children').first().locator('tr')).toHaveCount(5)
  await expect(body(page).locator('table.children').last().locator('tr')).toHaveCount(6)
  await expect(body(page).locator('blockquote')).toContainText('Teacher + Student + Guardian + controls')
  await expect(body(page)).toContainText('不能用它证明')
  await expect(body(page).locator('strong')).toContainText(['对每一个 reporter', '如果把 AI 换成 Teacher'])
  const raw = await source(page)
  await expect(raw).toHaveValue(/\$\$\n\\Delta R\^2_r\n=\n/)
  await expect(raw).toHaveValue(/0\.0497/)
  const events = await page.evaluate(() => window.__writingDebug.read())
  expect(events.some(row => row.event === 'paste-route' && row.route === 'markdown-math-recovery')).toBe(true)
  expect(events.some(row => row.event === 'paste-result' && row.displayMath === 1 && row.inlineMath === 1 && row.tables === 2)).toBe(true)
  expect(JSON.stringify(events)).not.toContain('reporter')
  expect(JSON.stringify(events)).not.toContain('Delta')
  await page.getByRole('button', { name: '返回正文' }).click()
  await page.screenshot({ path: testInfo.outputPath('reporter-paste-fixed.png'), fullPage: true })
  const download = page.waitForEvent('download')
  await page.evaluate(() => window.__writingDebug.download())
  const saved = await download, path = testInfo.outputPath('editor-diagnostics.json')
  await saved.saveAs(path)
  const diagnostics = JSON.parse(await readFile(path, 'utf8'))
  expect(diagnostics.revision).toBe('clipboard-math-3')
  expect(diagnostics.events.some(row => row.route === 'markdown-math-recovery')).toBe(true)
  await page.reload()
  expect(await page.evaluate(() => window.__writingDebug.read().some(row => row.event === 'paste-result'))).toBe(true)
})

test('富文本独有格式和代码粘贴不被 Markdown 恢复覆盖', async ({ page }) => {
  await open(page, '')
  await pasteContent(page, '普通正文', '<p><strong>普通正文</strong><a href="https://example.com/">链接</a></p>')
  await expect(body(page).locator('strong')).toHaveText('普通正文')
  await expect(body(page).locator('a')).toHaveAttribute('href', 'https://example.com/')
  expect(await page.evaluate(() => window.__writingDebug.read().filter(row => row.event === 'paste-route').at(-1).route)).toBe('html')
  await source(page)
  await page.getByRole('textbox', { name: 'Markdown 源码' }).fill('```text\n代码区\n```')
  await page.getByRole('button', { name: '返回正文' }).click()
  const code = body(page).locator('.cm-content')
  await code.click()
  await code.evaluate((element, text) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  }, aiFormula)
  await expect(body(page).locator('.writing-math')).toHaveCount(0)
  await expect(code).toContainText('\\Delta')
})

test('AI 附录表格直接粘贴保留单元格内圆括号公式', async ({ page }) => {
  const markdown = String.raw`附录需要联动的，是下面四张图：

| 附录图 | 建议加入的内容 |
|---|---|
| **C1: common15 alpha** | 三个比较，均 \(p<0.001\)。 |
| **C3: common15 双变量关联** | 成绩依次为 \(0.058,\ <0.001,\ <0.001\)；心理健康三个均 \(<0.001\)。 |
| **C4: common15 多变量系数** | 成绩依次为 \(0.700,\ <0.001,\ 0.026\)；心理健康依次为 \(0.009,\ 0.223,\ <0.001\)。 |
| **C6: common15 Shapley 贡献** | 成绩 \(p=0.894\)，心理健康 \(p<0.001\)。 |

三个比较均按 **AI–Teacher、AI–Student、AI–Guardian** 排列。`
  await open(page, '')
  await pasteContent(page, markdown, new MarkdownIt().render(markdown))
  await expect(body(page).locator('table.children tr')).toHaveCount(5)
  await expect(body(page).locator('.writing-math-inline .katex')).toHaveCount(7)
  await expect(body(page).locator('table.children strong')).toHaveCount(4)
  await expect(body(page)).toContainText('AI–Teacher、AI–Student、AI–Guardian')
  await expect(body(page).locator('.katex-error')).toHaveCount(0)
})

test('从 KaTeX 与 MathML 元数据恢复公式并保留 HTML 独有表格和格式', async ({ page }) => {
  await open(page, '')
  const inline = katex.renderToString('p<0.001', { throwOnError: false })
  const block = katex.renderToString('a^2+b^2=c^2', { displayMode: true, throwOnError: false })
  const html = `<p><strong>保留粗体</strong> <a href="https://example.com/paper">链接</a></p>
    <table><tr><th>图</th><th>结果</th></tr><tr><td>C1</td><td>${inline}</td></tr></table>
    ${block}<p>MathML: <math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math></p>
    <p>属性: <span data-latex="y^2">显示结果</span></p>
    <p>普通 (p&lt;0.001)；代码 <code data-latex="z^2">z^2</code>。</p>`
  await pasteContent(page, '保留粗体 链接 图 结果 C1 (p<0.001) a²+b²=c² MathML x² 属性 y² 普通 (p<0.001) 代码 z²', html)
  await expect(body(page).locator('table.children')).toHaveCount(1)
  await expect(body(page).locator('strong')).toHaveText('保留粗体')
  await expect(body(page).locator('a')).toHaveAttribute('href', 'https://example.com/paper')
  await expect(body(page).locator('.writing-math-inline .katex')).toHaveCount(3)
  await expect(body(page).locator('.writing-math-block .katex')).toHaveCount(1)
  await expect(body(page)).toContainText('普通 (p<0.001)')
  await expect(body(page).locator('code')).toHaveText('z^2')
  const raw = await source(page)
  await expect(raw).toHaveValue(/\$p<0\.001\$/)
  await expect(raw).toHaveValue(/\$\$\na\^2\+b\^2=c\^2\n\$\$/)
  expect(await page.evaluate(() => window.__writingDebug.read().some(row => row.event === 'paste-html-recovered' && row.convertedDisplay === 1 && row.convertedInline === 3))).toBe(true)
})

test('HTML 拆开的公式边界在单元格内识别，不吞掉粗体和代码', async ({ page }) => {
  await open(page, '')
  const html = String.raw`<table><tr><th>结果</th></tr><tr><td><strong>成绩</strong> <span>\(</span><em>0.058,\ </em><span>&lt;0.001\)</span>；<a href="https://example.com/">继续阅读</a></td></tr></table><p>普通 (说明) <code>\(literal\)</code> 和转义 \\(escaped\\)。</p>`
  await pasteContent(page, '成绩 (0.058, <0.001)；继续阅读。普通 (说明) code', html)
  await expect(body(page).locator('.writing-math-inline .katex')).toHaveCount(1)
  await expect(body(page).locator('table.children strong')).toHaveText('成绩')
  await expect(body(page).locator('table.children a')).toHaveText('继续阅读')
  await expect(body(page).locator('code')).toHaveText('\\(literal\\)')
  await expect(body(page)).toContainText('普通 (说明)')
  await expect(body(page)).toContainText(String.raw`\\(escaped\\)`)
})

for (const width of [1200, 390]) {
  test(`列表圆点与首行对齐、间距紧凑且层级可辨 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 })
    await open(page, '说明正文。\n\n- 成绩：$p=0.012$。\n- 心理健康：$p<0.001$。\n  - 二级条目\n    - 三级条目\n\n后续正文。')
    const bullet = body(page).locator('.label.bullet')
    await expect(bullet).toHaveCount(4)
    const geometry = await bullet.first().evaluate(label => {
      const item = label.closest('li'), paragraph = item.querySelector('.content-dom > p')
      const a = label.getBoundingClientRect(), b = paragraph.getBoundingClientRect()
      return { offset: Math.abs(a.top + a.height / 2 - (b.top + parseFloat(getComputedStyle(paragraph).lineHeight) / 2)), gap: b.left - a.right }
    })
    expect(geometry.offset).toBeLessThan(2)
    expect(geometry.gap).toBeLessThanOrEqual(12)
    const first = await bullet.nth(0).boundingBox(), second = await bullet.nth(1).boundingBox()
    expect(second.y - first.y).toBeLessThan(42)
    const styles = await bullet.evaluateAll(labels => labels.map(el => { const style = getComputedStyle(el, '::before'); return { content: style.content, background: style.backgroundColor, radius: style.borderRadius } }))
    expect(styles[0].content).toBe('""')
    expect(styles[0].background).not.toBe('rgba(0, 0, 0, 0)')
    expect(styles[2].background).toBe('rgba(0, 0, 0, 0)')
    expect(styles[3].radius).toBe('0px')
    await expect(body(page).locator('.writing-math-inline')).toHaveCount(2)
  })
}

test('列表 Tab 缩进与行首 Backspace 逐级退出，不合并或删字', async ({ page }) => {
  await open(page, '- 父项\n- 子项内容\n- 末项')
  const itemText = () => body(page).locator('li .content-dom > p').filter({ hasText: /^子项内容$/ })
  async function placeStart() {
    await itemText().evaluate(el => {
      el.closest('[contenteditable=true]').focus()
      const range = document.createRange(); range.setStart(el.firstChild, 0); range.collapse(true)
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
    })
  }
  await placeStart(); await page.keyboard.press('Tab')
  await expect(body(page).locator('ul ul .content-dom > p').filter({ hasText: /^子项内容$/ })).toHaveCount(1)

  await page.keyboard.press('Shift+Tab')
  await expect(body(page).locator('ul ul')).toHaveCount(0)
  await placeStart(); await page.keyboard.press('Tab')
  await placeStart(); await page.keyboard.press('Backspace')
  await expect(body(page).locator('ul ul')).toHaveCount(0)
  await expect(itemText()).toHaveCount(1)
  await expect(body(page).locator('.label.bullet')).toHaveCount(3)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(body(page).locator('ul ul .content-dom > p').filter({ hasText: /^子项内容$/ })).toHaveCount(1)
  await placeStart(); await page.keyboard.press('Backspace')
  await placeStart(); await page.keyboard.press('Backspace')
  await expect(body(page).locator(':scope > p').filter({ hasText: /^子项内容$/ })).toHaveCount(1)
  const raw = await source(page)
  await expect(raw).toHaveValue(/父项/); await expect(raw).toHaveValue(/子项内容/); await expect(raw).toHaveValue(/末项/)
})

test('嵌套列表第二条在行首退一级，中间 Backspace 仍删除一个字', async ({ page }) => {
  await open(page, '- 父项\n  - 子项甲\n  - 子项乙\n    - 孙项\n\n1. 有序一\n2. 有序二\n\n- [ ] 待办')
  const target = body(page).locator('li .content-dom > p').filter({ hasText: /^子项乙$/ })
  await target.evaluate(el => {
    el.closest('[contenteditable=true]').focus()
    const range = document.createRange(); range.setStart(el.firstChild, 0); range.collapse(true)
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
  })
  await page.keyboard.press('Backspace')
  await expect(body(page).locator('ul ul .content-dom > p').filter({ hasText: /^子项乙$/ })).toHaveCount(0)
  await expect(target).toHaveText('子项乙')
  await expect(body(page)).toContainText('子项甲'); await expect(body(page)).toContainText('孙项')
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Backspace')
  await expect(body(page).locator('li .content-dom > p').filter({ hasText: /^项乙$/ })).toHaveCount(1)
  await expect(body(page).locator('.label.ordered')).toHaveCount(2)
  await expect(body(page).locator('.label.unchecked')).toHaveCount(1)
})

for (const start of [1, 2, 5]) {
  test(`输入数字加空格立即显示有序标记，Enter 新项不闪成圆点 起点${start}`, async ({ page }) => {
    await open(page, '')
    await body(page).click()
    await body(page).evaluate(el => {
      window.listMarkerMismatches = []
      window.listMarkerObserver = new MutationObserver(() => {
        for (const list of el.querySelectorAll('ol')) {
          for (const item of list.children) {
            const label = item.querySelector(':scope > .list-item > .label-wrapper > .label')
            if (label?.classList.contains('bullet')) window.listMarkerMismatches.push(list.textContent)
          }
        }
      })
      window.listMarkerObserver.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    })
    await page.keyboard.type(`${start}. `)
    const labels = body(page).locator('.label.ordered')
    await expect(labels).toHaveText([`${start}.`])
    await expect(body(page).locator('.label.bullet')).toHaveCount(0)
    await page.keyboard.insertText('第一项')
    await page.keyboard.press('Enter')
    await expect(labels).toHaveText([`${start}.`, `${start + 1}.`])
    await expect(body(page).locator('.label.bullet')).toHaveCount(0)
    await page.keyboard.insertText('第二项')
    await page.keyboard.press('Enter')
    await expect(labels).toHaveText([`${start}.`, `${start + 1}.`, `${start + 2}.`])
    await page.keyboard.insertText('第三项')
    expect(await page.evaluate(() => { window.listMarkerObserver.disconnect(); return window.listMarkerMismatches })).toEqual([])
    await source(page)
    await page.getByRole('button', { name: '返回正文' }).click()
    await expect(labels).toHaveText([`${start}.`, `${start + 1}.`, `${start + 2}.`])
    await page.getByRole('textbox', { name: '文档名称' }).press('ControlOrMeta+s')
    await page.reload()
    await expect(body(page).locator('.label.ordered')).toHaveText([`${start}.`, `${start + 1}.`, `${start + 2}.`])
  })
}

test('有序列表退出后输入无序标记，撤销重做不改变真实列表类型', async ({ page }) => {
  await open(page, '')
  await body(page).click(); await page.keyboard.type('1. '); await page.keyboard.insertText('有序甲')
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
  await page.keyboard.type('- ')
  await expect(body(page).locator('.label.ordered')).toHaveText(['1.'])
  await expect(body(page).locator('.label.bullet')).toHaveCount(1)
  await page.keyboard.insertText('无序乙')
  await page.keyboard.press('Enter')
  await expect(body(page).locator('.label.bullet')).toHaveCount(2)
  await page.keyboard.press('ControlOrMeta+z'); await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(body(page).locator('.label.ordered')).toHaveText(['1.'])
  await expect(body(page).locator('.label.bullet')).toHaveCount(2)
  await source(page); await page.getByRole('button', { name: '返回正文' }).click()
  await expect(body(page).locator('ol')).toHaveCount(1)
  await expect(body(page).locator('ul')).toHaveCount(1)
})

for (const start of [1, 3]) {
  test(`有序列表缩进退级及撤销保持实际编号 起点${start}`, async ({ page }) => {
    await open(page, `${start}. 甲\n${start + 1}. 乙\n${start + 2}. 丙`)
    const labels = body(page).locator('.label.ordered')
    const expected = [`${start}.`, `${start + 1}.`, `${start + 2}.`]
    async function place() {
      await body(page).locator('li .content-dom > p').filter({ hasText: /^乙$/ }).evaluate(el => {
        el.closest('[contenteditable=true]').focus()
        const range = document.createRange(); range.setStart(el.firstChild, 0); range.collapse(true)
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
      })
    }
    await expect(labels).toHaveText(expected)
    await place(); await page.keyboard.press('Tab')
    await expect(labels).toHaveText([`${start}.`, '1.', `${start + 1}.`])
    await page.keyboard.press('Shift+Tab')
    await expect(labels).toHaveText(expected)
    await page.keyboard.press('ControlOrMeta+z')
    await expect(labels).toHaveText([`${start}.`, '1.', `${start + 1}.`])
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(labels).toHaveText(expected)
    await place(); await page.keyboard.press('Tab')
    await place(); await page.keyboard.press('Backspace')
    await expect(labels).toHaveText(expected)
    const raw = await source(page)
    await expect(raw).toHaveValue(new RegExp(`${start}\\. 甲`))
    await page.getByRole('button', { name: '返回正文' }).click()
    await expect(labels).toHaveText(expected)
  })
}

test('任务列表退级保留勾选，表格和代码继续使用各自 Tab', async ({ page }) => {
  await open(page, '- [ ] 父任务\n- [ ] 子任务\n\n| A | B |\n|---|---|\n| 左格 | 右格 |\n\n```text\nhello\n```')
  const task = body(page).locator('li .content-dom > p').filter({ hasText: /^子任务$/ })
  await task.evaluate(el => {
    el.closest('[contenteditable=true]').focus()
    const range = document.createRange(); range.setStart(el.firstChild, 0); range.collapse(true)
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
  })
  await page.keyboard.press('Tab')
  await expect(body(page).locator('ul ul .label.unchecked')).toHaveCount(1)
  await page.keyboard.press('Shift+Tab')
  await expect(body(page).locator('ul ul')).toHaveCount(0)
  await body(page).locator('.label.unchecked').nth(1).click()
  await expect(body(page).locator('.label.checked')).toHaveCount(1)
  const cells = body(page).locator('table.children td')
  await cells.first().locator('p').evaluate(el => {
    el.closest('[contenteditable=true]').focus()
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false)
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
  })
  await page.keyboard.press('Tab')
  expect(await cells.nth(1).evaluate(el => el.contains(window.getSelection()?.anchorNode))).toBe(true)
  const code = body(page).locator('.cm-content')
  await code.click(); await code.press('Home'); await code.press('Tab')
  await expect(code).toContainText('hello')
  expect(await code.textContent()).toMatch(/^\s+hello/)
  await expect(body(page).locator('.label.checked')).toHaveCount(1)
  await expect(body(page).locator('table.children')).toHaveCount(1)
})

const aiFormula = String.raw`\[
\Delta R^2_r
=
R^2_{\text{全部四类报告＋controls}}
-
R^2_{\text{去掉 }r\text{ 的报告＋controls}}
\]`
async function pasteContent(page, text, html = '') {
  await body(page).click()
  await body(page).evaluate((element, { text, html }) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', text)
    if (html) clipboardData.setData('text/html', html)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  }, { text, html })
}

for (const format of ['plain', 'html', 'html-blocks']) {
  test(`粘贴 AI 括号公式在 Markdown 标题解析前识别 ${format}`, async ({ page }) => {
    await open(page, '')
    const before = '前文 **强调**', after = String.raw`后文 \(x^2\)，原有 $y^2$。`
    const code = '\n\n```text\n' + aiFormula + '\n```'
    const text = `${before}\n\n${aiFormula}\n\n${after}${code}`
    const formulaHtml = format === 'html-blocks' ? aiFormula.split('\n').map(line => `<p>${line}</p>`).join('') : `<p>${aiFormula.replaceAll('\n', '<br>')}</p>`
    const html = format === 'plain' ? '' : `<p>前文 <strong>强调</strong></p>${formulaHtml}<p>${after}</p><pre><code>${aiFormula}</code></pre>`
    await pasteContent(page, text, html)
    await expect(body(page).locator('.writing-math-block .katex')).toHaveCount(1)
    await expect(body(page).locator('.writing-math-inline .katex')).toHaveCount(2)
    await expect(body(page).locator('h1,h2')).toHaveCount(0)
    await expect(body(page).locator('strong')).toHaveText('强调')
    await expect(body(page)).toContainText('后文')
    await expect(body(page).locator('.katex-error')).toHaveCount(0)
    await expect(body(page).locator('.milkdown-code-block')).toContainText('\\Delta')
    await page.getByRole('button', { name: '编辑行间公式' }).click()
    await expect(page.getByRole('textbox', { name: '行间公式 LaTeX' })).toHaveText(aiFormula.slice(3, -3), { useInnerText: true })
    await page.getByRole('textbox', { name: '行间公式 LaTeX' }).press('ControlOrMeta+Enter')
    const raw = await source(page)
    await expect(raw).toHaveValue(/\$\$\n\\Delta R\^2_r\n=\n/)
    await page.getByRole('button', { name: '返回正文' }).click()
    await expect(body(page).locator('.writing-math-block .katex')).toHaveCount(1)
  })
}

test('括号公式导入和源码转换保留普通标题、代码、链接与转义文本', async ({ page }) => {
  const literal = String.raw`普通标题
===

二级标题
---

行内代码：` + '`\\(literal\\)`' + '\n\n```text\n' + aiFormula + '\n```\n\n' + String.raw`转义：\\[不应转换\\]，普通 [方括号]。

[链接](https://example.com/path "\(不要转换\)")

未配对：\[`
  await open(page, `${aiFormula}\n\n${literal}`)
  await expect(body(page).locator('.writing-math-block .katex')).toHaveCount(1)
  await expect(body(page).locator('h1')).toHaveText('普通标题')
  await expect(body(page).locator('h2')).toHaveText('二级标题')
  await expect(body(page).locator('.milkdown-code-block')).toHaveCount(1)
  await expect(body(page).locator('.milkdown-code-block')).toContainText('\\Delta')
  // CommonMark unescapes punctuation in link titles; it must not become math.
  await expect(body(page).locator('a')).toHaveAttribute('title', '(不要转换)')
  await expect(body(page).locator('a')).toHaveAttribute('href', 'https://example.com/path')
  await expect(body(page).locator('.writing-math-inline')).toHaveCount(0)
  await expect(body(page)).toContainText('转义：\\[不应转换\\]')
  const raw = await source(page)
  await raw.fill(`${literal}\n\n${aiFormula}`)
  await page.getByRole('button', { name: '返回正文' }).click()
  await expect(body(page).locator('.writing-math-block .katex')).toHaveCount(1)
  await expect(body(page).locator('h1')).toHaveText('普通标题')
})

let preview
const key = 'frowang-writing-probe-v1'
test.beforeAll(async () => { preview = await startWritingPreview({ port: 0 }) })
test.afterAll(async () => { await preview?.server.close() })
async function open(page, markdown) {
  if (markdown !== undefined) await page.addInitScript(({ key, markdown }) => localStorage.setItem(key, JSON.stringify({ title: '验证笔记', markdown })), { key, markdown })
  await page.goto(preview.origin + '/__editor')
  await expect(page.getByRole('button', { name: '源码', exact: true })).toBeEnabled()
}
const body = page => page.getByRole('textbox', { name: 'Markdown 正文', exact: true })
async function source(page) {
  await page.getByRole('button', { name: '源码', exact: true }).click()
  return page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
}

test('直接写作、Markdown 输入与浏览器草稿恢复', async ({ page }) => {
  await open(page, '# 初始笔记\n\nH<sub>2</sub>O\n\n正文')
  await body(page).locator('p').last().evaluate(el => {
    el.closest('[contenteditable=true]').focus()
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false)
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
  })
  await page.keyboard.press('Enter')
  await page.keyboard.type('## ')
  await page.keyboard.insertText('新增标题')
  await expect(body(page).locator('h2').last()).toHaveText('新增标题')
  await page.keyboard.press('Enter'); await page.keyboard.type('/')
  await expect(page.locator('.milkdown-block-handle')).toHaveCount(0)
  await expect(page.locator('.milkdown-slash-menu')).toHaveCount(0)
  await page.keyboard.insertText('自然输入中文')
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible()
  await page.reload()
  await expect(body(page)).toContainText('自然输入中文')
  await expect(body(page).locator('sub')).toHaveText('2')
})

for (const width of [1200, 390]) {
  test(`行内公式轻量源码与实时预览保持视口边界 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await open(page, 'Joint tests reject the null hypothesis ($p=0.012$ and $p<0.001$), respectively.')
    await page.getByRole('button', { name: '编辑行内公式', exact: true }).first().click()
    const input = page.getByRole('textbox', { name: '行内公式 LaTeX', exact: true })
    const tooltip = page.getByRole('tooltip', { name: '公式预览' })
    await expect(tooltip).toBeVisible()
    await expect(tooltip.locator('annotation')).toHaveText('p=0.012')
    const style = await input.evaluate(el => ({ border: getComputedStyle(el).borderTopWidth, fontSize: getComputedStyle(el).fontSize }))
    expect(style.border).toBe('0px'); expect(style.fontSize).toBe('16px')
    await expect(page.locator('.writing-math-delimiter:visible')).toHaveCount(2)
    await input.fill('p=0.025')
    await expect(tooltip.locator('annotation')).toHaveText('p=0.025')
    await input.fill('\\frac{1}{')
    await expect(tooltip).toContainText('公式尚未完整')
    await input.fill('\\frac{1}{2}')
    await expect(tooltip.locator('annotation')).toHaveText('\\frac{1}{2}')
    const box = await tooltip.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(8); expect(box.x + box.width).toBeLessThanOrEqual(width - 8)
    expect(box.y).toBeGreaterThanOrEqual(8); expect(box.y + box.height).toBeLessThanOrEqual(792)
    await input.press('Escape')
    await expect(tooltip).toHaveCount(0)
    await page.getByRole('button', { name: '编辑行内公式', exact: true }).first().click()
    await expect(input).toHaveValue('p=0.012')
    await input.press('Enter')
    await expect(tooltip).toHaveCount(0)
  })
}

test('方向键双向进入行内公式并在边界回到正文', async ({ page }) => {
  await open(page, 'Before $p=0.012$ after.')
  const paragraph = body(page).locator('p').first()
  await paragraph.evaluate(el => {
    el.closest('[contenteditable=true]').focus()
    const range = document.createRange(); range.setStart(el.firstChild, el.firstChild.textContent.length); range.collapse(true)
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
  })
  await page.keyboard.press('ArrowRight')
  const input = page.getByRole('textbox', { name: '行内公式 LaTeX', exact: true })
  await expect(input).toBeFocused()
  expect(await input.evaluate(el => el.selectionStart)).toBe(0)
  await input.press('End'); await input.press('ArrowRight')
  await expect(input).toBeHidden()
  await page.keyboard.insertText('NEXT')
  await expect(paragraph).toContainText('NEXT after.')
  await paragraph.evaluate(el => {
    el.closest('[contenteditable=true]').focus()
    const range = document.createRange(); range.setStart(el.lastChild, 0); range.collapse(true)
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
  })
  await page.keyboard.press('ArrowLeft')
  await expect(input).toBeFocused()
  expect(await input.evaluate(el => el.selectionStart)).toBe('p=0.012'.length)
  await input.press('Home'); await input.press('ArrowLeft')
  await page.keyboard.insertText('PREV')
  await expect(paragraph).toContainText('Before PREV')
  await expect(page.getByRole('tooltip', { name: '公式预览' })).toHaveCount(0)
})

test('短行内公式支持上下进入和退出正文', async ({ page }) => {
  await open(page, 'Above paragraph.\n\n$p$\n\nBelow paragraph.')
  const paragraph = body(page).locator('p')
  async function place(index) {
    await paragraph.nth(index).evaluate(el => {
      el.closest('[contenteditable=true]').focus()
      const range = document.createRange(); range.setStart(el.firstChild, 0); range.collapse(true)
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
    })
  }
  await place(0); await page.keyboard.press('ArrowDown')
  const input = page.getByRole('textbox', { name: '行内公式 LaTeX', exact: true })
  await expect(input).toBeFocused()
  await input.press('ArrowUp')
  await expect(input).toBeHidden()
  await page.keyboard.insertText('UP ')
  await expect(paragraph.first()).toContainText('UP ')
  await place(2); await page.keyboard.press('ArrowUp')
  await expect(input).toBeFocused()
  await input.press('ArrowDown')
  await expect(input).toBeHidden()
  await page.keyboard.insertText('DOWN ')
  await expect(paragraph.nth(2)).toContainText('DOWN ')
  await expect(page.getByRole('tooltip', { name: '公式预览' })).toHaveCount(0)
})

test('段落中间的行内公式上下退出到相邻文字行', async ({ page }) => {
  await open(page, 'The first visual line contains enough ordinary text.  \nThe second line contains $p$ inside text.  \nThe third visual line continues below the formula.')
  const paragraph = body(page).locator('p').first()
  const formula = page.getByRole('button', { name: '编辑行内公式', exact: true })
  const input = page.getByRole('textbox', { name: '行内公式 LaTeX', exact: true })
  await formula.click(); await input.press('ArrowUp')
  await expect(input).toBeHidden()
  await page.keyboard.insertText('UP ')
  expect(await paragraph.evaluate(el => el.firstChild.textContent)).toContain('UP ')
  await formula.click(); await input.press('ArrowDown')
  await expect(input).toBeHidden()
  await page.keyboard.insertText('DOWN ')
  expect(await paragraph.evaluate(el => el.lastChild.textContent)).toContain('DOWN ')
})

test('长行内公式源码自动折行，上下键先在源码内移动再退出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 })
  const formula = String.raw`\frac{\sum_{i=1}^{n}(x_i-\bar{x})(y_i-\bar{y})}{\sqrt{\sum_{i=1}^{n}(x_i-\bar{x})^2}\sqrt{\sum_{i=1}^{n}(y_i-\bar{y})^2}}+\frac{\lambda_1\alpha_1+\lambda_2\alpha_2+\lambda_3\alpha_3}{1+\exp(-\beta_0-\beta_1 x_i-\beta_2 z_i)}`
  await open(page, `Above.\n\n$${formula}$\n\nBelow.`)
  await page.getByRole('button', { name: '编辑行内公式', exact: true }).click()
  const input = page.getByRole('textbox', { name: '行内公式 LaTeX', exact: true })
  expect(await input.evaluate(el => el.tagName)).toBe('TEXTAREA')
  await expect.poll(async () => (await input.boundingBox()).height).toBeGreaterThan(48)
  await input.press('ControlOrMeta+Home'); await input.press('ArrowDown')
  await expect(input).toBeFocused()
  expect(await input.evaluate(el => el.selectionStart)).toBeGreaterThan(0)
  await input.press('ControlOrMeta+End'); await input.press('ArrowUp')
  await expect(input).toBeFocused()
  expect(await input.evaluate(el => el.selectionStart)).toBeLessThan(formula.length)
  await input.press('ControlOrMeta+End'); await input.press('ArrowDown')
  await expect(input).toBeHidden()
  await page.keyboard.insertText('DOWN ')
  await expect(body(page).locator('p').last()).toContainText('DOWN ')
  await page.getByRole('button', { name: '编辑行内公式', exact: true }).click()
  await expect(input).toHaveValue(formula)
  await input.press('ControlOrMeta+Home'); await input.press('ArrowUp')
  await expect(input).toBeHidden()
  await page.keyboard.insertText('UP ')
  await expect(body(page).locator('p').first()).toContainText('UP ')
})

test('多行行间公式在源码首尾用上下键退出', async ({ page }) => {
  await open(page, 'Above block.\n\n$$\na=1\nb=2\n$$\n\nBelow block.')
  await page.getByRole('button', { name: '编辑行间公式' }).click()
  const input = page.getByRole('textbox', { name: '行间公式 LaTeX' })
  await input.press('ControlOrMeta+End'); await input.press('ArrowUp')
  await expect(input).toBeFocused()
  await input.press('ControlOrMeta+Home'); await input.press('ArrowUp')
  await expect(input).toBeHidden()
  await page.keyboard.insertText('UP ')
  await expect(body(page).locator('p').first()).toContainText('UP ')
  await page.getByRole('button', { name: '编辑行间公式' }).click()
  await input.press('ControlOrMeta+End'); await input.press('ArrowDown')
  await expect(input).toBeHidden()

  await page.keyboard.insertText('DOWN ')
  await expect(body(page).locator('p').last()).toContainText('DOWN ')
})

test('公式导航样例新增标签，刷新不重复插入', async ({ page }) => {
  await open(page, '# 原有草稿')
  await page.goto(preview.origin + '/__editor?sample=math-navigation')
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab', { name: '公式上下移动样例' })).toHaveAttribute('aria-selected', 'true')
  await expect(body(page).locator('.writing-math-inline')).toHaveCount(2)
  await expect(body(page).locator('.writing-math-block')).toHaveCount(1)
  await page.reload()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.getByRole('tab', { name: '验证笔记' }).click()
  await expect(body(page)).toContainText('原有草稿')
})

test('空公式删除和标签切换清理实时预览', async ({ page }) => {
  await open(page, 'Before $x^2$ after.')
  await page.getByRole('button', { name: '编辑行内公式', exact: true }).click()
  const input = page.getByRole('textbox', { name: '行内公式 LaTeX', exact: true })
  await input.fill(''); await input.press('Backspace')
  await expect(body(page).locator('.writing-math-inline')).toHaveCount(0)
  await expect(body(page)).toContainText('Before  after.')
  await expect(page.getByRole('tooltip', { name: '公式预览' })).toHaveCount(0)
  const raw = await source(page)
  await raw.fill('Before $y^2$ after.')
  await page.getByRole('button', { name: '返回正文' }).click()
  await page.getByRole('button', { name: '编辑行内公式', exact: true }).click()
  await expect(page.getByRole('tooltip', { name: '公式预览' })).toBeVisible()
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await expect(page.getByRole('tooltip', { name: '公式预览' })).toHaveCount(0)
  await page.getByRole('tab', { name: '验证笔记', exact: true }).click()
  await expect(page.getByRole('tooltip', { name: '公式预览' })).toHaveCount(0)
  await expect(body(page).locator('.writing-math-inline annotation')).toHaveText('y^2')
})

for (const width of [1200, 390]) {
  test(`行内公式原位编辑、取消和撤销 ${width}`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height: 850 })
    await open(page, '# 公式\n\n前文 $x^2$ 后文')
    const formula = page.getByRole('button', { name: '编辑行内公式', exact: true })
    await formula.click()
    const input = page.getByRole('textbox', { name: '行内公式 LaTeX', exact: true })
    await expect(input).toBeVisible()
    await expect(page.locator('.milkdown-latex-inline-edit')).toHaveCount(0)
    await input.fill('x^3'); await input.press('Enter')
    await expect(input).toBeHidden()
    await body(page).press('ControlOrMeta+z')
    await formula.click(); await expect(input).toHaveValue('x^2'); await input.press('Enter')
    await body(page).press('ControlOrMeta+Shift+z')
    await formula.click(); await expect(input).toHaveValue('x^3')
    await input.fill('x^4'); await input.press('Escape')
    await formula.click(); await expect(input).toHaveValue('x^3'); await input.press('Enter')
    await expect(body(page)).toContainText('后文')
    const raw = await source(page)
    await expect(raw).toHaveValue(/\$x\^3\$/)
    await page.getByRole('button', { name: '返回正文' }).click()
    const box = await formula.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width)
    expect(errors).toEqual([])
  })
}

test('行间公式多行修改，源码往返、表格和上下标保留', async ({ page }) => {
  await open(page, '# 记录\n\n$$\nx^2 + y^2\n$$\n\n| 指标 | 值 |\n| --- | --- |\n| H<sub>2</sub>O | $x^2$ |\n\n结尾')
  await page.getByRole('button', { name: '编辑行间公式' }).click()
  const input = page.getByRole('textbox', { name: '行间公式 LaTeX' })
  await input.fill('\\begin{aligned}\nx &= 2 \\\\\ny &= 3\n\\end{aligned}')
  await input.press('ControlOrMeta+Enter')
  await expect(input).toBeHidden()
  const raw = await source(page)
  await expect(raw).toHaveValue(/\$\$\n\\begin\{aligned\}/)
  await expect(raw).toHaveValue(/H<sub>2<\/sub>O/)
  await raw.fill((await raw.inputValue()) + '\n\n新增 **重点**')
  await page.getByRole('button', { name: '返回正文' }).click()
  await expect(body(page).locator('strong')).toHaveText('重点')
  await expect(body(page).locator('table.children')).toHaveCount(1)
  await expect(body(page).locator('table.children td')).toHaveCount(2)
  await expect(body(page).locator('table.children sub')).toHaveText('2')
  await expect(body(page).locator('.writing-math-block .katex')).toHaveCount(1)
  await expect(body(page).locator('.katex-error')).toHaveCount(0)
})

test('即时输入行内和行间公式，普通代码不被当成公式', async ({ page }) => {
  await open(page, '# 输入验证\n\n')
  await body(page).press('ControlOrMeta+End')
  await page.keyboard.type('text $a^2$')
  await expect(page.getByRole('button', { name: '编辑行内公式', exact: true })).toHaveCount(1)
  await page.keyboard.press('Enter'); await page.keyboard.type('$$b^2$$')
  await expect(page.getByRole('button', { name: '编辑行间公式' })).toHaveCount(1)
  const raw = await source(page)
  await raw.fill('```python\nprint("$x$")\n```\n\n`$literal$`')
  await page.getByRole('button', { name: '返回正文' }).click()
  await expect(body(page).locator('.writing-math')).toHaveCount(0)
  await expect(body(page)).toContainText('print("$x$")')
})

test('Markdown 文件导入下载与 PDF 下载', async ({ page }, testInfo) => {
  await open(page)
  page.on('dialog', dialog => dialog.accept())
  const text = '# 文件测试\n\n保留原文 $x^2$ 与 H<sub>2</sub>O\n\n$$\ny=3\n$$'
  await page.locator('input[type=file]').setInputFiles({ name: '测试.md', mimeType: 'text/markdown', buffer: Buffer.from(text) })
  await expect(body(page).locator('h1')).toHaveText('文件测试')
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab', { name: '测试', exact: true })).toHaveAttribute('aria-selected', 'true')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 .md', exact: true }).click()
  const md = await download; const mdPath = testInfo.outputPath('note.md'); await md.saveAs(mdPath)
  expect(await readFile(mdPath, 'utf8')).toBe(text)
  const pdfDownload = page.waitForEvent('download', { timeout: 60000 })
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click()
  const pdf = await pdfDownload; const pdfPath = testInfo.outputPath('note.pdf'); await pdf.saveAs(pdfPath)
  const bytes = await readFile(pdfPath)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(bytes.length).toBeGreaterThan(10000)
})

for (const width of [1200, 390]) {
  test(`多笔记标签保留旧草稿、源码和撤销记录并刷新恢复 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 })
    const legacy = '# 原来的笔记\n\n不能覆盖的内容 $x^2$'
    await open(page, legacy)
    await expect(page.getByRole('tab', { name: '验证笔记' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.brand, .help, .document-footer')).toHaveCount(0)
    await expect(page).toHaveTitle('验证笔记')
    await body(page).press('ControlOrMeta+End'); await page.keyboard.insertText('新增甲')
    // Switch immediately, before Milkdown's debounced markdown callback.
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(body(page)).toBeVisible()
    await page.getByRole('textbox', { name: '文档名称' }).fill('第二篇')
    const raw = await source(page)
    await raw.fill('# 第二篇正文\n\n源码草稿乙')
    await page.getByRole('tab', { name: '验证笔记', exact: true }).click()
    await expect(body(page)).toContainText('新增甲')
    await body(page).press('ControlOrMeta+z')
    await expect(body(page)).not.toContainText('新增甲')
    await expect(body(page)).toContainText('不能覆盖的内容')
    await page.getByRole('tab', { name: '第二篇', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue('# 第二篇正文\n\n源码草稿乙')
    await expect(page.getByRole('button', { name: '返回正文' })).toBeVisible()
    await page.getByRole('button', { name: '返回正文' }).click()
    await expect(body(page)).toContainText('源码草稿乙')
    await page.getByRole('textbox', { name: '文档名称' }).press('ControlOrMeta+s')
    await page.reload()
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(page.getByRole('tab', { name: '第二篇' })).toHaveAttribute('aria-selected', 'true')
    await expect(body(page)).toContainText('源码草稿乙')
    await page.getByRole('tab', { name: '验证笔记' }).click()
    await expect(body(page)).toContainText('不能覆盖的内容')
    await expect(body(page)).not.toContainText('新增甲')
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).markdown, key)).toBe(legacy)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    expect(overflow).toBe(false)
  })
}

test('关闭笔记确认、保留其他笔记及最后一个标签的空白替代', async ({ page }) => {
  await open(page, '# 保留此篇')
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.getByRole('button', { name: '关闭 未命名笔记', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(body(page)).toContainText('保留此篇')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '关闭 验证笔记', exact: true }).click()
  await expect(body(page)).toContainText('保留此篇')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '关闭 验证笔记', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('tab', { name: '未命名笔记', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(body(page)).not.toContainText('保留此篇')
})

for (const mode of ['source', 'plain', 'paseo', 'html']) {
  test(`表格显式换行保真 ${mode}`, async ({ page }) => {
    await open(page, mode === 'source' ? tableBreakMarkdown : '')
    if (mode !== 'source') await pasteContent(page, tableBreakMarkdown, mode === 'paseo'
      ? createPaseoMarkdownClipboardContent(tableBreakMarkdown).html
      : mode === 'html' ? new MarkdownIt({ html: true }).render(tableBreakMarkdown) : '')
    const table = body(page).locator('table.children')
    await expect(table.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(22)
    await expect(table.locator('strong')).toHaveText('Stage 1')
    await expect(table.locator('code').last()).toHaveText('<br>')
    await expect(table.locator('code').nth(5)).toHaveText('<TEXT> | --body | --body-file <FILE|->')
    if (mode === 'source') {
      await expect(await source(page)).toHaveValue(tableBreakMarkdown)
      await page.getByRole('button', { name: '返回正文' }).click()
    }
    await table.locator('td p').last().click()
    await page.keyboard.press('End'); await page.keyboard.insertText('追加')
    const raw = await source(page)
    expect((await raw.inputValue()).match(/<br>/g).length).toBeGreaterThanOrEqual(22)
    await page.getByRole('button', { name: '返回正文' }).click()
    await expect(table.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(22)
  })
}

test('表格显式换行 Shift+Enter 连续输入与源码往返保持单段落', async ({ page }) => {
  await open(page, '| Header |\n| --- |\n| ab |')
  const cell = body(page).locator('td').first()
  await cell.locator('p').evaluate(el => {
    el.closest('[contenteditable=true]').focus()
    const range = document.createRange(); range.setStart(el.firstChild, 1); range.collapse(true)
    getSelection().removeAllRanges(); getSelection().addRange(range)
  })
  await page.keyboard.press('Shift+Enter'); await page.keyboard.press('Shift+Enter')
  await page.keyboard.insertText('中间')
  await expect(cell.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(2)
  await expect(cell.locator('p')).toHaveCount(1)
  const raw = await source(page)
  await expect(raw).toHaveValue(/a<br><br>中间b/)
  await page.getByRole('button', { name: '返回正文' }).click()
  await cell.locator('p').evaluate(el => {
    el.closest('[contenteditable=true]').focus()
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false)
    getSelection().removeAllRanges(); getSelection().addRange(range)
  })
  await page.keyboard.press('Shift+Enter')
  await expect(await source(page)).toHaveValue(/中间b<br><br>/)
  await page.getByRole('button', { name: '返回正文' }).click()
  await expect(cell.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(3)
})
