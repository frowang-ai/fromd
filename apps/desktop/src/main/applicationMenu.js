// Native menu owns presentation only; document operations remain in the renderer's
// flush/identity/composition-aware command path.
export function createApplicationMenu({ Menu, sendCommand, canDispatch, closeWindow }) {
  let state = { documentId: null, ready: false, busy: true, sourceMode: false, revision: 0 }
  const commands = [
    ['new', '新建', 'CmdOrCtrl+N'], ['open', '打开', 'CmdOrCtrl+O'],
    ['save', '保存', 'CmdOrCtrl+S'], ['saveAs', '另存为', 'CmdOrCtrl+Shift+S'],
    ['pdf', '导出 PDF'],
  ]
  const item = (name, label, accelerator, type = 'normal') => ({
    id: `document-${name}`, label, type, enabled: false,
    ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
    click: () => {
      // Electron toggles checkboxes before click. Restore the acknowledged state;
      // only a completed renderer mode change changes the visible checkmark.
      refresh()
      if (state.ready && !state.busy && state.documentId && canDispatch()) {
        sendCommand({ name, documentId: state.documentId, revision: state.revision })
      }
    },
  })
  const menu = Menu.buildFromTemplate([
    { label: '文件', submenu: [
      ...commands.map(args => item(...args)), { type: 'separator' }, { label: '退出', click: closeWindow },
    ] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [item('source', '源码模式', undefined, 'checkbox'), { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'toggleDevTools' } ] },
  ])
  function refresh() {
    const enabled = Boolean(state.ready && !state.busy && state.documentId && canDispatch())
    for (const name of [...commands.map(([name]) => name), 'source']) menu.getMenuItemById(`document-${name}`).enabled = enabled
    menu.getMenuItemById('document-source').checked = state.sourceMode
  }
  Menu.setApplicationMenu(menu)
  return {
    refresh,
    reset() { state = { documentId: null, ready: false, busy: true, sourceMode: false, revision: 0 }; refresh() },
    update(value) {
      if (!value || typeof value !== 'object' ||
        !(value.documentId === null || (typeof value.documentId === 'string' && value.documentId.length <= 200)) ||
        !['ready', 'busy', 'sourceMode'].every(key => typeof value[key] === 'boolean') ||
        !Number.isSafeInteger(value.revision) || value.revision <= state.revision) return
      state = { documentId: value.documentId, ready: value.ready, busy: value.busy, sourceMode: value.sourceMode, revision: value.revision }
      refresh()
    },
  }
}
