// The native mirror in menu_routing.rs is checked against this menu.
export const formatMenu = [
  [
    ...Array.from({length: 7}, (_, level) => ({
      id: 'formatHeading' + level,
      label: level ? '标题 ' + level : '段落',
      accelerator: 'Cmd+' + level,
      macos: '⌘' + level,
      windows: 'Ctrl+' + level,
      command: {name: 'heading', level},
    })),
    ['raiseHeading', '提升标题级别', 'Cmd+Equal', '⌘=', 'Ctrl+='],
    ['lowerHeading', '降低标题级别', 'Cmd+Minus', '⌘-', 'Ctrl+-'],
  ],
  [
    ['bold', '加粗', 'Cmd+B', '⌘B', 'Ctrl+B'],
    ['italic', '斜体', 'Cmd+I', '⌘I', 'Ctrl+I'],
    ['underline', '下划线', 'Cmd+U', '⌘U', 'Ctrl+U'],
    ['strike', '删除线', 'Ctrl+Shift+Backquote', '⌃⇧`', 'Alt+Shift+5'],
    ['inlineCode', '行内代码', 'Ctrl+Backquote', '⌃`', 'Ctrl+Shift+`'],
    ['link', '链接', 'Cmd+K', '⌘K', 'Ctrl+K'],
    ['clear', '清除格式', 'Cmd+Backslash', '⌘\\', 'Ctrl+\\'],
  ],
  [
    ['quote', '引用', 'Cmd+Alt+Q', '⌥⌘Q', 'Ctrl+Shift+Q'],
    ['orderedList', '有序列表', 'Cmd+Alt+O', '⌥⌘O', 'Ctrl+Shift+['],
    ['bulletList', '无序列表', 'Cmd+Alt+U', '⌥⌘U', 'Ctrl+Shift+]'],
    ['codeBlock', '代码块', 'Cmd+Alt+C', '⌥⌘C', 'Ctrl+Shift+K'],
    ['mathBlock', '公式块', 'Cmd+Alt+B', '⌥⌘B', 'Ctrl+Shift+M'],
    ['table', '表格', 'Cmd+Alt+T', '⌥⌘T', 'Ctrl+T'],
  ],
].map(group => group.map(item => {
  if (!Array.isArray(item)) return item
  const [name, label, accelerator, macos, windows] = item
  const id = 'format' + name[0].toUpperCase() + name.slice(1)
  return {id, label, accelerator, macos, windows, command: {name}}
}))

export const formatMenuCommands = new Map(formatMenu.flat().map(({id, command}) => [id, command]))
