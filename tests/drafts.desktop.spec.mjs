import { test, expect, _electron as electron } from '@playwright/test'
import { bindMenu, removePage, finishRemovePage, editorReady, menuCommand, menuState } from './native-menu.mjs'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const nameField = page => page.getByRole('textbox', { name: '草稿名称', exact: true })
const status = page => page.getByRole('status', { name: '自动保存状态', exact: true })
const source = page => page.locator('.document-pane:visible').getByRole('textbox', { name: 'Markdown 源码', exact: true })
const snapshot = page => page.evaluate(async () => {
  const snapshot = await window.desktop.list()
  return { ...snapshot, documents: await Promise.all(snapshot.documents.map(doc => window.desktop.read(doc.id))) }
})
async function launch(profile, files = []) {
  const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ ...(process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: files } : { args: [root, ...files] }), env, timeout: 30000 })
  const page = await app.firstWindow()
  bindMenu(app, page)
  await editorReady(page)
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
  await editorReady(page)
  if (!(await menuState(page, 'source')).checked) await menuCommand(page, 'source')
  await expect(source(page)).toBeVisible()
  await source(page).fill(text)
}
async function nameDraft(page, title) {
  await expect(page.locator('header')).not.toHaveAttribute('inert', '')
  await expect(nameField(page)).toBeVisible()
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
    await expect(page).toHaveTitle('Agent 回复一 — frowd')
    await nameField(page).press('Enter')
    await expect(nameField(page)).toHaveValue('Agent 回复一')
    await expect(status(page)).toHaveText('已自动保存')
    expect((await snapshot(page)).documents[0].revision).toBe(initialRevision)
    await putSource(page, '# 第一篇\n\n保留的 Agent 回复')
    await page.getByRole('button', { name: '新建笔记', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(page.locator('.app-bar')).not.toHaveAttribute('inert', '')
    await nameDraft(page, '用完即弃')
    await expect(page.getByRole('tab', { name: '用完即弃', exact: true })).toHaveAttribute('aria-selected', 'true')
    await putSource(page, '第二篇稍后删除')
    await page.getByRole('button', { name: '新建笔记', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(3)
    await expect(page.locator('.app-bar')).not.toHaveAttribute('inert', '')
    await nameDraft(page, '第三篇')
    await expect(page.getByRole('tab', { name: '第三篇', exact: true })).toHaveAttribute('aria-selected', 'true')
    await putSource(page, '第三篇留到明天')
    await expect(status(page)).toHaveText('已自动保存')
    await expect(page.getByRole('tab', { name: 'Agent 回复一', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Agent 回复一', exact: true }).click()
    await expect(nameField(page)).toHaveValue('Agent 回复一')
    await expect(source(page)).toHaveValue('# 第一篇\n\n保留的 Agent 回复')
    await removePage(page, '用完即弃')
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(page.locator('.app-bar')).not.toHaveAttribute('inert', '')
    await page.getByRole('tab', { name: /第三篇/ }).click()
    await expect(page.locator('.app-bar')).not.toHaveAttribute('inert', '')
    await nameField(page).fill('   ')
    await source(page).click() // blur finishes and normalizes an empty name
    await expect(nameField(page)).toHaveValue('未命名笔记')
    await expect(page).toHaveTitle('未命名笔记 — frowd')
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
    await removePage(page, 'Agent 回复一')
    await removePage(page, '明日继续')
    await expect(page.getByRole('tab')).toHaveCount(0)
    await menuCommand(page, 'new')
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
      await expect(page).toHaveTitle('最终名称 — frowd')
      await expect.poll(async () => (await snapshot(page)).documents[0].markdown).toBe('与命名同时修改的最新正文')
      await expect(status(page)).toHaveText('正在自动保存…')
      expect(await app.evaluate(() => globalThis.__renameProbe.calls)).toEqual(['旧名称'])
      await release(app)
      await expect(status(page)).toHaveText('已自动保存')
      // A late full snapshot from a second-instance event must not overwrite local edits.
      await app.evaluate(({ BrowserWindow }, snapshot) => BrowserWindow.getAllWindows()[0].webContents.send('documents:changed', snapshot), oldSnapshot)
      await expect(nameField(page)).toHaveValue('最终名称')
      await expect(source(page)).toHaveValue('与命名同时修改的最新正文')
      await expect(page).toHaveTitle('最终名称 — frowd')
      expect(await app.evaluate(() => globalThis.__renameProbe.calls)).toEqual(['旧名称', '最终名称'])
      const doc = (await snapshot(page)).documents[0]
      expect(doc.title).toBe('最终名称'); expect(doc.markdown).toBe('与命名同时修改的最新正文')
      await expect(page.getByRole('alert')).toHaveCount(0)
    } finally { await stop(app); await cleanup(directory) }
  })
}

test('删除草稿先收齐命名，迟到更新不能复活已移除页面', async () => {
  const { directory, profile } = await sandbox()
  let app
  try {
    const launched = await launch(profile); app = launched.app; const page = launched.page
    const id = (await snapshot(page)).activeId
    await holdFirstRename(app)
    await nameField(page).fill('已发出名称'); await held(app)
    await nameField(page).fill('不应再提交的名称')
    await removePage(page, '不应再提交的名称', { wait: false })
    await expect(page.locator('.app-bar')).toHaveAttribute('inert', '')
    await release(app)
    await finishRemovePage(page)
    await expect(page.getByRole('tab')).toHaveCount(0)
    expect(await app.evaluate(() => globalThis.__renameProbe.calls)).toEqual(['已发出名称', '不应再提交的名称'])
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
    await app.evaluate(({ dialog }) => {
      const answers = [2, 0, 1]
      globalThis.__boundFileCloseAnswers = []
      dialog.showMessageBox = async () => {
        const response = answers.shift()
        if (response === undefined) throw new Error('Unexpected extra file-close dialog')
        globalThis.__boundFileCloseAnswers.push(response)
        return { response }
      }
    })
    await expect(page.locator('.app-bar')).not.toHaveAttribute('inert', '')
    await removePage(page, '外部文件.md')
    await expect.poll(() => app.evaluate(() => globalThis.__boundFileCloseAnswers)).toEqual([2])
    await expect(page.locator('.app-bar')).not.toHaveAttribute('inert', '')
    await expect(source(page)).toHaveValue('第一次未保存')
    expect(await readFile(file, 'utf8')).toBe('磁盘原文')
    await removePage(page, '外部文件.md')
    await expect.poll(() => app.evaluate(() => globalThis.__boundFileCloseAnswers)).toEqual([2, 0])
    await expect(page.getByRole('tab', { name: /外部文件.md/ })).toHaveCount(0)
    await expect(page.locator('.app-bar')).not.toHaveAttribute('inert', '')
    expect(await readFile(file, 'utf8')).toBe('第一次未保存')
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, file)
    await menuCommand(page, 'open')
    await expect(page.getByRole('tab', { name: '外部文件.md', exact: true })).toBeVisible()
    await expect(page.locator('.app-bar')).not.toHaveAttribute('inert', '')
    await putSource(page, '这次放弃修改')
    await expect(page.locator('.app-bar')).not.toHaveAttribute('inert', '')
    await removePage(page, '外部文件.md')
    await expect.poll(() => app.evaluate(() => globalThis.__boundFileCloseAnswers)).toEqual([2, 0, 1])
    await expect(page.locator('.app-bar')).not.toHaveAttribute('inert', '')
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

test('第二实例旧快照迟到不删除新建标签，也不复活已关闭标签', async () => {
  const { directory, profile } = await sandbox()
  const file = join(directory, '第二实例文件.md')
  await writeFile(file, '从第二实例打开')
  let app
  try {
    const launched = await launch(profile); app = launched.app; const page = launched.page
    await nameDraft(page, '稍后关闭')
    // Hold only delivery of the genuine second-instance event. Its file read,
    // SQLite commit and ordering in the main operation queue execute normally.
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      const send = contents.send.bind(contents)
      globalThis.__heldDocuments = null
      contents.send = (channel, ...args) => {
        if (channel === 'documents:changed') { globalThis.__heldDocuments = args[0]; return }
        return send(channel, ...args)
      }
      globalThis.__deliverDocuments = () => send('documents:changed', globalThis.__heldDocuments)
    })
    const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
    const executable = await app.evaluate(() => process.execPath)
    const child = spawn(executable, process.env.PACKAGED_EXE ? [file] : [root, file], { env, stdio: 'ignore' })
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Second instance exit: ${code}`))) })
    await expect.poll(() => app.evaluate(() => !!globalThis.__heldDocuments)).toBe(true)
    await page.getByRole('button', { name: '新建笔记', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(3)
    await expect(page.locator('.app-bar')).not.toHaveAttribute('inert', '')
    await nameDraft(page, '较晚新建的草稿')
    await putSource(page, '不能被旧快照抹掉的新正文')
    await expect(status(page)).toHaveText('已自动保存')
    const before = await snapshot(page)
    await app.evaluate(() => globalThis.__deliverDocuments())
    await expect(page.getByRole('tab')).toHaveCount(3)
    await expect(nameField(page)).toHaveValue('较晚新建的草稿')
    await expect(source(page)).toHaveValue('不能被旧快照抹掉的新正文')
    await removePage(page, '稍后关闭')
    await expect(page.getByRole('tab')).toHaveCount(2)
    await app.evaluate(() => globalThis.__deliverDocuments())
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(page.getByRole('tab', { name: '稍后关闭', exact: true })).toHaveCount(0)
    expect((await snapshot(page)).documents.map(doc => doc.id)).toEqual(before.documents.slice(1).map(doc => doc.id))
    await closeWindow(app)
    const restarted = await launch(profile); app = restarted.app
    expect((await snapshot(restarted.page)).documents.map(doc => doc.title)).toEqual(['第二实例文件.md', '较晚新建的草稿'])
  } finally { await stop(app); await cleanup(directory) }
})

async function holdOpenEvent(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents, send = contents.send.bind(contents)
    globalThis.__openSnapshot = null
    contents.send = (channel, ...args) => {
      if (channel === 'documents:changed') { globalThis.__openSnapshot = args[0]; return }
      return send(channel, ...args)
    }
    globalThis.__deliverOpen = () => send('documents:changed', globalThis.__openSnapshot)
  })
}
async function openSecondInstance(app, profile, file) {
  const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
  const executable = await app.evaluate(() => process.execPath)
  const child = spawn(executable, process.env.PACKAGED_EXE ? [file] : [root, file], { env, stdio: 'ignore' })
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Second instance exit: ${code}`))) })
}
async function holdFirstUpdate(app) {
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('documents:update')
    let first = true; globalThis.__updateHeld = false
    ipcMain.removeHandler('documents:update')
    ipcMain.handle('documents:update', async (...args) => {
      const result = await original(...args)
      if (first) {
        first = false; globalThis.__updateHeld = true
        await new Promise(resolve => { globalThis.__releaseUpdate = resolve })
      }
      return result
    })
  })
}

