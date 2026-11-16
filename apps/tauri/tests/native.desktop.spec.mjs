import { test, expect, chromium } from '@playwright/test'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtemp, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const execute = promisify(execFile)
const root = fileURLToPath(new URL('../../../', import.meta.url))
// FROWANG_USER_DATA is intentionally supported only by the debug application.
const executable = join(root, 'apps/tauri/src-tauri/target/debug/frowd-tauri.exe')
const evidence = join(root, 'output/tauri-native-profiles')
const body = page => page.getByRole('textbox', { name: 'Markdown 正文', exact: true })
const source = page => page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
const nameInput = page => page.getByRole('textbox', { name: '当前页面名称', exact: true })

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function fixture() {
  await mkdir(evidence, { recursive: true })
  const directory = await mkdtemp(join(evidence, 'case-'))
  return { directory, profile: join(directory, 'profile') }
}

function debugEndpoint(port) {
  return fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })
    .then(response => response.ok).catch(() => false)
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { if (error.code === 'ESRCH') return false; throw error }
}

async function stopFailedChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 15000 }).toBe(true)
}

async function launch(profile) {
  const port = await freePort()
  const child = spawn(executable, [], {
    windowsHide: true,
    env: {
      ...process.env,
      FROWANG_USER_DATA: profile,
      WEBVIEW2_USER_DATA_FOLDER: join(profile, 'webview2'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostic = ''
  child.stdout.on('data', bytes => { diagnostic += bytes.toString() })
  child.stderr.on('data', bytes => { diagnostic += bytes.toString() })
  let startupError
  child.on('error', error => { startupError = error })
  let browser
  try {
    await expect.poll(async () => {
      if (startupError) throw startupError
      if (child.exitCode !== null) throw Error(`Native startup exited ${child.exitCode}\n${diagnostic}`)
      return debugEndpoint(port)
    }, { timeout: 60000 }).toBe(true)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const session = await browser.newBrowserCDPSession()
    const processes = await session.send('SystemInfo.getProcessInfo')
    const browserPid = processes.processInfo.find(process => process.type === 'browser')?.id
    await session.detach()
    expect(browserPid).toBeGreaterThan(0)
    const context = browser.contexts()[0]
    const page = context.pages()[0] || await context.waitForEvent('page')
    await expect(page.locator('.loading-state')).toHaveCount(0)
    await expect(body(page)).toBeVisible()
    expect(await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__ && !window.__FROWD_TEST_HOST__))).toBe(true)
    expect((await stat(join(profile, 'webview2'))).isDirectory()).toBe(true)
    expect((await stat(join(profile, 'drafts.sqlite'))).isFile()).toBe(true)
    return { child, browser, page, port, profile, browserPid }
  } catch (error) {
    await browser?.close().catch(() => {})
    await stopFailedChild(child)
    throw new Error(`Native launch failed: pid=${child.pid}, port=${port}, profile=${profile}\n${diagnostic}\n${error.message}`, { cause: error })
  }
}

async function closeNormally(app) {
  // Send the real window-close event so the renderer flush / SQLite checkpoint
  // handshake runs before the native process exits.
  const exited = once(app.child, 'exit')
  const script = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FrowdClose { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam); }'
$taskProcess = Get-Process -Id ${app.child.pid}
if ($taskProcess.MainWindowHandle -eq 0) { throw 'Native window handle unavailable' }
if (-not [FrowdClose]::PostMessage($taskProcess.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Window close failed' }
`
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
  await expect.poll(() => app.child.exitCode, { timeout: 15000 }).toBe(0)
  await exited
  await app.browser.close()
  // A WebView2 environment can outlive its host briefly. Do not reopen the same
  // profile with new debugging options until that exact browser process exits.
  await expect.poll(() => debugEndpoint(app.port), { timeout: 15000 }).toBe(false)
  await expect.poll(() => processAlive(app.browserPid), { timeout: 15000 }).toBe(false)
}

async function cleanup(app) {
  if (!app) return
  await app.browser.close().catch(() => {})
  await stopFailedChild(app.child)
}

async function setMode(page, mode) {
  if (await source(page).isVisible() === (mode === 'source')) return
  await page.locator('summary').filter({ hasText: '视图' }).click()
  await page.getByRole('button', { name: mode === 'source' ? /^源码/ : /^正文/ }).click()
  await expect(mode === 'source' ? source(page) : body(page)).toBeVisible()
}

async function pasteImage(page) {
  const bytes = await readFile(join(root, 'apps/tauri/tests/fixtures/synthetic-resource.png'))
  await body(page).click()
  await page.keyboard.press('Control+End')
  await body(page).evaluate((element, bytes) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(bytes)], 'native-sample.png', { type: 'image/png' }))
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
  }, Array.from(bytes))
  await expect.poll(() => body(page).locator('img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 0))).toBe(true)
}

function seedFile(profile, id, file, markdown) {
  // Only call with the app closed, against a disposable profile created above.
  const hash = createHash('sha256').update(markdown).digest('hex')
  const db = new DatabaseSync(join(profile, 'drafts.sqlite'))
  try {
    db.prepare('UPDATE documents SET title=?,path=?,markdown=?,contentHash=?,savedHash=?,baseline=?,revision=1 WHERE id=?')
      .run('原生文件.md', file, markdown, hash, hash, hash, id)
  } finally { db.close() }
}

test('native WebView2 authoring, search, managed image and normal-close SQLite recovery', async ({}, info) => {
  const { directory, profile } = await fixture()
  let app
  try {
    app = await launch(profile)
    let page = app.page
    await nameInput(page).fill('原生草稿')
    await nameInput(page).press('Enter')
    await setMode(page, 'source')
    await source(page).fill('# 原生标题\n\n跨页检索文字\n\n第二节\n---\n\n图片在此。')
    await setMode(page, 'rendered')
    await pasteImage(page)
    const before = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_metadata'))
    const originalId = before.activeId
    await page.getByRole('button', { name: '新建页面', exact: true }).click()
    await nameInput(page).fill('第二页')
    await nameInput(page).press('Enter')
    await body(page).fill('第二页正文')
    await page.getByRole('button', { name: '标签收起 原生草稿', exact: true }).click()
    const query = page.getByRole('searchbox', { name: '搜索全部页面', exact: true })
    await query.fill('跨页检索文字')
    await page.locator('.search-result').filter({ hasText: '原生草稿' }).click()
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('跨页检索文字')
    await query.fill('')
    await expect(body(page).locator('h1')).toHaveText('原生标题')
    await expect.poll(() => body(page).locator('img').evaluateAll(images => images.some(image => image.naturalWidth > 0))).toBe(true)
    await closeNormally(app)
    app = null

    app = await launch(profile)
    page = app.page
    await expect(nameInput(page)).toHaveValue('原生草稿')
    await expect(body(page)).toContainText('跨页检索文字')
    await expect.poll(() => body(page).locator('img').evaluateAll(images => images.some(image => image.naturalWidth > 0))).toBe(true)
    const after = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_metadata'))
    expect(after.activeId).toBe(originalId)
    expect(after.documents.map(document => document.title)).toEqual(['原生草稿', '第二页'])
    await page.screenshot({ path: info.outputPath('native-recovered.png') })
    await writeFile(join(directory, 'result.json'), JSON.stringify({ before, after }, null, 2))
    await closeNormally(app)
    app = null
  } finally { await cleanup(app) }
})

test('native save writes Markdown and its managed image beside an existing file', async ({}, info) => {
  const { directory, profile } = await fixture()
  let app
  try {
    app = await launch(profile)
    const initial = await app.page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_metadata'))
    await closeNormally(app)
    app = null
    const file = join(directory, '原生文件.md')
    const markdown = '# 原生文件\n\n保存图片。'
    await writeFile(file, markdown)
    seedFile(profile, initial.activeId, file, markdown)
    app = await launch(profile)
    await pasteImage(app.page)
    await app.page.keyboard.press('Control+s')
    await expect.poll(() => readFile(file, 'utf8')).toContain('.frowd-assets/')
    const saved = await readFile(file, 'utf8')
    const reference = saved.match(/\.frowd-assets\/[^\s)]+/)?.[0]
    expect(reference).toBeTruthy()
    expect(await readFile(resolve(dirname(file), reference))).toEqual(await readFile(join(root, 'apps/tauri/tests/fixtures/synthetic-resource.png')))
    await expect(app.page.getByRole('status', { name: '保存状态', exact: true })).toHaveText('已保存')
    await app.page.screenshot({ path: info.outputPath('native-saved-image.png') })
    await closeNormally(app)
    app = null
    // Reopen from a fresh profile with no asset binding, so rendering must resolve
    // the saved relative file rather than the old profile's imported object.
    const freshProfile = join(directory, 'profile-from-disk')
    app = await launch(freshProfile)
    const fresh = await app.page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_metadata'))
    await closeNormally(app)
    app = null
    seedFile(freshProfile, fresh.activeId, file, saved)
    app = await launch(freshProfile)
    await expect.poll(() => body(app.page).locator('img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 0))).toBe(true)
    await expect(body(app.page)).toContainText('保存图片。')
    await closeNormally(app)
    app = null
  } finally { await cleanup(app) }
})

test('native reading preferences and Setext outline survive restart in an isolated WebView profile', async ({}, info) => {
  const { profile } = await fixture()
  let app
  try {
    app = await launch(profile)
    let page = app.page
    await setMode(page, 'source')
    await source(page).fill('# 第一节\n\nHello 世界\n\n第二节\n---\n\n结束')
    await setMode(page, 'rendered')
    await page.getByRole('button', { name: '大纲', exact: true }).click()
    await page.getByRole('button', { name: '第二节', exact: true }).click()
    await expect.poll(() => page.evaluate(() => getSelection()?.anchorNode?.parentElement?.closest('h2')?.textContent)).toBe('第二节')
    const count = page.getByRole('status', { name: '字数统计', exact: true })
    await expect(count).toHaveText(/\d+ 字词 · \d+ 字符/)
    const originalCount = await count.textContent()
    await page.getByRole('button', { name: '阅读设置', exact: true }).click()
    await page.getByRole('combobox', { name: '正文字号', exact: true }).selectOption('20')
    await page.getByRole('combobox', { name: '正文宽度', exact: true }).selectOption('720')
    await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('dark')
    await page.getByRole('button', { name: '关闭阅读设置', exact: true }).click()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark')
    await expect(body(page)).toHaveCSS('font-size', '20px')
    await closeNormally(app)
    app = null

    app = await launch(profile)
    page = app.page
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark')
    await expect(body(page)).toHaveCSS('font-size', '20px')
    await expect(page.getByRole('status', { name: '字数统计', exact: true })).toHaveText(originalCount)
    await page.getByRole('button', { name: '阅读设置', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '正文宽度', exact: true })).toHaveValue('720')
    await expect(page.getByRole('combobox', { name: '主题', exact: true })).toHaveValue('dark')
    await page.screenshot({ path: info.outputPath('native-reading-dark.png') })
    await closeNormally(app)
    app = null
  } finally { await cleanup(app) }
})
