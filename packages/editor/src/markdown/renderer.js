/**
 * MarkdownIt 实例创建与共享：texmath/KaTeX 挂载、linkify CJK 边界后处理注册。
 * 安全性由 index.js 的 renderMarkdown 出口（DOMPurify 清洗）保证。
 */
import MarkdownIt from 'markdown-it'
import texmath from 'markdown-it-texmath'
import katex from 'katex'
import { fixAutolinkCjkBoundary } from './autolinkCjk.js'

/**
 * 创建 Markdown 渲染器实例
 */
export function createMarkdownRenderer() {
  const md = new MarkdownIt({
    html: true, // 允许 HTML 标签（报告含 sub/sup/table 等）；安全性由 renderMarkdown 出口的 DOMPurify 清洗保证，不要绕过它直接 v-html 原始 md.render 结果
    linkify: true, // 自动转换 URL 为链接
    typographer: true, // 启用智能引号和其他排版替换
    breaks: true, // 转换段落里的 '\n' 到 <br>
    highlight: function (str, lang) {
      // 代码高亮（可选：可以集成 highlight.js）
      return `<pre class="language-${lang}"><code>${escapeHtml(str)}</code></pre>`
    }
  })

  // 添加数学公式支持
  md.use(texmath, {
    engine: katex,
    delimiters: ['dollars', 'brackets'], // 支持 $...$ / $$...$$ 与 \(...\) / \[...\]
    katexOptions: {
      throwOnError: false,
      strict: false,
      // trust 必须为 false：禁止公式里的 \href / \includegraphics / \htmlClass 等
      // 可产生链接、外部请求或任意 class 的命令
      trust: false,
      displayMode: false
    }
  })

  // 自动链接的 CJK 边界修正：linkify 之后把首个 CJK 字符起的部分剥出链接
  // （背景与实现见 ./autolinkCjk.js）
  md.core.ruler.after('linkify', 'cjk-autolink-boundary', fixAutolinkCjkBoundary)

  return md
}

// 模块级共享实例：markdown-it 实例创建（含 texmath/KaTeX 插件挂载）有明显成本，
// 流式期间每个 token 都会调 renderMarkdown，不能每次新建。
let _sharedRenderer = null

/**
 * 共享 MarkdownIt 实例（惰性创建）。渲染是无状态的，可安全复用；
 * 需要独立配置的调用方才用 createMarkdownRenderer() 自建。
 */
export function getMarkdownRenderer() {
  if (!_sharedRenderer) _sharedRenderer = createMarkdownRenderer()
  return _sharedRenderer
}

/**
 * HTML 转义（防止 XSS）
 * @param {string} html - 原始 HTML 字符串
 * @returns {string} 转义后的字符串
 */
function escapeHtml(html) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return html.replace(/[&<>"']/g, m => map[m])
}