test('审核回归：旧打开事件不能解绑已保存文件，移除等待正文写入并确认', async () => {
  const { directory, profile } = await sandbox()
  const destination = join(directory, '已保存.md'), other = join(directory, '其他.md')
  await writeFile(other, '另一篇')
  let app
  try {
    const launched = await launch(profile); app = launched.app; const page = launched.page
    await nameDraft(page, '草稿'); await putSource(page, '最初写入磁盘的正文')
    await expect(status(page)).toHaveText('已自动保存')
    const id = (await snapshot(page)).activeId
    await holdOpenEvent(app); await openSecondInstance(app, profile, other)
    await expect.poll(() => app.evaluate(() => !!globalThis.__openSnapshot)).toBe(true)
    await app.evaluate(({ dialog }, filePath) => {
      globalThis.__fileCloseDialogs = []
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      dialog.showMessageBox = async (_window, options) => { globalThis.__fileCloseDialogs.push(options.message); return { response: 2 } }
    }, destination)
    await menuCommand(page, 'save')
    await expect(page.getByRole('tab', { name: '已保存.md', exact: true })).toBeVisible()
    await app.evaluate(() => globalThis.__deliverOpen())
    await page.getByRole('tab', { name: '已保存.md', exact: true }).click()
    await expect(page.locator('header')).not.toHaveAttribute('inert', '')
    await holdFirstUpdate(app)
    await source(page).fill('尚未收到备份回执的文件修改')
    await expect.poll(() => app.evaluate(() => globalThis.__updateHeld)).toBe(true)
    await removePage(page, '已保存.md', { wait: false })
    await expect(page.locator('header')).toHaveAttribute('inert', '')
    await app.evaluate(() => globalThis.__releaseUpdate())
    await finishRemovePage(page)
    expect(await app.evaluate(() => globalThis.__fileCloseDialogs)).toHaveLength(1)
    expect((await snapshot(page)).documents.find(doc => doc.id === id)?.markdown).toBe('尚未收到备份回执的文件修改')
    expect(await readFile(destination, 'utf8')).toBe('最初写入磁盘的正文')
    await expect(nameField(page)).toHaveCount(0)
    await expect(page.locator('.document-meta').getByText(destination, { exact: true })).toBeVisible()
  } finally { await stop(app); await cleanup(directory) }
})

