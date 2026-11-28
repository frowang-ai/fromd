import { renderMarkdown } from './index.js'
import { renderMermaid } from './mermaid.js'
import { extensionCss } from './extensions.js'

const pdfCss = `
  :root { --editor-font-text: -apple-system, "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; --editor-font-mono: "SF Mono", Menlo, Monaco, Consolas, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", monospace; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eeece8; color: #242321; }
  .markdown-body { width: 210mm; margin: 24px auto; padding: 18mm; background: white; box-shadow: 0 2px 12px #0001; font: 11pt/1.75 var(--editor-font-text); overflow-wrap: anywhere; }
  h1, h2, h3, h4, h5, h6 { font-family: var(--editor-font-text); line-height: 1.4; break-after: avoid; margin: 1.3em 0 .65em; }
  h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 13pt; }
  .markdown-body > :first-child { margin-top: 0; }
  p { margin: .7em 0; orphans: 3; widows: 3; }
  ul, ol { padding-left: 1.7em; } li { margin: .3em 0; }
  .task-mark { display: inline-block; margin-right: .4em; font-family: system-ui, sans-serif; }
  blockquote { margin: 1em 0; padding: .15em 1em; border-left: 3px solid #b89451; color: #555; }
  table { width: 100%; table-layout: auto; border-collapse: collapse; margin: 1em 0; font-size: 10pt; }
  th, td { border: 1px solid #ccc; padding: 6px 9px; vertical-align: top; overflow-wrap: anywhere; }
  th { background: #f3f1ec; font-weight: bold; word-break: keep-all; }
  thead { display: table-header-group; } tr, img { break-inside: avoid; }
  img { display: block; max-width: 100%; height: auto; margin: .8em auto; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: #f5f4f1; border: 1px solid #e1ded8; border-radius: 4px; }
  code { font-family: var(--editor-font-mono); font-size: .9em; }
  .writing-frontmatter { font: inherit; font-family: var(--editor-font-mono); tab-size: 4; }
  .writing-frontmatter code { font: inherit; }
  :not(pre) > code { display: inline; overflow-wrap: anywhere; background: #f5f4f1; padding: .1em .25em; border-radius: 3px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
  a { color: #32567b; text-decoration: underline; }
  u { text-decoration: underline; text-underline-offset: .15em; }
  mark { color: inherit; background: #fff0a8; padding: .03em .12em; border-radius: 2px; }
  kbd { font: .85em/1.5 var(--editor-font-mono); padding: .12em .4em; margin: 0 .12em; color: #39434a; background: #f2f4f5; border: 1px solid #ccd2d5; border-bottom-width: 2px; border-radius: 4px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
  .katex { display: inline-block; white-space: nowrap; }
  .katex-display { margin: 1em 0; break-inside: avoid; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 1.5em 0; }
  .missing-image { color: #805a38; font-size: .9em; }
  @media screen and (max-width: 830px) { .markdown-body { width: calc(100% - 24px); padding: 24px; margin: 12px; } }
  @media print {
    html, body { background: white; margin: 0; padding: 0; }
    .markdown-body { width: auto; max-width: none; margin: 0; padding: 0; box-shadow: none; }
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  }
`

// Build the complete sanitized document, never copy the editor's lazy DOM.
// Resources are embedded by the caller; PDF workers must not fetch user URLs.
export async function buildPdfDocument({ markdown, title = '文档', resolveImage, resolveImages, pageLayout = 'css' }) {
  if (!['css', 'native'].includes(pageLayout)) throw Error('Unknown PDF page layout owner');
  const doc = document.implementation.createHTMLDocument(title)
  doc.documentElement.lang = 'zh-CN'
  // Exactly one owner supplies paper size/margins. Browser/Electron consumers
  // retain CSS A4/18mm; native printers supply them through their print settings.
  const pageCss = pageLayout === 'css' ? '@page { size: A4; margin: 18mm; }' : '';
  const style = doc.createElement('style'); style.textContent = pageCss + pdfCss + extensionCss; doc.head.append(style)
  const article = doc.createElement('article'); article.className = 'markdown-body'
  const template = doc.createElement('template')
  template.innerHTML = renderMarkdown(markdown, { allowRemoteImages: true, allowSvgData: Boolean(resolveImages) })
  // Template content never loads images. Remove web URLs before exposing the
  // local reference list to the host or moving content into the print document.
  for (const image of template.content.querySelectorAll('img')) {
    if (!/^(?:https?:)?\/\//i.test(image.getAttribute('src')?.trim())) continue
    const label = doc.createElement('span'); label.className = 'missing-image'
    label.textContent = image.getAttribute('alt')?.trim() || '[外部图片]'
    image.replaceWith(label)
  }
  const localImages = [...template.content.querySelectorAll('img')]
  const references = [...new Set(localImages.map(image => image.getAttribute('src')))]
  if (references.includes(null)) throw new Error('文档中有图片不可用，请检查后重新导出。')
  const embedded = resolveImages && references.length ? await resolveImages(references) : null
  // Diagram code still passes through the unchanged Markdown sanitizer first;
  // only the local renderer's generated SVG uses the dedicated SVG sanitizer.
  for (const code of template.content.querySelectorAll('pre > code.language-mermaid, pre.language-mermaid > code')) {
    const figure = doc.createElement('figure'); figure.className = 'writing-mermaid-figure'
    try { figure.innerHTML = await renderMermaid(code.textContent) }
    catch (error) { throw new Error(`Mermaid 图表无法导出：${error.message}`) }
    code.parentElement.replaceWith(figure)
  }
  for (const item of template.content.querySelectorAll('li')) {
    const content = item.firstElementChild?.tagName === 'P' ? item.firstElementChild : item
    const first = content.firstChild
    if (first?.nodeType !== 3) continue
    const match = first.textContent.match(/^\[([ xX])\]\s*/)
    if (!match) continue
    const mark = doc.createElement('span'); mark.className = 'task-mark'; mark.textContent = match[1].toLowerCase() === 'x' ? '☑' : '☐'
    first.textContent = first.textContent.slice(match[0].length); content.insertBefore(mark, first)
  }
  await Promise.all(localImages.map(async image => {
    const original = image.getAttribute('src')
    const src = resolveImages ? embedded?.[original] : resolveImage ? await resolveImage(original) : original
    if (!src) throw new Error('文档中有图片不可用，请检查后重新导出。')
    if (src.startsWith('data:image/')) { image.src = src; return }
    const url = new URL(src, document.baseURI)
    if (url.protocol !== 'document-image:' && url.origin !== location.origin) throw new Error('图片必须来自当前文档。')
    const response = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('图片加载失败，请重试。')
    const blob = await response.blob()
    if (!/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) throw new Error('图片格式暂不支持导出。')
    image.src = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob)
    })
    image.removeAttribute('loading')
  }))
  article.append(template.content)
  doc.body.append(article)
  return '<!doctype html>' + doc.documentElement.outerHTML
}
