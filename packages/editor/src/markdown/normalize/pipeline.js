/**
 * 归一化管线原语： fenced code / inline code 感知与转义判断。
 * 不依赖本目录其他模块（依赖方向的最底层）。
 */

export function transformMarkdownOutsideCode(markdown, transformText) {
  const lines = markdown.split(/(\r?\n)/)
  let inFence = false
  let fenceChar = ''
  let fenceLength = 0
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

    result += transformOutsideInlineCode(line, transformText) + newline
  }

  return result
}

function transformOutsideInlineCode(text, transformText) {
  let result = ''
  let chunkStart = 0
  let i = 0

  while (i < text.length) {
    if (text[i] !== '`') {
      i += 1
      continue
    }

    const tickStart = i
    while (i < text.length && text[i] === '`') i += 1
    const tickRun = text.slice(tickStart, i)
    const close = text.indexOf(tickRun, i)

    if (close === -1) continue

    result += transformText(text.slice(chunkStart, tickStart))
    result += text.slice(tickStart, close + tickRun.length)
    i = close + tickRun.length
    chunkStart = i
  }

  result += transformText(text.slice(chunkStart))
  return result
}

export function isEscaped(text, index) {
  let slashCount = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}
