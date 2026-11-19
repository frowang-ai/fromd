import { test, expect } from '@playwright/test'
import { installMockHost } from './mock-host.mjs'
import { fileURLToPath } from 'node:url'
const pdfModule = '/@fs/' + fileURLToPath(new URL('../../../packages/editor/src/markdown/pdfDocument.js', import.meta.url)).replaceAll('\\', '/')

const sample = '# 合成扩展文稿\n\n开头正文[^named]，重复引用[^named]。\n\n```mermaid\nflowchart LR\n A[开始] --> B[完成]\n```\n\n> [!NOTE]\n> 提示内容 **加粗**。\n\n> [!WARNING]\n> 请先保存。\n\n> 普通引用。\n\n[^named]: 多行脚注 [资料](https://example.com)\n\n    第二段内容。\n\n[^unused]: 未引用的定义也要保留。\n\n结尾正文。\n'
async function mode(page, source) {
  await page.getByText('视图', { exact: true }).click()
  await page.locator('.menu-popup button').filter({ hasText: source ? '源码' : '正文' }).first().click()
  return page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
}
async function capture(page) {
  return page.locator('.pm-port').evaluate(el => el.__vueParentComponent.exposed.capture().markdown)
}
async function boot(page, markdown = sample) {
  await page.addInitScript(installMockHost, { markdown }); await page.goto('/?testHost=1')
  await expect(page.locator('.ProseMirror')).toBeVisible()
}
async function bodyEdit(page, text = '追加') {
  await page.locator('.ProseMirror > p').filter({ hasText: '结尾正文' }).click()
  await page.keyboard.press('End'); await page.keyboard.insertText(text)
}

test('Mermaid、命名重复脚注与提示块真实显示，保存读回不吞定义', async ({ page }) => {
  await boot(page)
  await expect(page.locator('.writing-mermaid-svg')).toBeVisible()
  await expect(page.locator('.writing-mermaid-svg')).toContainText('完成')
  await expect(page.locator('.writing-footnote-reference')).toHaveText(['[named]', '[named]'])
  await expect(page.locator('.writing-footnote-definition')).toHaveCount(2)
  await expect(page.locator('.writing-footnote-definition').first()).toContainText('第二段内容')
  await expect(page.locator('blockquote[data-alert="NOTE"]')).toContainText('提示内容')
  await expect(page.locator('blockquote:not([data-alert])')).toHaveText('普通引用。')
  await bodyEdit(page)
  const changed = await capture(page)
  expect(changed).toContain('[^named]:'); expect(changed).toContain('[^unused]:')
  expect(changed).toContain('第二段内容'); expect(changed).toContain('[!NOTE]'); expect(changed).toContain('```mermaid')
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.rows.get('a').savedText)).toBe(changed)
  await page.locator('.tab-title').filter({ hasText: '公式推导' }).click()
  await page.locator('.tab-title').filter({ hasText: '方案讨论' }).click()
  expect(await capture(page)).toBe(changed)
  await expect(page.locator('.writing-mermaid-svg')).toContainText('完成')
  await page.screenshot({ path: 'output/markdown-extensions-body.png', fullPage: true })
})

test('正文编辑、source 往返与跨页 undo/redo 保留三类扩展', async ({ page }) => {
  await boot(page); await bodyEdit(page)
  const changed = await capture(page)
  const source = await mode(page, true); await expect(source).toHaveValue(changed)
  await mode(page, false)
  await page.locator('.tab-title').filter({ hasText: '公式推导' }).click()
  await page.locator('.tab-title').filter({ hasText: '方案讨论' }).click()
  await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+z')
  expect(await capture(page)).toBe(sample)
  await page.keyboard.press('Control+y'); expect(await capture(page)).toBe(changed)
  await expect(page.locator('.writing-mermaid-svg')).toContainText('完成')
})

