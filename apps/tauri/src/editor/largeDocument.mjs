import {utf8Bytes} from '../../../../packages/editor/src/documentLimits.js'

const LARGE_TEXT_BYTES = 1.5 * 1024 * 1024
const LARGE_TEXT_LINES = 20_000

export function isLargeDocument(markdown) {
  let newline = -1
  for (let line = 0; line < LARGE_TEXT_LINES; line++) {
    newline = markdown.indexOf('\n', newline + 1)
    if (newline === -1) break
  }
  if (newline !== -1) return true
  if (markdown.length * 3 <= LARGE_TEXT_BYTES) return false
  const text = markdown.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '')
  return text.length > LARGE_TEXT_BYTES || utf8Bytes(text) > LARGE_TEXT_BYTES
}
