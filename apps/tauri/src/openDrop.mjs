// Window drop routing for "drag a document in to open it". This is shell policy:
// it classifies the drop area and file names only. The renderer never reports a
// path; the native host resolves real file locations from the platform itself.
import {formatShortcut} from './platform.mjs'

export const OPENABLE_EXTENSIONS = Object.freeze(['md', 'markdown', 'txt'])
const OPENABLE_LABEL = OPENABLE_EXTENSIONS.map(ext => '.' + ext).join(' / ')
// Areas whose external file drop opens documents instead of importing resources.
export const OPEN_AREAS = Object.freeze(new Set(['sidebar', 'top', 'panel']))

export function openableName(name) {
  const match = /\.([^./\\]+)$/.exec(String(name || ''))
  return Boolean(match) && OPENABLE_EXTENSIONS.includes(match[1].toLowerCase())
}
export function externalFileDrag(dataTransfer) {
  return Array.from(dataTransfer?.types || []).some(type => String(type).toLowerCase() === 'files')
}
// macOS keeps the AppKit titlebar outside the WebView, so only the sidebar opens
// documents there; its tab bar stays a rejected (hinted) area. Windows also opens
// from the web titlebar and tab bar. With no page, the editor panel has no
// attachment target and opens instead. Everything else keeps resource behavior.
export function dropArea(target, platform, {hasDocument = true} = {}) {
  const element = target?.closest ? target : target?.parentElement
  if (!element?.closest) return 'other'
  const windows = platform?.os === 'windows'
  if (element.closest('.sidebar')) return 'sidebar'
  if (element.closest('.tabbar')) return windows ? 'top' : 'tabbar'
  if (element.closest('.app-header')) return windows ? 'top' : 'other'
  if (element.closest('.editor-panel')) return hasDocument ? 'body' : 'panel'
  return 'other'
}
// Must run synchronously inside the drop event: DataTransfer items are
// unreadable after the handler returns.
export function classifyDrop(dataTransfer) {
  const result = {openable: [], skipped: [], directories: 0}
  // File items and the file list share one order; pair them so a directory
  // entry and its File describe the same dropped item.
  const items = Array.from(dataTransfer?.items || []).filter(item => item.kind === 'file')
  const files = Array.from(dataTransfer?.files || [])
  const entries = items.length
    ? items.map((item, index) => ({file: (items.length === files.length ? files[index] : null) ?? item.getAsFile?.() ?? null, entry: item.webkitGetAsEntry?.() ?? null}))
    : files.map(file => ({file, entry: null}))
  for (const {file, entry} of entries) {
    if (entry?.isDirectory || file?.webkitRelativePath) { result.directories++; continue }
    if (!file) continue
    ;(openableName(file.name) ? result.openable : result.skipped).push(file)
  }
  return result
}
export function openDropMessages(platform) {
  return Object.freeze({
    unavailable: `无法获取文件位置，请使用 文件 → 打开…（${formatShortcut('open', platform)}）`,
    unsupported: `只能打开 ${OPENABLE_LABEL}，图片和附件请拖到正文`,
    directory: `不能打开文件夹，请拖入 ${OPENABLE_LABEL} 文件`,
    tabbar: `标签栏不能打开文档：拖到侧栏可打开文档，图片和附件请拖到正文`,
  })
}
// Notice for the files a drop could not open, or '' when nothing was skipped.
export function skippedNotice({skipped = [], directories = 0}, messages) {
  const parts = []
  if (skipped.length) parts.push(`已跳过 ${skipped.length} 个文件：${messages.unsupported}`)
  if (directories) parts.push(`已跳过 ${directories} 个文件夹：${messages.directory}`)
  return parts.join('。')
}
