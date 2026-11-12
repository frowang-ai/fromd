import { expect } from '@playwright/test'

const hosts = new WeakMap()
export function bindMenu(app, page) { hosts.set(page, app) }
export async function editorReady(page) {
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false')
}
export async function menuState(page, name) {
  return hosts.get(page).evaluate(({ Menu }, name) => {
    const item = Menu.getApplicationMenu().getMenuItemById(`document-${name}`)
    return { enabled: item.enabled, checked: item.checked, label: item.label }
  }, name)
}
export async function clickNativeMenu(app, name) {
  await expect.poll(() => app.evaluate(({ Menu }, name) => Menu.getApplicationMenu().getMenuItemById(`document-${name}`).enabled, name)).toBe(true)
  await app.evaluate(({ Menu, BrowserWindow }, name) => {
    const item = Menu.getApplicationMenu().getMenuItemById(`document-${name}`)
    if (!item.enabled) throw new Error(`Menu became disabled: ${name}`)
    item.click(item, BrowserWindow.getAllWindows()[0], {})
  }, name)
}
// Runs the actual registered MenuItem callback -> main -> preload -> renderer.
// Only system dialog answers and explicit race gates are mocked by the specs.
export async function menuCommand(page, name) { await clickNativeMenu(hosts.get(page), name) }

// Existing removal regressions explicitly choose discard for the new draft question.
// Dedicated remove-save tests exercise all answers and assert the dialog contents.
export async function discardDraftQuestions(app) {
  await app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox.bind(dialog)
    dialog.showMessageBox = (_window, options) => options.buttons?.[0] === '保存为 Markdown'
      ? Promise.resolve({ response: 1 }) : original(_window, options)
  })
}

// Exercise the real page-list button and the card's direct top-right removal control.
export async function removePage(page, title, { wait = true } = {}) {
  if (await page.getByRole('button', { name: '页面列表', exact: true }).getAttribute('aria-expanded') !== 'true')
    await page.getByRole('button', { name: '页面列表', exact: true }).click()
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await page.getByRole('button', { name: new RegExp(`^(删除|移除) ${escaped}$`) }).last().click()
  if (wait) await finishRemovePage(page)
}
export async function finishRemovePage(page) {
  await editorReady(page)
  if (await page.getByRole('button', { name: '收起页面列表', exact: true }).count())
    await page.getByRole('button', { name: '收起页面列表', exact: true }).click()
}