for (const invalidName of ['x'.repeat(1025), '中'.repeat(342)]) {
  test(`审核回归：UTF8超长名称可纠正且不阻断正文另存（${invalidName.length}字符）`, async () => {
    const { directory, profile } = await sandbox()
    const destination = join(directory, '正文出口.md')
    let app
    try {
      const launched = await launch(profile); app = launched.app; const page = launched.page
      await nameDraft(page, '安全名称'); await putSource(page, '需要另存的有效正文')
      await expect(status(page)).toHaveText('已自动保存')
      await app.evaluate(({ dialog }, filePath) => {
        globalThis.__nameSaveDialogs = []
        dialog.showSaveDialog = async (_window, options) => { globalThis.__nameSaveDialogs.push(options.defaultPath); return { canceled: false, filePath } }
      }, destination)
      await nameField(page).fill(invalidName); await nameField(page).press('Enter')
      await expect(page.getByRole('alert')).toContainText(/名称.*(过长|1024)/)
      await menuCommand(page, 'saveAs')
      await expect.poll(() => app.evaluate(() => globalThis.__nameSaveDialogs.length)).toBe(1)
      expect(await app.evaluate(() => globalThis.__nameSaveDialogs[0])).toMatch(/安全名称\.md$/)
      await expect(page.getByRole('tab', { name: '正文出口.md', exact: true })).toBeVisible()
      await expect(page.locator('header')).not.toHaveAttribute('inert', '')
      expect(await readFile(destination, 'utf8')).toBe('需要另存的有效正文')
      await page.getByRole('button', { name: '新建笔记', exact: true }).click()
      await expect(page.getByRole('tab')).toHaveCount(2)
      await expect(page.locator('header')).not.toHaveAttribute('inert', '')
      await expect(nameField(page)).toBeVisible()
      await nameField(page).fill(invalidName); await nameField(page).press('Enter')
      await expect(nameField(page)).toHaveValue(invalidName)
      await app.evaluate(({ ipcMain, BrowserWindow }) => {
        const original = ipcMain._invokeHandlers.get('application:close-cancel')
        globalThis.__invalidNameCloseCancelled = false
        ipcMain.removeHandler('application:close-cancel')
        ipcMain.handle('application:close-cancel', (...args) => { globalThis.__invalidNameCloseCancelled = true; return original(...args) })
        BrowserWindow.getAllWindows()[0].close()
      })
      await expect.poll(() => app.evaluate(() => globalThis.__invalidNameCloseCancelled)).toBe(true)
      await expect(page.locator('header')).not.toHaveAttribute('inert', '')
      await expect(nameField(page)).toHaveValue(invalidName)
      await nameDraft(page, '已纠正名称')
      expect((await snapshot(page)).documents.at(-1).title).toBe('已纠正名称')
      await expect(page.getByRole('alert')).toHaveCount(0)
    } finally { await stop(app); await cleanup(directory) }
  })
}

