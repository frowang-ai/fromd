import { defineConfig } from '@playwright/test'
import { browserLaunchOptions } from './tests/browser-harness/browser-options.mjs'
export default defineConfig({
  testDir: './tests', testMatch: ['editor.browser.spec.mjs', 'search.browser.spec.mjs'], workers: 1, timeout: 60000,
  expect: { timeout: 10000 }, outputDir: 'output/editor-results',
  reporter: [['list'], ['html', { outputFolder: 'output/editor-report', open: 'never' }]],
  use: { browserName: 'chromium', launchOptions: browserLaunchOptions(), headless: true, viewport: { width: 1200, height: 780 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', serviceWorkers: 'block' },
})
