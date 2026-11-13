// Smoke + resource comparison for the lite (Tauri) and Electron shells.
// Usage: node apps/tauri/scripts/measure.mjs <exe> <tauri|electron> [runs]
// Uses an isolated FROWANG_USER_DATA and a generated sample note; never touches real notes.
import { chromium } from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const [exe, kind, runsArg = '3'] = process.argv.slice(2)
if (!exe || !['tauri', 'electron'].includes(kind)) throw new Error('usage: measure.mjs <exe> <tauri|electron> [runs]')
const runs = Number(runsArg)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Sum working set and private bytes over the whole process tree rooted at pid.
function treeMemory(root) {
  const json = execFileSync('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const all = JSON.parse(json), ids = new Set([root])
  for (let grew = true; grew;) {
    grew = false
    for (const process of all) if (!ids.has(process.ProcessId) && ids.has(process.ParentProcessId)) { ids.add(process.ProcessId); grew = true }
  }
  const members = all.filter(process => ids.has(process.ProcessId))
  return { processes: members.length, names: [...new Set(members.map(process => process.Name))],
    workingSetMB: members.reduce((sum, process) => sum + Number(process.WorkingSetSize), 0) / 2 ** 20,
    privateMB: members.reduce((sum, process) => sum + Number(process.PrivatePageCount), 0) / 2 ** 20 }
}

function sample(directory) {
  // 1×1 PNG next to the note exercises the restricted document-image protocol.
  writeFileSync(join(directory, 'pic.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
  const note = join(directory, 'sample.md')
  writeFileSync(note, '# 样例笔记\r\n\r\n公式 $E=mc^2$ 与块公式：\r\n\r\n$$\r\n\\int_0^1 x\\,dx = \\frac12\r\n$$\r\n\r\n![图](pic.png)\r\n\r\n- 列表一\r\n- 列表二\r\n')
  return note
}

async function launch(directory, note, port) {
  const env = { ...process.env, FROWANG_USER_DATA: join(directory, 'profile') }
  const args = [note]
  if (port) {
    if (kind === 'tauri') env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`
    else args.unshift(`--remote-debugging-port=${port}`)
  }
  const started = performance.now()
  const child = spawn(exe, args, { env, stdio: 'ignore' })
  return { child, started }
}

async function connect(port) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`) } catch { await sleep(50) }
  }
  throw new Error('CDP not reachable')
}

async function editorPage(browser) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const page = browser.contexts().flatMap(context => context.pages()).find(page => !page.url().startsWith('devtools'))
    if (page) return page
    await sleep(50)
  }
  throw new Error('No page')
}

async function stop(child) {
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* already gone */ }
  await sleep(800)
}

const results = []
for (let run = 0; run < runs; run++) {
  // FROWD_MEASURE_TMP overrides the base directory (some sandboxed hosts deny WebView2 profiles elsewhere).
  const directory = mkdtempSync(join(process.env.FROWD_MEASURE_TMP || tmpdir(), `frowd-${kind}-`)), note = sample(directory)
  const port = 9300 + run + (kind === 'tauri' ? 0 : 50)
  // Startup and behaviour (CDP attached).
  const { child, started } = await launch(directory, note, port)
  const browser = await connect(port)
  const page = await editorPage(browser)
  await page.waitForSelector('.katex', { timeout: 30000 })
  const ready = performance.now() - started
  const checks = await page.evaluate(async () => {
    const image = document.querySelector('img[src*="pic.png"]')
    if (image && !image.complete) await new Promise(resolve => { image.onload = image.onerror = resolve })
    return {
      title: document.title,
      katex: document.querySelectorAll('.katex').length,
      imageLoaded: Boolean(image && image.naturalWidth > 0),
      imageSrc: image?.getAttribute('src')?.slice(0, 48) || null,
      bridge: typeof window.desktop?.read === 'function',
    }
  })
  let capture = null
  try { const data = await page.evaluate(() => window.desktop.capturePage()); capture = { ok: data.startsWith('data:image/png;base64,'), kb: Math.round(data.length * 0.75 / 1024) } }
  catch (error) { capture = { ok: false, error: String(error.message || error).slice(0, 80) } }
  // Persist an edit through the real renderer path, then verify it survives a restart.
  const marker = `持久化标记-${run}-${Date.now()}`
  await page.click('.ProseMirror')
  await page.keyboard.press('Control+End')
  await page.keyboard.type(`\n${marker}`)
  await sleep(2500)
  await browser.close().catch(() => {})
  await stop(child)
  const second = await launch(directory, note, port + 10)
  const browser2 = await connect(port + 10)
  const page2 = await editorPage(browser2)
  await page2.waitForSelector('.katex', { timeout: 30000 })
  const persisted = await page2.evaluate(text => document.body.innerText.includes(text), marker)
  await browser2.close().catch(() => {})
  await stop(second.child)
  // Memory without CDP: idle editor with the same note open.
  const plain = await launch(directory, note, null)
  await sleep(8000)
  const memory = treeMemory(plain.child.pid)
  await stop(plain.child)
  rmSync(directory, { recursive: true, force: true })
  results.push({ run, readyMs: Math.round(ready), ...checks, capture, persisted, memory })
  console.log(JSON.stringify(results.at(-1)))
}
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
console.log(JSON.stringify({ kind, runs, medianReadyMs: median(results.map(result => result.readyMs)),
  medianWorkingSetMB: Math.round(median(results.map(result => result.memory.workingSetMB))),
  medianPrivateMB: Math.round(median(results.map(result => result.memory.privateMB))) }))
