import { test, expect } from '@playwright/test'
import { installMockHost } from './mock-host.mjs'

const body = page => page.locator('.ProseMirror:visible')
const source = page => page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
async function boot(page, markdown = '原始正文\n') {
  await page.addInitScript(installMockHost, { markdown })
  await page.goto('/?testHost=1')
  await expect(page.locator('.loading-state')).toHaveCount(0)
  await expect(body(page)).toBeVisible()
}
async function remountChild(page, replacement = null) {
  // Local to this browser page: never edit an SFC on disk or send HMR to the
  // running interactive preview. Vue's own reload path destroys and recreates
  // the child while keeping ProseMirrorPort and the coordinator alive.
  await page.evaluate(replacement => {
    const old = document.querySelector('.writing-editor').__vueParentComponent
    if(replacement)old.exposed.replaceFind('原始正文',replacement,0,false)
    window.__beforeReloadHost = document.querySelector('.pm-port').__vueParentComponent.parent.setupState.coordinator.state.markdown
    window.__beforeReloadSelection = old.exposed.selection()
    window.__oldEditor = old
    window.__oldSnapshot = old.exposed.captureSession()
    window.__VUE_HMR_RUNTIME__.reload(old.type.__hmrId, { ...old.type })
  }, replacement)
  await expect.poll(() => page.evaluate(() => {
    const child = document.querySelector('.writing-editor')?.__vueParentComponent
    return Boolean(child && child !== window.__oldEditor)
  })).toBe(true)
  await page.evaluate(() => document.querySelector('.writing-editor').__vueParentComponent.exposed.whenReady())
}
async function captured(page) {
  return page.evaluate(() => {
    const value = document.querySelector('.pm-port').__vueParentComponent.exposed.capture()
    return value ? { id: value.id, generation: value.generation, markdown: value.markdown, viewState: value.viewState } : null
  })
}

test.beforeEach(async ({ page }) => {
  page.__errors = []; page.on('pageerror', error => page.__errors.push(error.message))
})
test.afterEach(async ({ page }) => { expect(page.__errors).toEqual([]) })

test('foreign-schema snapshot from a destroyed editor falls back to current Markdown', async ({ page }) => {
  await boot(page)
  await remountChild(page)
  await expect.poll(() => page.evaluate(() => {
    try {
      const paragraph = window.__oldSnapshot.state.doc.firstChild
      paragraph.type.spec.toDOM(paragraph)
      return false
    } catch (error) { return error.message.includes('paragraphAttr') }
  })).toBe(true)
  const result = await page.evaluate(() => {
    const engine = document.querySelector('.writing-editor').__vueParentComponent.exposed
    try {
      engine.activateSession({ id: 'a', generation: 1, snapshot: window.__oldSnapshot,
        markdown: '恢复的新正文\n', viewState: { selection: { anchor: 2, head: 4 } } })
      const pm = engine.captureSession()
      return { markdown: engine.getMarkdown(), freshSchema: pm.state.schema !== window.__oldSnapshot.state.schema,
        selection: engine.selection() }
    } catch (error) { return { error: error.message } }
  })
  expect(result).toEqual({ markdown: '恢复的新正文\n', freshSchema: true, selection: { anchor: 2, head: 4 } })
  await expect(body(page)).toHaveText('恢复的新正文')
})

test('rendered capture refuses an inactive child before reading Markdown or replacing coordinator buffers', async ({ page }) => {
  await boot(page)
  const result = await page.evaluate(() => {
    const port = document.querySelector('.pm-port').__vueParentComponent
    const engine = document.querySelector('.writing-editor').__vueParentComponent.exposed
    const coordinator = port.parent.setupState.coordinator
    const before = coordinator.state.markdown
    engine.clearSession()
    const originalGetMarkdown = engine.getMarkdown
    engine.getMarkdown = () => { throw Error('capture must not read an inactive engine') }
    const capture = port.exposed.capture()
    coordinator.capture()
    engine.getMarkdown = originalGetMarkdown
    return { capture, before, after: coordinator.state.markdown, buffer: coordinator.buffers.get('a').markdown }
  })
  expect(result).toEqual({ capture: null, before: '原始正文\n', after: '原始正文\n', buffer: '原始正文\n' })
})

test('HMR flushes the last transaction before its debounced change notification', async ({ page }) => {
  await boot(page)
  await remountChild(page, '尚未发出通知的末次文字')
  expect(await page.evaluate(() => window.__beforeReloadHost)).toBe('原始正文\n')
  await expect(body(page)).toHaveText('尚未发出通知的末次文字')
  expect((await captured(page)).markdown).toBe('尚未发出通知的末次文字\n')
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.rows.get('a').markdown)).toBe('尚未发出通知的末次文字\n')
  expect(await page.evaluate(() => window.__FROWD_TEST_HOST__.calls.filter(c => c.command === 'update_document').every(c => c.args.markdown !== ''))).toBe(true)
})

