import { test, expect } from '@playwright/test'
import { startWritingPreview } from './browser-harness/start-preview.mjs'

let preview
test.beforeAll(async () => { preview = await startWritingPreview({ port: 0 }) })
test.afterAll(async () => { await preview?.server.close() })
async function open(page, markdown) {
  await page.addInitScript(markdown => localStorage.setItem('search-probe', markdown), markdown)
  await page.goto(preview.origin + '/__search')
  await expect(page.getByLabel('测试就绪')).toHaveText('ready')
}
const body = page => page.getByRole('textbox', { name: 'Markdown 正文', exact: true })

test('页内查找跨格式替换、清空高亮并保持一次撤销', async ({ page }) => {
  await open(page, '前ab**cd**ef后\n\nabcdef')
  await page.getByRole('button', { name: '替换正文', exact: true }).click()
  await page.getByRole('searchbox', { name: '查找正文' }).fill('abcdef')
  await expect(page.getByRole('search').getByRole('status')).toHaveText('1 / 2')
  await page.getByRole('textbox', { name: '替换为' }).fill('新内容')
  await page.getByRole('button', { name: '全部替换', exact: true }).click()
  await expect(body(page)).toContainText('前新内容后')
  await expect(body(page).locator('p').last()).toHaveText('新内容')
  await page.getByRole('button', { name: '关闭查找' }).click()
  await expect(page.locator('.writing-search-match')).toHaveCount(0)
  await body(page).click(); await page.keyboard.press('Control+z')
  await expect(body(page).locator('strong')).toHaveText('cd')
  await expect(body(page).locator('p').last()).toHaveText('abcdef')
})

test('源码查找替换支持native undo和后续富文本切换', async ({ page }) => {
  await open(page, 'first needle\n\nsecond needle')
  await page.getByRole('button', { name: '切换源码' }).click()
  await page.getByRole('button', { name: '替换正文', exact: true }).click()
  await page.getByRole('searchbox', { name: '查找正文' }).fill('needle')
  await expect(page.getByRole('search').getByRole('status')).toHaveText('1 / 2')
  await page.getByRole('button', { name: '下一个匹配' }).click()
  await expect(page.getByRole('search').getByRole('status')).toHaveText('2 / 2')
  const source = page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
  expect(await source.evaluate(input => [input.selectionStart, input.selectionEnd])).toEqual([21, 27])
  await page.getByRole('textbox', { name: '替换为' }).fill('changed')
  await page.getByRole('button', { name: '替换当前', exact: true }).click()
  await expect(source).toHaveValue('first needle\n\nsecond changed')
  await page.getByRole('button', { name: '关闭查找' }).click()
  await source.focus(); await page.keyboard.press('Control+z')
  await expect(source).toHaveValue('first needle\n\nsecond needle')
  await page.getByRole('button', { name: '切换源码' }).click()
  await expect(body(page)).toContainText('second needle')
})

test('公式与代码块内的匹配可替换并保持Markdown结构', async ({ page }) => {
  await open(page, '$x+x$\n\n```js\nconst x = 2\n```')
  await page.getByRole('button', { name: '替换正文', exact: true }).click()
  await page.getByRole('searchbox', { name: '查找正文' }).fill('x')
  await expect(page.getByRole('search').getByRole('status')).toHaveText('1 / 3')
  await page.getByRole('textbox', { name: '替换为' }).fill('y')
  await page.getByRole('button', { name: '全部替换', exact: true }).click()
  await page.getByRole('button', { name: '关闭查找' }).click()
  await page.getByRole('button', { name: '切换源码' }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown 源码', exact: true })).toHaveValue(/\$y\+y\$[\s\S]*```js\nconst y = 2/)
})

test('源码图片插入在原选区且可撤销', async ({ page }) => {
  await open(page, 'before AFTER')
  await page.getByRole('button', { name: '切换源码' }).click()
  const source = page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
  await source.evaluate(input => input.setSelectionRange(7, 12))
  await page.getByRole('button', { name: '插入测试图片' }).click()
  await expect(source).toHaveValue(/^before !\[测试图片\]\(_frowd-assets\/a{64}\.png\)$/)
  await source.focus(); await page.keyboard.press('Control+z')
  await expect(source).toHaveValue('before AFTER')
})