test('审核回归：正文回执重绘不覆盖未结束的中文组合输入', async () => {
  const { directory, profile } = await sandbox()
  let app
  try {
    const launched = await launch(profile); app = launched.app; const page = launched.page
    await holdFirstUpdate(app); await putSource(page, '等待保存回执的正文')
    await expect.poll(() => app.evaluate(() => globalThis.__updateHeld)).toBe(true)
    const revision = (await snapshot(page)).documents[0].revision
    // Chromium composition events are controlled here; this is not a real IME qualification.
    await nameField(page).evaluate(el => {
      el.focus(); el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      el.value = '中文组合未结束'
      el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '中文组合未结束', inputType: 'insertCompositionText' }))
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', isComposing: true }))
    })
    await expect(nameField(page)).toBeFocused()
    await app.evaluate(() => globalThis.__releaseUpdate())
    await expect(status(page)).toHaveText('已自动保存')
    await expect(nameField(page)).toHaveValue('中文组合未结束')
    await nameField(page).evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文组合未结束' })))
    await nameField(page).press('Enter')
    await expect(status(page)).toHaveText('已自动保存')
    const doc = (await snapshot(page)).documents[0]
    expect(doc.title).toBe('中文组合未结束'); expect(doc.revision).toBe(revision)
  } finally { await stop(app); await cleanup(directory) }
})

