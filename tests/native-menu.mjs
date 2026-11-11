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
