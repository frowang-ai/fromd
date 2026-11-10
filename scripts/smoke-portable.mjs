// Smoke-test the portable launcher itself; the unpacked app has full E2E tests.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../', import.meta.url))
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const executable = resolve(process.argv[2] || join(root, `release/${version}/Frowang-Markdown-${version}-x64.exe`))
const profile = await mkdtemp(join(tmpdir(), 'frowang-portable-'))
const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
const child = spawn(executable, ['--remote-debugging-port=0'], { env, stdio: 'ignore' })
let ended = false, browser
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
  await until(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json()
    return pages.some(page => page.url === 'app://editor/index.html' && page.title.includes('Frowang Markdown')) ? pages : null
  })
  // Loading app:// is earlier than renderer initialization/close-ready wiring.
  // Wait for the real editor before exercising an ordinary portable close.
  // Closing a renderer reload with delayed ready is covered by a separate
  // desktop regression; this smoke does not cover every early cold-start close.
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = browser.contexts()[0].pages().find(page => page.url() === 'app://editor/index.html')
  assert.ok(page, 'Portable editor target must exist')
  await page.waitForFunction(() => document.querySelector('[aria-label="Markdown 正文"]') &&
    document.querySelector('nav button[aria-pressed]')?.disabled === false && !document.querySelector('header').inert)
  const saved = await until(async () => {
    const db = new DatabaseSync(join(profile, 'drafts.sqlite'), { readOnly: true })
    try { return { version: db.prepare("SELECT value FROM settings WHERE key='version'").get()?.value, count: db.prepare('SELECT COUNT(*) AS count FROM documents').get().count } }
    finally { db.close() }
  })
  assert.equal(saved.version, '2'); assert.equal(saved.count, 1)
  console.log(JSON.stringify({ portable: executable, page: await page.title(), uiReady: true, recoveryCreated: true }))
  const socket = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
  let shutdownTimer
  let code
  try { code = await Promise.race([exited, new Promise((_, reject) => { shutdownTimer = setTimeout(() => reject(new Error('Portable shutdown timed out')), 10000) })]) }
  finally { clearTimeout(shutdownTimer); socket.close() }
  assert.equal(code, 0)
  console.log('Portable launch and shutdown passed')
} finally {
  await browser?.close().catch(() => {})
  if (!ended && child.pid) { try { execFileSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* Already exited. */ } }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
