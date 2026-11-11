import { spawn } from 'node:child_process'

export function assertUpdateUrl(value, config, base = config.url) {
  const url = new URL(value, base)
  if (url.username || url.password) throw new Error('更新地址不能包含凭据。')
  if (config.testOnly) {
    const feed = new URL(config.url)
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.origin !== feed.origin) throw new Error('测试更新请求必须留在指定 loopback 源。')
  } else if (url.protocol !== 'https:') throw new Error('正式更新请求必须使用 HTTPS。')
  return url
}
function requestUrl(options, config) {
  if (options.auth || options.username || options.password) throw new Error('更新请求不能包含凭据。')
  const host = options.hostname || options.host
  const url = assertUpdateUrl(`${options.protocol || 'https:'}//${host}${options.port ? `:${options.port}` : ''}${options.path || '/'}`, config)
  for (const [name, value] of Object.entries(options.headers || {})) {
    if (/^(authorization|proxy-authorization|cookie)$/i.test(name) && value) throw new Error('更新请求不能包含凭据。')
    if (/^host$/i.test(name) && value !== url.host) throw new Error('更新请求不能覆盖目标 Host。')
  }
  return url
}

// Version-bound to electron-updater 6.8.9. Scope every hook to this executor and
// its own requests. Differential downloads register redirect handlers directly,
// so guarding only ElectronHttpExecutor.addRedirectHandlers is insufficient.
export function guardUpdateRequests(executor, config) {
  const createRequest = executor.createRequest.bind(executor)
  executor.createRequest = (options, callback) => {
    const origin = requestUrl(options, config)
    const request = createRequest({ ...options, headers: options.headers && { ...options.headers }, redirect: 'manual' }, callback)
    const on = request.on.bind(request), follow = request.followRedirect?.bind(request)
    let blocked = false, redirects = 0
    on('redirect', (_status, _method, target) => {
      try {
        assertUpdateUrl(target, config, origin)
        if (++redirects > executor.maxRedirects) throw new Error('更新重定向次数过多。')
      } catch (error) {
        blocked = true
        request.abort()
        // The caller installs its normal error/rejection handler before end().
        // Abort plus this error settles API, download and differential promises.
        queueMicrotask(() => request.emit('error', error))
        return
      }
      // Preserve automatic following for differential paths without a handler,
      // but only after the raw Location has passed the same policy.
      if (request.listenerCount('redirect') === 1) follow?.()
    })
    request.on = request.addListener = (event, listener) => on(event, event === 'redirect' ? (...args) => { if (!blocked) listener(...args) } : listener)
    if (follow) request.followRedirect = () => { if (!blocked) return follow() }
    return request
  }
  // These methods normalize URL objects into options, dropping URL credentials.
  // Check the original URL before that normalization as well as every request.
  for (const method of ['download', 'downloadToBuffer']) {
    const original = executor[method].bind(executor)
    executor[method] = (url, ...args) => { assertUpdateUrl(url, config); return original(url, ...args) }
  }
}

// Keep the actual BaseUpdater/NsisUpdater install path and arguments. Their
// synchronous return only means spawn was attempted, so hold this adapter's
// quit until both a real ChildProcess 'spawn' and the library quit request exist.
// Only per-user NSIS is supported: no unobservable shell/elevation fallback.
export function guardInstallerLaunch(updater, spawnProcess = spawn) {
  const quitAndInstall = updater.quitAndInstall.bind(updater), quit = updater.app.quit.bind(updater.app)
  let attempt = null
  const settle = () => {
    const current = attempt
    if (!current || !current.quitRequested) return
    if (current.error) {
      updater.quitAndInstallCalled = false
      attempt = null; updater.removeListener('error', current.onError)
      current.reject(current.error)
    } else if (current.spawned && !current.prepared) {
      current.prepared = true
      current.resolve(() => {
        if (attempt !== current || current.committed || current.error) throw new Error('安装启动确认已失效。')
        current.committed = true; attempt = null; updater.removeListener('error', current.onError)
        quit()
      })
    }
  }
  updater.app.quit = () => { if (attempt) { attempt.quitRequested = true; settle() } }
  updater.spawnLog = (command, args = [], env, stdio = 'ignore') => new Promise((resolve, reject) => {
    const current = attempt
    const failed = cause => {
      const error = new Error(`安装器启动失败（${cause.code || cause.name}）。`, { cause })
      error.code = 'ERR_UPDATER_INSTALLER_LAUNCH'; error.originalCode = cause.code
      reject(error)
    }
    try {
      const child = spawnProcess(command, args, { env, stdio, detached: true })
      child.once('error', failed)
      child.once('spawn', () => {
        child.unref()
        if (attempt === current && current && !current.error) { current.spawned = true; settle() }
        resolve(true)
      })
    } catch (error) { failed(error) }
  })
  updater.quitAndInstall = (silent, runAfter) => {
    if (attempt) return attempt.promise
    if (updater.downloadedUpdateHelper?.downloadedFileInfo?.isAdminRightsRequired) return Promise.reject(new Error('此应用仅支持按当前用户安装的更新。'))
    const current = { spawned: false, quitRequested: false, prepared: false, committed: false, error: null }
    current.promise = new Promise((resolve, reject) => { current.resolve = resolve; current.reject = reject })
    current.onError = error => { current.error = error; settle() }
    attempt = current; updater.on('error', current.onError)
    try {
      quitAndInstall(silent, runAfter)
      // A synchronous rejection does not schedule BaseUpdater's quit callback.
      if (!updater.quitAndInstallCalled) { current.error ||= new Error('安装器未能启动。'); current.quitRequested = true; settle() }
    } catch (error) { current.error = error; current.quitRequested = true; settle() }
    return current.promise
  }
}
