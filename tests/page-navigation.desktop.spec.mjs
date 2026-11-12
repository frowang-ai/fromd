import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { DocumentStore } from '../apps/desktop/src/main/documentStore.js'
import { bindMenu, editorReady, menuCommand, menuState } from './native-menu.mjs'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const body = page => page.getByRole('textbox', { name: 'Markdown 正文', exact: true })
const source = page => page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
const tab = (page, name) => page.getByRole('tab', { name, exact: true })
const snapshot = page => page.evaluate(() => window.desktop.listMetadata())
async function fixture({ file = false, shelved = false, dirty = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'frowd-navigation-')), profile = join(directory, 'profile')
  const store = new DocumentStore(profile); await store.restore()
  const first = store.activeId
  await store.rename(first, 'A'); await store.update(first, '# A\n\n第一篇正文', 1)
  const second = (await store.newDocument('# B\n\n| 左 | 右 |\n| --- | --- |\n| 一 | 二 |', 'B')).activeId
  const path = join(directory, '文件C.md')
  if (file) await writeFile(path, '# C\n\n文件磁盘原文')
  const third = file ? (await store.openFile(path)).activeId : (await store.newDocument('# C\n\n$$x^2$$\n\n第三篇正文', 'C')).activeId
  if (file && dirty) await store.update(third, '# C\n\n尚未写回的文件正文', 1)
  if (shelved) await store.shelveOthers(first)
  await store.activate(first); await store.dispose()
  return { directory, profile, first, second, third, path }
}
async function launch(profile) {
  const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ ...(process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: [] } : { args: [root] }), env, timeout: 30000 })
  const page = await app.firstWindow(); bindMenu(app, page); await editorReady(page)
  return { app, page }
}
async function stop(app) {
  const child = app?.process()
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolveExit => child.once('exit', resolveExit))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await exited
}
async function cleanup(directory, app) {
  await stop(app)
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('frowd-navigation-')) throw new Error('Unexpected test cleanup path')
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
async function select(page, name) { await tab(page, name).click(); await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true'); await editorReady(page) }
async function menu(page, name) { await tab(page, name).click({ button: 'right' }); await expect(page.getByRole('menu')).toBeVisible() }
async function action(page, name, label) { await menu(page, name); await page.getByRole('menuitem', { name: label, exact: true }).click(); await editorReady(page) }
async function shelf(page) {
  if (await page.getByRole('button', { name: '页面列表', exact: true }).getAttribute('aria-expanded') !== 'true') await page.getByRole('button', { name: '页面列表', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '搜索页面' })).toBeVisible()
}
async function screenshot(page, name) {
  const directory = join(root, 'output', 'page-navigation', 'screenshots'); await mkdir(directory, { recursive: true })
  await page.screenshot({ path: join(directory, name), fullPage: true })
}

test('非当前标签菜单打开取消不执行操作；边界、Escape、外部点击和键盘可用', async () => {
  const f = await fixture(); let app
  try {
    const launched = await launch(f.profile); app = launched.app; const { page } = launched
    await app.evaluate(({ ipcMain }) => {
      globalThis.__menuMutations = []
      for (const name of ['activate', 'save', 'close', 'shelve', 'shelve-others', 'shelve-all', 'expand-all', 'update', 'rename', 'view-state']) {
        const channel = `documents:${name}`, handler = ipcMain._invokeHandlers.get(channel)
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (...args) => { globalThis.__menuMutations.push(name); return handler(...args) })
      }
    })
    await menu(page, 'B'); await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('menuitem', { name: '重命名', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitem', { name: '保存为 Markdown…', exact: true })).toBeFocused()
    await screenshot(page, 'tab-context-menu.png')
    await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0); await expect(tab(page, 'B')).toBeFocused()
    await tab(page, 'B').press('Shift+F10'); await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await tab(page, 'B').evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: innerWidth - 1, clientY: innerHeight - 1 })))
    const bounds = await page.getByRole('menu').boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
    await body(page).locator('h1').click(); await expect(page.getByRole('menu')).toHaveCount(0)
    expect(await app.evaluate(() => globalThis.__menuMutations)).toEqual([])
    expect((await snapshot(page)).activeId).toBe(f.first)
  } finally { await cleanup(f.directory, app) }
})

