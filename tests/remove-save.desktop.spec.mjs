import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { bindMenu, editorReady, menuCommand, removePage } from './native-menu.mjs'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const draftText = '# 要保留的笔记\n\n刚写的内容 $x^2$。'
const processHandles = new WeakMap()
const source = page => page.locator('.document-pane:visible textarea')
async function fixture({ text = draftText, title = '待处理的笔记' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'frowd-remove-')), profile = join(directory, 'profile')
  const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ ...(process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: [] } : { args: [root] }), env, timeout: 30000 })
  processHandles.set(app, app.process())
  const page = await app.firstWindow(); bindMenu(app, page); await editorReady(page)
  await page.getByRole('textbox', { name: '草稿名称', exact: true }).fill(title)
  await menuCommand(page, 'source'); await editorReady(page)
  await source(page).fill(text)
  const id = (await page.evaluate(() => window.desktop.listMetadata())).activeId
  return { directory, profile, app, page, id, title, text }
}
async function dialogs(app, choice, destination = null) {
  await app.evaluate(({ dialog }, { choice, destination }) => {
    globalThis.__removeQuestions = []; globalThis.__removeSaveDialogs = []
    dialog.showMessageBox = async (_window, options) => { globalThis.__removeQuestions.push(options); return { response: choice } }
    dialog.showSaveDialog = async (_window, options) => { globalThis.__removeSaveDialogs.push(options); return destination ? { canceled: false, filePath: destination } : { canceled: true } }
  }, { choice, destination })
}
async function question(app) { return app.evaluate(() => globalThis.__removeQuestions) }
async function retained(page, id, text) {
  expect((await page.evaluate(() => window.desktop.listMetadata())).documents.some(doc => doc.id === id)).toBe(true)
  expect((await page.evaluate(id => window.desktop.read(id), id)).markdown).toBe(text)
}
async function cleanup(app, directory) {
  const child = processHandles.get(app)
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve))
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await exited
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

test('有内容草稿删除前提供保存/删除/取消，取消保留正文和页面', async () => {
  const { app, page, directory, id, title } = await fixture()
  try {
    await dialogs(app, 2)
    await removePage(page, title)
    const questions = await question(app)
    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatchObject({ message: '要保留这篇笔记吗？', detail: title, buttons: ['保存为 Markdown', '直接删除', '取消'], defaultId: 0, cancelId: 2 })
    await retained(page, id, draftText)
    expect(await app.evaluate(() => globalThis.__removeSaveDialogs)).toHaveLength(0)
    await expect(source(page)).toHaveValue(draftText)
  } finally { await cleanup(app, directory) }
})

test('保存为Markdown选择目录/文件名，成功后才移除并可撤销', async () => {
  const { app, page, directory, id, title } = await fixture()
  try {
    const destinationDirectory = join(directory, '我的Markdown'); await mkdir(destinationDirectory)
    const destination = join(destinationDirectory, '自定义名称.md')
    await dialogs(app, 0, destination)
    await removePage(page, title)
    expect(await question(app)).toHaveLength(1)
    const selections = await app.evaluate(() => globalThis.__removeSaveDialogs)
    expect(selections).toHaveLength(1)
    expect(selections[0].defaultPath).toBe(`${title}.md`)
    expect(await readFile(destination, 'utf8')).toBe(draftText)
    expect((await page.evaluate(() => window.desktop.listMetadata())).documents.some(doc => doc.id === id)).toBe(false)
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await editorReady(page)
    const restored = (await page.evaluate(() => window.desktop.listMetadata())).documents[0]
    expect(restored.path).toBe(destination)
    expect((await page.evaluate(id => window.desktop.read(id), restored.id)).markdown).toBe(draftText)
  } finally { await cleanup(app, directory) }
})

