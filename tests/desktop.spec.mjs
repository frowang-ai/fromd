import { test, expect, _electron as electron } from '@playwright/test'
import { bindMenu, discardDraftQuestions, removePage, finishRemovePage, editorReady, menuCommand, clickNativeMenu } from './native-menu.mjs'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const processes = new WeakMap()
function recoveryDocuments(profile) {
  const db = new DatabaseSync(join(profile, 'drafts.sqlite'), { readOnly: true })
  try { return db.prepare('SELECT * FROM documents ORDER BY position').all() }
  finally { db.close() }
}
function recoverySQL(profile, sql) {
  const db = new DatabaseSync(join(profile, 'drafts.sqlite'))
  try { db.exec(sql) } finally { db.close() }
}
async function launch(profile, files = []) {
  const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ ...(process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: files } : { args: [root, ...files] }), env, timeout: 30000 })
  processes.set(app, app.process())
  await discardDraftQuestions(app)
  return app
}
async function stop(app) {
  if (!app) return
  const process = processes.get(app)
  if (!process || process.exitCode !== null || process.signalCode !== null) return
  const exited = new Promise(resolve => process.once('exit', resolve))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await exited
}
async function cleanup(directory) { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
const body = page => page.getByRole('textbox', { name: 'Markdown 正文', exact: true })
async function ready(app) {
  const page = await app.firstWindow()
  bindMenu(app, page)
  await editorReady(page)
  return page
}
async function putSource(page, text) {
  await editorReady(page); await menuCommand(page, 'source')
  const editorSource = page.locator('.document-pane:visible').getByRole('textbox', { name: 'Markdown 源码', exact: true })
  await expect(editorSource).toBeVisible(); await editorSource.fill(text)
  await menuCommand(page, 'source')
  await expect(editorSource).toBeHidden()
  await editorReady(page)
}
async function chooseSave(app, path) { await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, path) }
async function chooseMessage(app, response) { await app.evaluate(({ dialog }, response) => { dialog.showMessageBox = async () => ({ response }) }, response) }

test('SQLite桌面：旧会话迁移、命名与阅读位置、关闭后正常退出重启', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-sqlite-')), profile = join(directory, 'profile')
  await mkdir(profile)
  const legacy = JSON.stringify({ version: 1, activeId: 'keep', documents: ['discard', 'keep'].map(id => ({
    id, title: id, path: null, markdown: `${id} 草稿正文`, savedText: '', baseline: null,
    eol: '\n', bom: false, revision: 1, conflict: false,
  })) })
  await writeFile(join(profile, 'session.json'), legacy)
  let app
  try {
    app = await launch(profile); let page = await ready(app)
    await expect(body(page)).toContainText('keep 草稿正文')
    const result = await page.evaluate(async () => {
      const api = window.desktop
      const renamed = await api.rename('keep', '明天继续')
      await api.setViewState('keep', { mode: 'source', scrollTop: 123, sourceSelection: { start: 1, end: 3 } })
      await api.close('discard')
      let closed = false
      try { await api.update('discard', '迟到写入', 99) } catch { closed = true }
      return { renamed, closed, metadata: await api.listMetadata(), read: await api.read('keep') }
    })
    expect(result.renamed).toEqual({ id: 'keep', title: '明天继续', backedUp: true, warning: '' })
    expect(result.closed).toBe(true)
    expect(result.metadata.documents).toHaveLength(1)
    expect(result.metadata.documents[0]).not.toHaveProperty('markdown')
    expect(result.read.revision).toBe(1)
    expect(result.read.viewState.scrollTop).toBe(123)
    await page.reload(); await ready(app)
    await expect(page.getByRole('tab')).toHaveCount(1)
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => { throw new Error('退出不应要求保存文件') } })
    const exited = app.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {})
    await exited
    app = await launch(profile); page = await ready(app)
    await expect(page.getByRole('tab')).toHaveCount(1)
    await expect(page.getByRole('textbox', { name: 'Markdown 源码', exact: true })).toHaveValue('keep 草稿正文')
    await menuCommand(page, 'source')
    await expect(body(page)).toContainText('keep 草稿正文')
    expect(await page.evaluate(async () => (await window.desktop.read('keep')).title)).toBe('明天继续')
    expect(recoveryDocuments(profile).map(doc => doc.id)).toEqual(['keep'])
    expect(await readFile(join(profile, 'session.json'), 'utf8')).toBe(legacy)
  } finally { await stop(app); await cleanup(directory) }
})

