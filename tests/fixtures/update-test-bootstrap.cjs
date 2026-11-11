// Included only in isolated NSIS test builds, never in a production package.
// NSIS's shell-based automatic relaunch drops inherited environment variables.
// Configure the synthetic profile and CDP synchronously, before importing ESM.
const { app } = require('electron')
const { dirname, isAbsolute, join } = require('node:path')
const { pathToFileURL } = require('node:url')
const metadata = require('./package.json')
const profile = metadata.frowangUpdates?.testProfile
if (metadata.name !== 'frowang-markdown-update-test' || metadata.frowangUpdates?.testOnly !== true || !isAbsolute(profile || '')) throw new Error('Isolated update test metadata required')
console.log(JSON.stringify({ stage: 'update-test-bootstrap', ready: app.isReady(), profile }))
process.env.FROWANG_USER_DATA = profile
process.env.FROWANG_UPDATE_TEST = '1'
process.env.LOCALAPPDATA = join(dirname(profile), 'local-app-data')
app.setPath('userData', profile)
app.commandLine.appendSwitch('remote-debugging-port', '0')
// An actual main-process integration fault, limited to this test package and
// explicitly toggled by Playwright. Reject after BaseUpdater has requested quit.
const childProcess = require('node:child_process')
const { EventEmitter } = require('node:events')
const nativeSpawn = childProcess.spawn
childProcess.spawn = function (command, args, options) {
  if (globalThis.__updateTestRejectSpawn && args?.includes('--updated')) {
    const child = new EventEmitter(); child.unref = () => {}
    setTimeout(() => child.emit('error', Object.assign(new Error('Injected installer launch denial'), { code: 'EACCES' })), 50)
    return child
  }
  return nativeSpawn(command, args, options)
}
require('node:module').syncBuiltinESMExports()
import(pathToFileURL(join(__dirname, 'out/main/index.js')).href).catch(error => { console.error(error); app.exit(1) })
