// The product coordinator/editor never imports this native-shell policy.
export function describePlatform({platform = globalThis.navigator?.platform || '', userAgent = globalThis.navigator?.userAgent || '', browserTestHost = false, search = globalThis.location?.search || '', nativeWindow = false} = {}) {
  const override = browserTestHost ? new URLSearchParams(search).get('testPlatform') : null
  const os = ['macos', 'windows'].includes(override) ? override : /mac/i.test(platform) ? 'macos' : /win/i.test(platform + userAgent) ? 'windows' : 'other'
  const nativeChrome = nativeWindow || browserTestHost && new URLSearchParams(search).get('testNativeChrome') === '1'
  return Object.freeze({os, primaryModifier: os === 'macos' ? 'Meta' : 'Control', linkModifier: os === 'macos' ? 'meta' : 'ctrl', nativeMenu: nativeChrome && os === 'macos', customControls: nativeChrome && os === 'windows', customDrag: nativeChrome && os === 'windows'})
}
const keys = {new: 'n', open: 'o', save: 's', saveAs: 's', source: '/', find: 'f', replace: 'h', reading: ',', zoomIn: '=', zoomOut: '-', zoomReset: '0', nextTab: 'Tab', previousTab: 'Tab'}
export function commandShortcut(id, platform) {
  if (!(id in keys)) return null
  const mac = platform.os === 'macos', tab = id === 'nextTab' || id === 'previousTab'
  return {key: id === 'replace' && mac ? 'f' : keys[id], modifier: tab ? 'Control' : platform.primaryModifier,
    shift: id === 'saveAs' || id === 'previousTab' || id.startsWith('zoom'), alt: id === 'replace' && mac}
}
export function formatShortcut(id, platform) {
  if (id === 'insertImage') return platform.os === 'macos' ? '⌃⌘I' : 'Ctrl+Shift+I'
  const shortcut = commandShortcut(id, platform)
  if (!shortcut) return ''
  const {key, modifier, shift, alt} = shortcut, display = key.length === 1 ? key.toUpperCase() : key
  return platform.os === 'macos' ? `${modifier === 'Control' ? '⌃' : ''}${alt ? '⌥' : ''}${shift ? '⇧' : ''}${modifier === 'Meta' ? '⌘' : ''}${display}` : `${modifier === 'Control' ? 'Ctrl' : 'Meta'}+${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${display}`
}
// AppKit owns only the accelerators actually registered in menu_macos.rs.
export function usesNativeAccelerator(command, event, platform) {
  return platform.nativeMenu && !['nextTab', 'previousTab'].includes(command)
    && !(command.startsWith('zoom') && event.code?.startsWith('Numpad'))
}
export function matchCommand(event, platform) {
  if (event.isComposing || event.keyCode === 229) return null
  for (const id of Object.keys(keys)) {
    const s = commandShortcut(id, platform)
    if (Boolean(event.ctrlKey) !== (s.modifier === 'Control') || Boolean(event.metaKey) !== (s.modifier === 'Meta') || Boolean(event.altKey) !== s.alt) continue
    if (id === 'zoomIn' && event.code === 'NumpadAdd') return id
    if (Boolean(event.shiftKey) !== s.shift) continue
    const key = String(event.key || '').toLowerCase()
    if (key === s.key.toLowerCase() || id === 'source' && event.code === 'Slash' ||
      id === 'zoomIn' && (key === '+' || event.code === 'Equal') ||
      id === 'zoomOut' && (event.code === 'Minus' || event.code === 'NumpadSubtract' || key === '_') ||
      id === 'zoomReset' && (event.code === 'Digit0' || event.code === 'Numpad0' || key === ')')) return id
  }
  return null
}
