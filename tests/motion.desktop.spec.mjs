import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DocumentStore } from '../apps/desktop/src/main/documentStore.js'
import { bindMenu, editorReady, menuCommand } from './native-menu.mjs'
const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const body = page => page.getByRole('textbox', { name: 'Markdown 正文', exact: true })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-motion-')), profile = join(directory, 'profile')
  const store = new DocumentStore(profile)
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lKkAAAAASUVORK5CYII=', 'base64')
  await writeFile(join(directory, 'pixel.png'), image)
  const file = join(directory, '动效.md')
  const markdown = '# 动效样本\n\n正文与公式 $x^2$。\n\n$$\ny = ax + b\n$$\n\n![本地图片](pixel.png)\n\n```js\nconst value = 1\n```\n\n' + Array.from({ length: 18 }, (_, i) => `第${i}段保留正文。`).join('\n\n')
  await writeFile(file, markdown)
  try { await store.restore(); await store.openFile(file) } finally { await store.dispose() }
  const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ ...(process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: [] } : { args: [root] }), env, timeout: 30000 })
  const page = await app.firstWindow(); bindMenu(app, page); await editorReady(page)
  return { directory, app, page }
}
async function cleanup(app, directory) {
  const child = app.process()
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve))
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await exited
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
async function observeMotion(page) {
  await page.evaluate(() => {
    window.__motions = []
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof HTMLCanvasElement) || !node.classList.contains('page-flight')) continue
        const entry = { direction: node.dataset.direction, started: performance.now(), painted: false, width: node.width, height: node.height }
        window.__motions.push(entry)
        const watch = () => {
          if (!node.isConnected) { entry.duration = performance.now() - entry.started; return }
          if (Number(node.dataset.progress) > .15 && Number(node.dataset.progress) < .85) {
            const { data } = node.getContext('2d').getImageData(0, 0, node.width, node.height)
            let dark = 0
            for (let i = 0; i < data.length; i += 16) if (data[i+3] > 100 && data[i] < 180 && data[i+1] < 180) dark++
            entry.painted ||= dark > 20
          }
          requestAnimationFrame(watch)
        }
        requestAnimationFrame(watch)
      }
    }).observe(document.body, { childList: true })
  })
}
async function shelve(page) {
  await page.getByRole('button', { name: '收起 动效.md', exact: true }).click()
  await expect(page.getByRole('tab', { name: '动效.md', exact: true })).toHaveCount(0)
  await editorReady(page)
}
async function restore(page) {
  await page.getByRole('button', { name: '页面列表', exact: true }).click()
  await page.getByRole('button', { name: '打开 动效.md', exact: true }).click()
  await expect(page.getByRole('tab', { name: '动效.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await editorReady(page)
}

test('真实画面收尖与反向展开：公式/图片/文字被绘入，编辑和阅读状态保留', async ({}, info) => {
  const { directory, app, page } = await fixture()
  const warnings = [], errors = []
  page.on('console', message => { if (message.text().includes('[page-motion]')) warnings.push(message.text()) })
  page.on('pageerror', error => errors.push(error.message))
  try {
    await expect(body(page).locator('.katex').first()).toBeVisible()
    await expect.poll(() => body(page).locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    const id = await page.evaluate(async () => (await window.desktop.listMetadata()).activeId)
    await body(page).click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' EDIT-KEPT')
    await page.evaluate(() => window.scrollTo(0, 180))
    await observeMotion(page)
    // The native capture is a fixed own-window API and stays in memory.
    const capture = await page.evaluate(() => window.desktop.capturePage())
    expect(capture.startsWith('data:image/png;base64,')).toBe(true)
    await shelve(page)
    await restore(page)
    await expect(body(page)).toContainText('EDIT-KEPT')
    expect(await page.evaluate(() => window.scrollY)).toBe(180)
    expect((await page.evaluate(id => window.desktop.read(id), id)).markdown).toContain('EDIT-KEPT')
    await expect.poll(() => page.evaluate(() => window.__motions.filter(entry => entry.duration).length)).toBe(2)
    const motions = await page.evaluate(() => window.__motions)
    expect(motions.map(entry => entry.direction)).toEqual(['collapse', 'expand'])
    expect(motions.every(entry => entry.painted)).toBe(true)
    expect(motions[0].duration).toBeGreaterThanOrEqual(430)
    expect(motions[0].duration).toBeLessThan(1000)
    expect(motions[1].duration).toBeGreaterThanOrEqual(380)
    expect(motions[1].duration).toBeLessThan(1000)
    expect(motions.every(entry => entry.width <= 2048 && entry.height <= 1536)).toBe(true)
    await expect(page.locator('.page-flight,.page-flight-backdrop')).toHaveCount(0)
    await expect(page.locator('.editor-content')).not.toHaveCSS('visibility', 'hidden')
    await page.getByRole('button', { name: '页面列表', exact: true }).click()
    await expect(page.locator('.shelf-note')).toHaveCount(0)
    await page.screenshot({ path: info.outputPath('genie-integrated.png') })
    expect(warnings).toEqual([]); expect(errors).toEqual([])
  } finally { await cleanup(app, directory) }
})

test('减少动态效果跳过画面捕获；收起仍保存源码与选区', async () => {
  const { directory, app, page } = await fixture()
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await app.evaluate(({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('application:capture-page'); globalThis.__motionCaptures = 0
      ipcMain.removeHandler('application:capture-page')
      ipcMain.handle('application:capture-page', (...args) => { globalThis.__motionCaptures++; return handler(...args) })
    })
    await menuCommand(page, 'source'); await editorReady(page)
    const source = page.locator('.document-pane:visible textarea')
    await source.fill('源码保留\n'.repeat(50))
    await source.evaluate(input => { input.setSelectionRange(3, 8); input.scrollTop = 100 })
    await shelve(page); await restore(page)
    expect(await source.evaluate(input => [input.selectionStart, input.selectionEnd, input.scrollTop])).toEqual([3, 8, 100])
    expect(await app.evaluate(() => globalThis.__motionCaptures)).toBe(0)
    await expect(page.locator('.page-flight')).toHaveCount(0)
  } finally { await cleanup(app, directory) }
})

for (const failure of ['reject', 'pending', 'draw']) test(`动画${failure}不阻断收起或下次恢复，临时画布和锁均清理`, async () => {
  const { directory, app, page } = await fixture()
  try {
    await app.evaluate(({ ipcMain }, failure) => {
      const handler = ipcMain._invokeHandlers.get('application:capture-page')
      globalThis.__restoreMotionCapture = () => { ipcMain.removeHandler('application:capture-page'); ipcMain.handle('application:capture-page', handler) }
      if (failure === 'draw') return
      ipcMain.removeHandler('application:capture-page')
      ipcMain.handle('application:capture-page', () => failure === 'pending' ? new Promise(() => {}) : { ok: false, error: 'controlled failure' })
    }, failure)
    if (failure === 'draw') await page.evaluate(() => {
      const original = CanvasRenderingContext2D.prototype.drawImage
      window.__restoreMotionDraw = () => { CanvasRenderingContext2D.prototype.drawImage = original }
      CanvasRenderingContext2D.prototype.drawImage = function (...args) { if (this.canvas.classList.contains('page-flight')) throw new Error('controlled draw failure'); return original.apply(this, args) }
    })
    await shelve(page)
    await expect(page.locator('.page-flight,.page-flight-backdrop')).toHaveCount(0)
    await expect(page.locator('.editor-content')).not.toHaveCSS('visibility', 'hidden')
    await app.evaluate(() => globalThis.__restoreMotionCapture())
    if (failure === 'draw') await page.evaluate(() => window.__restoreMotionDraw())
    await restore(page)
    await expect(body(page)).toContainText('正文与公式')
  } finally { await cleanup(app, directory) }
})

test('动画中调整窗口或旧打开事件到达时清理旧画面，最终页面与保存状态一致', async () => {
  const { directory, app, page } = await fixture()
  try {
    await page.getByRole('button', { name: '收起 动效.md', exact: true }).click()
    await page.locator('.page-flight').waitFor({ state: 'attached' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(850, 650))
    await expect(page.getByRole('tab', { name: '动效.md', exact: true })).toHaveCount(0); await editorReady(page)
    await expect(page.locator('.page-flight,.page-flight-backdrop')).toHaveCount(0)
    await restore(page)
    const before = await page.evaluate(() => window.desktop.listMetadata())
    await page.getByRole('button', { name: '收起 动效.md', exact: true }).click()
    await page.locator('.page-flight').waitFor({ state: 'attached' })
    await app.evaluate(({ BrowserWindow }, snapshot) => BrowserWindow.getAllWindows()[0].webContents.send('documents:changed', snapshot), before)
    await expect(page.getByRole('tab', { name: '动效.md', exact: true })).toHaveCount(0); await editorReady(page)
    await expect(page.locator('.page-flight,.page-flight-backdrop')).toHaveCount(0)
    expect((await page.evaluate(() => window.desktop.listMetadata())).documents.find(doc => doc.id === before.activeId).shelved).toBe(true)
    await restore(page); await expect(body(page)).toContainText('正文与公式')
  } finally { await cleanup(app, directory) }
})
