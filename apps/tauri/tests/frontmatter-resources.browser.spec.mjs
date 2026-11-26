import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { installMockHost } from './mock-host.mjs'
const png = [...await readFile(new URL('./fixtures/synthetic-resource.png', import.meta.url))]
const missing = '.frowd-assets/' + 'd'.repeat(64) + '.png'
const yaml = ref => `---\nimage: ![PNG](${ref})\n---\n`
const body = page => page.locator('.ProseMirror:visible')
async function capture(page) {
  return page.locator('.pm-port').evaluate(el => { const c = el.__vueParentComponent.exposed.capture(); return { markdown: c.markdown, selection: c.pm.state.selection.toJSON() } })
}
async function boot(page, targetMarkdown = 'B before\n\nB target\n\nB after\n') {
  await page.addInitScript(installMockHost, { documents: [
    { id: 'a', title: 'A', markdown: 'A body\n', shelved: false },
    { id: 'b', title: 'B', markdown: targetMarkdown, shelved: false },
  ] })
  await page.goto('/?testHost=1'); await expect(page.locator('.loading-state')).toHaveCount(0)
  await expect(body(page)).toHaveAttribute('contenteditable', 'true')
}
async function mode(page, source) {
  await page.getByText('视图', { exact: true }).click()
  await page.locator('.menu-popup button').filter({ hasText: source ? '源码' : '正文' }).first().click()
  return page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
}
async function target(page) {
  await page.locator('[data-tab-id="b"] .tab-title').click()
  await expect(body(page)).toHaveAttribute('contenteditable', 'true')
  await body(page).locator('p').filter({ hasText: /^B target$/ }).click(); await page.keyboard.press('Home')
}
async function paste(page, data) {
  await body(page).evaluate((el, { text, html }) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', text)
    if (html) clipboardData.setData('text/html', html)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  }, data)
}
async function copyKnownYaml(page) {
  await body(page).locator('p').click(); await page.keyboard.press('End')
  await body(page).evaluate((el, bytes) => {
    const clipboardData = new DataTransfer()
    clipboardData.items.add(new File([new Uint8Array(bytes)], 'PNG.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  }, png)
  await expect(body(page).locator('img[data-editor-image-src]')).toHaveJSProperty('naturalWidth', 240)
  const ref = await page.evaluate(() => [...window.__FROWD_TEST_HOST__.bindings.get('a')][0])
  const source = await mode(page, true); await source.fill(yaml(ref) + '\nA body\n'); await mode(page, false)
  await body(page).locator('.writing-frontmatter').click()
  const copied = await body(page).evaluate(el => {
    const clipboardData = new DataTransfer()
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }))
    return { text: clipboardData.getData('text/plain'), html: clipboardData.getData('text/html') }
  })
  expect(copied.html).toContain('data-writing-frontmatter')
  expect(copied.text).toContain(ref)
  return { copied, ref }
}

test('non-leading YAML plain paste rejects unknown resources before changing the document', async ({ page }) => {
  await boot(page); await target(page)
  const before = await capture(page)
  await paste(page, { text: yaml(missing) })
  await expect(page.getByRole('alert')).toContainText('重新导入')
  expect(await capture(page)).toEqual(before)
  expect(await page.evaluate(() => window.__FROWD_TEST_HOST__.entered.reuse_resources || 0)).toBe(1)
  await expect(body(page).locator('img')).toHaveCount(0)
})

for (const format of ['html', 'plain']) test(`a copied YAML atom reuses A resources before inserting real images into B prose (${format})`, async ({ page }) => {
  await boot(page, `B before [unrelated](${missing})\n\nB target\n\nB after\n`)
  const { copied, ref } = await copyKnownYaml(page); await target(page)
  if (format === 'plain') copied.html = ''
  const before = await capture(page)
  await page.evaluate(() => window.__FROWD_TEST_HOST__.holds.add('reuse_resources'))
  await paste(page, copied)
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.entered.reuse_resources || 0)).toBe(1)
  expect(await capture(page)).toEqual(before)
  await expect(body(page)).toHaveAttribute('contenteditable', 'false')
  await expect(page.locator('.pm-port')).toHaveJSProperty('inert', true)
  await page.evaluate(() => window.__FROWD_TEST_HOST__.release('reuse_resources'))
  await expect(body(page).locator('img[data-editor-image-src]')).toHaveJSProperty('naturalWidth', 240)
  expect(await page.evaluate(ref => window.__FROWD_TEST_HOST__.bindings.get('b')?.has(ref), ref)).toBe(true)
  expect(await page.evaluate(() => window.__FROWD_TEST_HOST__.calls.filter(c => c.command === 'reuse_resources').map(c => c.args.references))).toEqual([[{ reference: ref, image: true }]])
  const after = await capture(page)
  await body(page).press('Control+z'); await expect.poll(async () => (await capture(page)).markdown).toBe(before.markdown)
  await body(page).press('Control+y'); await expect.poll(async () => (await capture(page)).markdown).toBe(after.markdown)
})

