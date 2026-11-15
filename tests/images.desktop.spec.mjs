import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bindMenu, editorReady, menuCommand } from './native-menu.mjs'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4ZkAAAAASUVORK5CYII='
const png = Buffer.from(pngBase64, 'base64')
const body = page => page.getByRole('textbox', { name: 'Markdown 正文', exact: true })
const source = page => page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
const images = page => body(page).locator('img[data-editor-image-src^="_frowd-assets/"]')

async function launch(profile, files = []) {
  const env = { ...process.env, FROWANG_USER_DATA: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    ...(process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: files } : { args: [root, ...files] }),
    env, timeout: 30000,
  })
  const page = await app.firstWindow()
  bindMenu(app, page)
  await editorReady(page)
  return { app, page }
}

async function stop(app) {
  const child = app?.process()
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await exited
}

async function exitNormally(app) {
  const closed = app.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
}

async function chooseSave(app, path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, path)
}

async function currentMarkdown(page) {
  return page.evaluate(async () => {
    const state = await window.desktop.listMetadata()
    return (await window.desktop.read(state.activeId)).markdown
  })
}

// Chromium's File and DataTransfer objects exercise the renderer's public
// paste/drop handlers. Storage, preload, IPC and image requests stay real.
async function transferImage(target, kind = 'paste') {
  await target.focus()
  await target.evaluate((element, { kind, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], '合成截图.png', { type: 'image/png' }))
    const event = kind === 'paste'
      ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
      : new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })
    element.dispatchEvent(event)
    if (!event.defaultPrevented) throw new Error('Image event was not handled by the application')
  }, { kind, base64: pngBase64 })
}