test('HMR restores body selection and scroll while keeping frozen editing disabled', async ({ page }) => {
  const markdown = Array.from({ length: 80 }, (_, i) => `第${i}段 合成正文`).join('\n\n') + '\n'
  await boot(page, markdown)
  await body(page).locator('p').nth(20).evaluate(el => {
    el.closest('.ProseMirror').focus()
    const range = document.createRange(); range.setStart(el.firstChild, 1); range.setEnd(el.firstChild, 4)
    getSelection().removeAllRanges(); getSelection().addRange(range)
  })
  await expect.poll(async () => { const s = (await captured(page)).viewState.selection; return s.anchor !== s.head }).toBe(true)
  await page.locator('.pm-scroller').evaluate(el => { el.scrollTop = 700 })
  const before = await captured(page)
  await page.evaluate(() => document.querySelector('.pm-port').__vueParentComponent.exposed.setFrozen(true))
  await remountChild(page)
  await expect(body(page)).toHaveAttribute('contenteditable', 'false')
  expect(await captured(page)).toMatchObject({ markdown, viewState: { selection: before.viewState.selection } })
  await expect.poll(() => page.locator('.pm-scroller').evaluate(el => el.scrollTop)).toBe(before.viewState.scrollTop)
  await page.evaluate(() => document.querySelector('.pm-port').__vueParentComponent.exposed.setFrozen(false))
  await expect(body(page)).toHaveAttribute('contenteditable', 'true')
})

test('source text, selection and undo survive a hidden child remount', async ({ page }) => {
  await boot(page)
  await body(page).press('Control+/')
  await source(page).press('Control+End'); await page.keyboard.insertText('源码追加')
  const text = await source(page).inputValue()
  await source(page).evaluate(el => { el.setSelectionRange(1, 3) })
  await remountChild(page)
  await expect(source(page)).toBeVisible(); await expect(source(page)).toHaveValue(text)
  expect(await source(page).evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([1, 3])
  expect((await captured(page)).markdown).toBe(text)
  await source(page).press('Control+z'); await expect(source(page)).toHaveValue('原始正文\n')
  await source(page).press('Control+y'); await expect(source(page)).toHaveValue(text)
  await source(page).press('Control+/'); await expect(body(page)).toContainText('源码追加')
})

test('cleared owner cannot be revived by a late child ready event', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => document.querySelector('.pm-port').__vueParentComponent.exposed.clear())
  await remountChild(page)
  expect(await captured(page)).toBeNull()
  await expect(body(page)).toHaveAttribute('contenteditable', 'false')
})

test('page switch during child recovery keeps the final owner, body and persisted pages separate', async ({ page }) => {
  await boot(page)
  const before = await captured(page)
  await page.evaluate(() => {
    const old = document.querySelector('.writing-editor').__vueParentComponent
    // Keep the real new child unready until the page-B click has entered the
    // normal coordinator queue. Only this test page's component is wrapped.
    const originalSetup = old.type.setup
    let release
    const gate = new Promise(resolve => { release = resolve })
    old.exposed.replaceFind('原始正文', '页面A最后修改', 0, false)
    window.__VUE_HMR_RUNTIME__.reload(old.type.__hmrId, { ...old.type, setup(props, context) {
      return originalSetup(props, { ...context,
        expose(api) { context.expose({ ...api, whenReady: async () => { await api.whenReady(); await gate } }) },
        emit(event, ...args) {
          if(event !== 'ready') { context.emit(event, ...args); return }
          window.__childReadyBlocked = true
          window.__releaseChildReady = () => { context.emit(event, ...args); release() }
        },
      })
    } })
  })
  await expect.poll(() => page.evaluate(() => Boolean(window.__childReadyBlocked))).toBe(true)
  expect(await captured(page)).toBeNull()
  await page.locator('[data-tab-id="b"] .tab-title').click()
  await expect.poll(() => page.evaluate(() => document.querySelector('.pm-port').__vueParentComponent.parent.setupState.coordinator.state.busy)).toBe(true)
  await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id', 'a')
  expect(await captured(page)).toBeNull()
  await page.evaluate(() => window.__releaseChildReady())
  await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id', 'b')
  await expect(body(page)).toContainText('第二篇')
  const active = await captured(page)
  expect(active.id).toBe('b'); expect(active.generation).toBeGreaterThan(before.generation)
  expect(active.markdown).toBe('# 第二篇\n\n数学 $x^2$ 与代码。')
  await body(page).locator('p').last().click(); await page.keyboard.press('Control+End')
  await page.keyboard.insertText(' 页面B独立修改')
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.rows.get('b').markdown)).toContain('页面B独立修改')
  const persisted = await page.evaluate(() => [...window.__FROWD_TEST_HOST__.rows.values()].map(({ id, markdown }) => ({ id, markdown })))
  expect(persisted.find(row => row.id === 'a').markdown).toBe('页面A最后修改\n')
  expect(persisted.find(row => row.id === 'b').markdown).not.toContain('页面A最后修改')
  await page.locator('[data-tab-id="a"] .tab-title').click()
  await expect(body(page)).toHaveText('页面A最后修改')
  expect((await captured(page)).id).toBe('a')
})

test('child-only HMR restores latest body and owner, then revisits old cached pages safely', async ({ page }) => {
  await boot(page)
  await page.locator('[data-tab-id="b"] .tab-title').click()
  await page.locator('[data-tab-id="a"] .tab-title').click()
  await body(page).locator('p').click(); await page.keyboard.press('Control+End')
  await page.keyboard.insertText(' 最新修改')
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.rows.get('a').markdown)).toBe('原始正文 最新修改\n')
  const before = await captured(page)
  await remountChild(page)
  await expect(body(page)).toHaveText('原始正文 最新修改')
  expect(await captured(page)).toMatchObject({ id: before.id, generation: before.generation, markdown: before.markdown })
  await expect(body(page)).toHaveAttribute('contenteditable', 'true')
  await page.locator('[data-tab-id="b"] .tab-title').click()
  await expect(body(page)).toContainText('第二篇')
  await page.locator('[data-tab-id="a"] .tab-title').click()
  await expect(body(page)).toHaveText('原始正文 最新修改')
  await expect(page.getByRole('alert').filter({ hasText: 'paragraphAttr' })).toHaveCount(0)
})