test('图表局部源码编辑与未完成输入有反馈，跨页和撤销不串异步结果', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: '编辑图表源码', exact: true }).click()
  const code = page.locator('.writing-mermaid .cm-content')
  await expect(code).toBeVisible(); await code.click(); await page.keyboard.press('Control+a')
  await page.keyboard.insertText('flowchart LR\n A[新的图] --> B[新的终点]')
  await expect(page.locator('.writing-mermaid-svg')).toContainText('新的终点')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.writing-mermaid-svg')).toContainText('完成')
  await page.keyboard.press('Control+y')
  await expect(page.locator('.writing-mermaid-svg')).toContainText('新的终点')
  await page.keyboard.press('Control+a'); await page.keyboard.insertText('flowchart LR\n A[')
  await expect(page.locator('.writing-mermaid-status')).toContainText('语法尚未完整')
  await page.locator('.tab-title').filter({ hasText: '公式推导' }).click()
  await expect(page.locator('.writing-mermaid')).toHaveCount(0)
  await page.locator('.tab-title').filter({ hasText: '方案讨论' }).click()
  await expect(page.locator('.writing-mermaid-status')).toContainText('语法尚未完整')
  expect(await capture(page)).toContain('A[')
})

test('source 修改图表快速切页后重建预览，五类提示块都可保存', async ({ page }) => {
  await boot(page)
  const source = await mode(page, true)
  const updated = sample.replace('B[完成]', 'B[更新终点]') + '\n> [!TIP]\n> 小提示\n\n> [!IMPORTANT]\n> 重要内容\n\n> [!CAUTION]\n> 危险内容\n'
  await source.fill(updated); await mode(page, false)
  await page.locator('.tab-title').filter({ hasText: '公式推导' }).click()
  await page.locator('.tab-title').filter({ hasText: '方案讨论' }).click()
  await expect(page.locator('.writing-mermaid-svg')).toContainText('更新终点')
  await expect(page.locator('.writing-alert')).toHaveCount(5)
  expect(await capture(page)).toBe(updated)
})

test('脚注定义正文可编辑，普通点击不打开外链而 Ctrl 点击沿现有回调', async ({ page }) => {
  await boot(page)
  const paragraph = page.locator('.writing-footnote-definition dd p').filter({ hasText: '第二段内容' })
  await paragraph.click(); await page.keyboard.press('End'); await page.keyboard.insertText('脚注修改')
  expect(await capture(page)).toContain('第二段内容。脚注修改')
  const link = page.locator('.writing-footnote-definition a')
  await link.click(); expect(await page.evaluate(() => window.__FROWD_TEST_HOST__.entered.open_document_link ?? 0)).toBe(0)
  await link.click({ modifiers: ['Control'] })
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.entered.open_document_link ?? 0)).toBe(1)
})

test('普通代码块改为 Mermaid 后立即渲染，撤销恢复普通代码块', async ({ page }) => {
  await boot(page, '```text\nflowchart LR\n A[语言修改] --> B[图表结果]\n```\n')
  await expect(page.locator('.writing-mermaid')).toHaveCount(0)
  await page.locator('.milkdown-code-block .language-button').click()
  await page.getByPlaceholder('代码语言').fill('Mermaid')
  await page.locator('.language-list-item').filter({ hasText: /^Mermaid$/i }).click()
  await expect(page.locator('.writing-mermaid-svg')).toBeVisible()
  await expect(page.locator('.writing-mermaid-svg')).toContainText('图表结果')
  await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+z')
  await expect(page.locator('.writing-mermaid')).toHaveCount(0)
  expect(await capture(page)).toContain('```text')
})

