// Local preview diagnostics: metadata only, bounded and retained in this tab.
const key = 'frowang-writing-diagnostics-v1'
const revision = 'clipboard-math-3'
const allowed = new Set(['editorId', 'pasteId', 'route', 'reason', 'types', 'textLength', 'htmlLength', 'normalized', 'displayMath', 'inlineMath', 'headings', 'tables', 'htmlDisplayMath', 'htmlInlineMath', 'convertedDisplay', 'convertedInline', 'errorType'])
let entries = []
function cleanFields(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => allowed.has(key) && (
    typeof value === 'number' || typeof value === 'boolean' ||
    (typeof value === 'string' && value.length <= 100) ||
    (key === 'types' && Array.isArray(value) && value.every(item => ['text/plain', 'text/html', 'Files', 'vscode-editor-data', 'other'].includes(item)))
  )))
}
try {
  const saved = JSON.parse(sessionStorage.getItem(key) || '[]')
  if (Array.isArray(saved)) entries = saved.slice(-80).filter(row => typeof row?.event === 'string' && typeof row?.time === 'string').map(row => ({ time: row.time.slice(0, 30), event: row.event.slice(0, 40), revision: typeof row.revision === 'string' ? row.revision.slice(0, 40) : 'unknown', ...cleanFields(row) }))
} catch { /* Logging must never prevent editing. */ }
export function logWritingEvent(event, fields = {}) {
  const entry = { time: new Date().toISOString(), revision, event, ...cleanFields(fields) }
  entries.push(entry); entries = entries.slice(-80)
  try { sessionStorage.setItem(key, JSON.stringify(entries)) } catch { /* Console remains available. */ }
  console.info('[writing-editor]', entry)
  return entry
}
export function installWritingDiagnostics() {
  if (typeof window === 'undefined') return
  window.__writingDebug = {
    revision,
    read: () => JSON.parse(JSON.stringify(entries)),
    clear: () => { entries = []; try { sessionStorage.removeItem(key) } catch { /* optional storage */ } },
    download() {
      const url = URL.createObjectURL(new Blob([JSON.stringify({ revision, events: entries }, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = 'editor-diagnostics.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
  }
}
installWritingDiagnostics()
