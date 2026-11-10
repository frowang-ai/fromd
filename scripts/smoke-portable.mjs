// Smoke-test the portable launcher itself; the unpacked app has full E2E tests.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../', import.meta.url))
const executable = resolve(process.argv[2] || join(root, 'release/Frowang-Markdown-0.1.0-x64.exe'))
const profile = await mkdtemp(join(tmpdir(), 'frowang-portable-'))
const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
const child = spawn(executable, ['--remote-debugging-port=0'], { env, stdio: 'ignore' })
let ended = false
const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => { ended = true; resolve(code) }) })
async function until(check, timeout = 60000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    if (ended) throw new Error('Portable launcher exited before readiness')
    try { const result = await check(); if (result) return result } catch (error) { lastError = error }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`Portable condition timed out: ${lastError?.message || ''}`)
}
try {
  const [port, browserPath] = await until(async () => {
    const lines = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
    return lines[0] && lines[1] ? lines : null
  })
  const pages = await until(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json()
    return pages.some(page => page.url === 'app://editor/index.html' && page.title.includes('Frowang Markdown')) ? pages : null
  })
  const saved = JSON.parse(await readFile(join(profile, 'session.json'), 'utf8'))
  assert.equal(saved.version, 1); assert.equal(saved.documents.length, 1)
  console.log(JSON.stringify({ portable: executable, page: pages.find(page => page.url === 'app://editor/index.html').title, recoveryCreated: true }))
  const socket = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
  const code = await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('Portable shutdown timed out')), 10000))])
  socket.close()
  assert.equal(code, 0)
  console.log('Portable launch and shutdown passed')
} finally {
  if (!ended && child.pid) { try { execFileSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* Already exited. */ } }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
