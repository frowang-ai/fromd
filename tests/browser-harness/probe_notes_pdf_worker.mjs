import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { browserLaunchOptions } from './browser-options.mjs'

const require = createRequire(import.meta.url)
async function embeddedKatexCss() {
  const cssPath = require.resolve('katex/dist/katex.min.css')
  let css = await readFile(cssPath, 'utf8')
  // Minified @font-face rules may omit the final semicolon. Do not consume
  // the closing brace and the next rule while replacing a font source.
  const sources = [...css.matchAll(/src:([^;}]+);?/g)]
  for (const [rule, source] of sources) {
    const font = source.match(/url\(([^)]+\.woff2)\)/)?.[1]
    if (!font) throw new Error('KaTeX 字体缺失')
    const data = await readFile(resolve(dirname(cssPath), font))
    css = css.replace(rule, `src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');`)
  }
  return css
}

// Run outside the preview/test process so Chromium ownership is unambiguous.
process.once('message', async ({ html }) => {
  let browser, context, timer, result
  try {
    const css = await embeddedKatexCss()
    browser = await chromium.launch({ ...browserLaunchOptions(), headless: true, timeout: 15000 })
    context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', offline: true })
    await context.route('**/*', route => route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    // Closing the browser also interrupts a stuck native PDF operation.
    timer = setTimeout(() => { void browser.close().catch(() => {}) }, 30000)
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`
    await page.setContent(csp + '<style>' + css + '</style>' + html, { waitUntil: 'load', timeout: 20000 })
    await page.emulateMedia({ media: 'print' })
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map(image => image.decode()))
    })
    const pdf = await page.pdf({
      format: 'A4', preferCSSPageSize: true, printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' },
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="font:9px Arial;color:#888;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      tagged: true,
    })
    result = { pdf: pdf.toString('base64') }
  } catch (error) {
    result = { error: error.message }
  } finally {
    clearTimeout(timer)
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
  }
  process.send(result, () => process.disconnect())
})
