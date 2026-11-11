import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { UpdateController, validateUpdateConfig } from '../apps/desktop/src/main/updates.js'

function candidate(updater, data) {
  const info = data && { files: [{ url: 'setup.exe', sha512: 'test-sha' }], ...data }
  updater.updateInfoAndProvider = info ? { info, provider: { resolveFiles: value => value.files.map(file => ({ url: new URL(file.url, 'https://updates.example.test/'), info: file })) } } : null
  return { isUpdateAvailable: !!info, updateInfo: info }
}
function fixture(overrides = {}) {
  const updater = new EventEmitter()
  updater.checkForUpdates = async () => candidate(updater, { version: '0.2.901' })
  updater.downloadUpdate = async () => { updater.emit('download-progress', { percent: 47 }); updater.emit('update-downloaded', updater.updateInfoAndProvider.info) }
  let installed = 0, requested = 0, time = 100000
  updater.quitAndInstall = async () => () => { installed++ }
  const controller = new UpdateController({ updater, config: { enabled: true, url: 'https://updates.example.test/' }, currentVersion: '0.2.900', now: () => time, requestRestart: () => { requested++; return true }, ...overrides })
  return { updater, controller, installed: () => installed, requested: () => requested, advance: () => { time += 10001 } }
}
test('update configuration disables network without a feed, in development and portable; requires isolated loopback or signed HTTPS', async () => {
  const options = { packaged: true, platform: 'win32', portable: false, env: {} }
  assert.equal(validateUpdateConfig(null, options).enabled, false)
  assert.equal(validateUpdateConfig({ url: 'https://updates.example.test/' }, options).enabled, false)
  const production = { url: 'https://updates.example.test/', publisherName: 'Publisher' }
  assert.equal(validateUpdateConfig(production, options).enabled, true)
  assert.equal(validateUpdateConfig(production, { ...options, portable: true }).enabled, false)
  assert.equal(validateUpdateConfig(production, { ...options, packaged: false }).enabled, false)
  assert.equal(validateUpdateConfig({ ...production, url: 'https://token@updates.example.test/' }, options).enabled, false)
  const local = { url: 'http://127.0.0.1:19091/', testOnly: true }
  assert.equal(validateUpdateConfig(local, options).enabled, false)
  assert.equal(validateUpdateConfig(local, { ...options, env: { FROWANG_UPDATE_TEST: '1', FROWANG_USER_DATA: process.cwd() } }).enabled, true)
  const { controller, updater } = fixture({ config: { enabled: false, reason: 'not configured' } })
  updater.checkForUpdates = () => { throw new Error('network must not be called') }
  controller.start(); await controller.check(); await controller.download(); controller.restart()
  assert.equal(controller.snapshot().status, 'disabled')
})
test('checks are coalesced and throttled; same version never downloads', async () => {
  const { controller, updater, advance } = fixture()
  let checks = 0
  updater.checkForUpdates = async () => { checks++; return candidate(updater, null) }
  await Promise.all([controller.check(), controller.check()]); await controller.check(); await controller.download()
  assert.equal(checks, 1); assert.equal(controller.snapshot().status, 'current')
  advance(); await controller.check(); assert.equal(checks, 2)
})
test('manual download, progress, later/cancel restart and save confirmation gate installation', async () => {
  const { controller, updater, installed, requested } = fixture()
  let downloads = 0
  updater.downloadUpdate = async () => { downloads++; updater.emit('download-progress', { percent: 47 }); assert.equal(controller.snapshot().progress, 47); updater.emit('update-downloaded', updater.updateInfoAndProvider.info) }
  assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false)
  await controller.check(); assert.equal(controller.snapshot().status, 'available'); assert.equal(downloads, 0)
  controller.restart(); assert.equal(requested(), 0)
  await controller.download(); await controller.download(); await controller.check(); assert.equal(downloads, 1)
  controller.restart(); assert.equal(requested(), 1); assert.equal(installed(), 0)
  controller.cancelRestart(); assert.equal(await controller.install(), false); assert.equal(installed(), 0)
  controller.restart(); const commitQuit = await controller.install(); assert.equal(installed(), 0); commitQuit(); assert.equal(installed(), 1)
})
test('network/download failure can retry without automatic busy loops; installer errors preserve retry state', async () => {
  const { controller, updater, advance } = fixture()
  updater.checkForUpdates = async () => { throw new Error('offline') }
  await controller.check(); assert.equal(controller.snapshot().status, 'error')
  advance(); updater.checkForUpdates = async () => candidate(updater, { version: '0.2.901' })
  await controller.check()
  updater.downloadUpdate = async () => { throw new Error('download failed') }
  await controller.download(); assert.equal(controller.snapshot().status, 'error')
  updater.downloadUpdate = async () => updater.emit('update-downloaded', updater.updateInfoAndProvider.info)
  await controller.download(); assert.equal(controller.snapshot().status, 'ready')
  updater.quitAndInstall = () => { throw new Error('cannot execute') }
  controller.restart(); assert.equal(await controller.install(), false); assert.equal(controller.snapshot().status, 'ready')
})
test('insecure artifact links never become downloadable', async () => {
  const { controller, updater } = fixture({ config: { enabled: true, url: 'https://updates.example.test/' } })
  updater.checkForUpdates = async () => candidate(updater, { version: '0.2.901', files: [{ url: 'http://updates.example.test/installer.exe' }] })
  await controller.check()
  assert.equal(controller.snapshot().status, 'error'); assert.equal(controller.snapshot().version, null)
  updater.downloadUpdate = () => { throw new Error('must not download') }
  await controller.download()
})

test('restart refused while another lifecycle operation is active', async () => {
  const { controller } = fixture({ requestRestart: () => false })
  await controller.check(); await controller.download(); controller.restart()
  assert.equal(controller.installIntent, false); assert.equal(controller.snapshot().status, 'ready')
})
