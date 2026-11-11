import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { bindMenu, editorReady, menuCommand, menuState } from './native-menu.mjs'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
async function launch() {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-menu-'))
  const env = { ...process.env, FROWANG_USER_DATA: join(directory, 'profile') }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ ...(process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: [] } : { args: [root] }), env, timeout: 30000 })
  const page = await app.firstWindow(); bindMenu(app, page); await editorReady(page)
  return { directory, app, page }
}
async function cleanup(app, directory) {
  await app.close()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
const plus = page => page.getByRole('button', { name: '新建笔记', exact: true })
const source = page => page.locator('.document-pane:visible textarea')
async function menuTree(app) {
  return app.evaluate(({ Menu }) => {
    const map = item => ({ id: item.id, label: item.label, role: item.role, type: item.type, enabled: item.enabled,
      checked: item.checked, accelerator: item.accelerator, submenu: item.submenu?.items.map(map) })
    return Menu.getApplicationMenu().items.map(map)
  })
}

test('原生菜单：标签末尾加号、窄窗溢出、真实菜单结构和源码状态', async ({}, info) => {
  const { app, page, directory } = await launch()
  try {
    await expect(page.locator('header nav')).toHaveCount(0)
    await expect(plus(page)).toBeVisible()
    expect(await plus(page).getAttribute('role')).toBeNull()
    const first = await page.locator('.tabs').boundingBox(), button = await plus(page).boundingBox()
    expect(button.x - first.x - first.width).toBeGreaterThanOrEqual(0)
    expect(button.x - first.x - first.width).toBeLessThanOrEqual(14)
    expect(button.x).toBeLessThan(300)
    await plus(page).click(); await editorReady(page)
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(page.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true')
    await page.screenshot({ path: info.outputPath('menu-tabs-wide.png') })
    const tree = await menuTree(app)
    expect(tree.map(item => item.label)).toEqual(['文件', '编辑', '视图'])
    expect(tree[0].submenu.filter(item => item.id?.startsWith('document-')).map(item => item.label)).toEqual(['新建', '打开', '保存', '另存为', '导出 PDF'])
    expect(tree[1].submenu.filter(item => item.role).map(item => item.role)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectall'])
    const menuEvidence = info.outputPath('native-menu.json')
    await writeFile(menuEvidence, JSON.stringify(tree, null, 2))
    await info.attach('native-menu.json', { path: menuEvidence, contentType: 'application/json' })
    await menuCommand(page, 'source'); await expect(source(page)).toBeVisible(); await editorReady(page)
    expect((await menuState(page, 'source')).checked).toBe(true)
    await source(page).fill('菜单切换保留的正文')
    await menuCommand(page, 'source'); await expect(page.getByRole('textbox', { name: 'Markdown 正文', exact: true })).toContainText('菜单切换保留的正文')
    await expect.poll(async () => (await menuState(page, 'source')).checked).toBe(false)
    for (let i = 0; i < 8; i++) { await plus(page).click(); await editorReady(page) }
    await expect(page.getByRole('tab')).toHaveCount(10)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(520, 600))
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(520)
    await expect(plus(page)).toBeInViewport()
    const scroll = await page.locator('.tabs').evaluate(el => ({ width: el.clientWidth, total: el.scrollWidth }))
    expect(scroll.total).toBeGreaterThan(scroll.width)
    await page.locator('.tabs').evaluate(el => { el.scrollLeft = el.scrollWidth })
    await expect(plus(page)).toBeInViewport()
    await plus(page).click(); await editorReady(page)
    await expect(page.getByRole('tab')).toHaveCount(11)
    await expect(page.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true')
    await page.screenshot({ path: info.outputPath('menu-tabs-narrow.png') })
  } finally { await cleanup(app, directory) }
})

test('原生菜单：快捷键各执行一次，取消和错误后恢复可用', async () => {
  const { app, page, directory } = await launch()
  try {
    const file = join(directory, 'opened.md'), copy = join(directory, 'copy.md')
    await writeFile(file, '文件正文')
    await app.evaluate(({ ipcMain, dialog }, { file, copy }) => {
      globalThis.__menuCalls = { new: 0, open: 0, save: 0, pdf: 0 }
      for (const name of Object.keys(globalThis.__menuCalls)) {
        const channel = `documents:${name}`, original = ipcMain._invokeHandlers.get(channel)
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (...args) => { globalThis.__menuCalls[name]++; return original(...args) })
      }
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: copy })
    }, { file, copy })
    await page.keyboard.press('Control+n'); await editorReady(page)
    await expect(page.getByRole('tab')).toHaveCount(2)
    await page.keyboard.press('Control+o')
    await expect(page.getByRole('tab', { name: 'opened.md', exact: true })).toHaveAttribute('aria-selected', 'true'); await editorReady(page)
    await menuCommand(page, 'source'); await source(page).fill('保存最新正文')
    await page.keyboard.press('Control+s'); await expect.poll(() => readFile(file, 'utf8')).toBe('保存最新正文'); await editorReady(page)
    await page.keyboard.press('Control+Shift+s'); await expect.poll(() => readFile(copy, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error })).toBe('保存最新正文'); await editorReady(page)
    expect(await app.evaluate(() => globalThis.__menuCalls)).toEqual({ new: 1, open: 1, save: 2, pdf: 0 })
    // Delay the real menu message as if the menu stayed open while backup and
    // input progressed. Body revisions must not invalidate its selection context.
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents, send = contents.send.bind(contents)
      contents.send = (channel, ...args) => {
        if (channel === 'application:command') { globalThis.__pendingSave = args[0]; return }
        return send(channel, ...args)
      }
      globalThis.__releaseSave = () => { contents.send = send; send('application:command', globalThis.__pendingSave) }
    })
    await source(page).fill('菜单打开时的正文')
    await menuCommand(page, 'save')
    await source(page).fill('菜单期间继续输入的最新正文')
    await expect(page.getByRole('status', { name: '自动保存状态', exact: true })).toHaveText('已自动保存 · 未写入文件')
    await app.evaluate(() => globalThis.__releaseSave())
    await expect.poll(() => readFile(copy, 'utf8')).toBe('菜单期间继续输入的最新正文'); await editorReady(page)
    expect(await app.evaluate(() => globalThis.__menuCalls.save)).toBe(3)
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
      dialog.showSaveDialog = async () => ({ canceled: true })
    })
    for (const name of ['open', 'saveAs', 'pdf']) {
      const previous = await app.evaluate(() => ({ ...globalThis.__menuCalls }))
      await menuCommand(page, name)
      await expect.poll(() => app.evaluate(() => ({ ...globalThis.__menuCalls })) ).not.toEqual(previous)
      await editorReady(page)
      await expect(page.getByRole('tab')).toHaveCount(3)
    }
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => { throw new Error('测试：PDF对话框失败') } })
    await menuCommand(page, 'pdf')
    await expect(page.getByRole('alert')).toContainText('测试：PDF对话框失败'); await editorReady(page)
    expect((await menuState(page, 'pdf')).enabled).toBe(true)
    expect(await readFile(copy, 'utf8')).toBe('菜单期间继续输入的最新正文')
  } finally { await cleanup(app, directory) }
})

