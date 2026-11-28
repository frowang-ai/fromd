// Native claim for files dropped on an open area. Only name/size leave the
// renderer, for the host to cross-check the paths it reads itself (macOS drag
// pasteboard, WebView2 File objects). The renderer never reports a path.
export const DROP_MESSAGE_PREFIX = 'frowd-open-drop:'
// getRandomValues also works outside secure contexts (custom WKWebView schemes).
export function dropToken(random = globalThis.crypto) {
  return Array.from(random.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function claimDroppedFiles(files, {invoke, webview = globalThis.chrome?.webview, token = dropToken()}) {
  const descriptors = files.map(file => ({ name: file.name, size: file.size }))
  if (webview) {
    // WebView2 >= 1.0.1774.30 attaches the File objects (and so their paths).
    // wry hands every string message to Tauri's postMessage IPC fallback, which
    // only logs a console error for this non-invoke string; no command runs.
    if (typeof webview.postMessageWithAdditionalObjects !== 'function') return { unavailable: true, accepted: 0, errors: [] }
    webview.postMessageWithAdditionalObjects(DROP_MESSAGE_PREFIX + token, files)
  }
  return invoke('claim_dropped_documents', { token, files: descriptors })
}