test('非当前草稿保存和文件另存绑定目标ID；立即编辑和undo仍属于当前页', async () => {
  const f = await fixture({ file: true }); let app
  try {
    const launched = await launch(f.profile); app = launched.app; const { page } = launched
    await body(page).press('Control+End'); await page.keyboard.insertText(' IMMEDIATE')
    const destination = join(f.directory, 'B另存.md')
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, destination)
    await action(page, 'B', '保存为 Markdown…')
    expect(await readFile(destination, 'utf8')).toContain('# B')
    expect(await readFile(destination, 'utf8')).not.toContain('IMMEDIATE')
    await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true')
    await body(page).press('Control+z'); await expect(body(page)).not.toContainText('IMMEDIATE')
    const secondDestination = join(f.directory, 'C另存.md')
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, secondDestination)
    await menu(page, '文件C.md'); await expect(page.getByRole('menuitem', { name: '重命名', exact: true })).toHaveCount(0)
    await page.getByRole('menuitem', { name: '另存为…', exact: true }).click(); await editorReady(page)
    expect(await readFile(secondDestination, 'utf8')).toContain('文件磁盘原文')
    expect(await readFile(f.path, 'utf8')).toBe('# C\n\n文件磁盘原文')
    expect((await snapshot(page)).activeId).toBe(f.first)
    expect((await snapshot(page)).documents.find(doc => doc.id === f.third).path).toBe(secondDestination)
  } finally { await cleanup(f.directory, app) }
})

test('右键其他草稿重命名复用名称输入；取消非当前移除保留页面，确认后可撤销', async () => {
  const f = await fixture(); let app
  try {
    const launched = await launch(f.profile); app = launched.app; const { page } = launched
    await action(page, 'B', '重命名')
    const name = page.getByRole('textbox', { name: '草稿名称', exact: true })
    await expect(name).toBeFocused(); await name.fill('改名B'); await name.press('Enter')
    await select(page, 'A')
    await app.evaluate(({ dialog }) => { globalThis.__removeQuestions = []; dialog.showMessageBox = async (_window, options) => { globalThis.__removeQuestions.push(options); return { response: 2 } } })
    await action(page, '改名B', '移除页面')
    await expect(tab(page, '改名B')).toHaveCount(1); await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true')
    expect((await app.evaluate(() => globalThis.__removeQuestions)).at(-1).detail).toContain('改名B')
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }) })
    await action(page, '改名B', '移除页面'); await expect(tab(page, '改名B')).toHaveCount(0)
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await editorReady(page)
    const restored = (await snapshot(page)).documents.find(doc => doc.title === '改名B')
    expect(restored.id).not.toBe(f.second)
    expect((await page.evaluate(id => window.desktop.read(id), restored.id)).markdown).toContain('# B')
  } finally { await cleanup(f.directory, app) }
})

