import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const nameField = page => page.getByRole('textbox', { name: '草稿名称', exact: true })
const status = page => page.getByRole('status', { name: '自动保存状态', exact: true })
const source = page => page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
const snapshot = page => page.evaluate(() => window.desktop.list())
async function launch(profile, files = []) {
  const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ ...(process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: files } : { args: [root, ...files] }), env, timeout: 30000 })
  const page = await app.firstWindow()
  await expect(page.getByRole('button', { name: '源码', exact: true })).toBeEnabled()
  return { app, page }
}
async function stop(app) {
  const process = app?.process()
  if (!process || process.exitCode !== null || process.signalCode !== null) return
  const exited = new Promise(resolve => process.once('exit', resolve))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await exited
}
async function closeWindow(app) {
  const closed = app.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
}
async function sandbox() {
  const parent = join(root, 'output', 'draft-fixtures')
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(join(parent, 'case-'))
  return { directory, profile: join(directory, 'profile') }
}
async function cleanup(directory) { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
async function putSource(page, text) {
  const toggle = page.getByRole('button', { name: '源码', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  await source(page).fill(text)
}
async function nameDraft(page, title) {
  await nameField(page).fill(title)
  await nameField(page).press('Enter')
  await expect(status(page)).toHaveText('已自动保存')
}
async function noDialogs(app) {
  await app.evaluate(({ dialog }) => {
    globalThis.__draftDialogs = []
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__draftDialogs.push(options.message)
      return { response: 1 }
    }
  })
}
// Delay a real IPC reply after the actual store operation. This leaves storage,
// preload, renderer and Electron lifecycle real; only response timing is controlled.
async function holdFirstRename(app, fail = false) {
  await app.evaluate(({ ipcMain }, fail) => {
    const original = ipcMain._invokeHandlers.get('documents:rename')
    if (!original) throw new Error('Real documents:rename handler is required')
    globalThis.__renameProbe = { calls: [], waiting: false }
    ipcMain.removeHandler('documents:rename')
    ipcMain.handle('documents:rename', async (...args) => {
      const probe = globalThis.__renameProbe
      probe.calls.push(args[2])
      const result = await original(...args)
      if (probe.calls.length === 1) {
        probe.waiting = true
        await new Promise(resolve => { probe.release = resolve })
        probe.waiting = false
        if (fail) return { ok: false, error: '测试：旧名称回执失败' }
      }
      return result
    })
  }, fail)
}
async function held(app) { await expect.poll(() => app.evaluate(() => globalThis.__renameProbe.waiting)).toBe(true) }
async function release(app) { await app.evaluate(() => globalThis.__renameProbe.release()) }

test('临时草稿：即时命名、空名回退、多篇切换、删除部分、退出重启', async () => {
  const { directory, profile } = await sandbox()
  let app
  try {
    let launched = await launch(profile); app = launched.app; let page = launched.page
    await noDialogs(app)
    const initialRevision = (await snapshot(page)).documents[0].revision
    await nameField(page).fill('  Agent 回复一  ')
    await expect(page.getByRole('tab', { name: 'Agent 回复一', exact: true })).toBeVisible()
    await expect(page).toHaveTitle('Agent 回复一 — Frowang Markdown')
    await nameField(page).press('Enter')
    await expect(nameField(page)).toHaveValue('Agent 回复一')
    await expect(status(page)).toHaveText('已自动保存')
    expect((await snapshot(page)).documents[0].revision).toBe(initialRevision)
    await putSource(page, '# 第一篇\n\n保留的 Agent 回复')
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await nameDraft(page, '用完即弃')
    await putSource(page, '第二篇稍后删除')
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await nameDraft(page, '第三篇')
    await putSource(page, '第三篇留到明天')
    await page.getByRole('tab', { name: /Agent 回复一/ }).click()
    await expect(nameField(page)).toHaveValue('Agent 回复一')
    await expect(source(page)).toHaveValue('# 第一篇\n\n保留的 Agent 回复')
    await page.getByRole('button', { name: '关闭 用完即弃', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(2)
    await page.getByRole('tab', { name: /第三篇/ }).click()
    await nameField(page).fill('   ')
    await source(page).click() // blur finishes and normalizes an empty name
    await expect(nameField(page)).toHaveValue('未命名笔记')
    await expect(page).toHaveTitle('未命名笔记 — Frowang Markdown')
    // Leave the final name focused: application close must flush without blur.
    await nameField(page).fill('明日继续')
    expect(await app.evaluate(() => globalThis.__draftDialogs)).toEqual([])
    await closeWindow(app)
    launched = await launch(profile); app = launched.app; page = launched.page
    const recovered = await snapshot(page)
    expect(recovered.documents.map(doc => doc.title)).toEqual(['Agent 回复一', '明日继续'])
    expect(recovered.documents.map(doc => doc.markdown)).toEqual(['# 第一篇\n\n保留的 Agent 回复', '第三篇留到明天'])
    expect(recovered.activeId).toBe(recovered.documents[1].id)
    await expect(nameField(page)).toHaveValue('明日继续')
    await noDialogs(app)
    await page.getByRole('button', { name: '关闭 Agent 回复一', exact: true }).click()
    await page.getByRole('button', { name: '关闭 明日继续', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(1)
    await expect(nameField(page)).toHaveValue('未命名笔记')
    expect((await snapshot(page)).documents[0].markdown).toBe('')
    expect(await app.evaluate(() => globalThis.__draftDialogs)).toEqual([])
  } finally { await stop(app); await cleanup(directory) }
})

for (const fail of [false, true]) {
  test(`名称旧${fail ? '失败' : '成功'}回执不覆盖新名称或正文，连续输入合并`, async () => {
    const { directory, profile } = await sandbox()
    let app
    try {
      const launched = await launch(profile); app = launched.app; const page = launched.page
      await holdFirstRename(app, fail)
      await nameField(page).fill('旧名称')
      await held(app)
      const oldSnapshot = await snapshot(page)
      await nameField(page).fill('更新中')
      await nameField(page).fill('最终名称')
      await putSource(page, '与命名同时修改的最新正文')
      await expect(page).toHaveTitle('最终名称 — Frowang Markdown')
      await expect.poll(async () => (await snapshot(page)).documents[0].markdown).toBe('与命名同时修改的最新正文')
      await expect(status(page)).toHaveText('正在自动保存…')
      expect(await app.evaluate(() => globalThis.__renameProbe.calls)).toEqual(['旧名称'])
      await release(app)
      await expect(status(page)).toHaveText('已自动保存')
      // A late full snapshot from a second-instance event must not overwrite local edits.
      await app.evaluate(({ BrowserWindow }, snapshot) => BrowserWindow.getAllWindows()[0].webContents.send('documents:changed', snapshot), oldSnapshot)
      await expect(nameField(page)).toHaveValue('最终名称')
      await expect(source(page)).toHaveValue('与命名同时修改的最新正文')
      await expect(page).toHaveTitle('最终名称 — Frowang Markdown')
      expect(await app.evaluate(() => globalThis.__renameProbe.calls)).toEqual(['旧名称', '最终名称'])
      const doc = (await snapshot(page)).documents[0]
      expect(doc.title).toBe('最终名称'); expect(doc.markdown).toBe('与命名同时修改的最新正文')
      await expect(page.getByRole('alert')).toHaveCount(0)
    } finally { await stop(app); await cleanup(directory) }
  })
}

test('删除草稿停止未发出的命名，迟到更新不能复活已关闭草稿', async () => {
  const { directory, profile } = await sandbox()
  let app
  try {
    const launched = await launch(profile); app = launched.app; const page = launched.page
    const id = (await snapshot(page)).activeId
    await holdFirstRename(app)
    await nameField(page).fill('已发出名称'); await held(app)
    await nameField(page).fill('不应再提交的名称')
    await page.getByRole('button', { name: '关闭 不应再提交的名称', exact: true }).click()
    await expect(page.locator('.app-bar')).toHaveAttribute('inert', '')
    await release(app)
    await expect(nameField(page)).toHaveValue('未命名笔记')
    expect(await app.evaluate(() => globalThis.__renameProbe.calls)).toEqual(['已发出名称'])
    const results = await page.evaluate(async id => {
      const attempt = async action => { try { const result = await action(); return !!(result.stale || result.closed) } catch { return true } }
      return [await attempt(() => window.desktop.update(id, '迟到正文', 100)), await attempt(() => window.desktop.rename(id, '迟到名称'))]
    }, id)
    expect(results).toEqual([true, true])
    expect((await snapshot(page)).documents.some(doc => doc.id === id)).toBe(false)
    await closeWindow(app)
    const restarted = await launch(profile); app = restarted.app
    expect((await snapshot(restarted.page)).documents.some(doc => doc.id === id)).toBe(false)
  } finally { await stop(app); await cleanup(directory) }
})

test('退出等待名称队列；退出保存失败后可继续编辑并重试', async () => {
  const { directory, profile } = await sandbox()
  let app
  try {
    const launched = await launch(profile); app = launched.app; const page = launched.page
    await holdFirstRename(app)
    await nameField(page).fill('退出前旧名'); await held(app)
    await nameField(page).fill('退出前最终名称')
    // Reject the first close-ready receipt. The next attempt uses the real handler.
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('application:close-ready')
      let first = true
      ipcMain.removeHandler('application:close-ready')
      ipcMain.handle('application:close-ready', (...args) => {
        if (first) { first = false; return { ok: false, error: '测试：退出保存失败' } }
        return original(...args)
      })
    })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect(page.locator('.app-bar')).toHaveAttribute('inert', '')
    await release(app)
    await expect(page.getByRole('alert')).toContainText('退出保存失败')
    await expect(page.locator('.app-bar')).not.toHaveAttribute('inert', '')
    await expect(nameField(page)).toHaveValue('退出前最终名称')
    await putSource(page, '失败后继续编辑，第二次退出保留')
    await closeWindow(app)
    const restarted = await launch(profile); app = restarted.app
    const doc = (await snapshot(restarted.page)).documents[0]
    expect(doc.title).toBe('退出前最终名称'); expect(doc.markdown).toBe('失败后继续编辑，第二次退出保留')
  } finally { await stop(app); await cleanup(directory) }
})

test('已绑定文件显示路径，关闭保留保存／放弃／取消，另存使用草稿名称', async () => {
  const { directory, profile } = await sandbox()
  const file = join(directory, '外部文件.md'), copy = join(directory, '另存副本.md')
  await writeFile(file, '磁盘原文')
  let app
  try {
    const launched = await launch(profile, [file]); app = launched.app; const page = launched.page
    await expect(nameField(page)).toHaveCount(0)
    await expect(page.locator('.document-meta').getByText(file, { exact: true })).toBeVisible()
    await putSource(page, '第一次未保存')
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2 }) })
    await page.getByRole('button', { name: '关闭 外部文件.md', exact: true }).click()
    await expect(source(page)).toHaveValue('第一次未保存')
    expect(await readFile(file, 'utf8')).toBe('磁盘原文')
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }) })
    await page.getByRole('button', { name: '关闭 外部文件.md', exact: true }).click()
    await expect(page.getByRole('tab', { name: /外部文件.md/ })).toHaveCount(0)
    expect(await readFile(file, 'utf8')).toBe('第一次未保存')
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, file)
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await putSource(page, '这次放弃修改')
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }) })
    await page.getByRole('button', { name: '关闭 外部文件.md', exact: true }).click()
    await expect(nameField(page)).toBeVisible()
    expect(await readFile(file, 'utf8')).toBe('第一次未保存')
    await nameDraft(page, '建议文件名')
    await putSource(page, '另存的草稿正文')
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async (_window, options) => { globalThis.__suggestedName = options.defaultPath; return { canceled: false, filePath } }
    }, copy)
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.getByRole('tab', { name: '另存副本.md', exact: true })).toBeVisible()
    expect(await app.evaluate(() => globalThis.__suggestedName)).toMatch(/建议文件名\.md$/)
    expect(await readFile(copy, 'utf8')).toBe('另存的草稿正文')
    await expect(nameField(page)).toHaveCount(0)
    await expect(page.locator('.document-meta').getByText(copy, { exact: true })).toBeVisible()
  } finally { await stop(app); await cleanup(directory) }
})