for (const change of ['清空正文', '恢复默认名称']) {
  test(`数据库拒写时${change}阻止退出，恢复存储后退出重启保留结果`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'frowang-exit-regression-')), profile = join(directory, 'profile')
    let app
    try {
      app = await launch(profile); let page = await ready(app)
      const id = await page.evaluate(async () => (await window.desktop.listMetadata()).activeId)
      if (change === '清空正文') {
        await putSource(page, '待清空正文')
        await expect.poll(() => recoveryDocuments(profile)[0].markdown).toBe('待清空正文')
      } else {
        expect((await page.evaluate(id => window.desktop.rename(id, '旧草稿名'), id)).backedUp).toBe(true)
      }
      recoverySQL(profile, "CREATE TRIGGER deny_settings BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;")
      if (change === '清空正文') await putSource(page, '')
      else expect((await page.evaluate(id => window.desktop.rename(id, ''), id)).backedUp).toBe(false)
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
      await expect(page.getByRole('alert')).toContainText('草稿备份不可用')
      await expect(page.locator('header')).not.toHaveAttribute('inert', '')
      const current = await page.evaluate(id => window.desktop.read(id), id)
      expect(current.markdown).toBe(''); expect(current.title).toBe('未命名笔记'); expect(current.dirty).toBe(false)
      expect(change === '清空正文' ? recoveryDocuments(profile)[0].markdown : recoveryDocuments(profile)[0].title)
        .toBe(change === '清空正文' ? '待清空正文' : '旧草稿名')
      recoverySQL(profile, 'DROP TRIGGER deny_settings;')
      const exited = app.waitForEvent('close')
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {})
      await exited
      app = await launch(profile); page = await ready(app)
      const restored = await page.evaluate(id => window.desktop.read(id), id)
      expect(restored.markdown).toBe(''); expect(restored.title).toBe('未命名笔记')
      expect(recoveryDocuments(profile)[0].markdown).toBe('')
      expect(recoveryDocuments(profile)[0].title).toBe('未命名笔记')
    } finally { await stop(app); await cleanup(directory) }
  })
}