test('全部展开忽略搜索筛选、零捕获且不读其他正文，保留当前视图并跨重启持久化', async () => {
  const f = await fixture({ shelved: true }); let app
  try {
    let launched = await launch(f.profile); app = launched.app; let { page } = launched
    await menuCommand(page, 'source')
    const text = Array.from({ length: 100 }, (_, i) => `第${i}行`).join('\n')
    await source(page).fill(text); await source(page).evaluate(input => { input.setSelectionRange(4, 9); input.scrollTop = 200 })
    const view = await source(page).evaluate(input => [input.selectionStart, input.selectionEnd, input.scrollTop])
    await app.evaluate(({ ipcMain }) => {
      globalThis.__bulkReads = []; globalThis.__bulkCaptures = 0
      const read = ipcMain._invokeHandlers.get('documents:read'); ipcMain.removeHandler('documents:read')
      ipcMain.handle('documents:read', (...args) => { globalThis.__bulkReads.push(args[1]); return read(...args) })
      const capture = ipcMain._invokeHandlers.get('application:capture-page'); ipcMain.removeHandler('application:capture-page')
      ipcMain.handle('application:capture-page', (...args) => { globalThis.__bulkCaptures++; return capture(...args) })
    })
    await shelf(page); await page.getByRole('button', { name: '已收起 2', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索页面' }).fill('B')
    await screenshot(page, 'expand-all-entry.png')
    await page.getByRole('button', { name: '全部展开', exact: true }).click(); await editorReady(page)
    await expect(page.getByRole('tab')).toHaveCount(3)
    await expect(page.getByRole('button', { name: '全部展开', exact: true })).toBeDisabled()
    expect(await app.evaluate(() => [globalThis.__bulkReads, globalThis.__bulkCaptures])).toEqual([[], 0])
    expect((await snapshot(page)).activeId).toBe(f.first)
    expect((await snapshot(page)).documents.map(doc => doc.id)).toEqual([f.first, f.second, f.third])
    await page.getByRole('button', { name: '收起页面列表', exact: true }).click()
    expect(await source(page).evaluate(input => [input.selectionStart, input.selectionEnd, input.scrollTop])).toEqual(view)
    const closed = app.waitForEvent('close'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed
    launched = await launch(f.profile); app = launched.app; page = launched.page
    await expect(page.getByRole('tab')).toHaveCount(3); await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true')
    await expect(source(page)).toHaveValue(text)
    expect((await snapshot(page)).documents.every(doc => !doc.shelved)).toBe(true)
  } finally { await cleanup(f.directory, app) }
})

test('批量收起其他页激活右键目标；全部收起空桌面可新建，展开激活原顺序第一篇', async () => {
  const f = await fixture(); let app
  try {
    const launched = await launch(f.profile); app = launched.app; const { page } = launched
    await action(page, 'B', '收起其他页')
    await expect(page.getByRole('tab')).toHaveCount(1); await expect(tab(page, 'B')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Control+Tab'); await page.keyboard.press('Control+Shift+Tab')
    expect((await snapshot(page)).activeId).toBe(f.second)
    await action(page, 'B', '收起全部页')
    await expect(page.getByRole('tab')).toHaveCount(0); await expect(page.getByText('页面已收起', { exact: true })).toBeVisible()
    await page.keyboard.press('Control+Tab'); expect((await snapshot(page)).activeId).toBeNull()
    expect((await menuState(page, 'new')).enabled).toBe(true); expect((await menuState(page, 'open')).enabled).toBe(true)
    await shelf(page); await page.getByRole('button', { name: '全部展开', exact: true }).click(); await editorReady(page)
    await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true'); await expect(page.getByRole('tab')).toHaveCount(3)
    await page.getByRole('button', { name: '收起页面列表', exact: true }).click()
    await action(page, 'A', '收起全部页'); await menuCommand(page, 'new')
    await expect(page.getByRole('tab')).toHaveCount(1); await expect(page.getByRole('textbox', { name: '草稿名称' })).toHaveValue('未命名笔记')
    expect(await page.locator('.ProseMirror').count()).toBe(1)
  } finally { await cleanup(f.directory, app) }
})

test('Ctrl+Tab按标签顺序循环且跳过收起页，立即富文本输入与undo不丢', async () => {
  const f = await fixture(); let app
  try {
    const launched = await launch(f.profile); app = launched.app; const { page } = launched
    await page.getByRole('button', { name: '收起 B', exact: true }).click(); await editorReady(page)
    await body(page).press('Control+End'); await page.keyboard.insertText(' LATEST')
    await page.keyboard.press('Control+Shift+Tab'); await editorReady(page); await expect(tab(page, 'C')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Control+Tab'); await editorReady(page); await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true')
    await expect(body(page)).toContainText('LATEST'); await page.keyboard.press('Control+z'); await expect(body(page)).not.toContainText('LATEST')
    await menuCommand(page, 'nextPage'); await expect(tab(page, 'C')).toHaveAttribute('aria-selected', 'true'); await editorReady(page)
    await menuCommand(page, 'previousPage'); await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true'); await editorReady(page)
    await expect(tab(page, 'B')).toHaveCount(0)
  } finally { await cleanup(f.directory, app) }
})

test('源码、表格和公式焦点下快捷键生效，源码selection/scroll/undo保留，普通Tab仍留在表格', async () => {
  const f = await fixture(); let app
  try {
    const launched = await launch(f.profile); app = launched.app; const { page } = launched
    await menuCommand(page, 'source')
    const text = Array.from({ length: 120 }, (_, i) => `源码第${i}行`).join('\n')
    await source(page).fill(text); await source(page).press('Control+End'); await page.keyboard.insertText(' SOURCE EDIT')
    await source(page).evaluate(input => { input.setSelectionRange(4, 9); input.scrollTop = 250 })
    const expected = await source(page).evaluate(input => [input.selectionStart, input.selectionEnd, input.scrollTop])
    await page.keyboard.press('Control+Tab'); await editorReady(page)
    await expect(tab(page, 'B')).toHaveAttribute('aria-selected', 'true')
    await body(page).locator('td').first().click(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab')
    await expect(tab(page, 'B')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Control+Tab'); await editorReady(page)
    await page.getByRole('button', { name: '编辑行间公式', exact: true }).click()
    const formula = page.getByRole('textbox', { name: '行间公式 LaTeX', exact: true })
    await formula.press('Control+End'); await formula.pressSequentially(' + y')
    await page.keyboard.press('Control+Tab'); await editorReady(page)
    await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true'); await expect(source(page)).toBeFocused()
    expect(await source(page).evaluate(input => [input.selectionStart, input.selectionEnd, input.scrollTop])).toEqual(expected)
    await page.keyboard.press('Control+z'); await expect(source(page)).toHaveValue(text)
    await page.keyboard.press('Control+Shift+Tab'); await editorReady(page)
    await expect(formula).toBeVisible(); await expect(formula).toContainText('+ y')
    expect(await page.locator('.ProseMirror').count()).toBe(1)
  } finally { await cleanup(f.directory, app) }
})

test('组合输入提交前保持输入可用；忙碌期间重复切换不迟到覆盖后续选择', async () => {
  const f = await fixture(); let app
  try {
    const launched = await launch(f.profile); app = launched.app; const { page } = launched
    await menuCommand(page, 'source')
    await source(page).evaluate(input => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await page.keyboard.press('Control+Tab')
    await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true'); await expect(source(page)).toBeEnabled()
    await source(page).evaluate(input => {
      input.value += '\n组合提交文字'
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '组合提交文字' }))
    })
    await editorReady(page); await expect(tab(page, 'B')).toHaveAttribute('aria-selected', 'true')
    expect((await page.evaluate(id => window.desktop.read(id), f.first)).markdown).toContain('组合提交文字')
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('documents:activate'); ipcMain.removeHandler('documents:activate')
      let first = true; globalThis.__heldNavigation = false
      ipcMain.handle('documents:activate', async (...args) => {
        const result = await original(...args)
        if (first) { first = false; globalThis.__heldNavigation = true; await new Promise(resolve => { globalThis.__releaseNavigation = resolve }) }
        return result
      })
    })
    await page.keyboard.press('Control+Tab'); await expect.poll(() => app.evaluate(() => globalThis.__heldNavigation)).toBe(true)
    await page.keyboard.press('Control+Tab'); await page.keyboard.press('Control+Shift+Tab')
    await app.evaluate(() => globalThis.__releaseNavigation()); await editorReady(page)
    await expect(tab(page, 'C')).toHaveAttribute('aria-selected', 'true')
    await select(page, 'A'); await expect(source(page)).toHaveValue(/组合提交文字/)
    expect((await snapshot(page)).activeId).toBe(f.first)
  } finally { await cleanup(f.directory, app) }
})

test('真实SQLite批量提交失败后所有标签与当前页保持，恢复存储可重试', async () => {
  const f = await fixture(); let app
  const db = new DatabaseSync(join(f.profile, 'drafts.sqlite'))
  try {
    const launched = await launch(f.profile); app = launched.app; const { page } = launched
    db.exec("CREATE TRIGGER reject_shelving BEFORE UPDATE OF shelved ON documents WHEN NEW.shelved=1 BEGIN SELECT RAISE(ABORT,'controlled batch failure'); END")
    await action(page, 'B', '收起其他页')
    await expect(page.getByRole('alert')).toContainText('备份失败')
    await expect(page.getByRole('tab')).toHaveCount(3); await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true')
    expect((await snapshot(page)).documents.every(doc => !doc.shelved)).toBe(true)
    db.exec('DROP TRIGGER reject_shelving')
    await action(page, 'B', '收起其他页'); await expect(page.getByRole('tab')).toHaveCount(1)
    await expect(tab(page, 'B')).toHaveAttribute('aria-selected', 'true')
  } finally { db.close(); await cleanup(f.directory, app) }
})

test('键盘切换到溢出标签会滚动可见', async () => {
  const f = await fixture(); let app
  try {
    const store = new DocumentStore(f.profile); await store.restore()
    for (let i = 0; i < 18; i++) await store.newDocument(`正文${i}`, `很长的页面名称${i}`)
    await store.activate(f.first); await store.dispose()
    const launched = await launch(f.profile); app = launched.app; const { page } = launched
    await page.keyboard.press('Control+Shift+Tab'); await editorReady(page)
    const selected = page.locator('[role=tab][aria-selected=true]'), bounds = await selected.boundingBox(), list = await page.getByRole('tablist').boundingBox()
    await expect(selected).toHaveAccessibleName('很长的页面名称17')
    expect(bounds.x).toBeGreaterThanOrEqual(list.x - 1); expect(bounds.x + bounds.width).toBeLessThanOrEqual(list.x + list.width + 1)
  } finally { await cleanup(f.directory, app) }
})

test('已选标签点击可确认尚未送达的外部选择；非当前脏文件移除取消不写原件', async () => {
  const f = await fixture({ file: true, dirty: true }); let app
  try {
    const launched = await launch(f.profile); app = launched.app; const { page } = launched
    // Model the interval between a store-side external open and its metadata event.
    await page.evaluate(id => window.desktop.activate(id), f.second)
    await expect(tab(page, 'A')).toHaveAttribute('aria-selected', 'true')
    await tab(page, 'A').click()
    await expect.poll(async () => (await snapshot(page)).activeId).toBe(f.first)
    await app.evaluate(({ dialog }) => {
      globalThis.__fileQuestion = null
      dialog.showMessageBox = async (_window, options) => { globalThis.__fileQuestion = options; return { response: 2 } }
    })
    await action(page, '文件C.md', '移除页面')
    await expect(tab(page, '文件C.md')).toHaveCount(1)
    expect((await app.evaluate(() => globalThis.__fileQuestion)).message).toContain('文件C.md')
    expect((await snapshot(page)).activeId).toBe(f.first)
    expect((await page.evaluate(id => window.desktop.read(id), f.third)).markdown).toContain('尚未写回')
    expect(await readFile(f.path, 'utf8')).toBe('# C\n\n文件磁盘原文')
  } finally { await cleanup(f.directory, app) }
})

test('移除提示可关闭且保存切换新建不复活；同名新移除重现且撤销有效', async () => {
  const f = await fixture(); let app, db
  try {
    const store = new DocumentStore(f.profile); await store.restore()
    await store.rename(f.second, '未命名笔记'); await store.rename(f.third, '未命名笔记'); await store.dispose()
    const launched = await launch(f.profile); app = launched.app; const { page } = launched
    await app.evaluate(({ dialog }) => {
      globalThis.__noticeChoice = 1
      dialog.showMessageBox = async () => ({ response: globalThis.__noticeChoice })
    })
    async function removeSameName() {
      await tab(page, '未命名笔记').first().click({ button: 'right' })
      await page.getByRole('menuitem', { name: '移除页面', exact: true }).click(); await editorReady(page)
    }
    await removeSameName()
    const notice = page.locator('.removal-notice'), dismiss = page.getByRole('button', { name: '关闭移除提示', exact: true })
    await expect(notice).toBeVisible(); await expect(dismiss).toBeVisible()
    const shots = join(root, 'output', 'removal-notice-046'); await mkdir(shots, { recursive: true })
    await page.screenshot({ path: join(shots, 'removal-notice-close.png'), fullPage: true })
    const beforeDismiss = await snapshot(page)
    await app.evaluate(({ ipcMain }) => {
      globalThis.__dismissMutations = []
      for (const name of ['close', 'undo-remove', 'save', 'update', 'rename', 'view-state']) {
        const channel = `documents:${name}`, handler = ipcMain._invokeHandlers.get(channel)
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (...args) => { globalThis.__dismissMutations.push(name); return handler(...args) })
      }
    })
    await dismiss.focus(); await page.keyboard.press('Enter')
    await expect(notice).toHaveCount(0)
    expect(await snapshot(page)).toEqual(beforeDismiss)
    expect(await app.evaluate(() => globalThis.__dismissMutations)).toEqual([])
    expect((await snapshot(page)).undoRemoval).toBe('未命名笔记')

    const saved = join(f.directory, '当前A.md')
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, saved)
    await menuCommand(page, 'save'); await expect(tab(page, '当前A.md')).toBeVisible(); await editorReady(page)
    await expect(notice).toHaveCount(0)
    expect(await readFile(saved, 'utf8')).toBe('# A\n\n第一篇正文')
    await select(page, '未命名笔记'); await expect(notice).toHaveCount(0)
    await select(page, '当前A.md'); await expect(notice).toHaveCount(0)
    await menuCommand(page, 'new'); await editorReady(page)
    await expect.poll(async () => (await snapshot(page)).documents.length).toBe(3)
    await expect(notice).toHaveCount(0)
    await select(page, '当前A.md')

    await app.evaluate(() => { globalThis.__noticeChoice = 2 })
    await removeSameName(); await expect(notice).toHaveCount(0)
    expect((await snapshot(page)).documents.some(doc => doc.id === f.third)).toBe(true)
    db = new DatabaseSync(join(f.profile, 'drafts.sqlite'))
    db.exec("CREATE TRIGGER reject_notice_remove BEFORE DELETE ON documents BEGIN SELECT RAISE(ABORT,'controlled removal failure'); END")
    await app.evaluate(() => { globalThis.__noticeChoice = 1 })
    await removeSameName(); await expect(page.getByRole('alert')).toContainText('备份失败')
    await expect(notice).toHaveCount(0)
    expect((await snapshot(page)).undoRemoval).toBe('未命名笔记')
    db.exec('DROP TRIGGER reject_notice_remove'); db.close(); db = null

    await removeSameName(); await expect(notice).toBeVisible()
    expect((await snapshot(page)).documents.some(doc => doc.id === f.third)).toBe(false)
    await notice.getByRole('button', { name: '撤销', exact: true }).focus(); await page.keyboard.press('Enter'); await editorReady(page)
    await expect(notice).toHaveCount(0)
    const restored = (await snapshot(page)).documents.find(doc => doc.title === '未命名笔记' && doc.preview.includes('第三篇正文'))
    expect(restored.id).not.toBe(f.third)
    expect((await page.evaluate(id => window.desktop.read(id), restored.id)).markdown).toContain('第三篇正文')
    await removeSameName(); await expect(dismiss).toBeVisible()
    await dismiss.click(); await expect(notice).toHaveCount(0)
    expect((await snapshot(page)).undoRemoval).toBe('未命名笔记')
  } finally { db?.close(); await cleanup(f.directory, app) }
})
