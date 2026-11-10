/**
 * 自动链接的 CJK 边界：linkify-it 不把 CJK 标点/汉字当 URL 边界，
 * 「https://a.b/c。后续」会把句号连同后续文字整段吞进 href（streamdown 的
 * CJK 插件文档提示的方向，2026-10-01 在我们的管线上实测复现）。
 * linkify 之后把首个 CJK 字符起的部分剥出链接。
 */

// CJK 标点与汉字：CJK 符号区、表意文字（含扩展 A 与兼容区）、全角 ASCII 标点
// （不含全角字母/数字——与 normalize/cjkEmphasis.js 中 CJK_PUNCT 的口径一致）
// 注：正则开头的表意空格（U+3000）以 Unicode 转义书写（eslint no-irregular-whitespace），语义不变
const CJK_LINK_BOUNDARY = /[\u3000-〿㐀-䶿一-鿿豈-﫿＀-／：-＠［-｀｛-･]/

/**
 * linkify 后处理：把自动链接里首个 CJK 字符起的部分剥出链接。
 * 只处理 linkify 生成的自动链接（锚文本即 URL 本身）；显式 [锚文本](url)
 * 的锚文本可以是中文，绝不能动，靠"文本以 http(s):// 开头"区分。
 */
export function fixAutolinkCjkBoundary(state) {
  for (const token of state.tokens) {
    if (token.type !== 'inline' || !token.children) continue
    const children = token.children
    for (let i = 0; i < children.length - 2; i += 1) {
      const open = children[i]
      if (open.type !== 'link_open') continue
      const textToken = children[i + 1]
      const close = children[i + 2]
      if (textToken.type !== 'text' || close.type !== 'link_close') continue
      const text = textToken.content
      if (!/^https?:\/\//.test(text)) continue
      const cut = text.search(CJK_LINK_BOUNDARY)
      if (cut === -1) continue
      const url = text.slice(0, cut)
      textToken.content = url
      open.attrSet('href', state.md.normalizeLink(url))
      const tail = new state.Token('text', '', 0)
      tail.content = text.slice(cut)
      children.splice(i + 3, 0, tail)
      i += 3 // 跳过刚插入的 tail，继续扫后面的链接
    }
  }
}
