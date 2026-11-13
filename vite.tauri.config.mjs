import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

// One chunk per vendor package: keeps chunks small and cache-friendly. The esbuild
// temp-file denial on some Windows hosts is avoided by minifying with terser below.
function vendorChunk(id) {
  const parts = id.split(/node_modules[\\/]/)
  if (parts.length < 2) return undefined
  const segments = parts.at(-1).split(/[\\/]/)
  const name = segments[0].startsWith('@') ? `${segments[0].slice(1)}-${segments[1]}` : segments[0]
  return `vendor-${name}`
}

// Lite (Tauri) shell: the same renderer as Electron, with a different bridge entry.
export default defineConfig({
  root: resolve('apps/tauri'),
  publicDir: resolve('apps/desktop/src/renderer/public'),
  base: './',
  plugins: [vue()],
  clearScreen: false,
  server: { port: 5200, strictPort: true, fs: { allow: [resolve('.')] } },
  build: {
    outDir: resolve('out/tauri'), emptyOutDir: true,
    // WebView2 is evergreen Chromium; terser avoids esbuild's >1 MiB temp-file path.
    target: 'esnext', minify: 'terser',
    rollupOptions: { output: { manualChunks: vendorChunk } },
  },
})
