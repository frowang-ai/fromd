/**
 * Markdown 渲染工具（公共出口）
 * 使用 markdown-it + KaTeX 渲染数学公式
 *
 * 安全（agent-security-review-20260928）：模型回复、报告、用户消息都按不可信
 * 内容处理，renderMarkdown 输出统一经 DOMPurify 清洗后才交给 v-html；
 * 图片/样式中的外部资源引用只允许同源或 data:image。
 *
 * 目录拆分（2026-10-01，纯机械重构、零行为变化）：
 * - renderer.js     MarkdownIt 实例创建与共享（texmath/KaTeX、linkify CJK 边界注册）
 * - sanitize.js     DOMPurify 收口（SVG 白名单、同源资源、style 白名单）
 * - normalize/      渲染前文本归一化（块公式 → 行内公式 → CJK 标点 emphasis）
 * - autolinkCjk.js  自动链接的 CJK 边界修正（由 renderer 注册）
 * - toc.js          目录提取与滚动跳转
 * - download.js     Markdown / HTML 文件下载
 */
import { createMarkdownRenderer, getMarkdownRenderer } from './renderer.js'
import { sanitizeHtml } from './sanitize.js'
import { normalizeBlockMath } from './normalize/blockMath.js'
import { normalizeInlineMath } from './normalize/inlineMath.js'
import { fixCjkEmphasis } from './normalize/cjkEmphasis.js'
import { extractTOC, scrollToHeading } from './toc.js'
import { downloadMarkdown, downloadHTML } from './download.js'

export { createMarkdownRenderer, getMarkdownRenderer }
export { extractTOC, scrollToHeading }
export { downloadMarkdown, downloadHTML }

/**
 * 渲染 Markdown 文本为 HTML
 * @param {string} markdown - Markdown 文本
 * @returns {string} HTML 字符串
 */
export function renderMarkdown(markdown) {
  if (!markdown) return ''

  // 归一化顺序固定：块公式 → 行内公式 → CJK 标点 emphasis 修复
  const fixed = fixCjkEmphasis(normalizeInlineMath(normalizeBlockMath(markdown)))

  const md = getMarkdownRenderer()
  return sanitizeHtml(md.render(fixed))
}

export default {
  createMarkdownRenderer,
  renderMarkdown,
  extractTOC,
  scrollToHeading,
  downloadMarkdown,
  downloadHTML
}
