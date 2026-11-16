import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'native.desktop.spec.mjs',
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  outputDir: '../../output/tauri-native-results',
  reporter: [['list']],
})
