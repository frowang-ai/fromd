// Local-only PDF experiment: one job, same-origin loopback requests, no persisted content.
// Production auth, resource authorization and deployment are intentionally not wired here.
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function renderPdf(html) {
  return new Promise((resolve, reject) => {
    const worker = fork(fileURLToPath(new URL('./probe_notes_pdf_worker.mjs', import.meta.url)), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true })
    const timer = setTimeout(() => { worker.kill(); reject(new Error('PDF 生成超时')) }, 50000)
    worker.once('message', result => {
      clearTimeout(timer)
      if (result.error) reject(new Error(result.error))
      else resolve(Buffer.from(result.pdf, 'base64'))
    })
    worker.once('error', error => { clearTimeout(timer); reject(error) })
    worker.once('exit', code => { clearTimeout(timer); reject(new Error(`PDF worker exited: ${code}`)) })
    worker.send({ html })
  })
}

export function createNotesPdfService() {
  let busy = false
  return async function handle(req, res) {
    const json = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ message }))
    }
    const origin = `http://127.0.0.1:${req.socket.localPort}`
    if (req.method !== 'POST') return json(405, '仅支持 POST')
    if (req.headers.origin !== origin || req.headers.host !== new URL(origin).host) return json(403, '仅限本地预览页面调用')
    if (!req.headers['content-type']?.startsWith('application/json')) return json(415, '需要 JSON 文档')
    if (busy) return json(429, '另一份 PDF 正在生成，请稍后重试。')
    busy = true
    try {
      req.setTimeout(15000, () => req.destroy())
      let length = 0
      const chunks = []
      for await (const chunk of req) {
        length += chunk.length
        if (length > 8 * 1024 * 1024) return json(413, '本地预览最多支持 8 MB 文档。')
        chunks.push(chunk)
      }
      req.setTimeout(0)
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      catch { return json(400, '文档格式无效') }
      if (typeof body.html !== 'string' || !body.html.trim()) return json(400, '文档内容为空')
      const pdf = await renderPdf(body.html)
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="note.pdf"', 'Cache-Control': 'no-store' })
      res.end(pdf)
    } catch (error) {
      console.error('Local PDF export:', error.message)
      if (!res.headersSent && !res.destroyed) json(500, 'PDF 生成失败，请检查图片后重试。')
    } finally {
      busy = false
    }
  }
}
