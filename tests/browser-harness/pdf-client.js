import { buildPdfDocument } from '@frowang/editor/pdf'

export async function downloadPreviewPdf({ markdown, title }) {
  const html = await buildPdfDocument({ markdown, title })
  const response = await fetch('/__notes-export/pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html }), signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || 'PDF 生成失败，请重试。')
  }
  if (!response.headers.get('content-type')?.startsWith('application/pdf')) throw new Error('未收到有效 PDF 文件。')
  const blob = await response.blob()
  if (await blob.slice(0, 5).text() !== '%PDF-') throw new Error('生成的 PDF 无效，请重试。')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = (String(title || '笔记').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 100) || '笔记') + '.pdf'
  document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
