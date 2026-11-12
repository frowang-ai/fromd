import { contextBridge, ipcRenderer } from 'electron'
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args)
  if (!result.ok) throw new Error(result.error)
  return result.value
}
const listen = (channel, callback) => {
  const listener = (_event, value) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
contextBridge.exposeInMainWorld('desktop', {
  updates: {
    state: () => invoke('updates:state'),
    check: () => invoke('updates:check'),
    download: () => invoke('updates:download'),
    restart: () => invoke('updates:restart'),
    onChanged: callback => listen('updates:changed', callback),
  },
  ready: () => invoke('application:renderer-ready'),
  capturePage: () => invoke('application:capture-page'),
  setMenuState: state => ipcRenderer.send('application:menu-state', state),
  list: () => invoke('documents:list'),
  listMetadata: () => invoke('documents:list-metadata'),
  read: id => invoke('documents:read', id),
  rename: (id, title) => invoke('documents:rename', id, title),
  setViewState: (id, state) => invoke('documents:view-state', id, state),
  newDocument: () => invoke('documents:new'),
  open: () => invoke('documents:open'),
  update: (id, text, revision) => invoke('documents:update', id, text, revision),
  activate: id => invoke('documents:activate', id),
  save: (id, saveAs = false) => invoke('documents:save', id, saveAs),
  close: id => invoke('documents:close', id),
  shelve: id => invoke('documents:shelve', id),
  undoRemove: () => invoke('documents:undo-remove'),
  reload: id => invoke('documents:reload', id),
  exportPdf: (id, html) => invoke('documents:pdf', id, html),
  closeReady: () => invoke('application:close-ready'),
  cancelClose: () => invoke('application:close-cancel'),
  onClose: callback => listen('application:request-close', callback),
  onCommand: callback => listen('application:command', callback),
  onDocuments: callback => listen('documents:changed', callback),
})
