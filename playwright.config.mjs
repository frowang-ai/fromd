import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: ['desktop.spec.mjs', 'drafts.desktop.spec.mjs', 'lazy.desktop.spec.mjs', 'menu.desktop.spec.mjs', 'shelf.desktop.spec.mjs', 'motion.desktop.spec.mjs', 'remove-save.desktop.spec.mjs'], workers: 1, timeout: 90000,
  expect: { timeout: 15000 },
  outputDir: process.env.PACKAGED_EXE ? 'output/packaged-results' : 'output/desktop-results', reporter: [['list'], ['html', { outputFolder: process.env.PACKAGED_EXE ? 'output/packaged-report' : 'output/desktop-report', open: 'never' }]],
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
})
