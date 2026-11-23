// The product coordinator/editor never imports this native-shell policy.
export function describePlatform({platform = globalThis.navigator?.platform || '', userAgent = globalThis.navigator?.userAgent || '', browserTestHost = false, search = globalThis.location?.search || '', nativeWindow = false} = {}) {
  const override = browserTestHost ? new URLSearchParams(search).get('testPlatform') : null
  const os = ['macos', 'windows'].includes(override) ? override : /mac/i.test(platform) ? 'macos' : /win/i.test(platform + userAgent) ? 'windows' : 'other'
  const nativeChrome = nativeWindow || browserTestHost && new URLSearchParams(search).get('testNativeChrome') === '1'
  return Object.freeze({os, primaryModifier: os === 'macos' ? 'Meta' : 'Control', linkModifier: os === 'macos' ? 'meta' : 'ctrl', nativeMenu: nativeChrome && os === 'macos', customControls: nativeChrome && os === 'windows', customDrag: nativeChrome && os === 'windows'})
}
const keys = {new: 'n', open: 'o', save: 's', saveAs: 's', source: '/', find: 'f', replace: 'h', reading: ',', zoomIn: '+', zoomOut: '-', zoomReset: '0', nextTab: 'Tab', previousTab: 'Tab'}
export function commandShortcut(id, platform) {
  if (!(id in keys)) return null
  const mac = platform.os === 'macos', tab = id === 'nextTab' || id === 'previousTab'
  return {key: id === 'replace' && mac ? 'f' : keys[id], modifier: tab ? 'Control' : platform.primaryModifier,
    shift: id === 'saveAs' || id === 'previousTab', alt: id === 'replace' && mac}
}
export function formatShortcut(id, platform) {
  const shortcut = commandShortcut(id, platform)
  if (!shortcut) return ''
  const {key, modifier, shift, alt} = shortcut, display = key.length === 1 ? key.toUpperCase() : key
  return platform.os === 'macos' ? `${modifier === 'Control' ? '⌃' : ''}${alt ? '⌥' : ''}${shift ? '⇧' : ''}${modifier === 'Meta' ? '⌘' : ''}${display}` : `${modifier === 'Control' ? 'Ctrl' : 'Meta'}+${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${display}`
}
// AppKit owns only the accelerators actually registered in menu_macos.rs.
// Cmd+= / numpad + are useful aliases but Cmd+Shift+Equal owns the menu item.
export function usesNativeAccelerator(command, event, platform) {
  return platform.nativeMenu && !['nextTab', 'previousTab'].includes(command)
    && !(command === 'zoomIn' && !event.shiftKey)
}
export function matchCommand(event, platform) {
  if (event.isComposing || event.keyCode === 229) return null
  for (const id of Object.keys(keys)) {
    const s = commandShortcut(id, platform)
    if (Boolean(event.ctrlKey) !== (s.modifier === 'Control') || Boolean(event.metaKey) !== (s.modifier === 'Meta') || Boolean(event.altKey) !== s.alt) continue
    // Plus is Shift+= on many layouts; the key character/code also covers numpad.
    const plus = id === 'zoomIn' && ['+', '='].includes(event.key)
    if (!plus && Boolean(event.shiftKey) !== s.shift) continue
    const key = String(event.key || '').toLowerCase()
    if (key === s.key.toLowerCase() || plus || id === 'source' && event.code === 'Slash' || id === 'zoomIn' && event.code === 'NumpadAdd' || id === 'zoomOut' && event.code === 'NumpadSubtract' || id === 'zoomReset' && event.code === 'Numpad0') return id
  }
  return null
}
