// PDF export smoke for the lite shell: renders KaTeX + a data: image through the
// real print path (hidden WebView2 + PrintToPdf) and answers the native save dialog.
// Usage: FROWD_MEASURE_TMP=<dir> node apps/tauri/scripts/pdf-smoke.mjs <frowd-lite.exe>
import { chromium } from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const exe = process.argv[2]
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const directory = mkdtempSync(join(process.env.FROWD_MEASURE_TMP || tmpdir(), 'frowd-pdf-'))
const note = join(directory, 'sample.md'), output = join(directory, 'export.pdf')
writeFileSync(note, '# PDF 样例\n\n行内 $a^2+b^2=c^2$，块公式：\n\n$$\n\\sum_{k=1}^n k = \\frac{n(n+1)}{2}\n$$\n')
const child = spawn(exe, [note], { stdio: 'ignore', env: { ...process.env, FROWANG_USER_DATA: join(directory, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9390' } })
let browser
for (let attempt = 0; attempt < 200 && !browser; attempt++) { try { browser = await chromium.connectOverCDP('http://127.0.0.1:9390') } catch { await sleep(50) } }
const page = browser.contexts().flatMap(context => context.pages())[0]
await page.waitForSelector('.katex')
// Same shape the renderer sends: sanitized article HTML with images already inlined as data URLs.
await page.evaluate(() => {
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const html = `<article>${document.querySelector('.ProseMirror').innerHTML}<p><img src="${pixel}" width="40" height="40"></p></article>`
  window.__pdf = window.desktop.list().then(snapshot => window.desktop.exportPdf(snapshot.activeId, html)).then(value => ({ value }), error => ({ error: error.message }))
})
// Answer the native "导出 PDF" save dialog by typing the path (no clipboard use).
const typed = output.replace(/[+^%~(){}[\]]/g, match => `{${match}}`).replace(/'/g, "''")
execFileSync('powershell', ['-NoProfile', '-Command', `
  $shell = New-Object -ComObject WScript.Shell
  for ($i = 0; $i -lt 50 -and -not $shell.AppActivate('导出 PDF'); $i++) { Start-Sleep -Milliseconds 200 }
  Start-Sleep -Milliseconds 400
  $shell.SendKeys('^a'); $shell.SendKeys('${typed}'); Start-Sleep -Milliseconds 200; $shell.SendKeys('{ENTER}')`], { stdio: 'inherit' })
const result = await page.evaluate(() => window.__pdf)
const bytes = existsSync(output) ? readFileSync(output) : Buffer.alloc(0)
const text = bytes.toString('latin1')
console.log(JSON.stringify({ result, exists: existsSync(output), bytes: bytes.length, header: text.slice(0, 5), pages: (text.match(/\/Type\s*\/Page[^s]/g) || []).length,
  katexFonts: [...new Set(text.match(/KaTeX_[A-Za-z0-9-]+/g) || [])], imageObjects: (text.match(/\/Subtype\s*\/Image/g) || []).length, output }))
await browser.close().catch(() => {})
try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* already gone */ }