test('non-leading copied YAML HTML rejects unknown resources as a whole', async ({ page }) => {
  await boot(page); const { copied, ref } = await copyKnownYaml(page); await target(page)
  copied.html = copied.html.replaceAll(ref, missing); copied.text = copied.text.replaceAll(ref, missing)
  const before = await capture(page)
  await paste(page, copied)
  await expect(page.getByRole('alert')).toContainText('重新导入')
  expect(await capture(page)).toEqual(before)
  expect(await page.evaluate(() => window.__FROWD_TEST_HOST__.bindings.get('b')?.size || 0)).toBe(0)
})

for (const known of [false, true]) test(`YAML resource preparation uses effective table cells (known=${known})`, async ({ page }) => {
  await boot(page)
  const data = known ? await copyKnownYaml(page) : { copied: { text: yaml(missing) }, ref: missing }
  await target(page)
  const source = await mode(page, true); await source.fill('| Keep | Target |\n| --- | --- |\n| retained | cell |\n'); await mode(page, false)
  await body(page).locator('td').filter({ hasText: 'cell' }).locator('p').click({ clickCount: known ? 3 : 1, position: { x: 6, y: 12 } })
  const before = await capture(page)
  await paste(page, data.copied)
  if (known) {
    await expect(body(page).locator('td img[data-editor-image-src]')).toHaveJSProperty('naturalWidth', 240)
    await expect(body(page).locator('table.children')).toHaveCount(1)
    await expect(body(page).locator('table.children td').first()).toHaveText('retained')
    const requests = await page.evaluate(() => window.__FROWD_TEST_HOST__.calls.filter(c => c.command === 'reuse_resources').map(c => c.args.references))
    expect(requests).toEqual([[{ reference: data.ref, image: true }]])
    await body(page).press('Control+z'); await expect.poll(async () => (await capture(page)).markdown).toBe(before.markdown)
  } else {
    await expect(page.getByRole('alert')).toContainText('重新导入')
    expect(await capture(page)).toEqual(before)
  }
})

test('leading YAML retains inert resource spelling and does not bind or render images', async ({ page }) => {
  await boot(page)
  const source = await mode(page, true); await source.fill(''); await mode(page, false)
  await body(page).locator('p').click()
  await paste(page, { text: yaml(missing) + '\nBody' })
  await expect(body(page).locator('.writing-frontmatter')).toContainText(missing)
  await expect(body(page).locator('img[data-editor-image-src]')).toHaveCount(0)
  expect(await page.evaluate(() => window.__FROWD_TEST_HOST__.entered.reuse_resources || 0)).toBe(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

for (const operation of ['drag', 'paragraph-before']) test(`moving resource-bearing YAML cannot bypass qualification (${operation})`, async ({ page }) => {
  await boot(page)
  const source = await mode(page, true); await source.fill(yaml(missing) + '\nA body\n\nTarget paragraph\n'); await mode(page, false)
  const before = (await capture(page)).markdown
  const block = body(page).locator('.writing-frontmatter-block')
  await block.locator('pre').click()
  if (operation === 'drag') await block.dragTo(body(page).locator('p').filter({ hasText: 'Target paragraph' }))
  else await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText('复制或剪切')
  expect((await capture(page)).markdown).toBe(before)
  await expect(body(page).locator('img[data-editor-image-src]')).toHaveCount(0)
  expect(await page.evaluate(() => window.__FROWD_TEST_HOST__.entered.reuse_resources || 0)).toBe(0)
  await page.locator('[data-tab-id="b"] .tab-title').click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
