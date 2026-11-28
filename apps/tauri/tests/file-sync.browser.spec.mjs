import {test, expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'

const bound = {id:'a', title:'文件 A', path:'/synthetic/a.md', markdown:'# A 原文'}
const second = {id:'b', title:'文件 B', path:'/synthetic/b.markdown', markdown:'# B 原文'}
const draft = {id:'c', title:'草稿 C', markdown:'# C 原文'}
const body = page => page.locator('.ProseMirror:visible')
const status = page => page.getByRole('status', {name:'保存状态'})
const tab = (page, id) => page.locator(`[data-tab-id="${id}"] .tab-title`)
const row = (page, id) => page.evaluate(id => window.__FROWD_TEST_HOST__.rows.get(id), id)
async function boot(page, documents = [bound, second, draft], options = {}) {
  await page.addInitScript(installMockHost, {...options, documents})
  await page.goto('/?testHost=1')
  await expect(page.locator('.loading-state')).toHaveCount(0)
}
async function append(page, text) {
  await expect(body(page)).toHaveAttribute('contenteditable', 'true')
  await body(page).locator('h1').evaluate(heading => {
    heading.closest('[contenteditable=true]').focus()
    getSelection().collapse(heading.lastChild, heading.lastChild.length)
  })
  await page.keyboard.insertText(text)
}
const calls = page => page.evaluate(() => window.__FROWD_TEST_HOST__.calls.map(call => call.command))

test('debounced file sync follows SQLite and clean close removes only the page', async ({page}) => {
  await boot(page, [bound, draft], {holds:['sync_document_file']})
  await append(page, ' 停顿写盘')
  for (let i=0;i<3;i++) await page.keyboard.press('Enter')
  await page.keyboard.insertText('下一段')
  await expect(status(page)).toHaveText('正在同步到文件…')
  expect((await row(page, 'a')).markdown).toContain('停顿写盘')
  expect((await row(page, 'a')).savedText).toBe(bound.markdown)
  await page.evaluate(() => window.__FROWD_TEST_HOST__.release('sync_document_file'))
  await expect(status(page)).toHaveText('已保存到文件')
  expect((await row(page, 'a')).savedText).toBe('# A 原文 停顿写盘\n\n\n\n下一段\n')
  await page.getByRole('button', {name:'关闭页面 文件 A', exact:true}).click()
  await expect(tab(page, 'a')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(status(page)).toHaveText('草稿已暂存')
  expect(await calls(page)).not.toContain('save_document')
})

test('switching and shelving sync the outgoing file; close checks its target conflict', async ({page}) => {
  await boot(page)
  await expect(body(page)).toContainText('A 原文')
  await append(page, ' 切页前')
  await tab(page, 'b').click()
  await expect(body(page)).toContainText('B 原文')
  expect((await row(page, 'a')).savedText).toContain('切页前')
  await page.evaluate(() => window.__FROWD_TEST_HOST__.externalTexts.set('b', '外部版本'))
  await append(page, ' 本地版本')
  await page.getByRole('button', {name:'标签收起 文件 B', exact:true}).click()
  await expect(body(page)).toContainText('C 原文')
  expect(await row(page, 'b')).toMatchObject({savedText:second.markdown, conflict:true, shelved:true})
  await page.getByRole('button', {name:'页面菜单 文件 B', exact:true}).click()
  await page.getByRole('menuitem', {name:'移除页面…'}).click()
  await expect(page.getByRole('dialog')).toContainText('文件 B')
  await expect(page.getByRole('button', {name:'另存为', exact:true})).toBeVisible()
  await page.getByRole('button', {name:'取消', exact:true}).click()
  await page.locator('.shelved-row[data-page-id="b"] .page-title').click()
  await expect(status(page)).toHaveText('外部文件已变更，未自动覆盖（请另存为）')
  await expect(body(page)).toContainText('本地版本')
})

for (const action of ['收起其他页面', '收起全部页面']) test(`${action} syncs the active file before changing layout`, async ({page}) => {
  await boot(page)
  await expect(body(page)).toContainText('A 原文')
  await append(page, ' 收起前')
  await page.getByRole('button', {name:'页面菜单 文件 B', exact:true}).click()
  await page.getByRole('menuitem', {name:action, exact:true}).click()
  await expect(tab(page, 'a')).toHaveCount(0)
  expect((await row(page, 'a')).savedText).toContain('收起前')
  const sequence = await calls(page)
  expect(sequence.indexOf('sync_document_file')).toBeLessThan(sequence.indexOf(action === '收起全部页面' ? 'shelve_all' : 'shelve_others'))
})

for (const action of ['close', 'update']) test(`normal ${action} attempts file sync before checkpoint`, async ({page}) => {
  await boot(page, [bound, draft], {holds:['sync_document_file']})
  await expect(body(page)).toContainText('A 原文')
  if (action === 'update') {
    await page.locator('.app-menu summary').filter({hasText:'文件'}).click()
    await page.getByRole('button', {name:'检查更新…'}).click()
    await expect(page.getByRole('button', {name:'立即更新'})).toBeVisible()
  }
  await append(page, ' 退出前')
  if (action === 'close') await page.evaluate(() => { window.__FROWD_TEST_HOST__.requestClose() })
  else await page.getByRole('button', {name:'立即更新'}).click()
  await expect.poll(async () => (await calls(page)).includes('sync_document_file')).toBe(true)
  expect(await calls(page)).not.toContain('checkpoint')
  await page.evaluate(() => {
    const host = window.__FROWD_TEST_HOST__
    host.fail = 'sync_document_file'
    host.release('sync_document_file')
  })
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.closed)).toBe(true)
  expect((await row(page, 'a')).markdown).toContain('退出前')
  expect((await row(page, 'a')).savedText).toBe(bound.markdown)
  const sequence = await calls(page)
  expect(sequence.indexOf('update_document')).toBeLessThan(sequence.indexOf('sync_document_file'))
  expect(sequence.indexOf('sync_document_file')).toBeLessThan(sequence.indexOf('checkpoint'))
  expect(sequence.indexOf('checkpoint')).toBeLessThan(sequence.indexOf(action === 'close' ? 'close_ready' : 'install_update'))
})

