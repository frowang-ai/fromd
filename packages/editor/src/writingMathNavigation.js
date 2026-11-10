import { TextSelection } from '@milkdown/kit/prose/state'

// Mirror the textarea's actual font/wrapping rather than treating every long
// formula as one line or estimating rows by character count.
export function sourceCaretGeometry(source) {
  const style = getComputedStyle(source), mirror = document.createElement('div')
  for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'wordBreak', 'overflowWrap', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'textIndent']) mirror.style[key] = style[key]
  Object.assign(mirror.style, { position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden', whiteSpace: 'pre-wrap', boxSizing: 'border-box', width: `${source.clientWidth}px` })
  const offset = source.selectionStart ?? 0, marker = document.createElement('span')
  mirror.append(document.createTextNode(source.value.slice(0, offset)))
  marker.textContent = source.value.slice(offset) || '.'; mirror.append(marker)
  document.body.append(mirror)
  const base = mirror.getBoundingClientRect(), caret = marker.getClientRects()[0] || marker.getBoundingClientRect()
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5
  const paddingTop = parseFloat(style.paddingTop) || 0, paddingBottom = parseFloat(style.paddingBottom) || 0
  const row = Math.max(0, Math.round((caret.top - base.top - paddingTop) / lineHeight))
  const lastRow = Math.max(0, Math.round((base.height - paddingTop - paddingBottom) / lineHeight) - 1)
  const box = source.getBoundingClientRect()
  const x = box.left + caret.left - base.left - source.scrollLeft
  mirror.remove()
  return { row, lastRow, x }
}

function nativePosition(view, selection) {
  if (!selection?.focusNode || !view.dom.contains(selection.focusNode)) return null
  try { return view.posAtDOM(selection.focusNode, selection.focusOffset) } catch { return null }
}

// Use the browser's visual-line navigation (including wrapped paragraphs and
// lists) to locate a vertical neighbour. Restore the DOM selection immediately:
// ordinary arrow handling is untouched unless the destination really is math.
export function verticalMathTarget(view, direction) {
  const native = view.dom.ownerDocument.getSelection()
  if (!native?.isCollapsed || typeof native.modify !== 'function' || !view.dom.contains(native.focusNode)) return null
  const anchor = native.anchorNode, offset = native.anchorOffset
  const origin = view.coordsAtPos(view.state.selection.head)
  let target = null
  try {
    native.modify('move', direction < 0 ? 'backward' : 'forward', 'line')
    const pos = nativePosition(view, native)
    if (pos === null) return null
    const resolved = view.state.doc.resolve(pos)
    const candidates = [[resolved.nodeAfter, pos], [resolved.nodeBefore, pos - (resolved.nodeBefore?.nodeSize || 0)]]
    for (const [node, at] of candidates) {
      const math = node?.type.name === 'math_inline' || (node?.type.name === 'code_block' && String(node.attrs.language).toLowerCase() === 'latex')
      if (!math) continue
      const dom = view.nodeDOM(at), box = dom?.getBoundingClientRect()
      if (!box?.height || origin.left < box.left - 8 || origin.left > box.right + 8) continue
      if (direction < 0 ? box.top >= origin.top - 2 : box.bottom <= origin.bottom + 2) continue
      target = dom; break
    }
    return target
  } finally {
    native.setBaseAndExtent(anchor, offset, anchor, offset)
  }
}

export function moveBodyVertically(view, direction, x) {
  const native = view.dom.ownerDocument.getSelection()
  if (typeof native?.modify !== 'function') return
  native.modify('move', direction < 0 ? 'backward' : 'forward', 'line')
  let pos = nativePosition(view, native)
  if (pos === null) return
  // Keep the source caret's horizontal column when the browser gives us the
  // neighbouring visual line. Ignore overlay geometry; the preview is closed.
  const caret = view.coordsAtPos(pos), box = view.dom.getBoundingClientRect()
  const hit = view.posAtCoords({ left: Math.max(box.left + 1, Math.min(x, box.right - 1)), top: (caret.top + caret.bottom) / 2 })
  if (hit && view.state.doc.resolve(hit.pos).parent.isTextblock) pos = hit.pos
  const selection = TextSelection.near(view.state.doc.resolve(pos), direction)
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
  view.focus()
}
