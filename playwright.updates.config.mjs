import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: ['updates.desktop.spec.mjs'], workers: 1, timeout: 240000,
  expect: { timeout: 20000 }, outputDir: 'output/update-results',
  reporter: [['list'], ['html', { outputFolder: 'output/update-report', open: 'never' }]],
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
})
