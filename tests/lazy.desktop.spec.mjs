import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DocumentStore } from '../apps/desktop/src/main/documentStore.js'
const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const body = page => page.getByRole('textbox', { name: 'Markdown 正文', exact: true })
const source = page => page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
async function launch(profile, files = []) {
  const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ ...(process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: files } : { args: [root, ...files] }), env, timeout: 30000 })
  const page = await app.firstWindow()
  await expect(page.getByRole('button', { name: /^(源码|返回正文)$/ })).toBeEnabled()
  return { app, page }
}
async function stop(app) {
  const child = app?.process(); if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await exited
}
async function seed(profile, documents) {
  const store = new DocumentStore(profile); await store.restore(); const ids = []
  for (const [title, markdown] of documents) ids.push((await store.newDocument(markdown, title)).activeId)
  await store.close(store.documents[0].id); await store.activate(ids[0]); await store.dispose(); return ids
}
async function switchTab(page, name) {
  await page.getByRole('tab', { name: new RegExp(name) }).click()
  await expect(page.getByRole('button', { name: /^(源码|返回正文)$/ })).toBeEnabled()
  await expect(page.locator('.ProseMirror')).toHaveCount(1)
}
async function reading(page, id) { return page.evaluate(id => window.desktop.read(id), id) }

test('按需桌面：metadata列表、单活跃DOM、迟到读取切换及关闭不能复活', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-lazy-')), profile = join(directory, 'profile')
  const ids = await seed(profile, [['A', '# A\n\nA正文'], ['B', '# B\n\nB正文'], ['C', '# C\n\nC正文']])
  let app
  try {
    const started = await launch(profile); app = started.app; const page = started.page
    await expect(body(page)).toContainText('A正文'); await expect(page.locator('.ProseMirror')).toHaveCount(1)
    const metadata = await page.evaluate(() => window.desktop.list())
    expect(metadata.documents.every(doc => !('markdown' in doc) && !('savedText' in doc))).toBe(true)
    await app.evaluate(({ ipcMain }, id) => {
      const handler = ipcMain._invokeHandlers.get('documents:read'); globalThis.__lazyReads = []; globalThis.__lazyHeld = false
      ipcMain.removeHandler('documents:read')
      ipcMain.handle('documents:read', async (...args) => {
        globalThis.__lazyReads.push(args[1]); const result = await handler(...args)
        if (args[1] === id && !globalThis.__lazyHeld) { globalThis.__lazyHeld = true; await new Promise(resolve => { globalThis.__lazyRelease = resolve }) }
        return result
      })
    }, ids[1])
    await page.getByRole('tab', { name: 'B', exact: true }).click()
    await expect.poll(() => app.evaluate(() => globalThis.__lazyHeld)).toBe(true)
    await switchTab(page, '^C$'); await expect(body(page)).toContainText('C正文')
    await page.getByRole('button', { name: '关闭 B', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(2)
    await app.evaluate(() => globalThis.__lazyRelease())
    await page.evaluate(() => window.desktop.list())
    await expect(body(page)).toContainText('C正文'); await expect(page.getByRole('tab', { name: 'B', exact: true })).toHaveCount(0)
    expect((await page.evaluate(() => window.desktop.list())).documents.map(doc => doc.id)).toEqual([ids[0], ids[2]])
    expect((await app.evaluate(() => globalThis.__lazyReads)).every(id => [ids[1], ids[2]].includes(id))).toBe(true)
    await expect(page.locator('.ProseMirror')).toHaveCount(1)
  } finally { await stop(app); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('按需桌面：正文历史、公式未完成编辑原值、代码块反向选区跨标签保留', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-lazy-state-')), profile = join(directory, 'profile')
  const markdown = '# A\n\n正文\n\n行内 $y^2$\n\n$$\nx^2\n$$\n\n```js\nlet value = 1\n```\n\n末尾'
  const [id] = await seed(profile, [['A', markdown], ['B', '# B\n\n另一篇']])
  let app
  try {
    const started = await launch(profile); app = started.app; const page = started.page
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await body(page).click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' HISTORY')
    await switchTab(page, '^B$'); await switchTab(page, '^A')
    await body(page).click(); await page.keyboard.press('Control+z'); await expect(body(page)).not.toContainText('HISTORY')
    await page.keyboard.press('Control+y'); await expect(body(page)).toContainText('HISTORY')
    await page.getByRole('button', { name: '编辑行间公式', exact: true }).click()
    const formula = page.getByRole('textbox', { name: '行间公式 LaTeX', exact: true })
    await formula.press('Control+End'); await formula.pressSequentially('\\frac{')
    await switchTab(page, '^B$'); await switchTab(page, '^A')
    await expect(formula).toBeVisible(); await expect(formula).toContainText('\\frac{')
    await formula.press('Escape'); await expect(body(page).locator('.writing-math-block annotation')).toHaveText('x^2')
    await page.getByRole('button', { name: '编辑行内公式', exact: true }).click()
    const inline = page.getByRole('textbox', { name: '行内公式 LaTeX', exact: true })
    await inline.fill('y_{'); await inline.evaluate(el => el.setSelectionRange(1, 3))
    await switchTab(page, '^B$'); await switchTab(page, '^A')
    await expect(inline).toBeVisible(); await expect(inline).toHaveValue('y_{')
    expect(await inline.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([1, 3])
    await inline.press('Escape'); await expect(body(page).locator('.writing-math-inline annotation')).toHaveText('y^2')
    const code = page.locator('.milkdown-code-block .cm-content')
    await code.click(); await code.press('Control+End'); await code.pressSequentially(' + tail'); await code.press('Shift+ArrowLeft')
    const selection = () => code.evaluate(el => { const s = el.ownerDocument.getSelection(); return { anchor: s.anchorOffset, head: s.focusOffset, text: s.toString() } })
    const before = await selection()
    expect(before.anchor).toBeGreaterThan(before.head)
    await switchTab(page, '^B$'); await switchTab(page, '^A')
    await expect(code).toBeFocused(); expect(await selection()).toEqual(before)
    // Flush while focus remains inside code; writes keep their original document.
    await switchTab(page, '^B$')
    expect((await reading(page, id)).markdown).toContain('let value = 1 + tail')
    expect(errors).toEqual([])
  } finally { await stop(app); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('按需桌面：源码原文、选区、滚动和native undo跨切换，退出恢复源码模式', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-lazy-source-')), profile = join(directory, 'profile')
  const raw = '#  source\n\n  原样空格 $unfinished\n\n' + Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
  await seed(profile, [['A', raw], ['B', '# B']]); let app
  try {
    const started = await launch(profile); app = started.app; let page = started.page
    await page.getByRole('button', { name: '源码', exact: true }).click(); await expect(source(page)).toHaveValue(raw)
    // One native insertion has one deterministic undo entry; sequential typing
    // can split the leading space into its own platform-dependent undo group.
    await source(page).press('Control+End'); await page.keyboard.insertText(' SOURCE EDIT')
    await source(page).evaluate(el => { el.setSelectionRange(4, 9); el.scrollTop = 300 })
    const expectedScroll = await source(page).evaluate(el => el.scrollTop)
    await switchTab(page, '^B$'); await switchTab(page, '^A')
    await expect(source(page)).toHaveValue(raw + ' SOURCE EDIT')
    expect(await source(page).evaluate(el => [el.selectionStart, el.selectionEnd, el.scrollTop])).toEqual([4, 9, expectedScroll])
    await source(page).press('Control+z'); await expect(source(page)).toHaveValue(raw)
    await source(page).press('Control+y'); await expect(source(page)).toHaveValue(raw + ' SOURCE EDIT')
    const closed = app.waitForEvent('close'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed
    const restarted = await launch(profile); app = restarted.app; page = restarted.page
    await expect(source(page)).toHaveValue(raw + ' SOURCE EDIT')
    await expect(page.getByRole('button', { name: '返回正文', exact: true })).toBeVisible()
  } finally { await stop(app); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('按需桌面：未编辑原文不被规范化，快速富文本转源码不漏最后输入', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-lazy-source-sync-')), profile = join(directory, 'profile')
  const raw = '#  标题\n\n  原样空格 $unfinished\n\n末尾'
  const [id] = await seed(profile, [['A', raw], ['B', '另一篇']])
  let app
  try {
    const started = await launch(profile); app = started.app; const page = started.page
    await page.getByRole('button', { name: '源码', exact: true }).click()
    await expect(source(page)).toHaveValue(raw)
    await switchTab(page, '^B$')
    expect((await reading(page, id)).markdown).toBe(raw)
    await switchTab(page, '^A$')
    await page.getByRole('button', { name: '返回正文', exact: true }).click()
    await body(page).press('Control+End'); await page.keyboard.insertText('LATEST')
    await page.getByRole('button', { name: '源码', exact: true }).click()
    await expect(source(page)).toHaveValue(/LATEST/)
    await source(page).fill('源码的更新正文')
    await switchTab(page, '^B$')
    expect((await reading(page, id)).markdown).toBe('源码的更新正文')
    await switchTab(page, '^A$')
    await expect(source(page)).toHaveValue('源码的更新正文')
  } finally { await stop(app); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('按需桌面：恢复阅读位置期间改选目标，迟到恢复不得改新会话或重新ready', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-lazy-restore-')), profile = join(directory, 'profile')
  const long = title => title + '\n\n' + Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
  const ids = await seed(profile, [['A', 'A'], ['B', long('B')], ['C', long('C')]])
  const store = new DocumentStore(profile); await store.restore()
  await store.setViewState(ids[1], { mode: 'source', scrollTop: 0, sourceScrollTop: 300, sourceSelection: { start: 4, end: 9 } })
  await store.setViewState(ids[2], { mode: 'source', scrollTop: 0, sourceScrollTop: 40, sourceSelection: { start: 11, end: 12 } })
  await store.dispose()
  let app
  try {
    const started = await launch(profile); app = started.app; const page = started.page
    const b = await page.getByRole('tab', { name: 'B', exact: true }).boundingBox()
    const c = await page.getByRole('tab', { name: 'C', exact: true }).boundingBox()
    // Hold app layout callbacks, not IPC or input. Clicks below are real pointer
    // events; the hold gives a bounded, deterministic restoration window.
    await page.evaluate(() => {
      const raf = window.requestAnimationFrame.bind(window), queued = []
      window.requestAnimationFrame = callback => { queued.push(callback); return -queued.length }
      window.__resumeRestoreFrames = () => { window.requestAnimationFrame = raf; queued.splice(0).forEach(callback => raf(callback)) }
    })
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await expect.poll(() => page.evaluate(() => {
      const input = [...document.querySelectorAll('.document-pane')].find(el => getComputedStyle(el).display !== 'none')?.querySelector('textarea')
      return input?.value.startsWith('B') && input.closest('section').inert && input.disabled
    })).toBe(true)
    await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2)
    await expect.poll(() => page.evaluate(() => {
      const input = [...document.querySelectorAll('.document-pane')].find(el => getComputedStyle(el).display !== 'none')?.querySelector('textarea')
      return input?.value.startsWith('C') && input.closest('section').inert && input.disabled
    })).toBe(true)
    await page.evaluate(() => window.__resumeRestoreFrames())
    await expect(page.getByRole('button', { name: '返回正文', exact: true })).toBeEnabled()
    await expect(page.getByRole('tab', { name: 'C', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(source(page)).toHaveValue(long('C'))
    await expect(source(page)).toBeEnabled()
    expect(await source(page).evaluate(el => [el.selectionStart, el.selectionEnd, el.scrollTop])).toEqual([11, 12, 40])
    // Cancelling B before it becomes ready must not replace B's stored position
    // with the temporary textarea's default zero selection/scroll.
    await switchTab(page, '^B$')
    expect(await source(page).evaluate(el => [el.selectionStart, el.selectionEnd, el.scrollTop])).toEqual([4, 9, 300])
    await expect(page.locator('.ProseMirror')).toHaveCount(1)
  } finally { await stop(app); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('按需桌面：相同Markdown不同目录图片重建，组合输入结束前不切走', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowang-lazy-images-')), profile = join(directory, 'profile')
  const files = []
  for (const name of ['A', 'B']) {
    const dir = join(directory, name); await mkdir(dir)
    await writeFile(join(dir, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4ZkAAAAASUVORK5CYII=', 'base64'))
    const file = join(dir, name + '.md'); await writeFile(file, '![pixel](pixel.png)\n\n正文'); files.push(file)
  }
  let app
  try {
    const started = await launch(profile, files); app = started.app; const page = started.page
    const image = body(page).getByRole('img', { name: 'pixel', exact: true })
    await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true)
    const urlB = await image.getAttribute('src')
    await switchTab(page, 'A.md'); const urlA = await image.getAttribute('src'); expect(urlA).not.toBe(urlB)
    await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true)
    await switchTab(page, 'B.md'); expect(await image.getAttribute('src')).toBe(urlB)
    // Synthetic event coverage only; not a real Windows IME qualification.
    await page.getByRole('button', { name: '源码', exact: true }).click()
    await source(page).evaluate(el => { el.focus(); el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.value = '组合输入最终正文' })
    await page.getByRole('tab', { name: 'A.md', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'B.md', exact: true })).toHaveAttribute('aria-selected', 'true')
    await source(page).evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '组合输入最终正文' })))
    await expect(page.getByRole('tab', { name: 'A.md', exact: true })).toHaveAttribute('aria-selected', 'true')
    await switchTab(page, 'B.md'); await expect(source(page)).toHaveValue('组合输入最终正文')
  } finally { await stop(app); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})