for (const saveAs of [false, true]) {
  test(`审核回归：${saveAs ? '另存' : '保存'}等待flush时不被第二实例改变目标`, async () => {
    const { directory, profile } = await sandbox()
    const target = join(directory, '目标.md'), other = join(directory, '另一篇.md'), copy = join(directory, '目标副本.md')
    await writeFile(target, '目标原文'); await writeFile(other, '别篇原文')
    let app
    try {
      const launched = await launch(profile, [target]); app = launched.app; const page = launched.page
      await putSource(page, '原目标的修改正文')
      await expect(status(page)).toHaveText('已自动保存 · 未写入文件')
      const targetId = (await snapshot(page)).activeId
      await holdFirstUpdate(app)
      await app.evaluate(({ ipcMain, dialog }, filePath) => {
        const original = ipcMain._invokeHandlers.get('documents:save'); globalThis.__savedTargetIds = []
        ipcMain.removeHandler('documents:save')
        ipcMain.handle('documents:save', (...args) => { globalThis.__savedTargetIds.push(args[1]); return original(...args) })
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, copy)
      // A flush now writes only changed bodies. Create a real pending edit before
      // holding its receipt, rather than depending on a redundant all-tab write.
      await putSource(page, '原目标的修改正文（最后编辑）')
      await menuCommand(page, saveAs ? 'saveAs' : 'save')
      await expect.poll(() => app.evaluate(() => globalThis.__updateHeld)).toBe(true)
      await openSecondInstance(app, profile, other)
      await expect(page.locator('[role=tab]').filter({ hasText: '另一篇.md' })).toHaveAttribute('aria-selected', 'true')
      await app.evaluate(() => globalThis.__releaseUpdate())
      await expect(page.locator('header')).not.toHaveAttribute('inert', '')
      expect(await app.evaluate(() => globalThis.__savedTargetIds)).toEqual([targetId])
      expect(await readFile(saveAs ? copy : target, 'utf8')).toBe('原目标的修改正文（最后编辑）')
      expect(await readFile(other, 'utf8')).toBe('别篇原文')
    } finally { await stop(app); await cleanup(directory) }
  })
}

test('审核回归：迟到打开事件不回退已有标签上较新的主动选择', async () => {
  const { directory, profile } = await sandbox()
  const other = join(directory, '外部打开.md'); await writeFile(other, '外部正文')
  let app
  try {
    const launched = await launch(profile); app = launched.app; const page = launched.page
    await nameDraft(page, '已有一')
    await page.getByRole('button', { name: '新建笔记', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(2)
    await nameDraft(page, '已有二')
    await holdOpenEvent(app); await openSecondInstance(app, profile, other)
    await expect.poll(() => app.evaluate(() => !!globalThis.__openSnapshot)).toBe(true)
    await page.getByRole('tab', { name: '已有一', exact: true }).click()
    await expect(page.locator('header')).not.toHaveAttribute('inert', '')
    const selectedId = (await snapshot(page)).activeId
    await app.evaluate(() => globalThis.__deliverOpen())
    await expect(page.getByRole('tab')).toHaveCount(3)
    await expect(page.getByRole('tab', { name: '已有一', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveTitle('已有一 — frowd')
    expect((await snapshot(page)).activeId).toBe(selectedId)
    // Also delay the authoritative metadata reply itself: a later user choice wins.
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('documents:list-metadata')
      let first = true; globalThis.__metadataHeld = false
      ipcMain.removeHandler('documents:list-metadata')
      ipcMain.handle('documents:list-metadata', async (...args) => {
        const result = await original(...args)
        if (first) {
          first = false; globalThis.__metadataHeld = true
          await new Promise(resolve => { globalThis.__releaseMetadata = resolve })
        }
        return result
      })
      globalThis.__deliverOpen()
    })
    await expect.poll(() => app.evaluate(() => globalThis.__metadataHeld)).toBe(true)
    await page.getByRole('tab', { name: '已有二', exact: true }).click()
    await expect(page.locator('header')).not.toHaveAttribute('inert', '')
    await app.evaluate(() => globalThis.__releaseMetadata())
    await snapshot(page) // an IPC round trip after releasing the earlier reply
    await expect(page.getByRole('tab', { name: '已有二', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveTitle('已有二 — frowd')
  } finally { await stop(app); await cleanup(directory) }
})