test('Windows桌面：打开写回、另存、冲突、标签、恢复及PDF', async ({}, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-desktop-')), profile = join(directory, 'profile')
  const file = join(directory, '中文 笔记.md'), copy = join(directory, '另存.md')
  await writeFile(file, '\ufeff# 原文件\r\n\r\n原始内容\r\n')
  let app
  try {
    app = await launch(profile, [file]); let page = await ready(app)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await expect(body(page)).toContainText('原文件')
    await putSource(page, '# 原文件\n\n修改内容 $x^2$\n')
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe('\ufeff# 原文件\r\n\r\n修改内容 $x^2$\r\n')
    await chooseSave(app, copy); await menuCommand(page, 'saveAs')
    await expect(page.getByRole('tab', { name: '另存.md', exact: true })).toBeVisible()
    await expect.poll(() => readFile(copy, 'utf8')).toContain('修改内容')
    await writeFile(copy, '外部版本')
    await putSource(page, '# 内部修改\n\n还未保存')
    await menuCommand(page, 'save')
    await expect(page.getByText('磁盘文件已变化，当前修改仍保留。')).toBeVisible()
    expect(await readFile(copy, 'utf8')).toBe('外部版本')
    await expect(body(page)).toContainText('内部修改')
    await chooseMessage(app, 0); await page.getByRole('button', { name: '重新读取磁盘' }).click()
    await expect(body(page)).toHaveText('外部版本')
    await page.getByRole('button', { name: '新建笔记', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(3)
    await editorReady(page)
    await putSource(page, '# 未保存草稿\n\n- 第一项\n- 第二项\n\n公式 $p=0.012$\n\n<u>下划线</u> <mark>重点</mark> <kbd>Ctrl+S</kbd>\n\n<!-- hidden -->')
    await expect(body(page).locator('u')).toHaveText('下划线'); await expect(body(page).locator('kbd')).toHaveText('Ctrl+S')
    const pdfPath = join(directory, 'out.pdf'); await chooseSave(app, pdfPath)
    await menuCommand(page, 'pdf')
    await expect.poll(async () => (await readFile(pdfPath).catch(() => Buffer.alloc(0))).subarray(0, 5).toString(), { timeout: 60000 }).toBe('%PDF-')
    await expect.poll(async () => recoveryDocuments(profile).at(-1).markdown).toContain('未保存草稿')
    await page.screenshot({ path: info.outputPath('desktop-mvp.png') })
    expect(errors).toEqual([])
    // Kill the renderer host without the normal close handshake: recovery was already acknowledged.
    await stop(app); app = await launch(profile); page = await ready(app)
    await expect(body(page)).toContainText('未保存草稿'); await expect(page.getByRole('tab')).toHaveCount(3)
    // Explicitly discard the temporary draft through its new save/remove question.
    await chooseMessage(app, 1)
    await removePage(page, '未命名笔记')
    await expect(page.getByRole('tab')).toHaveCount(2)
    // Bound dirty files still offer cancel/discard, without deleting disk files.
    await putSource(page, '文件关闭前未保存修改')
    await app.evaluate(({ dialog }) => {
      const answers = [2, 1]
      globalThis.__fileCloseAnswers = []
      dialog.showMessageBox = async () => {
        const response = answers.shift()
        if (response === undefined) throw new Error('Unexpected extra file-close dialog')
        globalThis.__fileCloseAnswers.push(response)
        return { response }
      }
    })
    await removePage(page, '另存.md')
    // Existing tab count/text already hold before close runs. Wait for the
    // actual cancel answer and completed UI operation before the second click.
    await expect.poll(() => app.evaluate(() => globalThis.__fileCloseAnswers)).toEqual([2])
    await expect(page.locator('header')).not.toHaveAttribute('inert', '')
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(body(page)).toContainText('文件关闭前未保存修改')
    await removePage(page, '另存.md')
    await expect.poll(() => app.evaluate(() => globalThis.__fileCloseAnswers)).toEqual([2, 1])
    await expect(page.getByRole('tab')).toHaveCount(1)
    expect(await readFile(copy, 'utf8')).toBe('外部版本')
  } finally { await stop(app); await cleanup(directory) }
})

test('页面崩溃可重载草稿，备份失败但文件已保存仍可退出', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-lifecycle-')), profile = join(directory, 'profile'), file = join(directory, 'saved.md')
  await writeFile(file, 'original')
  let app
  try {
    app = await launch(profile, [file]); let page = await ready(app)
    await putSource(page, 'recovered draft')
    await expect.poll(async () => recoveryDocuments(profile).at(-1).markdown).toBe('recovered draft')
    await chooseMessage(app, 0)
    // Observe the reload from the still-alive main process. Playwright page
    // waiters intentionally reject when the renderer crash is injected.
    await app.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      await new Promise(resolve => { contents.once('did-finish-load', resolve); contents.forcefullyCrashRenderer() })
    })
    // The old Playwright Page is permanently marked crashed. Read the new
    // renderer through Electron, and dispatch the same native-menu save event.
    await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
      `document.querySelector('[aria-label="Markdown 正文"]')?.textContent || ''`
    ))).toContain('recovered draft')
    await clickNativeMenu(app, 'save')
    await expect.poll(() => readFile(file, 'utf8')).toBe('recovered draft')
    // Simulate recovery failure without touching the saved Markdown file.
    recoverySQL(profile, "CREATE TRIGGER deny_settings BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;")
    const exited = app.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close() }).catch(() => {})
    await exited
    expect(await readFile(file, 'utf8')).toBe('recovered draft')
  } finally { await stop(app); await cleanup(directory) }
})

test('重载中关闭等待页面就绪，持久化失败阻止退出，修复后可再次关闭', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-handoff-')), profile = join(directory, 'profile')
  let app
  try {
    app = await launch(profile); const page = await ready(app)
    await putSource(page, '保留重载中的草稿')
    await expect.poll(async () => recoveryDocuments(profile)[0].markdown).toBe('保留重载中的草稿')
    recoverySQL(profile, "CREATE TRIGGER deny_settings BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;")
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => { throw new Error('正常退出不应弹确认') } })
    await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
      const handler = ipcMain._invokeHandlers.get('documents:list')
      let release
      const gate = new Promise(resolve => { release = resolve })
      globalThis.__releaseList = release
      ipcMain.removeHandler('documents:list')
      ipcMain.handle('documents:list', async (...args) => { await gate; return handler(...args) })
      const contents = BrowserWindow.getAllWindows()[0].webContents
      await new Promise(resolve => { contents.once('did-finish-load', resolve); contents.reload() })
    })
    await expect(page.getByText('正在打开笔记…', { exact: true })).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); globalThis.__releaseList() })
    await expect(body(page)).toContainText('保留重载中的草稿')
    await expect(page.getByRole('alert')).toContainText('草稿备份不可用')
    await expect(page.locator('header')).not.toHaveAttribute('inert', '')
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    recoverySQL(profile, 'DROP TRIGGER deny_settings;')
    const exited = app.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {})
    await exited
  } finally { await stop(app); await cleanup(directory) }
})

