/**
 * 归一化开头 `$$` 粘连的块公式（用户反馈 2026-10-01：报告标题行尾粘 `$$`，
 * 整块公式退化为原始 LaTeX 文本）。
 * texmath 块规则要求 `$$` 位于块开头；`$$` 跟在标题/正文行尾时无法识别。
 * 这里把"行内唯一（不成对）、前方有正文、不在代码中"的 `$$` 切到独立行。
 * 块内状态跨行跟踪：块中的 `$$`（收尾，粘不粘都能被 texmath 接受）、
 * 同行成对的 `$$x$$`、行首 `$$`、fenced/inline code 中的 `$$` 一律保持原样。
 */
export function normalizeBlockMath(markdown) {
  const lines = markdown.split(/(\r?\n)/)
  let inFence = false
  let fenceChar = ''
  let fenceLength = 0
  let inBlockMath = false
  let result = ''

  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i] || ''
    const newline = lines[i + 1] || ''
    const fence = line.match(/^(\s*)(`{3,}|~{3,})/)

    if (inFence) {
      result += line + newline
      if (fence && fence[2][0] === fenceChar && fence[2].length >= fenceLength) {
        inFence = false
        fenceChar = ''
        fenceLength = 0
      }
      continue
    }

    if (fence) {
      inFence = true
      fenceChar = fence[2][0]
      fenceLength = fence[2].length
      result += line + newline
      continue
    }

    if (inBlockMath) {
      // 块内容原样保留；texmath 块不跨空行，空行意味着块未闭合已失效
      if (!line.trim() || line.includes('$$')) inBlockMath = false
      result += line + newline
      continue
    }

    const at = findBlockMathOpen(line)
    if (at === -1) {
      result += line + newline
      continue
    }
    if (!line.slice(0, at).trim()) {
      // 行首 $$（允许前导空白）是合法块开头，但若前一行是非空文本，段落尚未
      // 结束：块内出现 = / --- 独占行时会触发 Setext 标题劫持，把前面文本连同
      // $$ 吞进标题（真实报告案例：多行公式里 = 独占一行）。补空行切断段落，
      // 让 texmath 块规则在新块开头接管。
      const prev = i >= 2 ? lines[i - 2] || '' : ''
      inBlockMath = true
      if (prev.trim()) result += '\n'
      result += line + newline
      continue
    }
    inBlockMath = true
    result += `${line.slice(0, at).trimEnd()}\n\n${line.slice(at)}` + newline
  }

  return result
}

/** 行内块公式开头候选 `$$` 的位置；同行成对或位于行内代码中时不算（返回 -1） */
function findBlockMathOpen(line) {
  const at = line.indexOf('$$')
  if (at === -1) return -1
  // 同行还有第二个 $$：成对写法（如 "价格由 $$x$$ 决定"），行内规则已能处理
  if (line.indexOf('$$', at + 2) !== -1) return -1
  if (isInsideInlineCode(line, at)) return -1
  return at
}

/** 粗判 position 处是否处于行内代码：前方反引号数为奇数。行内代码跨行极罕见，按单行判断 */
function isInsideInlineCode(line, position) {
  let backticks = 0
  for (let i = 0; i < position; i += 1) {
    if (line[i] === '`') backticks += 1
  }
  return backticks % 2 === 1
}