for (const viewState of [null, {mode:'rendered', scrollTop:0}]) test(`cold long file enters source and keeps undo (${viewState?.mode ?? 'new'})`, async ({page}) => {
  const markdown = '# 长文标题\n\n' + '合成行\n'.repeat(20_000)
  await boot(page, [{...bound, markdown, bodyInDb:false, viewState}, draft])
  const source = page.getByRole('textbox', {name:'Markdown 源码'})
  await expect(source).toBeVisible()
  await expect(page.getByText('长文源码模式', {exact:true})).toBeVisible()
  const hasSession = () => page.locator('.pm-port').evaluate(el => Boolean(el.__vueParentComponent.exposed.capture()?.pm))
  expect(await hasSession()).toBe(false)
  await page.getByRole('button', {name:'大纲', exact:true}).click()
  await expect(page.getByText('长文源码模式下暂停生成大纲')).toBeVisible()
  await source.focus()
  await page.keyboard.press('Control+Home')
  await page.keyboard.insertText('源码新正文')
  expect((await source.inputValue()).startsWith('源码新正文')).toBe(true)
  await source.press('Control+z')
  expect(await source.inputValue()).toBe(markdown)
  expect(await hasSession()).toBe(false)
  await source.evaluate(el => {
    el.value = '# 按需生成正文\n\n\n正文空行'
    el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertReplacementText'}))
  })
  await source.press('Control+/')
  await expect(body(page).locator('h1')).toHaveText('按需生成正文')
  await expect(body(page).locator(':scope > p').filter({hasText:/^$/})).toHaveCount(1)
  expect(await hasSession()).toBe(true)
})

test('a missing dehydrated file leaves the workspace usable on startup, selection and removal', async ({page}) => {
  await page.addInitScript(installMockHost, {
    documents: [{...bound, bodyInDb:false}, draft],
    missingFiles: ['a'],
  })
  await page.goto('/?testHost=1')
  await expect(page.getByRole('alert')).toContainText('原文件不可用')
  await tab(page, 'c').click()
  await expect(body(page)).toContainText('C 原文')
  await tab(page, 'a').click()
  await expect(page.getByRole('alert')).toContainText('原文件不可用')
  await page.getByRole('button', {name:'关闭页面 文件 A', exact:true}).click()
  await page.getByRole('button', {name:'不保存', exact:true}).click()
  await expect(body(page)).toContainText('C 原文')
  await page.evaluate(() => window.__FROWD_TEST_HOST__.requestClose())
  expect(await page.evaluate(() => window.__FROWD_TEST_HOST__.closed)).toBe(true)
})
