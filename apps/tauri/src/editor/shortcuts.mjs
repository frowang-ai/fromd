const common = {
  b: 'bold', i: 'italic', u: 'underline', k: 'link',
  '\\': 'clear', e: 'inlineCode', '=': 'raiseHeading', '-': 'lowerHeading',
}
const windowsBlocks = { q: 'quote', k: 'codeBlock', m: 'mathBlock', '[': 'orderedList', ']': 'bulletList' }
const macBlocks = { q: 'quote', c: 'codeBlock', b: 'mathBlock', t: 'table', o: 'orderedList', u: 'bulletList' }

export function matchEditorShortcut(event, mac) {
  const { ctrlKey, metaKey, altKey, shiftKey, code } = event
  const key = event.key.toLowerCase()
  const primary = mac ? metaKey && !ctrlKey : ctrlKey && !metaKey
  const backquote = code === 'Backquote' || ['`', '~'].includes(key)
  if (mac && ctrlKey && metaKey && !altKey && !shiftKey && key === 'i') return { name: 'insertImage' }
  if (mac && ctrlKey && !metaKey && !altKey && backquote) return { name: shiftKey ? 'strike' : 'inlineCode' }
  if (!mac && !ctrlKey && !metaKey && altKey && shiftKey && (code === 'Digit5' || ['5', '%'].includes(key))) return { name: 'strike' }
  if (!primary) return null
  if (!shiftKey && /^[0-6]$/.test(key) && (!altKey || key !== '0')) return { name: 'heading', level: Number(key) }
  if (mac && altKey && !shiftKey) {
    // Option can change the printable character, including on US keyboards.
    const name = macBlocks[/^Key[A-Z]$/.test(code) ? code.at(-1).toLowerCase() : key]
    return name ? { name } : null
  }
  if (altKey) return null
  if (shiftKey) {
    if (backquote) return { name: 'inlineCode' }
    if (mac) return null
    if (key === 'i') return { name: 'insertImage' }
    const name = windowsBlocks[code === 'BracketLeft' || key === '{' ? '[' :
      code === 'BracketRight' || key === '}' ? ']' : key]
    return name ? { name } : null
  }
  const name = !mac && key === 't' ? 'table' : common[key]
  return name ? { name } : null
}
