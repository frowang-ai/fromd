import DOMPurify from 'dompurify'

let runtime, queue = Promise.resolve(), serial = 0
const styleProperties = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'visibility', 'display']
const svgTags = ['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'marker', 'clipPath', 'title', 'desc']
const svgAttributes = ['id', 'class', 'xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'dx', 'dy', 'points', 'transform', 'fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'text-anchor', 'dominant-baseline', 'marker-start', 'marker-mid', 'marker-end', 'markerWidth', 'markerHeight', 'markerUnits', 'orient', 'refX', 'refY', 'clip-path', 'clipPathUnits', 'preserveAspectRatio', 'role', 'aria-labelledby', 'aria-describedby', 'style']

// Refuse executable/config/resource syntax BEFORE Mermaid creates its measuring
// DOM. Post-render sanitizing alone cannot prevent a measuring <img> request.
// Common offline diagram types are supported; new resource-bearing types must
// be reviewed here before enabling them.
export function validateMermaid(source) {
  if (!source.trim()) throw Error('图表尚未完整，请输入 Mermaid 源码。')
  if (source.length > 50000) throw Error('图表源码超过 50,000 字符，请拆分图表。')
  const code = source.replace(/^\s*%%[^\n]*$/gm, '').trim()
  if (!/^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|xychart(?:-beta)?|sankey(?:-beta)?|requirementDiagram|block-beta|packet-beta)\b/.test(code)) throw Error('此图表类型暂不支持离线预览。')
  if (/%%\s*\{|^\s*---|<\s*[a-z!/?]|&(?:lt;|#)|\\|!\[|(?:url\s*\(|@import|@font-face|\b(?:img|image|icon)["']?\s*:|\bshape\s*:\s*["']?(?:image|icon)|\bimage\s*\(|::icon\s*\(|^\s*click\s)/im.test(source)) {
    throw Error('图表不支持 HTML、配置指令、点击动作或外部资源。')
  }
  return source
}

async function getRuntime() {
  if (!runtime) runtime = import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
      suppressErrorRendering: true, maxTextSize: 50000, maxEdges: 500,
      theme: 'default', fontFamily: 'Arial, Microsoft YaHei, sans-serif',
      flowchart: { htmlLabels: false },
      secure: ['secure', 'securityLevel', 'startOnLoad', 'htmlLabels', 'flowchart', 'theme', 'themeCSS', 'fontFamily', 'maxTextSize', 'maxEdges', 'suppressErrorRendering'],
    })
    return mermaid
  })
  return runtime
}

function localPaint(value) {
  // Browsers may resolve a local marker URL against document.baseURI.
  return value.replace(/url\(["']?([^\s)'"]+)["']?\)/g, (_, target) => {
    const fragment = target.slice(target.lastIndexOf('#'))
    if (!/^#[\w-]+$/.test(fragment)) throw Error('图表含不支持的资源引用。')
    if (!target.startsWith('#')) {
      const url = new URL(target, document.baseURI), base = new URL(document.baseURI)
      url.hash = ''; base.hash = ''
      if (url.href !== base.href) throw Error('图表含外部资源引用。')
    }
    return `url(${fragment})`
  })
}

// This sanitizer is ONLY for the local Mermaid output, never raw Markdown HTML.
// Resolve the generated styles while mounted, copy safe presentation properties,
// then discard all stylesheets, HTML, links, events and resource-bearing nodes.
function printableSvg(svg, stage) {
  stage.innerHTML = svg
  const original = stage.querySelector('svg')
  if (!original || !original.hasAttribute('viewBox')) throw Error('图表缺少可打印尺寸。')
  for (const element of [original, ...original.querySelectorAll('*')]) {
    if (!svgTags.some(tag => tag.toLowerCase() === element.localName.toLowerCase())) continue
    const computed = getComputedStyle(element)
    element.removeAttribute('style')
    for (const property of styleProperties) {
      const value = localPaint(computed.getPropertyValue(property))
      if (value && !/[<>\\@]/.test(value)) element.style.setProperty(property, value)
    }
    for (const attribute of ['marker-start', 'marker-mid', 'marker-end', 'clip-path', 'fill', 'stroke']) {
      if (element.hasAttribute(attribute)) element.setAttribute(attribute, localPaint(element.getAttribute(attribute)))
    }
  }
  const clean = DOMPurify(window).sanitize(original.outerHTML, {
    ALLOWED_TAGS: svgTags, ALLOWED_ATTR: svgAttributes, ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['style', 'foreignObject', 'image', 'use', 'a', 'script', 'animate', 'set'],
    FORBID_ATTR: ['href', 'xlink:href'], RETURN_DOM_FRAGMENT: true,
  })
  const result = clean.querySelector('svg'), box = result?.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number)
  if (!result || box?.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) throw Error('图表尺寸无效。')
  result.setAttribute('width', String(box[2])); result.setAttribute('height', String(box[3]))
  result.setAttribute('class', 'writing-mermaid-svg'); result.setAttribute('role', 'img')
  result.style.maxWidth = '100%'; result.style.height = 'auto'
  return result.outerHTML
}

// Serializing Mermaid's global renderer also keeps concurrent body/PDF jobs
// independent. Callers discard stale node-view results by revision/destroy state.
export function renderMermaid(source) {
  try { validateMermaid(source) } catch (error) { return Promise.reject(error) }
  const render = async () => {
    const mermaid = await getRuntime(), id = `frowd-mermaid-${++serial}`
    const stage = document.createElement('div')
    stage.setAttribute('aria-hidden', 'true')
    stage.style.cssText = 'position:fixed;left:-100000px;top:0;width:1000px;opacity:0;pointer-events:none'
    document.body.append(stage)
    try {
      const { svg } = await mermaid.render(id, source, stage)
      return printableSvg(svg, stage)
    } catch (error) {
      throw Error(error?.message?.startsWith('图表') ? error.message : '图表语法尚未完整或暂不支持，请检查 Mermaid 源码。')
    } finally { stage.remove(); document.getElementById(`d${id}`)?.remove() }
  }
  const result = queue.then(render)
  queue = result.catch(() => {})
  return result
}
