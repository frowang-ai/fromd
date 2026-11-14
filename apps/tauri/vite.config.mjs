import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve('apps/tauri/src'),
  plugins: [vue()],
  resolve: {
    alias: {
      '@frowang/editor': resolve('packages/editor'),
    },
  },
  build: {
    outDir: resolve('apps/tauri/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve('apps/tauri/src/index.html'),
    },
  },
})
