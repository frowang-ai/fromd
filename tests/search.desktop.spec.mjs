import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DocumentStore } from '../apps/desktop/src/main/documentStore.js'
import { bindMenu, editorReady, menuCommand } from './native-menu.mjs'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const body = page => page.getByRole('textbox', { name: 'Markdown 正文', exact: true })
const source = page => page.locator('.document-pane:visible textarea')

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'frowd-search-')), profile = join(directory, 'profile')
  const store = new DocumentStore(profile); await store.restore()
  const first = store.activeId
  await store.rename(first, 'A'); await store.update(first, '# A\n\nalpha alpha', 1)
  const second = (await store.newDocument('# B\n\n' + '长文内容。'.repeat(400) + '\n\n检索落点在这里。', 'B')).activeId
  await store.shelve(second)
  const third = (await store.newDocument('# C\n\n独立正文\n\n[普通链接](https://example.com/hidden-key)', 'C')).activeId
  await store.activate(first); await store.dispose()
  return { directory, profile, first, second, third }
}
async function launch(profile) {
  const env = { ...process.env, FROWANG_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ ...(process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: [] } : { args: [root] }), env, timeout: 30000 })
  const page = await app.firstWindow(); bindMenu(app, page); await editorReady(page)
  return { app, page }
}
async function cleanup(app, directory) {
  const child = app?.process()
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve))
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await exited
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
async function searchPages(page, query) {
  await menuCommand(page, 'searchPages')
  await page.getByRole('textbox', { name: '搜索页面', exact: true }).fill(query)
}

test('全文搜索读取持久化未访问的收起页，回传片段并恢复定位', async () => {
  const fixtureData = await fixture(); let app
  try {
    const launched = await launch(fixtureData.profile); app = launched.app; const page = launched.page
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('documents:read'); globalThis.__searchBodyReads = []
      ipcMain.removeHandler('documents:read')
      ipcMain.handle('documents:read', (...args) => { globalThis.__searchBodyReads.push(args[1]); return original(...args) })
    })
    await expect(page.getByRole('tab', { name: 'B', exact: true })).toHaveCount(0)
    await searchPages(page, '检索落点')
    await expect(page.locator('.page-card')).toHaveCount(1)
    await expect(page.locator('.search-snippet')).toContainText('检索落点在这里')
    expect(await app.evaluate(() => globalThis.__searchBodyReads)).toEqual([])
    const results = await page.evaluate(() => window.desktop.search('检索落点'))
    expect(results[0].id).toBe(fixtureData.second)
    expect(results.every(hit => !Object.hasOwn(hit, 'markdown'))).toBe(true)
    await page.getByRole('button', { name: '打开 B', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'B', exact: true })).toHaveAttribute('aria-selected', 'true'); await editorReady(page)
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('检索落点')
    await expect(body(page)).toContainText('检索落点在这里')
  } finally { await cleanup(app, fixtureData.directory) }
})

test('隐藏链接URL命中切到源码并选择准确范围', async () => {
  const fixtureData = await fixture(); let app
  try {
    const launched = await launch(fixtureData.profile); app = launched.app; const page = launched.page
    await searchPages(page, 'hidden-key')
    await expect(page.locator('.page-card')).toHaveCount(1)
    await page.getByRole('button', { name: '打开 C', exact: true }).click()
    await expect(source(page)).toBeVisible(); await editorReady(page)
    await expect.poll(() => source(page).evaluate(input => input.value.slice(input.selectionStart, input.selectionEnd))).toBe('hidden-key')
    await expect(source(page)).toHaveValue(/\[普通链接\]\(https:\/\/example.com\/hidden-key\)/)
  } finally { await cleanup(app, fixtureData.directory) }
})

