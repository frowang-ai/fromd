import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { DocumentStore } from '../apps/desktop/src/main/documentStore.js'
import { bindMenu, editorReady, menuCommand } from './native-menu.mjs'
const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const body = page => page.getByRole('textbox', { name: 'Markdown 正文', exact: true })
const link = (page, name) => body(page).getByRole('link', { name, exact: true })
async function fixture({ draft = false, two = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'frowd-links-')), profile = join(directory, 'profile')
  const folder = join(directory, '附件'); await mkdir(folder)
  const file = join(folder, '研究计划 #1.docx'); await writeFile(file, 'synthetic document')
  const markdown = `# 链接样本\n\n| 类型 | 链接 |\n| --- | --- |\n| 网页 | [网页](https://example.com/frowd?q=1#part) |\n| 文件 | [文件URL](${pathToFileURL(file).href}) |\n\n[相对文件](./附件/研究计划%20%231.docx)\n\n[文件夹](./附件)\n\n[绝对路径](<${file.replaceAll('\\', '/').replaceAll('#', '%23')}>)\n\n[不存在](./missing.pdf)\n\n[不支持](ms-word:ofe)\n\n可选择的普通文字。`
  const note = join(directory, '笔记A.md'); await writeFile(note, markdown)
  const store = new DocumentStore(profile)
  let secondFile, secondNote
  try {
    await store.restore()
    if (draft) await store.update(store.activeId, markdown, 1)
    else await store.openFile(note)
    if (two) {
      const second = join(directory, '另一个位置'); await mkdir(join(second, '附件'), { recursive: true })
      secondFile = join(second, '附件', '研究计划 #1.docx'); await writeFile(secondFile, 'another document')
      secondNote = join(second, '笔记B.md'); await writeFile(secondNote, markdown)
      await store.openFile(secondNote)
    }
  } finally { await store.dispose() }
  const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ ...(process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: [] } : { args: [root] }), env, timeout: 30000 })
  const page = await app.firstWindow(); bindMenu(app, page); await editorReady(page)
  // Only observe the final OS dispatch; parser, sender checks, IPC, stat and document ownership are real.
  await app.evaluate(({ shell }) => {
    globalThis.__linkCalls = []
    shell.openExternal = async target => { globalThis.__linkCalls.push(['web', target]) }
    shell.openPath = async target => { globalThis.__linkCalls.push(['folder', target]); return '' }
    shell.showItemInFolder = target => { globalThis.__linkCalls.push(['reveal', target]) }
  })
  return { directory, file, folder, note, secondFile, secondNote, app, page }
}
async function cleanup(app, directory) {
  const child = app.process()
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve))
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await exited
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
const calls = app => app.evaluate(() => globalThis.__linkCalls)

test('普通单击可编辑链接文字，Ctrl单击打开网页且不重复触发', async () => {
  const { directory, app, page } = await fixture()
  try {
    const before = await page.evaluate(async () => window.desktop.read((await window.desktop.listMetadata()).activeId))
    await link(page, '网页').click()
    await page.evaluate(() => window.desktop.listMetadata())
    expect(await calls(app)).toEqual([])
    await page.keyboard.insertText('EDIT')
    await expect(body(page).locator('a[href="https://example.com/frowd?q=1#part"]')).toContainText('EDIT')
    await page.keyboard.press('Control+z')
    await expect(link(page, '网页')).toBeVisible()
    await link(page, '网页').click({ modifiers: ['Control'] })
    await expect.poll(() => calls(app)).toEqual([['web', 'https://example.com/frowd?q=1#part']])
    const after = await page.evaluate(id => window.desktop.read(id), before.id)
    expect(after.markdown).toBe(before.markdown)
  } finally { await cleanup(app, directory) }
})

test('file URL、绝对路径、相对文件只定位；目录才通过openPath进入', async () => {
  const { directory, file, folder, app, page } = await fixture()
  try {
    for (const [index, name] of ['文件URL', '绝对路径', '相对文件'].entries()) {
      await link(page, name).click({ modifiers: ['Control'] })
      await expect.poll(() => calls(app)).toHaveLength(index + 1)
    }
    expect(await calls(app)).toEqual(Array.from({ length: 3 }, () => ['reveal', file]))
    // Sanitization is kept: local destinations never become a navigable file:// href.
    await expect(link(page, '文件URL')).toHaveAttribute('href', '')
    await link(page, '文件夹').click({ modifiers: ['Control'] })
    await expect.poll(() => calls(app)).toEqual([...Array.from({ length: 3 }, () => ['reveal', file]), ['folder', await realpath(folder)]])
  } finally { await cleanup(app, directory) }
})

