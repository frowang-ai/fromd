import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DocumentStore } from '../apps/desktop/src/main/documentStore.js'
import { bindMenu, editorReady, menuCommand } from './native-menu.mjs'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const body = page => page.getByRole('textbox', { name: 'Markdown 正文', exact: true })
const source = page => page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
const outline = page => page.getByRole('list', { name: '文档大纲', exact: true })

async function fixture(markdown) {
  const directory = await mkdtemp(join(tmpdir(), 'frowd-reading-'))
  const profile = join(directory, 'profile'), store = new DocumentStore(profile)
  try {
    await store.restore()
    await store.rename(store.activeId, '阅读样本')
    await store.update(store.activeId, markdown, 1)
  } finally { await store.dispose() }
  return { directory, profile }
}

async function launch(profile) {
  const env = { ...process.env, FROWANG_USER_DATA: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    ...(process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: [] } : { args: [root] }),
    env, timeout: 30000,
  })
  const page = await app.firstWindow()
  bindMenu(app, page)
  await editorReady(page)
  return { app, page }
}

async function stop(app) {
  const child = app?.process()
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await exited
}

async function closeNormally(app) {
  const closed = app.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
}

async function cleanup(app, directory) {
  await stop(app)
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

async function openSettings(page) {
  const button = page.getByRole('button', { name: '阅读', exact: true })
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
  await expect(page.getByRole('combobox', { name: '正文字号', exact: true })).toBeVisible()
}

async function expectCodeContrast(locator) {
  await expect(locator).toBeVisible()
  const ratios = await locator.evaluate(element => {
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => {
        const channel = Number(value) / 255
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
      })
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]
    }
    const background = node => {
      for (let current = node; current; current = current.parentElement) {
        const color = getComputedStyle(current).backgroundColor
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color
      }
      return 'rgb(255, 255, 255)'
    }
    return [...element.querySelectorAll('.cm-line, .cm-line span')].filter(node => node.textContent.trim()).map(node => {
      const foreground = luminance(getComputedStyle(node).color), surface = luminance(background(node))
      return (Math.max(foreground, surface) + .05) / (Math.min(foreground, surface) + .05)
    })
  })
  expect(ratios.length).toBeGreaterThan(0)
  expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5)
}

test('大纲排除代码伪标题，在正文和源码中定位同一标题', async () => {
  const markdown = '# 开始\n\n```md\n# 代码伪标题\n```\n\n' +
    Array.from({ length: 40 }, (_, index) => `第${index}段正文。`).join('\n\n') + '\n\n第二节\n---\n\n后续正文。'
  const { directory, profile } = await fixture(markdown)
  const { app, page } = await launch(profile)
  try {
    await page.getByRole('button', { name: '大纲', exact: true }).click()
    await expect(outline(page).getByRole('button')).toHaveText(['开始', '第二节'])
    await outline(page).getByRole('button', { name: '第二节', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('h2')?.textContent)).toBe('第二节')
    const target = await body(page).getByRole('heading', { name: '第二节', exact: true }).boundingBox()
    const header = await page.locator('.app-bar').boundingBox()
    expect(target.y).toBeGreaterThanOrEqual(header.y + header.height)
    expect(target.y).toBeLessThan(await page.evaluate(() => innerHeight))

    await menuCommand(page, 'source')
    await expect(source(page)).toHaveValue(markdown)
    await outline(page).getByRole('button', { name: '第二节', exact: true }).click()
    await expect(source(page)).toBeFocused()
    expect(await source(page).evaluate(input => input.selectionStart)).toBe(markdown.indexOf('第二节'))
    expect(await source(page).evaluate(input => input.scrollTop)).toBeGreaterThan(0)
    await expect(source(page)).toHaveValue(markdown)
  } finally { await cleanup(app, directory) }
})

test('字数统计随源码和正文编辑更新，切换笔记后使用当前页面', async () => {
  const { directory, profile } = await fixture('# 统计\n\n你好 world 123')
  const { app, page } = await launch(profile)
  try {
    const count = page.getByRole('status', { name: '字数统计', exact: true })
    await expect(count).toHaveText('6 字词 · 12 字符')
    await menuCommand(page, 'source')
    await source(page).fill('# 统计\n\n你好 world 123\n\n新增 words')
    await expect(count).toHaveText('9 字词 · 19 字符')
    await menuCommand(page, 'source')
    await body(page).press('Control+End')
    await page.keyboard.insertText(' again')
    await expect(count).toHaveText('10 字词 · 24 字符')
    await menuCommand(page, 'new')
    await editorReady(page)
    await expect(count).toHaveText('0 字词 · 0 字符')
    await page.getByRole('tab', { name: '阅读样本', exact: true }).click()
    await editorReady(page)
    await expect(count).toHaveText('10 字词 · 24 字符')
  } finally { await cleanup(app, directory) }
})

