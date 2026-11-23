/**
 * MarkdownIt 实例创建与共享：texmath/KaTeX 挂载、linkify CJK 边界后处理注册。
 * 安全性由 index.js 的 renderMarkdown 出口（DOMPurify 清洗）保证。
 */
import MarkdownIt from 'markdown-it'
import texmath from 'markdown-it-texmath'
import katex from 'katex'
import footnote from 'markdown-it-footnote'
import { markdownAlerts } from './extensions.js'
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
      if (/^mermaid$/i.test(lang)) lang = 'mermaid'
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
  // remark-math 6 parses $ $ as an empty inline atom; texmath rejects the
  // whitespace form. Consume only a single-dollar, same-line whitespace pair.
  // Inline code/escapes and link destinations retain markdown-it's own boundaries.
  md.inline.ruler.before('escape', 'frowd-empty-inline-math', (state, silent) => {
    const start = state.pos
    if (state.src[start] !== '$' || state.src[start - 1] === '$') return false
    const match = /^\$[ \t]+\$(?!\$)/.exec(state.src.slice(start, state.posMax))
    if (!match) return false
    if (!silent) state.push('frowd_empty_math', '', 0)
    state.pos += match[0].length
    return true
  })
  md.renderer.rules.frowd_empty_math = () => ''
  md.use(footnote).use(markdownAlerts)
  // Match the GFM parser's identifier case folding, while retaining the actual
  // definition label. This only changes print token matching, never stored text.
  const identifier = label => label.replace(/[\t\n\r ]+/g, ' ').replace(/^ | $/g, '').toLowerCase().toUpperCase()
  md.core.ruler.before('inline', 'frowd-footnote-labels', state => {
    const labels = new Map()
    for (const token of state.tokens) if (token.type === 'footnote_reference_open') {
      const label = token.meta.label, key = identifier(label)
      if (!labels.has(key)) labels.set(key, label)
    }
    state.env.frowdFootnoteLabels = labels
  })
  md.inline.ruler.at('footnote_ref', (state, silent) => {
    const start = state.pos
    if (state.src.slice(start, start + 2) !== '[^') return false
    const end = state.src.indexOf(']', start + 2)
    if (end < 0 || end >= state.posMax || end === start + 2) return false
    const label = state.src.slice(start + 2, end)
    if (/[\t\n\r ]/.test(label)) return false
    const defined = state.env.frowdFootnoteLabels?.get(identifier(label))
    if (defined === undefined) return false
    if (!silent) {
      const notes = state.env.footnotes
      notes.list ||= []
      let id = notes.refs[`:${defined}`]
      if (id < 0) {
        id = notes.list.length; notes.refs[`:${defined}`] = id
        notes.list.push({ label: defined, count: 0 })
      }
      const subId = notes.list[id].count++
      state.push('footnote_ref', '', 0).meta = { id, subId, label }
    }
    state.pos = end + 1
    return true
  })
  // Print the complete source, including definitions with no remaining reference
  // after an edit. markdown-it-footnote normally discards those definitions.
  md.core.ruler.before('footnote_tail', 'frowd-unused-footnotes', state => {
    const notes = state.env.footnotes
    if (!notes?.refs) return
    notes.list ||= []
    for (const [key, id] of Object.entries(notes.refs)) {
      if (id >= 0) continue
      notes.refs[key] = notes.list.length
      notes.list.push({ label: key.slice(1), count: 0 })
    }
  })
  const footnoteAnchor = md.renderer.rules.footnote_anchor
  md.renderer.rules.footnote_anchor = (tokens, index, options, env, self) =>
    env.footnotes.list[tokens[index].meta.id].count === 0 ? '' : footnoteAnchor(tokens, index, options, env, self)

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