test('原生菜单：恢复未ready、迟到命令、composition等待和忙碌时不重复执行', async () => {
  const { app, page, directory } = await launch()
  try {
    await menuCommand(page, 'source'); await source(page).fill('第一篇')
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents, send = contents.send.bind(contents)
      contents.send = (channel, ...args) => {
        if (channel === 'application:command') { globalThis.__heldMenuCommand = args[0]; return }
        return send(channel, ...args)
      }
      globalThis.__releaseMenuCommand = () => { contents.send = send; send('application:command', globalThis.__heldMenuCommand) }
    })
    await menuCommand(page, 'source') // hold a command for A
    await plus(page).click(); await editorReady(page)
    await app.evaluate(() => globalThis.__releaseMenuCommand())
    await expect(page.locator('.document-pane:visible textarea')).toHaveCount(0)
    expect((await menuState(page, 'source')).checked).toBe(false)
    await menuCommand(page, 'source'); await expect(source(page)).toBeVisible()
    await source(page).evaluate(el => { el.focus(); el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.value = '组合输入正文' })
    await menuCommand(page, 'new')
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true')
    await expect.poll(async () => (await menuState(page, 'new')).enabled).toBe(false)
    // Calling the registered callback even while disabled must still be harmless.
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu().getMenuItemById('document-new')
      item.click(item, BrowserWindow.getAllWindows()[0], {})
    })
    await source(page).evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '组合输入正文' })))
    await expect(page.getByRole('tab')).toHaveCount(3); await editorReady(page)
    await expect.poll(() => page.evaluate(async () => {
      const docs = (await window.desktop.list()).documents
      return (await window.desktop.read(docs[1].id)).markdown
    })).toBe('组合输入正文')
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('documents:read')
      let release; const gate = new Promise(resolve => { release = resolve })
      globalThis.__releaseMenuRead = () => { ipcMain.removeHandler('documents:read'); ipcMain.handle('documents:read', original); release() }
      ipcMain.removeHandler('documents:read'); ipcMain.handle('documents:read', async (...args) => { await gate; return original(...args) })
    })
    await page.getByRole('tab').first().click()
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true')
    await expect.poll(async () => (await menuState(page, 'save')).enabled).toBe(false)
    await expect(plus(page)).toBeDisabled()
    await page.keyboard.press('Control+n')
    await app.evaluate(({ Menu, BrowserWindow }) => {
      for (const name of ['new', 'open', 'save', 'saveAs', 'pdf', 'source']) {
        const item = Menu.getApplicationMenu().getMenuItemById(`document-${name}`)
        if (item.enabled) throw new Error(`Unexpected enabled menu: ${name}`)
        item.click(item, BrowserWindow.getAllWindows()[0], {})
      }
      globalThis.__releaseMenuRead()
    })
    await editorReady(page); await expect(page.getByRole('tab')).toHaveCount(3)
    await expect(source(page)).toHaveValue('第一篇')
    expect((await menuState(page, 'source')).checked).toBe(true)
  } finally { await cleanup(app, directory) }
})
