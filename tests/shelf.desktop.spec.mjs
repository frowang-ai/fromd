import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { DocumentStore } from '../apps/desktop/src/main/documentStore.js'
import { bindMenu, editorReady, menuCommand, menuState, removePage } from './native-menu.mjs'
const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const source = page => page.locator('.document-pane:visible textarea')
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-shelf-ui-')), profile = join(directory, 'profile')
  const store = new DocumentStore(profile); await store.restore()
  const first = store.activeId
  await store.rename(first, 'A'); await store.update(first, '# A\n\n需要保留的正文', 1)
  const second = (await store.newDocument('# B\n\n另一篇正文', 'B')).activeId
  await store.activate(first); await store.dispose()
  return { directory, profile, first, second }
}
async function launch(profile, files = []) {
  const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ ...(process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: files } : { args: [root, ...files] }), env, timeout: 30000 })
  const page = await app.firstWindow(); bindMenu(app, page); await editorReady(page)
  return { app, page }
}
async function stop(app) {
  const child = app?.process(); if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await exited
}
async function exitNormally(app) {
  const closed = app.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed
}
async function openShelf(page) {
  if (await page.getByRole('button', { name: '页面列表', exact: true }).getAttribute('aria-expanded') !== 'true')
    await page.getByRole('button', { name: '页面列表', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '搜索页面', exact: true })).toBeVisible()
}
async function restorePage(page, title) {
  await openShelf(page)
  await page.getByRole('button', { name: `打开 ${title}`, exact: true }).click()
  await expect(page.getByRole('tab', { name: title, exact: true })).toHaveAttribute('aria-selected', 'true')
  await editorReady(page)
}
async function shelve(page, title) {
  await page.getByRole('button', { name: `收起 ${title}`, exact: true }).click()
  await expect(page.getByRole('tab', { name: title, exact: true })).toHaveCount(0)
  await editorReady(page)
}
async function clean(directory) { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }

test('收起/卡片恢复保留编辑状态，全部收起重启不丢页，空桌面菜单仍可新建', async ({}, info) => {
  const { directory, profile, first } = await fixture(); let app
  try {
    let launched = await launch(profile); app = launched.app; let page = launched.page
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await menuCommand(page, 'source')
    const text = Array.from({ length: 60 }, (_, i) => `第${i}行，需要保留的编辑。`).join('\n')
    await source(page).fill(text)
    await source(page).evaluate(input => { input.setSelectionRange(50, 65); input.scrollTop = 120 })
    await shelve(page, 'A')
    expect((await page.evaluate(id => window.desktop.read(id), first)).markdown).toBe(text)
    expect((await page.evaluate(() => window.desktop.list())).documents.find(doc => doc.id === first).shelved).toBe(true)
    await restorePage(page, 'A')
    await expect(source(page)).toHaveValue(text)
    expect(await source(page).evaluate(input => [input.selectionStart, input.selectionEnd, input.scrollTop])).toEqual([50, 65, 120])
    await shelve(page, 'A'); await shelve(page, 'B')
    await expect(page.getByText('页面已收起，内容仍保留。')).toBeVisible()
    expect((await menuState(page, 'new')).enabled).toBe(true)
    expect((await menuState(page, 'open')).enabled).toBe(true)
    expect((await menuState(page, 'save')).enabled).toBe(false)
    await exitNormally(app)
    launched = await launch(profile); app = launched.app; page = launched.page
    await expect(page.getByRole('tab')).toHaveCount(0)
    const snapshot = await page.evaluate(() => window.desktop.list())
    expect(snapshot.documents).toHaveLength(2); expect(snapshot.activeId).toBeNull()
    await restorePage(page, 'A'); await expect(source(page)).toHaveValue(text)
    await openShelf(page)
    await page.screenshot({ path: info.outputPath('shelf-integrated.png') })
    await page.getByRole('button', { name: '收起页面列表', exact: true }).click()
    await shelve(page, 'A'); await menuCommand(page, 'new')
    await expect(page.getByRole('tab')).toHaveCount(1)
    await expect(page.getByRole('textbox', { name: '草稿名称', exact: true })).toHaveValue('未命名笔记')
    expect(errors).toEqual([])
  } finally { await stop(app); await clean(directory) }
})

