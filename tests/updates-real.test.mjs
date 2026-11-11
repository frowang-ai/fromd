import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { UpdateController } from '../apps/desktop/src/main/updates.js'
import { guardInstallerLaunch, guardUpdateRequests } from '../apps/desktop/src/main/updaterSafety.js'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const require = createRequire(import.meta.url)
const { NsisUpdater } = require('electron-updater/out/NsisUpdater.js')
const { GenericProvider } = require('electron-updater/out/providers/GenericProvider.js')
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor.js')
const { DifferentialDownloader } = require('electron-updater/out/differentialDownloader/DifferentialDownloader.js')
const { OperationKind } = require('electron-updater/out/differentialDownloader/downloadPlanBuilder.js')
const { CancellationToken } = require('builder-util-runtime')
const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js')
const Module = require('node:module')
const quiet = { info() {}, warn() {}, error() {}, debug() {} }
const turn = () => new Promise(resolve => setImmediate(resolve))
const config = { enabled: true, url: 'https://updates.example.test/stable/' }
const info = (version = '0.2.901', url = 'setup.exe') => ({ version, files: [{ url, sha512: 'synthetic-sha512' }] })
function realPair() {
  const quits = [], downloads = []
  let now = 100000
  const adapter = { version: '0.2.900', name: 'isolated-unit-test', isPackaged: true, whenReady: async () => {}, quit: () => quits.push('quit'), onQuit() {} }
  const updater = new NsisUpdater(null, adapter)
  updater.logger = quiet
  updater.stagingUserIdPromise = { value: Promise.resolve('11111111-1111-4111-8111-111111111111') }
  const provider = new GenericProvider({ provider: 'generic', url: config.url }, updater, { executor: null, platform: 'win32' })
  updater.clientPromise = Promise.resolve(provider)
  updater.executeDownload = async task => { downloads.push({ version: task.downloadUpdateOptions.updateInfoAndProvider.info.version, url: task.fileInfo.url.href }); throw new Error('stop before actual network and disk') }
  const controller = new UpdateController({ updater, config, currentVersion: adapter.version, requestRestart: () => true, now: () => now })
  return { updater, provider, controller, downloads, quits, advance: () => { now += 10001 } }
}
async function fakeElectron(electron, run) {
  const original = Module._load
  Module._load = function (name, ...args) { return name === 'electron' ? electron : original.call(this, name, ...args) }
  try { return await run() } finally { Module._load = original }
}

test('production build configuration satisfies the locked builder schema without building or signing', async () => {
  const keys = ['FROWANG_UPDATE_URL', 'FROWANG_UPDATE_PUBLISHER', 'FROWANG_UPDATE_TEST_BUILD', 'FROWANG_UPDATE_TEST_PROFILE']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const path = require.resolve('../electron-builder.config.cjs')
  try {
    process.env.FROWANG_UPDATE_URL = config.url; process.env.FROWANG_UPDATE_PUBLISHER = 'Test Publisher'
    delete process.env.FROWANG_UPDATE_TEST_BUILD; delete process.env.FROWANG_UPDATE_TEST_PROFILE; delete require.cache[path]
    const build = require(path)
    await validateConfiguration(build, { isEnabled: false })
    assert.deepEqual(build.win.signtoolOptions.publisherName, 'Test Publisher')
    assert.equal(build.forceCodeSigning, true); assert.equal(build.win.verifyUpdateCodeSignature, true)
  } finally {
    delete require.cache[path]
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]
  }
})