test('无图文稿不加载 Mermaid 运行时，首次图表按需加载', async ({ page }) => {
  const runtimeRequests = []
  page.on('request', request => {
    if (/(?:\/\.vite\/deps\/mermaid|\/node_modules\/mermaid\/)/.test(request.url())) runtimeRequests.push(request.url())
  })
  await boot(page, '结尾正文。\n\n普通无图文稿。\n')
  await bodyEdit(page); await page.waitForTimeout(300)
  expect(runtimeRequests).toEqual([])
  const source = await mode(page, true)
  await source.fill('```mermaid\nflowchart LR\n A[按需加载] --> B[本地图表]\n```\n')
  await mode(page, false)
  await expect(page.locator('.writing-mermaid-svg')).toBeVisible()
  expect(runtimeRequests.length).toBeGreaterThan(0)
})

test('共享 PDF 等待全部图表、脚注和提示块，生成文档无脚本或外部资源', async ({ page, context }) => {
  await boot(page)
  const external = []
  await context.route(/^https?:\/\/(?!127\.0\.0\.1:1441)/, route => { external.push(route.request().url()); return route.abort() })
  const html = await page.evaluate(async ({ markdown, pdfModule }) => {
    const { buildPdfDocument } = await import(pdfModule)
    return buildPdfDocument({ markdown, title: '合成导出' })
  }, { pdfModule, markdown: sample + '\n```Mermaid\nsequenceDiagram\n Alice->>Bob: 合成消息\n```\n' })
  const result = await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return { svg: doc.querySelectorAll('svg.writing-mermaid-svg').length, text: doc.body.textContent,
      notes: doc.querySelectorAll('.footnote-ref').length, alerts: doc.querySelectorAll('.writing-alert').length,
      unsafe: doc.querySelectorAll('script,iframe,foreignObject,image,svg a,[onclick],link,[src^="http"]').length,
      boxes: [...doc.querySelectorAll('svg.writing-mermaid-svg')].map(el => [el.getAttribute('viewBox'), el.getAttribute('width')]) }
  }, html)
  expect(result.svg).toBe(2); expect(result.text).toContain('完成'); expect(result.text).toContain('合成消息')
  expect(result.text).toContain('第二段内容'); expect(result.notes).toBe(2); expect(result.alerts).toBe(2)
  expect(result.text).toContain('未引用的定义也要保留')
  expect(result.unsafe).toBe(0); expect(result.boxes.every(box => box.every(Boolean))).toBe(true); expect(external).toEqual([])
  const print = await context.newPage()
  await print.setContent(html); await print.emulateMedia({ media: 'print' })
  await expect(print.locator('.writing-mermaid-svg')).toHaveCount(2)
  for (const svg of await print.locator('.writing-mermaid-svg').all()) await expect(svg).toBeVisible()
  await print.screenshot({ path: 'output/markdown-extensions-print.png', fullPage: true })
  await print.close()
})

test('恶意图表不发请求，错误图表阻止完整 PDF 导出，原始 SVG 边界不放宽', async ({ page, context }) => {
  const external = []
  await context.route(/^https?:\/\/(?!127\.0\.0\.1:1441)/, route => { external.push(route.request().url()); return route.abort() })
  await boot(page, '结尾正文。\n\n```mermaid\nflowchart LR\nA["<img src=https://evil.example/x>"]\n```\n')
  await expect(page.locator('.writing-mermaid-status')).toContainText('不支持 HTML')
  await expect(page.locator('.ProseMirror img')).toHaveCount(0)
  expect(external).toEqual([])
  const result = await page.evaluate(async pdfModule => {
    const { buildPdfDocument } = await import(pdfModule)
    let error
    try { await buildPdfDocument({ markdown: '```mermaid\nflowchart LR\nA[\n```' }) } catch (e) { error = e.message }
    const html = await buildPdfDocument({ markdown: '<svg><foreignObject><img src="https://evil.example/raw"></foreignObject><script>alert(1)</script><text>raw svg</text></svg>' })
    return { error, html }
  }, pdfModule)
  expect(result.error).toContain('Mermaid 图表无法导出'); expect(result.html).not.toContain('<foreignObject')
  expect(result.html).not.toContain('<script'); expect(result.html).not.toContain('evil.example'); expect(external).toEqual([])
})