test('卡片预览不加载整篇正文，右上角直接删除与撤销，搜索和Escape可用', async () => {
  const { directory, profile, first } = await fixture(); let app
  try {
    const launched = await launch(profile); app = launched.app; const page = launched.page
    await app.evaluate(({ ipcMain }) => {
      const read = ipcMain._invokeHandlers.get('documents:read'); globalThis.__shelfReads = []
      ipcMain.removeHandler('documents:read')
      ipcMain.handle('documents:read', (...args) => { globalThis.__shelfReads.push(args[1]); return read(...args) })
    })
    await openShelf(page)
    const card = page.locator(`[data-page-id="${first}"]`)
    await expect(card.locator('.page-thumbnail-content')).toContainText('需要保留的正文')
    expect(await app.evaluate(() => globalThis.__shelfReads)).toEqual([])
    const cardRect = await card.boundingBox(), deleteRect = await card.getByRole('button', { name: '删除 A', exact: true }).boundingBox()
    expect(deleteRect.x).toBeGreaterThan(cardRect.x + cardRect.width - 35)
    expect(deleteRect.y - cardRect.y).toBeLessThanOrEqual(8)
    await page.getByRole('textbox', { name: '搜索页面' }).fill('A')
    await expect(page.locator('.page-card')).toHaveCount(1)
    await card.getByRole('button', { name: '删除 A', exact: true }).click(); await editorReady(page)
    expect((await page.evaluate(() => window.desktop.list())).documents.some(doc => doc.id === first)).toBe(false)
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await editorReady(page)
    const restored = await page.evaluate(() => window.desktop.list())
    expect(restored.documents).toHaveLength(2)
    const recovered = restored.documents.find(doc => doc.title === 'A')
    expect(recovered.id).not.toBe(first)
    expect((await page.evaluate(id => window.desktop.read(id), recovered.id)).markdown).toContain('需要保留的正文')
    await page.getByRole('textbox', { name: '搜索页面' }).press('Escape')
    await expect(page.locator('.page-shelf')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '页面列表', exact: true })).toBeFocused()
  } finally { await stop(app); await clean(directory) }
})

test('脏文件收起不询问保存，卡片移除保留取消/放弃与磁盘文件', async () => {
  const { directory, profile } = await fixture(); let app
  const file = join(directory, '磁盘文件.md'); await writeFile(file, '磁盘原文')
  try {
    const launched = await launch(profile, [file]); app = launched.app; const page = launched.page
    await app.evaluate(({ dialog }) => {
      globalThis.__shelfDialogs = []; globalThis.__shelfAnswer = 2
      dialog.showMessageBox = async (_win, options) => { globalThis.__shelfDialogs.push(options.message); return { response: globalThis.__shelfAnswer } }
    })
    await menuCommand(page, 'source'); await source(page).fill('仍未写回的修改')
    await shelve(page, '磁盘文件.md')
    expect(await app.evaluate(() => globalThis.__shelfDialogs)).toEqual([])
    expect(await readFile(file, 'utf8')).toBe('磁盘原文')
    await removePage(page, '磁盘文件.md')
    expect((await page.evaluate(() => window.desktop.list())).documents.some(doc => doc.path === file)).toBe(true)
    await app.evaluate(() => { globalThis.__shelfAnswer = 1 })
    await removePage(page, '磁盘文件.md')
    expect((await page.evaluate(() => window.desktop.list())).documents.some(doc => doc.path === file)).toBe(false)
    expect(await readFile(file, 'utf8')).toBe('磁盘原文')
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await editorReady(page)
    await restorePage(page, '磁盘文件.md')
    await expect(source(page)).toHaveValue('仍未写回的修改')
  } finally { await stop(app); await clean(directory) }
})

test('收起和删除持久化失败时保留页面，恢复写入后可以重试', async () => {
  const { directory, profile, first } = await fixture(); let app, db
  try {
    const launched = await launch(profile); app = launched.app; const page = launched.page
    db = new DatabaseSync(join(profile, 'drafts.sqlite'))
    db.exec("CREATE TRIGGER reject_shelf BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT,'test write failure'); END")
    await page.getByRole('button', { name: '收起 A', exact: true }).click(); await editorReady(page)
    await expect(page.getByRole('alert')).toContainText('备份失败')
    await expect(page.getByRole('tab', { name: 'A', exact: true })).toBeVisible()
    await removePage(page, 'A')
    expect((await page.evaluate(() => window.desktop.list())).documents.some(doc => doc.id === first && !doc.shelved)).toBe(true)
    db.exec('DROP TRIGGER reject_shelf')
    await shelve(page, 'A')
    await removePage(page, 'A')
    expect((await page.evaluate(() => window.desktop.list())).documents.some(doc => doc.id === first)).toBe(false)
  } finally { db?.close(); await stop(app); await clean(directory) }
})