async function expectImages(page, count) {
  await expect(images(page)).toHaveCount(count)
  await expect.poll(() => images(page).evaluateAll(nodes => nodes.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
  await editorReady(page)
}

test('草稿截图粘贴后重启可读，另存附件并用全新profile重新打开，PDF包含图片', async ({}, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'frowd-image-ui-'))
  const profile = join(directory, 'profile'), exported = join(directory, 'exported')
  await mkdir(exported)
  let app
  try {
    let launched = await launch(profile)
    app = launched.app
    let page = launched.page
    await body(page).click()
    await page.keyboard.insertText('草稿中的截图')
    await page.keyboard.press('Enter')
    await transferImage(body(page))
    await expectImages(page, 1)
    const asset = await images(page).first().getAttribute('data-editor-image-src')
    expect(await readFile(join(profile, asset))).toEqual(png)
    await expect.poll(() => currentMarkdown(page)).toContain(asset)

    const draftPdf = join(directory, 'draft-image.pdf')
    await chooseSave(app, draftPdf)
    await menuCommand(page, 'pdf')
    await expect.poll(async () => (await readFile(draftPdf).catch(() => Buffer.alloc(0))).subarray(0, 5).toString()).toBe('%PDF-')
    await editorReady(page)
    expect((await readFile(draftPdf)).toString('latin1')).toMatch(/\/Subtype\s*\/Image\b/)

    await exitNormally(app)
    launched = await launch(profile)
    app = launched.app
    page = launched.page
    await expectImages(page, 1)
    await expect(body(page)).toContainText('草稿中的截图')
    const path = join(exported, '图片笔记.md')
    await chooseSave(app, path)
    await menuCommand(page, 'save')
    await expect.poll(async () => (await readFile(path, 'utf8').catch(() => ''))).toContain(asset)
    await editorReady(page)
    expect(await readFile(join(exported, asset))).toEqual(png)
    await exitNormally(app)

    launched = await launch(join(directory, 'fresh-profile'), [path])
    app = launched.app
    page = launched.page
    await expectImages(page, 1)
    await expect(body(page)).toContainText('草稿中的截图')
    await page.screenshot({ path: info.outputPath('saved-image-note.png') })
  } finally {
    await stop(app)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('源码截图粘贴替换选区并支持原生撤销重做，拖入图片仍可切回正文', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowd-image-source-'))
  let app
  try {
    const launched = await launch(join(directory, 'profile'))
    app = launched.app
    const page = launched.page
    await menuCommand(page, 'source')
    await expect(source(page)).toBeVisible()
    const original = '前文\n\n替换这里\n\n后文'
    await source(page).fill(original)
    await source(page).evaluate(input => input.setSelectionRange(4, 8))
    await transferImage(source(page))
    await expect(source(page)).toHaveValue(/前文\n\n.*_frowd-assets\/[a-f0-9]{64}\.png.*\n\n后文/s)
    await editorReady(page)
    const pasted = await source(page).inputValue()
    expect(pasted).not.toContain('替换这里')
    await source(page).press('Control+z')
    await expect(source(page)).toHaveValue(original)
    await source(page).press('Control+y')
    await expect(source(page)).toHaveValue(pasted)
    await source(page).evaluate(input => input.setSelectionRange(input.value.length, input.value.length))
    await transferImage(source(page), 'drop')
    await expect.poll(async () => (await source(page).inputValue()).match(/_frowd-assets\//g)?.length).toBe(2)
    await editorReady(page)
    await menuCommand(page, 'source')
    await expectImages(page, 2)
  } finally {
    await stop(app)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('正文拖入图片保留撤销，保存失败后仍可编辑并另存完整附件', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowd-image-failure-'))
  const profile = join(directory, 'profile'), blocked = join(directory, 'blocked.md')
  await mkdir(blocked)
  let app
  try {
    const launched = await launch(profile)
    app = launched.app
    const page = launched.page
    await body(page).click()
    await page.keyboard.insertText('保留正文')
    await page.keyboard.press('Enter')
    await transferImage(body(page), 'drop')
    await expectImages(page, 1)
    await body(page).press('Control+z')
    await expect(images(page)).toHaveCount(0)
    await body(page).press('Control+y')
    await expectImages(page, 1)
    const asset = await images(page).first().getAttribute('data-editor-image-src')
    await chooseSave(app, blocked)
    await menuCommand(page, 'save')
    await expect(page.getByRole('alert')).toBeVisible()
    await editorReady(page)
    await expectImages(page, 1)
    expect(await page.evaluate(async () => {
      const state = await window.desktop.listMetadata()
      return state.documents.find(doc => doc.id === state.activeId).path
    })).toBeNull()
    await body(page).click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('失败后继续写')
    await expect(body(page)).toContainText('失败后继续写')
    await expectImages(page, 1)
    const retry = join(directory, 'retry.md')
    await chooseSave(app, retry)
    await menuCommand(page, 'save')
    await expect.poll(async () => await readFile(retry, 'utf8').catch(() => '')).toContain('失败后继续写')
    await editorReady(page)
    expect(await readFile(join(directory, asset))).toEqual(png)
    expect(await readFile(retry, 'utf8')).toContain(asset)
  } finally {
    await stop(app)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('图片导入回执延迟期间外部打开另一页，图片不会插到新页面', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowd-image-owner-'))
  const other = join(directory, '另一页.md')
  await writeFile(other, '# 另一页\n\n保留外部正文')
  let app
  try {
    const launched = await launch(join(directory, 'profile'))
    app = launched.app
    const page = launched.page
    await body(page).click()
    await page.keyboard.insertText('原草稿')
    const originalId = await page.evaluate(async () => (await window.desktop.listMetadata()).activeId)
    await expect.poll(() => currentMarkdown(page)).toContain('原草稿')
    const originalMarkdown = await currentMarkdown(page)
    // Delay only the completed import's reply; the image write, validation and
    // document operation queue have already completed normally.
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('documents:import-images')
      ipcMain.removeHandler('documents:import-images')
      ipcMain.handle('documents:import-images', async (...args) => {
        const result = await original(...args)
        globalThis.__imageReplyWaiting = true
        await new Promise(resolve => { globalThis.__releaseImageReply = resolve })
        return result
      })
    })
    await transferImage(body(page))
    await expect.poll(() => app.evaluate(() => globalThis.__imageReplyWaiting === true)).toBe(true)
    await app.evaluate(({ app }, file) => app.emit('second-instance', {}, [], '', { files: [file] }), other)
    await expect(page.getByRole('tab', { name: '另一页.md', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(body(page)).toContainText('保留外部正文')
    await app.evaluate(() => globalThis.__releaseImageReply())
    await editorReady(page)
    await expect(images(page)).toHaveCount(0)
    expect(await currentMarkdown(page)).toBe('# 另一页\n\n保留外部正文')
    expect(await readFile(other, 'utf8')).toBe('# 另一页\n\n保留外部正文')
    expect(await page.evaluate(async id => (await window.desktop.read(id)).markdown, originalId)).toBe(originalMarkdown)
    await page.getByRole('tab', { name: '未命名笔记', exact: true }).click()
    await editorReady(page)
    await expect(body(page)).toHaveText('原草稿')
    await expect(images(page)).toHaveCount(0)
  } finally {
    await app?.evaluate(() => globalThis.__releaseImageReply?.()).catch(() => {})
    await stop(app)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