test('真实菜单富文本替换可撤销，切页后查找不会改写其他页面', async () => {
  const fixtureData = await fixture(); let app
  try {
    const launched = await launch(fixtureData.profile); app = launched.app; const page = launched.page
    await menuCommand(page, 'replace')
    await page.getByRole('searchbox', { name: '查找正文' }).fill('alpha')
    await expect(page.getByRole('search').getByRole('status')).toHaveText('1 / 2')
    await page.getByRole('textbox', { name: '替换为' }).fill('新内容')
    await page.getByRole('button', { name: '全部替换', exact: true }).click()
    await expect(body(page)).toContainText('新内容 新内容')
    await body(page).click(); await page.keyboard.press('Control+z')
    await expect(body(page)).toContainText('alpha alpha')
    await page.getByRole('tab', { name: 'C', exact: true }).click(); await editorReady(page)
    await expect(page.getByRole('search').getByRole('status')).toHaveText('无匹配')
    await expect(page.getByRole('button', { name: '全部替换', exact: true })).toBeDisabled()
    await expect(body(page)).toContainText('独立正文')
    const saved = await page.evaluate(async ids => Promise.all(ids.map(id => window.desktop.read(id))), [fixtureData.first, fixtureData.third])
    expect(saved[0].markdown).toContain('alpha alpha'); expect(saved[1].markdown).toContain('独立正文')
    expect(saved.every(doc => !doc.markdown.includes('新内容'))).toBe(true)
  } finally { await cleanup(app, fixtureData.directory) }
})

test('全文搜索迟到回执不会覆盖新查询', async () => {
  const fixtureData = await fixture(); let app
  try {
    const launched = await launch(fixtureData.profile); app = launched.app; const page = launched.page
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('documents:search')
      ipcMain.removeHandler('documents:search')
      ipcMain.handle('documents:search', async (...args) => {
        const result = await original(...args)
        if (args[1] === '检索落点') {
          globalThis.__searchHeld = true
          await new Promise(resolve => { globalThis.__releaseSearch = resolve })
          globalThis.__searchReleased = true
        }
        return result
      })
    })
    await searchPages(page, '检索落点')
    await expect.poll(() => app.evaluate(() => globalThis.__searchHeld)).toBe(true)
    await page.getByRole('textbox', { name: '搜索页面', exact: true }).fill('hidden-key')
    await expect(page.getByRole('button', { name: '打开 C', exact: true })).toBeVisible()
    await app.evaluate(() => globalThis.__releaseSearch())
    await expect.poll(() => app.evaluate(() => globalThis.__searchReleased)).toBe(true)
    await page.waitForTimeout(150)
    await expect(page.locator('.page-card')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '打开 B', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '打开 C', exact: true })).toBeVisible()
  } finally { await cleanup(app, fixtureData.directory) }
})

test('组合输入期间等待的替换在切页意图出现后取消', async () => {
  const fixtureData = await fixture(); let app
  try {
    const launched = await launch(fixtureData.profile); app = launched.app; const page = launched.page
    await menuCommand(page, 'source'); await expect(source(page)).toBeVisible()
    await menuCommand(page, 'replace')
    await page.getByRole('searchbox', { name: '查找正文' }).fill('alpha')
    await page.getByRole('textbox', { name: '替换为' }).fill('错误替换')
    await expect(page.getByRole('search').getByRole('status')).toHaveText('1 / 2')
    await source(page).evaluate(input => {
      input.focus(); input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      input.value += '组合输入'
    })
    await page.getByRole('button', { name: '替换当前', exact: true }).click()
    await page.getByRole('tab', { name: 'C', exact: true }).click()
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true')
    await source(page).evaluate(input => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '组合输入' })))
    await expect(page.getByRole('tab', { name: 'C', exact: true })).toHaveAttribute('aria-selected', 'true'); await editorReady(page)
    const saved = await page.evaluate(async ids => Promise.all(ids.map(id => window.desktop.read(id))), [fixtureData.first, fixtureData.third])
    expect(saved[0].markdown).toContain('alpha alpha组合输入')
    expect(saved.every(doc => !doc.markdown.includes('错误替换'))).toBe(true)
    await expect(body(page)).toContainText('独立正文')
  } finally { await cleanup(app, fixtureData.directory) }
})
