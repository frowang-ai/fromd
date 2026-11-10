/**
 * 行内数学公式归一化（依赖 pipeline 的代码段跳过原语）。
 */
import { transformMarkdownOutsideCode, isEscaped } from './pipeline.js'

const ZWSP = '\u200B'

/**
 * 归一化 LLM/OCR 常见的行内数学公式漂移。
 *
 * markdown-it-texmath 的 dollars 规则会拒绝 `$ C_j$`、`$C_j $`、
 * `1$C_j$`、`$C_j$1`，且不识别全角美元符号 `＄...＄`。
 * 这些形态在中文论文报告中经常来自 OCR 或模型输出。这里只处理看起来
 * 像数学公式的单美元片段，并跳过 fenced code 与 inline code。
 */
export function normalizeInlineMath(markdown) {
  return transformMarkdownOutsideCode(markdown, normalizeInlineMathInText)
}

function normalizeInlineMathInText(text) {
  let result = ''
  let i = 0

  while (i < text.length) {
    const delimiter = text[i]
    const isDollar = delimiter === '$'
    const isFullwidthDollar = delimiter === '＄'

    if (!isDollar && !isFullwidthDollar) {
      result += delimiter
      i += 1
      continue
    }

    if (isEscaped(text, i) || text[i + 1] === delimiter) {
      result += delimiter
      i += 1
      continue
    }

    const close = findClosingInlineMathDelimiter(text, i + 1, delimiter)
    if (close === -1) {
      result += delimiter
      i += 1
      continue
    }

    const rawContent = text.slice(i + 1, close)
    const trimmedContent = rawContent.trim()

    if (!looksLikeMath(trimmedContent)) {
      result += text.slice(i, close + 1)
      i = close + 1
      continue
    }

    const previous = result[result.length - 1] || ''
    const next = text[close + 1] || ''
    const needsPreBoundary = isAsciiDigit(previous)
    const needsPostBoundary = isAsciiDigit(next)
    const needsContentTrim = rawContent !== trimmedContent
    const needsDelimiterNormalize = isFullwidthDollar

    if (!needsPreBoundary && !needsPostBoundary && !needsContentTrim && !needsDelimiterNormalize) {
      result += text.slice(i, close + 1)
      i = close + 1
      continue
    }

    result += `${needsPreBoundary ? ZWSP : ''}$${trimmedContent}$${needsPostBoundary ? ZWSP : ''}`
    i = close + 1
  }

  return result
}

function findClosingInlineMathDelimiter(text, start, delimiter) {
  for (let i = start; i < text.length; i += 1) {
    if (text[i] !== delimiter || isEscaped(text, i)) continue
    if (text[i + 1] === delimiter || text[i - 1] === delimiter) continue
    return i
  }
  return -1
}

function looksLikeMath(content) {
  if (!content) return false

  return /[A-Za-z\\_^{}=<>+\-*/()[\]|,.;:]/.test(content)
}

function isAsciiDigit(char) {
  return char >= '0' && char <= '9'
}