test('未保存草稿相对路径提示先保存；绝对链接仍能定位，错误明确展示', async () => {
  const { directory, file, app, page } = await fixture({ draft: true })
  try {
    await link(page, '相对文件').click({ modifiers: ['Control'] })
    await expect(page.getByRole('alert')).toContainText('请先保存为 Markdown 文件，或改用绝对路径')
    expect(await calls(app)).toEqual([])
    await page.getByRole('button', { name: '关闭提示', exact: true }).click()
    await link(page, '文件URL').click({ modifiers: ['Control'] })
    await expect.poll(() => calls(app)).toEqual([['reveal', file]])
    await link(page, '不支持').click({ modifiers: ['Control'] })
    await expect(page.getByRole('alert')).toContainText('目前只支持网页和本地文件')
  } finally { await cleanup(app, directory) }
})

test('不存在的文件不会打开程序，浏览器和目录打开失败有提示', async () => {
  const { directory, app, page } = await fixture()
  try {
    await link(page, '不存在').click({ modifiers: ['Control'] })
    await expect(page.getByRole('alert')).toContainText('链接目标不存在')
    expect(await calls(app)).toEqual([])
    await app.evaluate(({ shell }) => {
      shell.openExternal = async () => { throw new Error('controlled failure') }
      shell.openPath = async () => 'controlled failure'
    })
    await link(page, '网页').click({ modifiers: ['Control'] }); await expect(page.getByRole('alert')).toContainText('默认浏览器设置')
    await link(page, '文件夹').click({ modifiers: ['Control'] }); await expect(page.getByRole('alert')).toContainText('无法打开文件夹')
  } finally { await cleanup(app, directory) }
})

test('切换笔记与另存为后，相同相对链接使用所属笔记的最新目录', async () => {
  const { directory, file, secondFile, app, page } = await fixture({ two: true })
  try {
    await link(page, '相对文件').click({ modifiers: ['Control'] })
    await expect.poll(() => calls(app)).toEqual([['reveal', secondFile]])
    await page.getByRole('tab', { name: '笔记A.md', exact: true }).click(); await editorReady(page)
    await link(page, '相对文件').click({ modifiers: ['Control'] })
    await expect.poll(() => calls(app)).toEqual([['reveal', secondFile], ['reveal', file]])
    const destination = join(directory, '另一个位置', '另存.md')
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, destination)
    await menuCommand(page, 'saveAs'); await editorReady(page)
    await expect(page.getByRole('tab', { name: '另存.md', exact: true })).toHaveAttribute('aria-selected', 'true')
    await link(page, '相对文件').click({ modifiers: ['Control'] })
    await expect.poll(() => calls(app)).toEqual([['reveal', secondFile], ['reveal', file], ['reveal', secondFile]])
  } finally { await cleanup(app, directory) }
})

test('浮层地址单击编辑，打开按钮与Ctrl单击执行目标，复制仍可用', async () => {
  const { directory, file, app, page } = await fixture()
  try {
    await body(page).locator('h1').click()
    await link(page, '文件URL').hover()
    const preview = page.locator('.milkdown-link-preview')
    await expect(preview.locator('.link-display')).toBeVisible()
    await preview.locator('.link-display').click()
    const address = page.locator('.milkdown-link-edit input')
    await expect(address).toBeVisible()
    expect(await calls(app)).toEqual([])
    await address.press('Escape')
    await body(page).locator('h1').click(); await link(page, '文件URL').hover()
    await preview.getByRole('button', { name: '打开位置', exact: true }).click()
    await expect.poll(() => calls(app)).toEqual([['reveal', file]])
    await page.evaluate(() => { window.__copiedLink = null; navigator.clipboard.writeText = async text => { window.__copiedLink = text } })
    await body(page).locator('h1').click()
    await link(page, '文件URL').hover(); await expect(preview.locator('.link-icon')).toBeVisible()
    await preview.locator('.link-icon').click()
    await expect.poll(() => page.evaluate(() => window.__copiedLink)).toBe(pathToFileURL(file).href)
    await preview.locator('.link-edit-button').click()
    const edit = page.locator('.milkdown-link-edit input')
    await expect(edit).toBeVisible()
    await edit.fill('https://example.com/edited'); await edit.press('Enter')
    await expect(link(page, '文件URL')).toHaveAttribute('href', 'https://example.com/edited')
    expect(await calls(app)).toHaveLength(1)
    await link(page, '文件URL').click({ modifiers: ['Control'] })
    await expect.poll(() => calls(app)).toEqual([['reveal', file], ['web', 'https://example.com/edited']])
    await body(page).locator('h1').click(); await link(page, '文件URL').hover()
    await preview.getByRole('button', { name: '打开网页', exact: true }).click()
    await expect.poll(() => calls(app)).toHaveLength(3)
    await body(page).locator('h1').click(); await link(page, '文件URL').hover()
    await preview.locator('.link-display').click({ modifiers: ['Control'] })
    await expect.poll(() => calls(app)).toEqual([['reveal', file], ...Array.from({ length: 3 }, () => ['web', 'https://example.com/edited'])])
  } finally { await cleanup(app, directory) }
})

