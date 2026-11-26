import { test, expect } from '@playwright/test'
import { installMockHost } from './mock-host.mjs'
import { yamlHeader, yamlMarkdown } from '../../../tests/fixtures/writing-frontmatter.mjs'
import { fileURLToPath } from 'node:url'
const pdfModule = '/@fs/' + fileURLToPath(new URL('../../../packages/editor/src/markdown/pdfDocument.js', import.meta.url)).replaceAll('\\', '/')

async function boot(page, markdown = yamlMarkdown) {
  await page.addInitScript(installMockHost, { markdown })
  await page.goto('/?testHost=1')
  await expect(page.locator('.ProseMirror')).toBeVisible()
}
async function capture(page) {
  return page.locator('.pm-port').evaluate(el => el.__vueParentComponent.exposed.capture().markdown)
}
async function mode(page, source) {
  await page.getByText('视图', { exact: true }).click()
  await page.locator('.menu-popup button').filter({ hasText: source ? '源码' : '正文' }).first().click()
  return page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
}

test('YAML is a literal metadata block and body edits preserve its original bytes', async ({ page }) => {
  await boot(page)
  await expect(page.locator('.writing-frontmatter')).toBeVisible()
  await expect(page.locator('.ProseMirror h2,.ProseMirror hr')).toHaveCount(0)
  await expect(page.locator('.ProseMirror h1')).toHaveText('Agent Memory')
  expect(await capture(page)).toBe(yamlMarkdown)
  await page.locator('.ProseMirror > p').filter({ hasText: '正文结尾' }).click()
  await page.keyboard.press('End'); await page.keyboard.insertText('追加')
  const changed = await capture(page)
  expect(changed.startsWith(yamlHeader)).toBe(true)
  expect(changed).toContain('正文结尾。追加')
  const source = await mode(page, true)
  await expect(source).toHaveValue(changed.replace(/\r\n/g, '\n'))
  await mode(page, false)
  expect(await capture(page)).toBe(changed)
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.rows.get('a').savedText)).toBe(changed)
  await page.locator('.ProseMirror > p').last().click(); await page.keyboard.press('Control+z')
  expect(await capture(page)).toBe(yamlMarkdown)
})

test('source body edits and replacements keep CRLF metadata and use textarea coordinates', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: '编辑 YAML 源码', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
  expect(await capture(page)).toBe(yamlMarkdown)
  await source.fill((await source.inputValue()) + '\n新增正文。')
  expect((await capture(page)).startsWith(yamlHeader)).toBe(true)
  await page.locator('.pm-port').evaluate(el => el.__vueParentComponent.exposed.findReplace('正文结尾', 0, true, true))
  expect(await source.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('正文结尾')
  await page.locator('.pm-port').evaluate(el => el.__vueParentComponent.exposed.replaceFind('正文结尾', '正文替换', 0, false, true))
  expect((await capture(page)).startsWith(yamlHeader)).toBe(true)
  await expect(source).toHaveValue(/正文替换。/)
  await source.press('Control+z'); await expect(source).toHaveValue(/正文结尾。/)
  expect((await capture(page)).startsWith(yamlHeader)).toBe(true)
  await mode(page, false)
  await expect(page.locator('.ProseMirror > p')).toContainText(['正文结尾。', '新增正文。'])
})

test('YAML source editing, source undo and body undo retain metadata across page switches and fresh loads', async ({ page, context }) => {
  await boot(page, yamlMarkdown.replaceAll('\r\n', '\n'))
  const initial = await capture(page)
  await page.getByRole('button', { name: '编辑 YAML 源码', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
  await expect(source).toBeFocused()
  await page.keyboard.press('Control+/')
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await page.getByRole('button', { name: '编辑 YAML 源码', exact: true }).click()
  await expect(source).toBeFocused()
  const changed = initial.replace('agent-memory', 'changed-name').replace('保存已核实的结论。', '保留两行缩进。')
  await source.fill(changed)
  await source.press('Control+z'); await expect(source).toHaveValue(initial)
  await source.press('Control+y'); await expect(source).toHaveValue(changed)
  await mode(page, false)
  await expect(page.locator('.writing-frontmatter')).toContainText('changed-name')
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.rows.get('a').savedText)).toBe(changed)
  await page.locator('.tab-title').filter({ hasText: '公式推导' }).click()
  await page.locator('.tab-title').filter({ hasText: '方案讨论' }).click()
  expect(await capture(page)).toBe(changed)
  await page.locator('.ProseMirror > p').last().click(); await page.keyboard.press('Control+z')
  expect(await capture(page)).toBe(initial)
  await page.keyboard.press('Control+y'); expect(await capture(page)).toBe(changed)
  const reopened = await context.newPage(); await boot(reopened, changed)
  expect(await capture(reopened)).toBe(changed)
  await expect(reopened.locator('.writing-frontmatter')).toContainText('  保留两行缩进。')
  await reopened.close()
})

