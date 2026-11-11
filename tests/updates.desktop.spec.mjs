import { test, expect, _electron as electron, chromium } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { extractFile } from '@electron/asar'
import { bindMenu, editorReady, menuCommand, menuState } from './native-menu.mjs'

const processes = new WeakMap()
const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const artifactRoot = process.env.FROWANG_UPDATE_TEST_ARTIFACTS ? resolve(process.env.FROWANG_UPDATE_TEST_ARTIFACTS) : join(root, 'release')
const oldInstaller = join(artifactRoot, 'update-test-0.2.900/Frowang-Update-Test-Setup-0.2.900.exe')
const feedRoot = join(artifactRoot, 'update-test-0.2.901')
const source = page => page.locator('.document-pane:visible').getByRole('textbox', { name: 'Markdown 源码', exact: true })
const name = page => page.getByRole('textbox', { name: '草稿名称', exact: true })
function run(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(`Exit ${code}: ${output}`)))
  })
}
function sql(profile, statement) {
  const db = new DatabaseSync(join(profile, 'drafts.sqlite'))
  try { db.exec(statement) } finally { db.close() }
}
async function normalClose(app) {
  const exit = app.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {})
  await exit
}
async function launch(executablePath, env) {
  const started = performance.now()
  const app = await electron.launch({ executablePath, env, timeout: 30000 })
  processes.set(app, app.process())
  const page = await app.firstWindow(); bindMenu(app, page)
  await editorReady(page)
  return { app, page, readyMs: performance.now() - started }
}
async function ensureSource(page) {
  await editorReady(page)
  if (!(await menuState(page, 'source')).checked) await menuCommand(page, 'source')
  await expect(source(page)).toBeVisible(); await editorReady(page)
}
async function fullSnapshot(page) {
  return page.evaluate(async () => {
    const snapshot = await window.desktop.listMetadata()
    return { ...snapshot, documents: await Promise.all(snapshot.documents.map(doc => window.desktop.read(doc.id))) }
  })
}
// This suite installs real NSIS test builds. It is explicit, Windows-only, and
// never targets a production identity or the user's normal recovery directory.
test('real installed NSIS update: failure protection, later, upgrade, same-entry recovery and no redownload', async () => {
  test.skip(process.platform !== 'win32', 'Windows NSIS integration')
  await stat(oldInstaller); await stat(join(feedRoot, 'latest.yml'))
  const fixtures = join(root, 'output', 'update-fixtures'); await mkdir(fixtures, { recursive: true })
  const fixture = await mkdtemp(join(fixtures, 'case-'))
  const install = join(fixture, 'install')
  const testMetadata = JSON.parse(extractFile(join(artifactRoot, 'update-test-0.2.900/win-unpacked/resources/app.asar'), 'package.json'))
  const profile = testMetadata.frowangUpdates.testProfile
  expect(profile.replaceAll('\\', '/')).toContain(root.replaceAll('\\', '/') + '/output/update-fixtures/')
  await mkdir(profile, { recursive: true })
  const executable = join(install, 'Frowang Markdown Update Test.exe')
  const external = join(fixture, 'BOM文档.md'), externalConflict = join(fixture, '冲突文档.md')
  const env = { ...process.env, FROWANG_USER_DATA: profile, FROWANG_UPDATE_TEST: '1', LOCALAPPDATA: join(fixture, 'local-app-data'), APPDATA: join(fixture, 'app-data') }; delete env.ELECTRON_RUN_AS_NODE
  await mkdir(env.LOCALAPPDATA, { recursive: true }); await mkdir(env.APPDATA, { recursive: true })
  const requests = [], metrics = { fixture }
  let serveInstaller = false, app, server, relaunchedBrowser
  const serverErrors = []
  try {
    server = createServer(async (req, res) => {
      try {
        const filename = basename(decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname))
        requests.push(filename)
        if (!['latest.yml', 'Frowang-Update-Test-Setup-0.2.901.exe', 'Frowang-Update-Test-Setup-0.2.901.exe.blockmap'].includes(filename) || (!serveInstaller && filename.endsWith('.exe'))) { res.writeHead(503); res.end('test: download unavailable'); return }
        const file = join(feedRoot, filename), info = await stat(file)
        res.writeHead(200, { 'Content-Length': info.size, 'Content-Type': filename.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream' })
        createReadStream(file).pipe(res)
      } catch (error) { serverErrors.push(error.message); res.writeHead(404); res.end() }
    })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(19091, '127.0.0.1', resolve) })
    const installStart = performance.now()
    await run(oldInstaller, ['/S', `/D=${install}`], env)
    metrics.firstInstallMs = performance.now() - installStart
    let launched = await launch(executable, env); app = launched.app; let page = launched.page
    metrics.emptyInstalledReadyMs = launched.readyMs
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe('0.2.900')
    await expect(page.getByRole('button', { name: '检查更新', exact: true })).toBeVisible()
    // Populate the same six synthetic documents through the new + and genuine
    // source-menu path. Every switch/new command retains the normal flush path.
    const paragraph = '这是生成的启动测量样本，不含真实用户笔记。用于观察多标签恢复、列表与公式显示。\n\n- 第一条\n- 第二条\n\n公式 $a+b=c$。\n\n'
    for (let i = 0; i < 6; i++) {
      if (i) {
        await page.getByRole('button', { name: '新建笔记', exact: true }).click()
        await expect(page.getByRole('tab')).toHaveCount(i + 1); await editorReady(page)
      }
      await name(page).fill(`升级草稿${i + 1}`); await name(page).press('Enter')
      await ensureSource(page)
      await source(page).fill(`# 启动样本 ${i + 1}\n\n` + paragraph.repeat(20))
      await menuCommand(page, 'source')
      await expect(page.getByRole('textbox', { name: 'Markdown 正文', exact: true })).toBeVisible(); await editorReady(page)
    }
    await page.getByRole('tab', { name: '升级草稿1', exact: true }).click()
    await expect(page.getByRole('tab', { name: '升级草稿1', exact: true })).toHaveAttribute('aria-selected', 'true')
    await editorReady(page)
    expect(Buffer.byteLength((await fullSnapshot(page)).documents[0].markdown)).toBe(3278)
    await normalClose(app)
    launched = await launch(executable, env); app = launched.app; page = launched.page
    metrics.sixDraftsInstalledReadyMs = launched.readyMs
    metrics.sampleDocuments = 6; metrics.sampleUtf8BytesPerDocument = 3278; metrics.osCacheCleared = false
    await writeFile(external, '\ufeff# BOM原文\r\n保留换行\r\n')
    await writeFile(externalConflict, '磁盘基线')
    await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }) }, [external, externalConflict])
    await menuCommand(page, 'open')
    await expect(page.getByRole('tab')).toHaveCount(8)
    await ensureSource(page)
    await source(page).fill('保留的未写入磁盘正文')
    await expect(page.getByRole('status', { name: '自动保存状态', exact: true })).toHaveText('已自动保存 · 未写入文件')
    await writeFile(externalConflict, '外部程序新内容')
    await page.getByRole('tab', { name: '升级草稿6', exact: true }).click()
    await expect(name(page)).toBeVisible()
    await page.getByRole('button', { name: '检查更新', exact: true }).click()
    await expect(page.getByLabel('应用更新')).toContainText('发现新版本 0.2.901')
    expect(requests.filter(file => file.endsWith('.exe'))).toHaveLength(0)
    await page.getByRole('button', { name: '下载更新', exact: true }).click()
    await expect(page.getByLabel('应用更新')).toContainText('下载失败')
    serveInstaller = true
    await page.getByRole('button', { name: '重试更新', exact: true }).click()
    await expect(page.getByRole('button', { name: '重启更新', exact: true })).toBeVisible({ timeout: 90000 })
    await page.getByRole('button', { name: '稍后', exact: true }).click()
    await expect(page.getByRole('button', { name: '查看更新', exact: true })).toBeVisible()
    const downloadedRequests = requests.filter(file => file.endsWith('.exe')).length
    await normalClose(app)
    launched = await launch(executable, env); app = launched.app; page = launched.page
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe('0.2.900')
    await page.getByRole('button', { name: '检查更新', exact: true }).click()
    await page.getByRole('button', { name: '下载更新', exact: true }).click()
    await expect(page.getByRole('button', { name: '重启更新', exact: true })).toBeVisible()
    expect(requests.filter(file => file.endsWith('.exe'))).toHaveLength(downloadedRequests)
    // Joint scenario: a real menu command is waiting on genuine Chromium IME
    // pre-edit. An update request already in flight must cancel its restart,
    // leave the input enabled/focused and let the menu's normal flush complete.
    await ensureSource(page)
    await source(page).fill('菜单组合输入前-'); await source(page).press('Control+End')
    const composingId = (await fullSnapshot(page)).activeId
    const ime = await app.context().newCDPSession(page)
    await app.evaluate(({ dialog }) => {
      globalThis.__jointSaveDialogs = 0
      dialog.showSaveDialog = async () => { globalThis.__jointSaveDialogs++; return { canceled: true } }
    })
    await ime.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 })
    await menuCommand(page, 'saveAs')
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByLabel('应用更新')).toHaveAttribute('inert', '')
    // Fixed updates API exercises the race after controls lock; no documents
    // operation bypasses renderer flush or the real registered menu callback.
    await page.evaluate(() => window.desktop.updates.restart())
    await expect(page.getByLabel('应用更新')).toContainText('尚未重启')
    await expect(source(page)).toBeEnabled(); await expect(source(page)).toBeFocused()
    await expect(source(page)).toHaveValue('菜单组合输入前-中')
    expect(await app.evaluate(() => globalThis.__jointSaveDialogs)).toBe(0)
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe('0.2.900')
    await ime.send('Input.insertText', { text: '中' })
    await editorReady(page)
    await expect.poll(() => app.evaluate(() => globalThis.__jointSaveDialogs)).toBe(1)
    expect((await page.evaluate(id => window.desktop.read(id), composingId)).markdown).toBe('菜单组合输入前-中')
    await expect(page.getByRole('button', { name: '重启更新', exact: true })).toBeVisible()
    metrics.menuCompositionRestartCancelled = true
    await ime.detach()
    // Real SQLite rejection: renderer flush and close-ready run unchanged.
    sql(profile, "CREATE TRIGGER deny_update BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'integration write failure'); END;")
    await name(page).fill('保存失败仍保留的名称')
    await ensureSource(page)
    await source(page).fill('升级前最后的正文\n' + '阅读位置\n'.repeat(100))
    await page.getByRole('button', { name: '重启更新', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('草稿备份不可用')
    await expect(page.getByRole('button', { name: '重启更新', exact: true })).toBeVisible()
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe('0.2.900')
    expect((await fullSnapshot(page)).documents).toHaveLength(8)
    sql(profile, 'DROP TRIGGER deny_update;')
    await page.getByRole('button', { name: '关闭提示', exact: true }).click()
    await name(page).fill('安装启动失败仍可编辑')
    await source(page).fill('安装启动前的已保存正文')
    await app.evaluate(() => { globalThis.__updateTestRejectSpawn = true })
    await page.getByRole('button', { name: '重启更新', exact: true }).click()
    await expect(page.getByLabel('应用更新')).toContainText('无法启动安装')
    await expect(name(page)).toBeEnabled(); await expect(source(page)).toBeEnabled()
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe('0.2.900')
    expect((await fullSnapshot(page)).documents).toHaveLength(8)
    await app.evaluate(() => { globalThis.__updateTestRejectSpawn = false })
    metrics.asyncLaunchFailureKeptWindow = true
    // Retry in the same window/library instance, with another final edit. The
    // successful recovery below also proves closing/quitting did not bypass flush.
    await name(page).fill('升级后继续阅读')
    const finalText = '重启点击前最后输入\n' + '保留源码和阅读位置\n'.repeat(100)
    await source(page).fill(finalText)
    await source(page).evaluate(el => { el.setSelectionRange(7, 12); window.scrollTo(0, 240) })
    const portFile = join(profile, 'DevToolsActivePort')
    await rm(portFile, { force: true })
    const oldClosed = app.waitForEvent('close')
    await page.getByRole('button', { name: '重启更新', exact: true }).click()
    await oldClosed
    // Observe the actual installed asar version, not a mocked quitAndInstall.
    await expect.poll(() => {
      try { return JSON.parse(extractFile(join(install, 'resources/app.asar'), 'package.json')).version } catch { return null }
    }, { timeout: 90000 }).toBe('0.2.901')
    // Connect directly to the automatic shell-launched app. The test-only CJS
    // bootstrap sets a random CDP port synchronously before product main loads.
    let port
    await expect.poll(async () => {
      try {
        port = (await readFile(portFile, 'utf8')).split(/\r?\n/)[0]
        return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok
      } catch { return false }
    }, { timeout: 45000 }).toBe(true)
    relaunchedBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    await expect.poll(() => relaunchedBrowser.contexts()[0].pages().some(page => page.url().startsWith('app://editor/'))).toBe(true)
    page = relaunchedBrowser.contexts()[0].pages().find(page => page.url().startsWith('app://editor/'))
    await editorReady(page)
    expect((await page.evaluate(() => window.desktop.updates.state())).currentVersion).toBe('0.2.901')
    await expect(page.getByRole('tab')).toHaveCount(8)
    await expect(name(page)).toHaveValue('升级后继续阅读')
    await expect(source(page)).toHaveValue(finalText)
    const automaticallyRestored = await fullSnapshot(page)
    expect(automaticallyRestored.documents.find(doc => doc.id === automaticallyRestored.activeId).viewState.sourceSelection).toEqual({ start: 7, end: 12 })
    metrics.automaticRelaunchRecovered = true
    const cdp = await relaunchedBrowser.newBrowserCDPSession()
    void cdp.send('Browser.close').catch(() => {})
    await expect.poll(async () => {
      try { await fetch(`http://127.0.0.1:${port}/json/version`); return false } catch { return true }
    }).toBe(true)
    await relaunchedBrowser.close(); relaunchedBrowser = null
    launched = await launch(executable, env); app = launched.app; page = launched.page
    metrics.upgradedReadyMs = launched.readyMs
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe('0.2.901')
    await expect(page.getByRole('tab')).toHaveCount(8)
    await expect(name(page)).toHaveValue('升级后继续阅读')
    await expect(source(page)).toHaveValue(finalText)
    const restored = await fullSnapshot(page), active = restored.documents.find(doc => doc.id === restored.activeId)
    expect(active.title).toBe('升级后继续阅读'); expect(active.viewState.mode).toBe('source')
    expect(active.viewState.sourceSelection).toEqual({ start: 7, end: 12 })
    expect(restored.documents.map(doc => doc.title)).toEqual(['升级草稿1', '升级草稿2', '升级草稿3', '升级草稿4', '升级草稿5', '升级后继续阅读', 'BOM文档.md', '冲突文档.md'])
    expect(restored.documents.find(doc => doc.path === externalConflict)).toMatchObject({ markdown: '保留的未写入磁盘正文', conflict: true })
    expect(await readFile(external, 'utf8')).toBe('\ufeff# BOM原文\r\n保留换行\r\n')
    expect(await readFile(externalConflict, 'utf8')).toBe('外部程序新内容')
    const previousDownloads = requests.filter(file => file.endsWith('.exe')).length
    await page.getByRole('button', { name: '检查更新', exact: true }).click()
    await expect(page.getByLabel('应用更新')).toContainText('已是最新版本')
    expect(requests.filter(file => file.endsWith('.exe'))).toHaveLength(previousDownloads)
    await normalClose(app)
    // Normal quit after choosing later above never ran the installer; only the
    // explicit restart path reached the real upgrade.
    metrics.requests = requests; metrics.serverErrors = serverErrors; metrics.passed = true
    console.log(JSON.stringify(metrics))
  } finally {
    if (app && processes.get(app)?.exitCode === null) {
      try { sql(profile, 'DROP TRIGGER IF EXISTS deny_update;') } catch {}
      await normalClose(app).catch(() => {})
    }
    if (relaunchedBrowser) {
      const cdp = await relaunchedBrowser.newBrowserCDPSession().catch(() => null)
      void cdp?.send('Browser.close').catch(() => {})
      await relaunchedBrowser.close().catch(() => {})
    }
    if (server) await new Promise(resolve => server.close(resolve))
    await writeFile(join(fixture, 'result.json'), JSON.stringify(metrics, null, 2))
    if (metrics.passed) await run(join(install, 'Uninstall Frowang Markdown Update Test.exe'), ['/S'], env)
    // Retain isolated data and installers as inspectable evidence; the test's
    // uninstall registration is removed after success. No real user
    // installation, shortcuts or recovery directory was touched.
  }
})