test('取消文件选择保留草稿；再次选择直接删除可撤销', async () => {
  const { app, page, directory, id, title } = await fixture()
  try {
    await dialogs(app, 0)
    await removePage(page, title)
    expect(await app.evaluate(() => globalThis.__removeSaveDialogs)).toHaveLength(1)
    await retained(page, id, draftText)
    await dialogs(app, 1)
    await removePage(page, title)
    expect(await question(app)).toHaveLength(1)
    expect(await app.evaluate(() => globalThis.__removeSaveDialogs)).toHaveLength(0)
    expect((await page.evaluate(() => window.desktop.listMetadata())).documents).toHaveLength(0)
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await editorReady(page)
    const recovered = (await page.evaluate(() => window.desktop.listMetadata())).documents[0]
    expect(recovered.path).toBeNull()
    expect((await page.evaluate(id => window.desktop.read(id), recovered.id)).markdown).toBe(draftText)
  } finally { await cleanup(app, directory) }
})

test('磁盘写入失败不移除页面，之后可重新保存', async () => {
  const { app, page, directory, id, title } = await fixture()
  try {
    // A real directory cannot be atomically replaced by a file; do not mock fs.
    await dialogs(app, 0, directory)
    await removePage(page, title)
    await expect(page.getByRole('alert')).toBeVisible()
    await retained(page, id, draftText)
    const destination = join(directory, '重试保存.md')
    await dialogs(app, 0, destination)
    await removePage(page, title)
    expect(await readFile(destination, 'utf8')).toBe(draftText)
    expect((await page.evaluate(() => window.desktop.listMetadata())).documents).toHaveLength(0)
  } finally { await cleanup(app, directory) }
})

test('空白草稿直接删除；收起和退出不询问保存', async () => {
  const { app, page, directory, title } = await fixture({ text: ' \n\t ' })
  try {
    await dialogs(app, 2)
    await removePage(page, title)
    expect(await question(app)).toHaveLength(0)
    expect((await page.evaluate(() => window.desktop.listMetadata())).documents).toHaveLength(0)
    await menuCommand(page, 'new'); await editorReady(page)
    await menuCommand(page, 'source'); await editorReady(page); await source(page).fill(draftText)
    await page.getByRole('button', { name: '收起 未命名笔记', exact: true }).click(); await editorReady(page)
    await expect(page.getByRole('tab')).toHaveCount(0)
    expect(await question(app)).toHaveLength(0)
    const closed = app.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed
  } finally { await cleanup(app, directory) }
})

test('删除已收起的另一篇时保存正确目标，不改变当前页正文', async () => {
  const { app, page, directory, id, title } = await fixture()
  try {
    await page.getByRole('button', { name: `收起 ${title}`, exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(0); await editorReady(page)
    await menuCommand(page, 'new'); await editorReady(page)
    await menuCommand(page, 'source'); await editorReady(page); await source(page).fill('当前页保留')
    const currentId = (await page.evaluate(() => window.desktop.listMetadata())).activeId
    const destination = join(directory, '收起的那篇.md')
    await dialogs(app, 0, destination)
    await removePage(page, title)
    expect(await readFile(destination, 'utf8')).toBe(draftText)
    const metadata = await page.evaluate(() => window.desktop.listMetadata())
    expect(metadata.activeId).toBe(currentId); expect(metadata.documents.some(doc => doc.id === id)).toBe(false)
    await expect(source(page)).toHaveValue('当前页保留')
  } finally { await cleanup(app, directory) }
})

test('文件已保存但列表移除失败，页面显示已关联文件并允许重试', async () => {
  const { app, page, directory, profile, id, title } = await fixture(); let db
  try {
    await expect(page.getByRole('status', { name: '自动保存状态', exact: true })).toHaveText('已自动保存')
    const destination = join(directory, '保留下来的文件.md')
    db = new DatabaseSync(join(profile, 'drafts.sqlite'))
    db.exec("CREATE TRIGGER reject_remove BEFORE DELETE ON documents BEGIN SELECT RAISE(ABORT,'controlled removal failure'); END")
    await dialogs(app, 0, destination)
    await removePage(page, title)
    expect(await readFile(destination, 'utf8')).toBe(draftText)
    await retained(page, id, draftText)
    await expect(page.locator('.document-meta').getByText(destination, { exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('页面移除失败')
    db.exec('DROP TRIGGER reject_remove')
    await removePage(page, '保留下来的文件.md')
    expect((await page.evaluate(() => window.desktop.listMetadata())).documents).toHaveLength(0)
    expect(await readFile(destination, 'utf8')).toBe(draftText)
  } finally { db?.close(); await cleanup(app, directory) }
})