test('本地链接不改直接确认与改为文件URL或盘符地址均保留原始目的地', async () => {
  const { directory, file, app, page } = await fixture()
  try {
    const replacement = join(directory, '备选计划.pdf'); await writeFile(replacement, 'synthetic PDF')
    const before = await page.evaluate(async () => window.desktop.read((await window.desktop.listMetadata()).activeId))
    async function editLocal(value, button = false) {
      await body(page).locator('h1').click(); await link(page, '文件URL').hover()
      await page.locator('.milkdown-link-preview .link-edit-button').click()
      const input = page.locator('.milkdown-link-edit input')
      await expect(input).toBeVisible()
      if (value !== undefined) await input.fill(value)
      if (button) await page.locator('.milkdown-link-edit .confirm').click()
      else await input.press('Enter')
      await expect(input).not.toBeVisible()
    }
    await editLocal(undefined)
    await link(page, '文件URL').click({ modifiers: ['Control'] })
    await expect.poll(() => calls(app)).toEqual([['reveal', file]])
    expect((await page.evaluate(id => window.desktop.read(id), before.id)).markdown).toBe(before.markdown)
    const url = pathToFileURL(replacement).href
    await editLocal(url, true)
    await link(page, '文件URL').click({ modifiers: ['Control'] })
    await expect.poll(() => calls(app)).toEqual([['reveal', file], ['reveal', replacement]])
    await expect.poll(async () => (await page.evaluate(id => window.desktop.read(id), before.id)).markdown).toContain(url)
    await editLocal(replacement.replaceAll('\\', '/'))
    await link(page, '文件URL').click({ modifiers: ['Control'] })
    await expect.poll(() => calls(app)).toEqual([['reveal', file], ['reveal', replacement], ['reveal', replacement]])
    await expect(link(page, '文件URL')).toHaveAttribute('href', '')
  } finally { await cleanup(app, directory) }
})

test('拖选链接文字和Shift选区不会打开目标，过期浮层不借用新笔记目录', async () => {
  const { directory, app, page } = await fixture({ two: true })
  try {
    await body(page).locator('h1').click()
    await link(page, '相对文件').hover()
    await expect(page.locator('.milkdown-link-preview .link-display')).toBeVisible()
    await page.getByRole('tab', { name: '笔记A.md', exact: true }).click(); await editorReady(page)
    // Milkdown can keep its old floating preview across state replacement.
    await page.locator('.milkdown-link-preview .link-display').evaluate(anchor => anchor.click())
    await link(page, '网页').click({ modifiers: ['Shift'] })
    const rect = await link(page, '相对文件').boundingBox()
    await page.mouse.move(rect.x + 1, rect.y + rect.height / 2)
    await page.mouse.down(); await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, { steps: 8 }); await page.mouse.up()
    await page.keyboard.down('Control')
    await page.mouse.move(rect.x + 1, rect.y + rect.height / 2)
    await page.mouse.down(); await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, { steps: 8 }); await page.mouse.up()
    await page.keyboard.up('Control')
    expect(await calls(app)).toEqual([])
    const invalid = await page.evaluate(async () => { try { await window.desktop.openLink('missing-document', 'https://example.com'); return null } catch (error) { return error.message } })
    expect(invalid).toBeTruthy(); expect(await calls(app)).toEqual([])
  } finally { await cleanup(app, directory) }
})
