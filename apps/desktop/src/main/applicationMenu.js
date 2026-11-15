// Native menu owns presentation only; document operations remain in the renderer's
// flush/identity/composition-aware command path.
export function createApplicationMenu({ Menu, sendCommand, canDispatch, closeWindow }) {
  let state = { documentId: null, ready: false, busy: true, sourceMode: false, revision: 0 }
  const commands = [
    ['new', '新建', 'CmdOrCtrl+N'], ['open', '打开', 'CmdOrCtrl+O'],
    ['save', '保存', 'CmdOrCtrl+S'], ['saveAs', '另存为', 'CmdOrCtrl+Shift+S'],
    ['pdf', '导出 PDF'],
  ]
  const available = name => Boolean(state.ready && !state.busy && (state.documentId || ['new', 'open', 'searchPages', 'reading'].includes(name)) && canDispatch())
  const item = (name, label, accelerator, type = 'normal') => ({
    id: `document-${name}`, label, type, enabled: false,
    ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
    click: () => {
      // Electron toggles checkboxes before click. Restore the acknowledged state;
      // only a completed renderer mode change changes the visible checkmark.
      refresh()
      if (available(name)) {
        sendCommand({ name, documentId: state.documentId, revision: state.revision })
      }
    },
  })
  const menu = Menu.buildFromTemplate([
    { label: '文件', submenu: [
      ...commands.map(args => item(...args)), { type: 'separator' }, { label: '退出', click: closeWindow },
    ] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' }, item('find', '查找', 'CmdOrCtrl+F'), item('replace', '替换', 'CmdOrCtrl+H'), item('searchPages', '搜索全部页面', 'CmdOrCtrl+Shift+F')] },
    { label: '视图', submenu: [item('source', '源码模式', undefined, 'checkbox'), item('outline', '文档大纲', 'CmdOrCtrl+Shift+O'), item('reading', '阅读设置'), { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'toggleDevTools' } ] },
  ])
  function refresh() {
    for (const name of [...commands.map(([name]) => name), 'source', 'find', 'replace', 'searchPages', 'outline', 'reading']) menu.getMenuItemById(`document-${name}`).enabled = available(name)
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
