import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { createNotesPdfService } from './probe_notes_pdf_service.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
export async function startWritingPreview({ port = 5198 } = {}) {
  const exportPdf = createNotesPdfService()
  const server = await createServer({
    root, configFile: false, logLevel: 'error',
    cacheDir: resolve(root, `node_modules/.vite-writing-${port || 'test'}`),
    resolve: { alias: { '@': resolve(root, 'src') } },
    optimizeDeps: { include: ['@milkdown/crepe', '@milkdown/kit/core', '@milkdown/kit/ctx', '@milkdown/kit/utils', '@milkdown/kit/prose/state', '@milkdown/kit/prose/history', '@milkdown/kit/prose/inputrules', '@milkdown/kit/preset/commonmark', 'remark-math', 'katex'] },
    server: { host: '127.0.0.1', port, strictPort: Boolean(port), fs: { allow: [root, realpathSync(resolve(root, 'node_modules'))] } },
    plugins: [vue(), { name: 'standalone-writing-preview', configureServer(s) {
      s.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url, 'http://localhost').pathname
        if (pathname === '/__notes-export/pdf') return exportPdf(req, res)
        if (pathname !== '/' && pathname !== '/__editor') return next()
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(await s.transformIndexHtml(req.url, `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>未命名笔记</title></head><body><div id="app"></div><script type="module">import {createApp} from 'vue';import App from '/tests/browser-harness/ProbeWritingApp.vue';createApp(App).mount('#app');</script></body></html>`))
      })
    } }],
  })
  await server.listen()
  return { server, origin: `http://127.0.0.1:${server.httpServer.address().port}` }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] || 5198)
  const { origin } = await startWritingPreview({ port })
  console.log(`Writing editor: ${origin}/__editor`)
}
