import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {formatMenu} from '../src/editor/formatMenu.mjs'
import {matchEditorShortcut} from '../src/editor/shortcuts.mjs'

const delimiters = {Backquote: '`', Backslash: '\\', Equal: '=', Minus: '-'}
const shifted = {'[': '{', ']': '}', '`': '~', '5': '%'}
const codes = {'[': 'BracketLeft', ']': 'BracketRight', '`': 'Backquote', '5': 'Digit5'}
function eventFrom(modifiers, key) {
  const shiftKey = modifiers.includes('Shift') || modifiers.includes('⇧')
  return {
    key: shiftKey && shifted[key] || key,
    code: codes[key] || (/^[A-Z]$/.test(key) ? 'Key' + key : undefined),
    shiftKey,
    ctrlKey: modifiers.includes('Ctrl') || modifiers.includes('⌃'),
    altKey: modifiers.includes('Alt') || modifiers.includes('⌥'),
    metaKey: modifiers.includes('Cmd') || modifiers.includes('⌘'),
  }
}

test('format menu labels and macOS accelerators resolve to the existing editor commands', () => {
  const items = formatMenu.flat()
  assert.equal(items.length, 22)
  assert.equal(new Set(items.map(item => item.id)).size, items.length)
  for (const item of items) {
    const windows = item.windows.split('+'), accelerator = item.accelerator.split('+')
    const nativeKey = accelerator.pop()
    const macos = [...item.macos]
    const checks = [
      [eventFrom(windows.slice(0, -1), windows.at(-1)), false],
      [eventFrom(macos.slice(0, -1), macos.at(-1)), true],
      [eventFrom(accelerator, delimiters[nativeKey] ?? nativeKey), true],
    ]
    for (const [event, mac] of checks) assert.deepEqual(matchEditorShortcut(event, mac), item.command, item.id)
  }
})

test('native format menu mirrors all three descriptor groups and displays Insert Image under File', () => {
  const rust = readFileSync(new URL('../src-tauri/src/menu_macos.rs', import.meta.url), 'utf8')
  const native = rust.match(/const FORMAT_MENU[^\n]+\n([\s\S]*?)^\];/m)[1]
  const groups = [...native.matchAll(/&\[([\s\S]*?)\]/g)].map(group =>
    [...group[1].matchAll(/\("([^"]+)", "([^"]+)", "([^"]+)"\)/g)].map(([, id, label, accelerator]) =>
      ({id, label, accelerator})))
  assert.deepEqual(groups, formatMenu.map(group => group.map(({id, label, accelerator}) => ({id, label, accelerator}))))
  assert.match(rust, /"insertImage", "插入图片…", Some\("Ctrl\+Cmd\+I"\)/)
  assert.deepEqual(matchEditorShortcut(eventFrom(['Ctrl', 'Cmd'], 'I'), true), {name: 'insertImage'})
})
