/**
 * HTML 消毒（不可信内容的唯一收口）
 *
 * 安全（agent-security-review-20260928）：模型回复、报告、用户消息都按不可信
 * 内容处理，renderMarkdown 输出统一经这里的 DOMPurify 清洗后才交给 v-html；
 * 图片/样式中的外部资源引用只允许同源或 data:image。
 */
import DOMPurify from 'dompurify'

// 专用实例：钩子只注册一次，且不影响 CollabThreadView / MarkdownText
// 等使用默认实例的页面，避免钩子累积或配置串扰。
const sanitizer = typeof window !== 'undefined' && window.document ? DOMPurify(window) : null

// KaTeX 的视觉渲染依赖行内 SVG（根号、上括号等），默认 html profile 会剥掉，
// 这里按 KaTeX 实际使用的最小集合放行 SVG 标签/属性；script、事件处理器、
// foreignObject 等仍由 DOMPurify 默认规则拦截。
// 报告不需要媒体/表单/嵌入类标签，直接禁用（poster/source src 等会自动外发请求）。
const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true, mathMl: true },
  ADD_TAGS: ['svg', 'path', 'line', 'rect', 'circle', 'ellipse', 'g', 'polygon', 'polyline'],
  ADD_ATTR: [
    'viewBox',
    'preserveAspectRatio',
    'xmlns',
    'd',
    'points',
    'transform',
    'fill',
    'fill-rule',
    'fill-opacity',
    'opacity',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-opacity',
    'x',
    'y',
    'x1',
    'x2',
    'y1',
    'y2',
    'cx',
    'cy',
    'r'
  ],
  FORBID_TAGS: [
    'video',
    'audio',
    'source',
    'track',
    'iframe',
    'object',
    'embed',
    'applet',
    'form',
    'input',
    'textarea',
    'select',
    'button',
    'link',
    'meta',
    'base',
    'frame',
    'frameset'
  ],
  // srcset/poster/xlink:href 都能直接触发外部请求，不在白名单机制里逐个判，直接禁用
  FORBID_ATTR: ['srcset', 'poster', 'xlink:href', 'formaction', 'srcdoc']
}

/**
 * CSS 反转义：\72 → r、\x 逐字符还原。\u 写法的 url(...) 必须先解码再判断，
 * 否则 `u\72 l(...)` 这类写法会绕过对 url( 的检查。
 */
function cssUnescape(value) {
  return value.replace(/\\([0-9a-fA-F]{1,6}\s?|.)/g, (match, body) => {
    if (/^[0-9a-fA-F]/.test(body)) {
      const codePoint = parseInt(body, 16)
      return Number.isNaN(codePoint) ? '' : String.fromCodePoint(codePoint)
    }
    return body
  })
}

// 公式/排版真正需要的 style 属性白名单；不在列表里的声明直接丢弃。
const SAFE_STYLE_PROP =
  /^(height|min-height|max-height|width|min-width|max-width|vertical-align|position|top|bottom|left|right|margin(-(top|right|bottom|left))?|padding(-(top|right|bottom|left))?|color|background-color|border-color|font-style|font-weight|text-decoration|white-space|display|visibility|box-sizing)$/
// 声明值只允许排版/颜色需要的字符；冒号、引号、斜杠、反斜杠一律不允许，
// 从字符集上杜绝 javascript:、//host、协议相对地址等写法。
const SAFE_STYLE_VALUE = /^[\w\s.,%#+()-]+$/

/**
 * 清洗 style 属性：按声明逐条过滤，返回保留的声明串（空串表示全部丢弃）。
 * 不做完整 CSS 解析：先 CSS 反转义（防 u\72 l 绕过），再双重白名单——
 * 属性必须在排版/颜色白名单内，值字符集不允许冒号/引号/斜杠/反斜杠，
 * 且值不得含 url(/expression( 等资源或脚本写法。白名单外的声明直接丢弃，
 * 不影响同元素其他合法声明。
 */
function sanitizeStyle(style) {
  const decoded = cssUnescape(style).toLowerCase()
  const kept = []
  for (const decl of decoded.split(';')) {
    const colon = decl.indexOf(':')
    if (colon === -1) continue
    const prop = decl.slice(0, colon).trim()
    const value = decl.slice(colon + 1).trim()
    if (!SAFE_STYLE_PROP.test(prop)) continue
    if (!SAFE_STYLE_VALUE.test(value)) continue
    if (/url\s*\(|expression\s*\(|@/.test(value)) continue
    kept.push(`${prop}: ${value}`)
  }
  return kept.join('; ')
}

/**
 * 资源 URL 只允许同源或 data:image；其余（外域图片、外域 CSS url）一律剥除，
 * 防止展示不可信内容时自动向外部服务器发请求（可能携带文档信息）。
 */
export function isAllowedResourceUrl(url) {
  if (!url) return false
  const trimmed = url.trim()
  if (/^data:image\//i.test(trimmed)) return true
  try {
    return new URL(trimmed, window.location.origin).origin === window.location.origin
  } catch {
    return false
  }
}

const SVG_TAGS = new Set([
  'SVG',
  'PATH',
  'LINE',
  'RECT',
  'CIRCLE',
  'ELLIPSE',
  'G',
  'POLYGON',
  'POLYLINE'
])

function enforceSameOriginResources(node) {
  if (!node.getAttribute) return
  // 注意：HTML 文档里的 SVG 元素 tagName 保留原大小写（'rect'），
  // HTML 元素是大写（'IMG'），统一转大写再比较
  const tag = (node.tagName || '').toUpperCase()
  if (tag === 'IMG') {
    if (node.hasAttribute('src') && !isAllowedResourceUrl(node.getAttribute('src'))) {
      node.removeAttribute('src')
      node.setAttribute('alt', ((node.getAttribute('alt') || '') + ' [外部图片已拦截]').trim())
    }
  }
  // SVG 表现属性可引用外部资源（fill/stroke="url(...)"），KaTeX 只用纯色/关键字，
  // 出现 url( 即剥除该属性
  if (SVG_TAGS.has(tag)) {
    for (const attr of ['fill', 'stroke']) {
      const value = node.getAttribute(attr)
      if (value && /url\s*\(/i.test(cssUnescape(value))) node.removeAttribute(attr)
    }
  }
  // style 走白名单清洗（反转义 + 危险模式拒绝 + 属性白名单），不再用正则识别 url
  if (node.hasAttribute('style')) {
    const clean = sanitizeStyle(node.getAttribute('style'))
    if (clean) node.setAttribute('style', clean)
    else node.removeAttribute('style')
  }
}

if (sanitizer) {
  sanitizer.addHook('afterSanitizeAttributes', enforceSameOriginResources)
}

export function sanitizeHtml(html) {
  // Node 单测环境没有 DOM，不清洗（清洗行为由浏览器测试覆盖）；
  // 生产路径（Vue SPA）一定在浏览器里运行，sanitizer 必然存在。
  return sanitizer ? sanitizer.sanitize(html, SANITIZE_CONFIG) : html
}
