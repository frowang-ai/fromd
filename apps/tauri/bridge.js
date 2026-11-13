// Same fixed `window.desktop` surface as the Electron preload, backed by Tauri commands.
// The renderer still never receives fs, arbitrary IPC names, URLs or paths of its choosing.
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'

const invoke = async (command, args) => {
  try { return await tauriInvoke(command, args) }
  catch (error) { throw new Error(typeof error === 'string' ? error : error?.message || String(error)) }
}
const listen = (name, callback) => {
  let unlisten, disposed = false
  void tauriListen(name, event => callback(event.payload)).then(dispose => { if (disposed) dispose(); else unlisten = dispose })
  return () => { disposed = true; unlisten?.() }
}

Object.defineProperty(window, 'desktop', { configurable: false, writable: false, value: Object.freeze({
  updates: Object.freeze({
    state: () => invoke('updates_state'),
    check: () => invoke('updates_state'),
    download: () => invoke('updates_state'),
    restart: () => invoke('updates_state'),
    onChanged: callback => listen('updates:changed', callback),
  }),
  ready: () => invoke('renderer_ready'),
  capturePage: () => invoke('capture_page'),
  setMenuState: state => { void invoke('menu_state', { state }).catch(() => {}) },
  list: () => invoke('documents_list'),
  listMetadata: () => invoke('documents_list'),
  read: id => invoke('documents_read', { id }),
  rename: (id, title) => invoke('documents_rename', { id, title }),
  setViewState: (id, state) => invoke('documents_view_state', { id, state }),
  newDocument: () => invoke('documents_new'),
  open: () => invoke('documents_open'),
  update: (id, text, revision) => invoke('documents_update', { id, markdown: text, revision }),
  activate: id => invoke('documents_activate', { id }),
  save: (id, saveAs = false) => invoke('documents_save', { id, saveAs: saveAs === true }),
  close: id => invoke('documents_close', { id }),
  shelve: id => invoke('documents_shelve', { id }),
  undoRemove: () => invoke('documents_undo_remove'),
  reload: id => invoke('documents_reload', { id }),
  exportPdf: (id, html) => invoke('documents_pdf', { id, html }),
  closeReady: () => invoke('close_ready'),
  cancelClose: () => invoke('close_cancel'),
  onClose: callback => listen('application:request-close', callback),
  onCommand: callback => listen('application:command', callback),
  onDocuments: callback => listen('documents:changed', callback),
  // WebView2 serves custom schemes as http://<scheme>.localhost.
  imageUrl: (id, src) => `http://document-image.localhost/${encodeURIComponent(id)}/${encodeURIComponent(src)}`,
}) })
