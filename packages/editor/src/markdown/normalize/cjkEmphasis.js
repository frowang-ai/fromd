/**
 * 修复 CommonMark emphasis 侧翼规则在 CJK 标点下失效的问题
 * `**`/`*` 紧跟中文全角标点（如 `"`、`'`、`"`、`"`、`，`。`）时，markdown-it
 * 不认为它是左侧翼分隔符，从而 bold/italic 语法失败。
 * 在 delimiter 与 CJK 标点之间插入零宽空格 (U+200B)，让解析器"看见"一个有效
 * 的单词边界。零宽空格是不可见字符，不影响最终展示。
 *
 * 字符类包含：
 *   - ASCII 引号 `"` `'`（LLM 输出常用直引号，typographer 会在 tokenize
 *     阶段才转成智能引号，必须提前处理）
 *   - 智能引号 U+2018-U+201F
 *   - CJK 符号与标点 U+3000-U+303F
 *   - 全角 ASCII 标点（排除全角字母/数字）：
 *     U+FF01-U+FF0F  ! " # $ % & ' ( ) * + , - . /
 *     U+FF1A-U+FF20  : ; < = > ? @
 *     U+FF3B-U+FF40  [ \ ] ^ _ `
 *     U+FF5B-U+FF65  { | } ~ (全角~)
 *   （不包含 U+FF21-U+FF3A / U+FF41-U+FF5A 全角字母，
 *    也不包含 U+FF10-U+FF19 全角数字 —— 它们与 ASCII 等价，
 *    应当作普通字符走原有逻辑，不应被插 ZWSP）
 */
export function fixCjkEmphasis(markdown) {
  // 静态回归测试按行提取并 eval 下一行（tests/test_markdown_cjk_bold.mjs），必须保持单行
  // prettier-ignore
  const CJK_PUNCT = '["\'\\u2018-\\u201F\\u3000-\\u303F\\uFF01-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65]'
  return (
    markdown
      // bold ** —— 先处理，避免被 italic 规则误伤
      .replace(new RegExp(`\\*\\*(?=${CJK_PUNCT})`, 'g'), '**\u200B')
      .replace(new RegExp(`(?<=${CJK_PUNCT})\\*\\*`, 'g'), '\u200B**')
      // italic * —— 必须用负向断言排除 **，避免破坏 bold delimiter
      .replace(new RegExp(`(?<!\\*)\\*(?!\\*)(?=${CJK_PUNCT})`, 'g'), '*\u200B')
      .replace(new RegExp(`(?<=${CJK_PUNCT})\\*(?!\\*)`, 'g'), '\u200B*')
  )
}