test('real library: a rejected replacement candidate cannot be downloaded under the previous version label', async () => {
  const { provider, controller, downloads, advance } = realPair()
  provider.getLatestVersion = async () => info()
  await controller.check(); await controller.download(); assert.equal(downloads.length, 1)
  advance(); provider.getLatestVersion = async () => info('0.2.902', 'http://updates.example.test/rejected.exe')
  await controller.check(); await controller.download()
  assert.equal(controller.snapshot().version, null)
  assert.equal(downloads.length, 1)
})
for (const files of [undefined, []]) test(`real library: reject legacy path when files=${JSON.stringify(files)}`, async () => {
  const { provider, controller, downloads } = realPair()
  provider.getLatestVersion = async () => ({ version: '0.2.901', path: 'http://updates.example.test/legacy.exe', sha512: 'synthetic', ...(files ? { files } : {}) })
  await controller.check(); await controller.download()
  assert.equal(controller.snapshot().status, 'error'); assert.equal(controller.snapshot().version, null); assert.equal(downloads.length, 0)
})
test('real generic provider: reject a prerelease even with allowPrerelease=false', async () => {
  const { provider, controller, downloads, updater } = realPair()
  provider.getLatestVersion = async () => info('0.3.0-beta.1')
  await controller.check(); await controller.download()
  assert.equal(updater.allowPrerelease, false)
  assert.equal(controller.snapshot().status, 'error'); assert.equal(downloads.length, 0)
})
test('real Base/Nsis asynchronous launch rejection must not quit and must clear its installation lock', async () => {
  const { updater, controller, quits } = realPair()
  updater.downloadedUpdateHelper = { file: 'C:\\isolated-test\\setup.exe', downloadedFileInfo: { isAdminRightsRequired: false }, packageFile: null }
  guardInstallerLaunch(updater, () => {
    const child = new EventEmitter(); child.unref = () => {}
    queueMicrotask(() => { const error = new Error('async launch failure'); error.code = 'ENOEXEC'; child.emit('error', error) })
    return child
  })
  controller.downloaded = true; controller.state.status = 'ready'; controller.restart()
  await fakeElectron({ autoUpdater: { emit() {} } }, async () => {
    const result = await controller.install()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(result, false); assert.deepEqual(quits, []); assert.equal(updater.quitAndInstallCalled, false)
  })
})
for (const route of ['metadata', 'installer', 'blockmap', 'differential-range', 'differential-direct']) {
  for (const boundary of [
    { config, target: 'http://updates.example.test/rejected' },
    { config, target: 'https://user:secret@updates.example.test/rejected' },
    { config: { enabled: true, testOnly: true, url: 'http://127.0.0.1:19091/' }, target: 'http://127.0.0.1:19092/rejected' },
  ]) test(`actual ${route} request/redirect: block ${boundary.target} before next request or follow`, { timeout: 3000 }, async () => {
    const sent = [], requests = []
    let follows = 0
    const executor = new ElectronHttpExecutor(null); executor.cachedSession = {}
    guardUpdateRequests(executor, boundary.config)
    let directory
    await fakeElectron({ net: { request(options) {
      sent.push(options)
      const request = new EventEmitter(); requests.push(request)
      request.abort = () => { request.aborted = true }
      request.followRedirect = () => { follows++ }
      request.end = () => queueMicrotask(() => request.emit('redirect', 302, 'GET', boundary.target))
      return request
    } } }, async () => {
      const url = new URL('file.exe', boundary.config.url)
      const opts = { protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname }
      const cancellationToken = new CancellationToken()
      try {
        let promise
        if (route === 'metadata') promise = executor.request(opts)
        if (route === 'installer') promise = executor.download(url, 'never-written.exe', { cancellationToken })
        if (route === 'blockmap') promise = executor.downloadToBuffer(url, { cancellationToken })
        if (route.startsWith('differential')) {
          directory = await mkdtemp(join(tmpdir(), 'updater-redirect-test-'))
          const oldFile = join(directory, 'old'), newFile = join(directory, 'new')
          await writeFile(oldFile, '')
          const downloader = new DifferentialDownloader({ sha512: 'unused' }, executor, { newUrl: url, requestHeaders: {}, logger: quiet, oldFile, newFile, isUseMultipleRangeRequest: false })
          promise = route === 'differential-range' ? downloader.readRemoteBytes(0, 3) : downloader.downloadFile([{ kind: OperationKind.DOWNLOAD, start: 0, end: 4 }])
        }
        await assert.rejects(promise, /HTTPS|凭据|loopback/)
        assert.equal(sent.length, 1); assert.equal(sent[0].redirect, 'manual')
        assert.equal(follows, 0); assert.equal(requests[0].aborted, true)
      } finally { if (directory) await rm(directory, { recursive: true, force: true }) }
    })
  })
}

test('real library: download revalidates the exact accepted manifest and rejects admin-only installers', async () => {
  for (const mutation of ['replace', 'mutate', 'admin']) {
    const { provider, updater, controller, downloads } = realPair()
    provider.getLatestVersion = async () => info()
    await controller.check()
    if (mutation === 'replace') updater.updateInfoAndProvider = { ...updater.updateInfoAndProvider, info: info('0.2.902') }
    if (mutation === 'mutate') updater.updateInfoAndProvider.info.files[0].url = 'changed.exe'
    if (mutation === 'admin') updater.updateInfoAndProvider.info.files[0].isAdminRightsRequired = true
    await controller.download()
    assert.equal(downloads.length, 0); assert.equal(controller.snapshot().version, null)
  }
})