test('YAML light/dark layout, body navigation and complete PDF stay literal and make no resource requests', async ({ page, context, baseURL }, testInfo) => {
  const raw = '---\nname: agent-memory\ndescription: >-\n  这是第一行。\n  这是第二行。\nhtml: <img src="https://invalid.example/yaml.png" onerror="alert(1)">\nformula: \\(x\\)\n# hidden heading\n...\n\n'
  const markdown = raw + '# Agent Memory\n\n正文目标。\n'
  const external = [], origin = new URL(baseURL).origin
  await context.route(url => /^https?:$/.test(url.protocol) && url.origin !== origin, route => { external.push(route.request().url()); return route.abort() })
  await boot(page, markdown)
  const block = page.locator('.writing-frontmatter')
  expect(await block.textContent()).toBe(raw.trimEnd())
  await expect(block).toHaveCSS('white-space', 'pre-wrap')
  await expect(block).toHaveCSS('font-size', '16px')
  await expect(page.locator('.writing-frontmatter img,.writing-frontmatter .katex')).toHaveCount(0)
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: '阅读设置', exact: true }).click()
    await page.getByRole('combobox', { name: '主题', exact: true }).selectOption(theme)
    await page.getByRole('button', { name: '关闭阅读设置', exact: true }).click()
    await expect(page.locator('.writing-frontmatter-block')).toHaveCSS('background-color', theme === 'light' ? 'rgb(247, 246, 243)' : 'rgb(38, 38, 40)')
    await page.screenshot({ path: testInfo.outputPath(`yaml-${theme}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: '大纲', exact: true }).click()
  await expect(page.locator('.outline-list button')).toHaveText(['Agent Memory'])
  await page.getByRole('button', { name: 'Agent Memory', exact: true }).click()
  expect(await page.locator('.pm-port').evaluate(el => el.__vueParentComponent.exposed.capture().pm.state.selection.$from.parent.type.name)).toBe('heading')
  const found = await page.locator('.pm-port').evaluate(el => {
    const port = el.__vueParentComponent.exposed
    return port.revealMatch({ line: 13, column: 0, needle: '正文目标' }).then(() => port.capture().pm.state.selection.$from.parent.textContent)
  })
  expect(found).toBe('正文目标。')
  const html = await page.evaluate(async ({ pdfModule, markdown }) => (await import(pdfModule)).buildPdfDocument({ markdown, resolveImage() { throw Error('YAML must not resolve resources') } }), { pdfModule, markdown })
  const print = await context.newPage(); await print.setContent(html); await print.emulateMedia({ media: 'print' })
  expect(await print.locator('.writing-frontmatter').textContent()).toBe(raw.trimEnd())
  await expect(print.locator('img,.katex,script')).toHaveCount(0)
  await expect(print.locator('h1')).toHaveText('Agent Memory')
  await expect(print.locator('.writing-frontmatter')).toHaveCSS('white-space', 'pre-wrap')
  await print.screenshot({ path: testInfo.outputPath('yaml-print.png'), fullPage: true })
  expect(external).toEqual([])
  await print.close()
})

test('ordinary rules, Setext headings, fenced YAML and unclosed prefixes retain body meaning', async ({ page }) => {
  const markdown = '---\nname: unclosed\n\n# Body\n\nSetext\n---\n\n```yaml\n---\nx: y\n---\n```\n\n---\n'
  // With a later closing fence this would be metadata by the documented rule.
  // Test an actually unclosed prefix separately from ordinary body constructs.
  await boot(page, '---\nname: unclosed\n\n# Body\n')
  await expect(page.locator('.writing-frontmatter')).toHaveCount(0)
  await expect(page.locator('.ProseMirror h1')).toHaveText('Body')
  const source = await mode(page, true); await source.fill(markdown.slice(markdown.indexOf('# Body')))
  await mode(page, false)
  await expect(page.locator('.writing-frontmatter')).toHaveCount(0)
  await expect(page.locator('.ProseMirror h2')).toHaveText('Setext')
  await expect(page.locator('.ProseMirror hr')).toHaveCount(1)
  await expect(page.locator('.milkdown-code-block')).toContainText('x: y')
})