test('从另一目录启动的相对文件进入现有窗口，原草稿保留', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-second-')), profile = join(directory, 'profile'), another = join(directory, 'other')
  await mkdir(another); await writeFile(join(directory, 'note.md'), '目录一'); await writeFile(join(another, 'note.md'), '目录二')
  let app
  try {
    app = await launch(profile, [join(directory, 'note.md')]); const page = await ready(app)
    await putSource(page, '目录一的未保存修改')
    const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
    const executable = await app.evaluate(() => process.execPath)
    const secondArgs = process.env.PACKAGED_EXE ? ['note.md'] : [root, 'note.md']
    const child = spawn(executable, secondArgs, { cwd: another, env, stdio: 'ignore' })
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Second instance exit: ${code}`))) })
    await expect(page.getByRole('tab')).toHaveCount(3)
    await expect(body(page)).toHaveText('目录二')
    await page.getByRole('tab').nth(1).click()
    await expect(body(page)).toHaveText('目录一的未保存修改')
    expect(await readFile(join(directory, 'note.md'), 'utf8')).toBe('目录一')
  } finally { await stop(app); await cleanup(directory) }
})

test('桌面编辑：有序列表、公式编辑、格式与本地图片', async ({}, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-edit-')), profile = join(directory, 'profile')
  const path = join(directory, 'note.md')
  await writeFile(join(directory, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4ZkAAAAASUVORK5CYII=', 'base64'))
  await writeFile(path, '# 本地图片\n\n![像素](pixel.png)\n\n正文')
  let app
  try {
    app = await launch(profile, [path]); const page = await ready(app)
    await expect.poll(() => body(page).getByRole('img', { name: '像素', exact: true }).evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true)
    const imagePdf = join(directory, 'local-image.pdf')
    await chooseSave(app, imagePdf)
    await menuCommand(page, 'pdf')
    await expect.poll(async () => {
      const alert = page.getByRole('alert')
      if (await alert.count()) return await alert.first().innerText()
      return (await readFile(imagePdf).catch(() => Buffer.alloc(0))).subarray(0, 5).toString()
    }, { timeout: 15000 }).toBe('%PDF-')
    await putSource(page, '')
    await body(page).click(); await page.keyboard.type('1. ')
    await expect(body(page).locator('.label.ordered')).toHaveText(['1.'])
    await page.keyboard.insertText('第一项'); await page.keyboard.press('Enter')
    await expect(body(page).locator('.label.ordered')).toHaveText(['1.', '2.'])
    await page.keyboard.insertText('第二项'); await page.keyboard.press('Tab')
    await expect(body(page).locator('ol ol')).toHaveCount(1)
    await page.keyboard.press('Shift+Tab'); await expect(body(page).locator('ol ol')).toHaveCount(0)
    await putSource(page, '# 公式\n\n行内 $p=0.012$\n\n$$\nx^2+y^2=z^2\n$$\n\n末尾')
    await page.getByRole('button', { name: '编辑行内公式' }).click()
    await page.getByRole('textbox', { name: '行内公式 LaTeX' }).fill('p=0.025')
    await page.getByRole('textbox', { name: '行内公式 LaTeX' }).press('Enter')
    await expect(body(page).locator('.writing-math-inline annotation')).toHaveText('p=0.025')
    await page.getByRole('button', { name: '编辑行间公式' }).click()
    await expect(body(page).locator('.cm-activeLine')).toHaveCount(1)
    await page.getByRole('textbox', { name: '行间公式 LaTeX' }).fill('a+b=c')
    await page.getByRole('button', { name: '完成公式编辑' }).click()
    await expect(body(page).locator('.writing-math-block annotation')).toHaveText('a+b=c')
    await menuCommand(page, 'save')
    await expect.poll(() => readFile(path, 'utf8')).toContain('a+b=c')
    await page.screenshot({ path: info.outputPath('desktop-editor.png') })
  } finally { await stop(app); await cleanup(directory) }
})