for (const ordering of ['error-before-quit', 'quit-before-error', 'spawn-before-quit', 'quit-before-spawn']) {
  test(`real Base/Nsis launch ordering, retry and one-shot quit: ${ordering}`, async () => {
    const { updater, controller, quits } = realPair()
    updater.downloadedUpdateHelper = { file: 'C:\\isolated-test\\setup.exe', downloadedFileInfo: {}, packageFile: null }
    const children = [], errors = [], calls = []
    updater.on('error', error => errors.push(error))
    guardInstallerLaunch(updater, (command, args) => { calls.push({ command, args }); const child = new EventEmitter(); child.unref = () => {}; children.push(child); return child })
    controller.downloaded = true; controller.state.status = 'ready'; controller.restart(); controller.restart()
    await fakeElectron({ autoUpdater: { emit() {} }, shell: { openPath() { throw new Error('no shell fallback') } } }, async () => {
      const result = controller.install(), duplicate = controller.install()
      assert.equal(children.length, 1); assert.deepEqual(quits, [])
      if (ordering.startsWith('quit')) await turn()
      assert.deepEqual(quits, [])
      const error = Object.assign(new Error('delayed execution denial'), { code: 'EACCES' })
      if (ordering.includes('error')) children[0].emit('error', error)
      else children[0].emit('spawn')
      if (ordering.includes('error')) {
        assert.equal(await result, false); assert.equal(await duplicate, false)
        assert.equal(updater.quitAndInstallCalled, false); assert.equal(controller.installIntent, false); assert.deepEqual(quits, [])
        assert.equal(errors[0].cause, error); assert.equal(errors[0].originalCode, 'EACCES')
        // Same instance and already-downloaded installer can be retried.
        controller.restart(); const retry = controller.install(); children[1].emit('spawn')
        const commit = await retry; assert.deepEqual(quits, []); commit(); assert.deepEqual(quits, ['quit'])
        assert.throws(commit, /失效/); assert.equal(children.length, 2)
      } else {
        const commit = await result; assert.equal(commit, await duplicate); assert.deepEqual(quits, [])
        commit(); assert.deepEqual(quits, ['quit']); assert.throws(commit, /失效/)
        // A late process error after 'spawn' is not proof that launch failed.
        children[0].emit('error', error); await turn()
        assert.deepEqual(quits, ['quit']); assert.equal(updater.quitAndInstallCalled, true)
      }
      assert(calls.every(call => call.args.includes('--updated') && call.args.includes('/S') && call.args.includes('--force-run')))
    })
  })
}

test('native ChildProcess async ENOENT is retained as cause and never falls back to shell or quit', async () => {
  const { updater, controller, quits } = realPair()
  updater.downloadedUpdateHelper = { file: join(tmpdir(), `missing-update-${randomUUID()}.exe`), downloadedFileInfo: {}, packageFile: null }
  let failure, shellCalls = 0
  updater.on('error', error => { failure = error })
  guardInstallerLaunch(updater)
  controller.downloaded = true; controller.restart()
  await fakeElectron({ autoUpdater: { emit() {} }, shell: { openPath() { shellCalls++ } } }, async () => {
    assert.equal(await controller.install(), false)
    assert.equal(failure.originalCode, 'ENOENT'); assert.equal(failure.cause.code, 'ENOENT')
    assert.equal(shellCalls, 0); assert.deepEqual(quits, []); assert.equal(updater.quitAndInstallCalled, false)
  })
})

test('per-instance transport preserves allowed HTTPS redirect handling and leaves another executor untouched', async () => {
  const executor = new ElectronHttpExecutor(null), other = new ElectronHttpExecutor(null)
  executor.cachedSession = {}; other.cachedSession = {}
  const originalOtherCreate = other.createRequest
  guardUpdateRequests(executor, config)
  const sent = []
  await fakeElectron({ net: { request(options) {
    sent.push(options)
    const request = new EventEmitter(); request.abort = () => {}; request.followRedirect = () => {}
    request.end = () => queueMicrotask(() => {
      if (sent.length === 1) request.emit('redirect', 302, 'GET', 'https://cdn.example.test/latest.yml')
      else {
        const response = new EventEmitter(); response.statusCode = 200; response.headers = {}; response.setEncoding = () => {}
        request.emit('response', response); response.emit('data', 'allowed'); response.emit('end')
      }
    })
    return request
  } } }, async () => {
    assert.equal(await executor.request({ protocol: 'https:', hostname: 'updates.example.test', path: '/latest.yml' }), 'allowed')
    assert.equal(sent.length, 2); assert.equal(sent[1].hostname, 'cdn.example.test'); assert.equal(sent[1].redirect, 'manual')
    assert.equal(other.createRequest, originalOtherCreate)
  })
})

test('request creation and URL-normalizing download entry points reject invalid initial targets without sending', async () => {
  let sent = 0
  const executor = new ElectronHttpExecutor(null); executor.cachedSession = {}
  guardUpdateRequests(executor, config)
  await fakeElectron({ net: { request() { sent++; throw new Error('must not send') } } }, async () => {
    await assert.rejects(executor.request({ protocol: 'http:', hostname: 'updates.example.test', path: '/' }), /HTTPS/)
    await assert.rejects(executor.request({ protocol: 'https:', hostname: 'updates.example.test', path: '/', auth: 'u:p' }), /凭据/)
    for (const method of ['download', 'downloadToBuffer']) {
      assert.throws(() => executor[method](new URL('https://u:p@updates.example.test/file'), 'unused', {}), /凭据/)
    }
    assert.equal(sent, 0)
  })
})