test('字号、正文宽度和主题重启后恢复，设置存储故障有反馈', async () => {
  const { directory, profile } = await fixture('# 设置\n\n保留正文')
  let app
  try {
    let launched = await launch(profile)
    app = launched.app
    let page = launched.page
    await openSettings(page)
    await page.getByRole('combobox', { name: '正文字号', exact: true }).selectOption('20')
    await page.getByRole('combobox', { name: '正文宽度', exact: true }).selectOption('720')
    await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('dark')
    await expect(page.locator('main')).toHaveAttribute('data-theme', 'dark')
    await expect(body(page)).toHaveCSS('font-size', '20px')
    await expect(page.locator('.shared-editor')).toHaveCSS('max-width', '720px')
    await closeNormally(app)

    launched = await launch(profile)
    app = launched.app
    page = launched.page
    await expect(page.locator('main')).toHaveAttribute('data-theme', 'dark')
    await expect(body(page)).toHaveCSS('font-size', '20px')
    await openSettings(page)
    await expect(page.getByRole('combobox', { name: '正文字号', exact: true })).toHaveValue('20')
    await expect(page.getByRole('combobox', { name: '正文宽度', exact: true })).toHaveValue('720')
    await expect(page.getByRole('combobox', { name: '主题', exact: true })).toHaveValue('dark')
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Synthetic settings failure') } })
    await page.getByRole('combobox', { name: '正文字号', exact: true }).selectOption('18')
    await expect(body(page)).toHaveCSS('font-size', '18px')
    await expect(page.getByRole('alert')).toContainText('阅读设置保存失败')
    await expect(body(page)).toContainText('保留正文')
  } finally { await cleanup(app, directory) }
})

test('深色下普通代码和公式编辑文字保持可读，跟随系统实时切换', async ({}, info) => {
  const { directory, profile } = await fixture('# 深色\n\n```js\nconst answer = 42 // comment\n```\n\n$$\nx = 1 + 2\n$$\n\n行内 $x^2$。')
  const { app, page } = await launch(profile)
  try {
    await openSettings(page)
    await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('dark')
    await page.getByRole('button', { name: '关闭阅读工具', exact: true }).click()
    await expect(page.locator('main')).toHaveCSS('background-color', 'rgb(32, 39, 35)')
    const code = page.locator('.milkdown-code-block .cm-content')
    await code.click()
    await expectCodeContrast(code)
    await page.getByRole('button', { name: '编辑行间公式', exact: true }).click()
    const formula = page.locator('.writing-block-code .cm-content')
    await expectCodeContrast(formula)
    await page.screenshot({ path: info.outputPath('dark-code-and-formula.png') })
    await page.getByRole('button', { name: '完成公式编辑', exact: true }).click()
    await page.getByRole('button', { name: '编辑行内公式', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '行内公式 LaTeX', exact: true })).toHaveCSS('color', 'rgb(229, 181, 237)')
    await page.keyboard.press('Escape')

    await openSettings(page)
    await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('system')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('main')).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('main')).toHaveAttribute('data-theme', 'dark')
  } finally { await cleanup(app, directory) }
})

test('窄窗口可以打开大纲和阅读设置，面板与主要工具保持在视口内', async ({}, info) => {
  const { directory, profile } = await fixture('# 窄窗口\n\n正文')
  const { app, page } = await launch(profile)
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(560, 600))
    for (const name of ['新建笔记', '大纲', '阅读']) {
      const button = page.getByRole('button', { name, exact: true })
      await expect(button).toBeVisible()
      const bounds = await button.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
    }
    await page.getByRole('button', { name: '大纲', exact: true }).click()
    await expect(outline(page).getByRole('button', { name: '窄窗口', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: '阅读设置', exact: true }).click()
    await page.getByRole('combobox', { name: '正文字号', exact: true }).selectOption('20')
    await page.getByRole('combobox', { name: '正文宽度', exact: true }).selectOption('1080')
    const bounds = await page.getByRole('complementary', { name: '阅读工具', exact: true }).boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
    await expect(page.getByRole('status', { name: '字数统计', exact: true })).toBeInViewport()
    await page.screenshot({ path: info.outputPath('narrow-reading-settings.png') })
  } finally { await cleanup(app, directory) }
})
