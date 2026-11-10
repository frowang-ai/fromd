import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
export default defineConfig({
  main: { build: { rollupOptions: { input: { index: resolve('apps/desktop/src/main/index.js'), storageWorker: resolve('apps/desktop/src/main/storageWorker.js') }, output: { entryFileNames: '[name].js' }, external: ['electron', 'katex', 'node:sqlite'] } } },
  preload: { build: { rollupOptions: { input: resolve('apps/desktop/src/preload/index.js'), output: { format: 'cjs', entryFileNames: 'index.cjs' }, external: ['electron'] } } },
  renderer: {
    root: resolve('apps/desktop/src/renderer'), plugins: [vue()],
    build: { rollupOptions: { input: resolve('apps/desktop/src/renderer/index.html') } },
  },
})
