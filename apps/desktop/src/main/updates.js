import { isAbsolute } from 'node:path'

// The feed is a build-time choice. Renderer IPC can never supply a URL or headers.
export function validateUpdateConfig(config, { packaged, platform, portable, env = process.env } = {}) {
  if (!packaged || platform !== 'win32' || portable) return { enabled: false, reason: '当前运行方式不支持应用内更新，请使用 Windows 安装版。' }
  if (!config?.url) return { enabled: false, reason: '此安装包尚未配置更新源。' }
  try {
    const url = new URL(config.url)
    if (url.username || url.password || url.search || url.hash) throw new Error('更新源不能包含凭据、查询参数或片段。')
    const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname)
    if (config.testOnly) {
      if (url.protocol !== 'http:' || !loopback || env.FROWANG_UPDATE_TEST !== '1' || !env.FROWANG_USER_DATA || !isAbsolute(env.FROWANG_USER_DATA)) throw new Error('隔离更新测试配置不完整。')
    } else if (url.protocol !== 'https:' || !config.publisherName) throw new Error('正式更新需要 HTTPS 更新源和签名发布者。')
    return { enabled: true, url: url.href, testOnly: config.testOnly === true }
  } catch (error) { return { enabled: false, reason: error.message } }
}

export class UpdateController {
  constructor({ updater, config, currentVersion, notify = () => {}, requestRestart, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.updater = updater
    this.config = config
    this.notify = notify
    this.requestRestart = requestRestart
    this.now = now
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.state = { status: config.enabled ? 'idle' : 'disabled', currentVersion, version: null, progress: 0, message: config.reason || '' }
    this.lastCheck = -Infinity
    this.pending = null
    this.downloaded = false
    this.stopped = false
    this.installIntent = false
    if (!config.enabled) return
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.autoRunAppAfterInstall = true
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.disableWebInstaller = true
    updater.on('download-progress', value => this.set({ status: 'downloading', progress: Math.max(0, Math.min(100, Number(value.percent) || 0)) }))
    updater.on('update-downloaded', () => { this.downloaded = true; this.set({ status: 'ready', progress: 100, message: '' }) })
    updater.on('error', () => this.fail('更新失败，请检查网络后重试。'))
  }
  snapshot() { return { ...this.state } }
  set(patch) { Object.assign(this.state, patch); this.notify(this.snapshot()); return this.snapshot() }
  fail(message) { this.installIntent = false; return this.set({ status: this.downloaded ? 'ready' : 'error', message }) }
  start() {
    // One delayed check per launch and at most one every six hours. Failures never
    // trigger retry loops; the next scheduled check or the user can retry.
    if (!this.config.enabled || this.timer) return
    this.stopped = false
    const tick = async () => { await this.check(false); if (!this.stopped) { this.timer = this.setTimer(tick, 6 * 60 * 60 * 1000); this.timer?.unref?.() } }
    this.timer = this.setTimer(tick, 30000); this.timer?.unref?.()
  }
  stop() { this.stopped = true; this.clearTimer(this.timer); this.timer = null }
  async check(manual = true) {
    if (!this.config.enabled || this.pending || this.downloaded || this.installIntent || this.state.status === 'available') return this.snapshot()
    if (this.now() - this.lastCheck < (manual ? 10000 : 6 * 60 * 60 * 1000)) return this.snapshot()
    this.lastCheck = this.now()
    this.set({ status: 'checking', message: '' })
    this.pending = (async () => {
      try {
        const result = await this.updater.checkForUpdates()
        if (result?.isUpdateAvailable) {
          // Reject insecure artifact URLs before electron-updater downloads them.
          for (const file of result.updateInfo.files || []) {
            const url = new URL(file.url, this.config.url)
            if (url.username || url.password || (this.config.testOnly ? url.origin !== new URL(this.config.url).origin : url.protocol !== 'https:')) throw new Error('Invalid artifact URL')
          }
          this.set({ status: 'available', version: result.updateInfo.version, progress: 0, message: '' })
        }
        else this.set({ status: 'current', version: null, message: '已是最新版本' })
      } catch { this.fail('检查更新失败，请检查网络后重试。') }
      finally { this.pending = null }
    })()
    await this.pending
    return this.snapshot()
  }
  async download() {
    if (!this.config.enabled || this.pending || this.downloaded || !this.state.version || this.installIntent) return this.snapshot()
    this.set({ status: 'downloading', progress: 0, message: '' })
    this.pending = (async () => {
      try { await this.updater.downloadUpdate() }
      catch { this.fail('下载失败，笔记不受影响。可重试下载。') }
      finally { this.pending = null }
    })()
    await this.pending
    return this.snapshot()
  }
  restart() {
    if (!this.downloaded || this.installIntent) return this.snapshot()
    this.installIntent = true
    this.set({ status: 'saving', message: '正在保存笔记…' })
    // Never await renderer flush inside the main document operation queue.
    try { if (!this.requestRestart()) this.cancelRestart() }
    catch { this.cancelRestart() }
    return this.snapshot()
  }
  cancelRestart() {
    if (!this.installIntent) return
    this.installIntent = false
    this.set({ status: 'ready', message: '尚未重启；请完成笔记保存后重试。' })
  }
  install() {
    if (!this.installIntent || !this.downloaded) return false
    this.set({ status: 'installing', message: '正在重启更新…' })
    try { this.updater.quitAndInstall(true, true); return this.installIntent }
    catch { this.fail('无法启动安装，请稍后重试。'); return false }
  }
}
