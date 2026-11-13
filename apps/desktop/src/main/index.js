import { app, BrowserWindow, dialog, ipcMain, protocol, shell, Menu, session } from 'electron'
import { join, resolve, relative, extname, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { DocumentStore, atomicWrite, suggestedFilename } from './documentStore.js'
import { UpdateController, validateUpdateConfig } from './updates.js'
import { guardUpdateRequests, guardInstallerLaunch } from './updaterSafety.js'
import electronUpdater from 'electron-updater'
import { existsSync } from 'node:fs'
import { openFileArguments, operationQueue } from './lifecycle.js'
import { createApplicationMenu } from './applicationMenu.js'

const require = createRequire(import.meta.url), here = dirname(fileURLToPath(import.meta.url))
const rendererRoot = resolve(here, '../renderer')
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }, { scheme: 'document-image', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
// Explicit test/developer profile only; never points tests at a user's recovery.
if (process.env.FROWANG_USER_DATA) app.setPath('userData', resolve(process.env.FROWANG_USER_DATA))
const startupFiles = openFileArguments(process.argv.slice(app.isPackaged ? 1 : 2))
const lock = app.requestSingleInstanceLock({ files: startupFiles })
let window, store, quitting = false, closing = false, rendererGone = false, rendererReady = false
let applicationMenu
let initialized, initializationFailed, updates, motionCapture
const startup = new Promise((resolve, reject) => { initialized = resolve; initializationFailed = reject })
const prints = new Map()
const serialize = operationQueue(startup)
void startup.catch(() => {})
function secureSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('来源窗口无效。')
  const url = new URL(event.senderFrame.url)
  if (!(url.protocol === 'app:' && url.host === 'editor') && !(process.env.ELECTRON_RENDERER_URL && event.senderFrame.url.startsWith(process.env.ELECTRON_RENDERER_URL + '/'))) throw new Error('来源页面无效。')
}
function handle(name, fn) {
  ipcMain.handle(name, (event, ...args) => {
    secureSender(event)
    return serialize(async () => { try { return { ok: true, value: await fn(...args) } } catch (error) { console.error(`[desktop:${name}]`, error.code || error.name); return { ok: false, error: error.message } } })
  })
}
async function chooseSave(doc) {
  const result = await dialog.showSaveDialog(window, { title: '保存 Markdown', defaultPath: doc.path || suggestedFilename(doc.title), filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] })
  return result.canceled ? null : result.filePath
}
async function saveDocument(id, saveAs = false) {
  const doc = store.get(id), path = saveAs || !doc.path ? await chooseSave(doc) : doc.path
  if (!path) return { cancelled: true }
  return store.save(id, path)
}
async function confirmClose(id) {
  const doc = store.get(id)
  if (doc.path && store.isDirty(doc)) {
    const answer = await dialog.showMessageBox(window, { type: 'question', message: `保存「${doc.title}」的修改？`, buttons: ['保存', '不保存', '取消'], defaultId: 0, cancelId: 2, noLink: true })
    if (answer.response === 2) return { cancelled: true }
    if (answer.response === 0) { const saved = await saveDocument(id); if (!saved.saved) return saved }
  }
  return { closed: true, snapshot: await store.remove(id) }
}
async function exportPdf(id, html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > 20 * 1024 * 1024) throw new Error('导出内容过大。')
  const doc = store.get(id)
  const destination = await dialog.showSaveDialog(window, { title: '导出 PDF', defaultPath: suggestedFilename(doc.title, 'pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (destination.canceled) return { cancelled: true }
  const cssPath = require.resolve('katex/dist/katex.min.css')
  let css = await readFile(cssPath, 'utf8')
  for (const [rule, source] of [...css.matchAll(/src:([^;}]+);?/g)]) {
    const font = source.match(/url\(([^)]+\.woff2)\)/)?.[1]
    if (font) css = css.replace(rule, `src:url(data:font/woff2;base64,${(await readFile(resolve(dirname(cssPath), font))).toString('base64')}) format('woff2');`)
  }
  const idPrint = randomUUID()
  prints.set(idPrint, `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"><style>${css}</style>${html}`)
  let printWindow, timer
  try {
    printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    printWindow.webContents.on('will-navigate', event => event.preventDefault())
    timer = setTimeout(() => printWindow?.destroy(), 40000)
    await printWindow.loadURL(`app://print/${idPrint}`)
    await printWindow.webContents.executeJavaScript('Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode())])')
    const bytes = await printWindow.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>', footerTemplate: '<div style="font:9px Arial;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' })
    await atomicWrite(destination.filePath, bytes)
    return { saved: true }
  } finally { clearTimeout(timer); if (printWindow && !printWindow.isDestroyed()) printWindow.destroy(); prints.delete(idPrint) }
}
function wireIPC() {
  // Fixed own-window capture only: no supplied window, path, region or desktop access.
  // Keep compositor waits outside the document queue and allow at most one in flight.
  ipcMain.handle('application:capture-page', async event => {
    secureSender(event)
    if (!rendererReady || rendererGone || closing || motionCapture || window.isMinimized())
      return { ok: false, error: '页面画面暂不可用。' }
    let timeout
    try {
      const pending = window.webContents.capturePage()
      motionCapture = pending
      void pending.finally(() => { if (motionCapture === pending) motionCapture = null }).catch(() => {})
      let image = await Promise.race([pending, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Capture timeout')), 1000) })])
      if (image.isEmpty()) throw new Error('Empty capture')
      const { width, height } = image.getSize(), scale = Math.min(1, 2048 / width, 1536 / height)
      if (scale < 1) image = image.resize({ width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), quality: 'good' })
      const png = image.toPNG()
      if (png.length > 8 * 1024 * 1024) throw new Error('Capture too large')
      return { ok: true, value: `data:image/png;base64,${png.toString('base64')}` }
    } catch { return { ok: false, error: '页面画面暂不可用。' } }
    finally { clearTimeout(timeout) }
  })
  // State must not wait behind a modal dialog/document write in the operation queue.
  ipcMain.on('application:menu-state', (event, state) => {
    try { secureSender(event); applicationMenu?.update(state) }
    catch (error) { console.error('[desktop:application:menu-state]', error.name) }
  })
  handle('application:renderer-ready', () => {
    rendererReady = true
    applicationMenu?.refresh()
    updates?.start()
    if (closing && !rendererGone) window.webContents.send('application:request-close')
    return true
  })
  handle('documents:list', () => store.snapshot())
  handle('documents:list-metadata', () => store.listMetadata())
  handle('documents:read', id => store.read(id))
  handle('documents:search', query => store.search(query))
  handle('documents:rename', (id, title) => store.rename(id, title))
  handle('documents:view-state', (id, state) => store.setViewState(id, state))
  handle('documents:new', () => store.newDocument())
  handle('documents:open', async () => {
    const answer = await dialog.showOpenDialog(window, { title: '打开 Markdown', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] })
    if (!answer.canceled) {
      const failures = []
      for (const path of answer.filePaths) { try { await store.openFile(path) } catch (error) { failures.push(error.message) } }
      const snapshot = store.snapshot()
      if (failures.length) snapshot.warning = failures.join('\n')
      return snapshot
    }
    return store.snapshot()
  })
  handle('documents:update', (id, markdown, revision) => store.update(id, markdown, revision))
  handle('documents:import-images', (id, images) => store.importImages(id, images))
  handle('documents:activate', id => store.activate(id))
  handle('documents:shelve', id => store.shelve(id))
  handle('documents:undo-remove', () => store.undoRemove())
  handle('documents:save', (id, saveAs) => saveDocument(id, saveAs === true))
  handle('documents:close', id => confirmClose(id))
  handle('documents:reload', async id => {
    const doc = store.get(id)
    const answer = await dialog.showMessageBox(window, { type: 'question', message: `从磁盘重新读取「${doc.title}」？`, detail: '当前标签中的未保存修改将被替换。', buttons: ['重新读取', '取消'], defaultId: 1, cancelId: 1 })
    return answer.response === 0 ? { reloaded: true, snapshot: await store.reload(id) } : { cancelled: true }
  })
  handle('documents:pdf', exportPdf)
  handle('application:close-ready', async () => {
    if (!closing) return false
    const backedUp = await store.tryPersist()
    if (!backedUp && (updates?.installIntent || !store.canExitWithoutRecovery())) {
      closing = false
      updates?.cancelRestart()
      throw new Error('草稿备份不可用，请先保存所有修改再退出；未完成的草稿删除需恢复备份后重试。')
    }
    // An update is application exit, never tab closure. It must have a confirmed
    // SQLite commit even when the external files happen to be clean.
    if (updates?.installIntent) {
      const commitQuit = await updates.install()
      if (!commitQuit) { quitting = false; closing = false; return false }
      // The actual installer process is now started and the library has asked
      // to quit. Only now may closing bypass another renderer handshake.
      try { quitting = true; commitQuit(); return true }
      catch (error) { quitting = false; closing = false; updates.cancelRestart(); throw error }
    }
    // The renderer has flushed pending edits; committed drafts survive normal exit.
    quitting = true; window.close(); return true
  })
  handle('application:close-cancel', () => { closing = false; updates?.cancelRestart(); return true })
  // Updates must not hold the document queue while networking or asking the
  // renderer to flush through documents:update / rename / view-state.
  for (const [name, action] of Object.entries({ state: () => updates.snapshot(), check: () => updates.check(), download: () => updates.download(), restart: () => updates.restart() })) {
    ipcMain.handle(`updates:${name}`, async event => {
      secureSender(event)
      try { await startup; return { ok: true, value: await action() } }
      catch { return { ok: false, error: '更新操作失败，请稍后重试。' } }
    })
  }
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
async function protocols() {
  protocol.handle('app', async request => {
    const url = new URL(request.url)
    if (url.host === 'print') return prints.has(url.pathname.slice(1)) ? new Response(prints.get(url.pathname.slice(1)), { headers: { 'content-type': 'text/html; charset=utf-8' } }) : new Response('', { status: 404 })
    if (url.host !== 'editor') return new Response('', { status: 403 })
    try {
      const path = resolve(rendererRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
      if (relative(rendererRoot, path).startsWith('..') || isAbsolute(relative(rendererRoot, path))) return new Response('', { status: 403 })
      return new Response(await readFile(path), { headers: { 'content-type': mime[extname(path)] || 'application/octet-stream' } })
    } catch { return new Response('', { status: 404 }) }
  })
  protocol.handle('document-image', async request => {
    try {
      const url = new URL(request.url), source = decodeURIComponent(url.pathname.slice(1))
      const { path, bytes } = await store.readImage(url.host, source)
      return new Response(bytes, { headers: { 'content-type': mime[extname(path).toLowerCase()], 'access-control-allow-origin': process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL).origin : 'app://editor' } })
    } catch { return new Response('', { status: 404 }) }
  })
}
async function createWindow() {
  window = new BrowserWindow({ width: 1160, height: 850, minWidth: 520, minHeight: 400, title: 'frowd', icon: join(rendererRoot, 'icon.png'), show: false,
    webPreferences: { preload: join(here, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } })
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  window.webContents.on('will-navigate', (event, url) => { event.preventDefault(); if (/^https?:\/\//i.test(url)) void shell.openExternal(url) })
  window.on('close', event => {
    if (quitting) return
    event.preventDefault()
    if (rendererGone) {
      if (!closing) {
        closing = true
        void serialize(async () => {
          const backedUp = await store.tryPersist()
          if (!backedUp) {
            for (const doc of store.documents.filter(doc => store.needsRecovery(doc))) {
              const choice = await dialog.showMessageBox(window, { type: 'warning', message: `页面停止且备份失败：请保存「${doc.title}」后退出。`, buttons: ['保存到文件', '取消'], defaultId: 0, cancelId: 1 })
              if (choice.response !== 0 || !(await saveDocument(doc.id, true)).saved) { closing = false; return }
            }
          }
          if (!backedUp && !store.canExitWithoutRecovery()) throw new Error('草稿删除尚未持久化，请恢复备份后重试退出。')
          quitting = true; window.close()
        }).catch(error => { closing = false; dialog.showErrorBox('退出失败', error.message) })
      }
      return
    }
    if (!rendererReady) { closing = true; return }
    if (!closing) { closing = true; window.webContents.send('application:request-close') }
  })
  window.on('ready-to-show', () => window.show())
  window.webContents.on('did-start-loading', () => { rendererReady = false; applicationMenu?.reset() })
  window.webContents.on('did-finish-load', () => { rendererGone = false })
  window.webContents.on('render-process-gone', async () => {
    rendererGone = true; closing = false; applicationMenu?.reset(); updates?.cancelRestart()
    const choice = await dialog.showMessageBox(window, { type: 'error', message: '编辑页面已停止。可重新载入已接收的草稿，或退出后恢复备份。', buttons: ['重新载入', '退出'], defaultId: 0, cancelId: 1 })
    if (choice.response === 0) window.webContents.reload()
    else window.close()
  })
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadURL('app://editor/index.html')
}
if (!lock) app.quit()
else {
  app.on('second-instance', (_event, argv, workingDirectory, additionalData) => { window?.show(); window?.focus(); const files = Array.isArray(additionalData?.files) && additionalData.files.every(path => typeof path === 'string' && isAbsolute(path)) ? additionalData.files : openFileArguments(argv, workingDirectory); void serialize(async () => { for (const path of files) await store.openFile(path); window?.webContents.send('documents:changed', store.snapshot()) }).catch(error => dialog.showErrorBox('打开失败', error.message)) })
  app.whenReady().then(async () => {
    store = new DocumentStore(app.getPath('userData')); await store.restore()
    for (const path of startupFiles) { try { await store.openFile(path) } catch (error) { dialog.showErrorBox('打开失败', error.message) } }
    await protocols()
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    wireIPC()
    applicationMenu = createApplicationMenu({ Menu,
      canDispatch: () => rendererReady && !rendererGone && !closing && !!window && !window.isDestroyed(),
      sendCommand: command => window.webContents.send('application:command', command),
      closeWindow: () => window?.close(),
    })
    const metadata = JSON.parse(await readFile(join(app.getAppPath(), 'package.json'), 'utf8'))
    const config = validateUpdateConfig(metadata.frowangUpdates, { packaged: app.isPackaged, platform: process.platform, portable: !!process.env.PORTABLE_EXECUTABLE_FILE, env: process.env })
    if (config.enabled && !existsSync(join(dirname(process.execPath), `Uninstall ${metadata.build?.executableName || metadata.build?.productName || metadata.productName || 'Frowang Markdown'}.exe`))) {
      config.enabled = false; config.reason = '请从安装后的应用入口检查更新。'
    }
    const updater = config.enabled ? new electronUpdater.NsisUpdater({ provider: 'generic', url: config.url, channel: 'latest' }) : null
    if (updater) { guardUpdateRequests(updater.httpExecutor, config); guardInstallerLaunch(updater) }
    updates = new UpdateController({ updater, config, currentVersion: app.getVersion(),
      notify: state => { if (window && !window.isDestroyed()) window.webContents.send('updates:changed', state) },
      requestRestart: () => {
        if (closing || rendererGone || !rendererReady || !window || window.isDestroyed()) return false
        window.close(); return closing
      },
    })
    await createWindow(); initialized()
  }).catch(error => { initializationFailed(error); dialog.showErrorBox('启动失败', error.message); app.exit(1) })
  app.on('window-all-closed', () => { updates?.stop(); void store.dispose().finally(() => app.quit()) })
}
