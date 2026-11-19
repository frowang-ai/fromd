import { $prose } from '@milkdown/kit/utils'
import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { footnoteDefinitionSchema, footnoteReferenceSchema } from '@milkdown/kit/preset/gfm'
import { EditorView as CodeView } from '@codemirror/view'
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { registerEmbeddedView } from './writingViewState.js'
import { alertKind } from './markdown/extensions.js'
import { renderMermaid } from './markdown/mermaid.js'

// The original code-language menu has no configured language list. Register an
// offline plain-text language there; diagram validation belongs to Mermaid.
export const mermaidCodeLanguage = LanguageDescription.of({
  name: 'Mermaid', alias: ['mermaid'],
  support: new LanguageSupport(StreamLanguage.define({ token(stream) { stream.skipToEnd(); return null } })),
})

// Milkdown already parses GFM footnotes. Keep its editable block schema and add
// unambiguous labels instead of converting definitions to detached preview HTML.
const definition = footnoteDefinitionSchema.extendSchema(previous => ctx => ({
  ...previous(ctx),
  toDOM: node => ['dl', { 'data-type': 'footnote_definition', 'data-label': node.attrs.label, class: 'writing-footnote-definition' },
    ['dt', { contenteditable: 'false' }, `[^${node.attrs.label}]`], ['dd', 0]],
}))
const reference = footnoteReferenceSchema.extendSchema(previous => ctx => ({
  ...previous(ctx),
  toDOM: node => ['sup', { 'data-type': 'footnote_reference', 'data-label': node.attrs.label, class: 'writing-footnote-reference', title: `脚注 ${node.attrs.label}` }, `[${node.attrs.label}]`],
}))

const alerts = $prose(() => new Plugin({ props: {
  decorations(state) {
    const decorations = []
    state.doc.descendants((node, position) => {
      if (node.type.name !== 'blockquote' || node.firstChild?.type.name !== 'paragraph') return
      const text = node.firstChild.textContent, kind = alertKind(text)
      if (!kind) return
      decorations.push(Decoration.node(position, position + node.nodeSize, { class: 'writing-alert', 'data-alert': kind }))
      decorations.push(Decoration.inline(position + 2, position + 2 + kind.length + 3, { class: 'writing-alert-marker' }))
    })
    return DecorationSet.create(state.doc, decorations)
  },
} }))

export const writingMarkdownExtensions = [definition, reference, alerts].flat()

// Wrap Crepe's existing code editor. Its CM history/selection/readonly behavior
// remains authoritative, and Mermaid adds only a local preview around that view.
function mermaidBlockView(initial, base, view, getPos) {
  let node = initial, revision = 0, destroyed = false, timer, editing = false
  const dom = document.createElement('div'); dom.className = 'writing-mermaid'; dom.contentEditable = 'false'
  const preview = document.createElement('div'); preview.className = 'writing-mermaid-figure'; preview.setAttribute('aria-label', 'Mermaid 图表')
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'writing-mermaid-toggle'
  const status = document.createElement('p'); status.className = 'writing-mermaid-status'; status.setAttribute('role', 'status')
  base.dom.hidden = true; dom.append(preview, status, toggle, base.dom)
  function open(value, focus = false, restoring = false) {
    if (value && !view.editable && !restoring) return
    editing = value; base.dom.hidden = !value; toggle.textContent = value ? '完成图表编辑' : '编辑图表源码'
    if (focus && value) base.setSelection?.(0, 0)
    else if (focus) view.focus()
  }
  toggle.addEventListener('click', () => open(!editing, true))
  function schedule() {
    const current = ++revision, text = node.textContent
    clearTimeout(timer); preview.replaceChildren(); status.textContent = '正在绘制图表…'
    timer = setTimeout(async () => {
      if (destroyed || current !== revision) return
      try {
        const svg = await renderMermaid(text)
        if (destroyed || current !== revision) return
        preview.innerHTML = svg; status.textContent = ''
      } catch (error) {
        if (destroyed || current !== revision) return
        status.textContent = error.message
      }
    }, 180)
  }
  const cm = () => { const element = base.dom.querySelector('.cm-editor'); return element && CodeView.findFromDOM(element) }
  const unregister = registerEmbeddedView(view, dom, getPos, () => editing ? {
    kind: 'mermaid', anchor: cm()?.state.selection.main.anchor ?? 0, head: cm()?.state.selection.main.head ?? 0,
  } : null, snapshot => {
    if (snapshot.kind !== 'mermaid') return
    // Session restoration occurs while the host is temporarily readonly. It
    // restores UI/selection only; user edits remain behind the existing lock.
    open(true, false, true); base.setSelection?.(snapshot.anchor, snapshot.head)
  }, () => cm()?.focus(), editable => {
    toggle.disabled = !editable
    // Crepe updates its CM readonly compartment in update(), which PM may skip
    // when only the outer view's editability changes and the node stays equal.
    base.update?.(node)
  })
  open(false); toggle.disabled = !view.editable; schedule()
  return {
    dom,
    update(next, ...args) {
      if (next.type !== node.type || String(next.attrs.language).toLowerCase() !== 'mermaid') return false
      if (base.update?.(next, ...args) === false) return false
      const changed = next.textContent !== node.textContent; node = next
      toggle.disabled = !view.editable
      if (changed) schedule()
      return true
    },
    setSelection(anchor, head) { open(true); base.setSelection?.(anchor, head) },
    selectNode() { base.selectNode?.() },
    deselectNode() { base.deselectNode?.() },
    stopEvent: event => !base.dom.contains(event.target) || base.stopEvent?.(event),
    ignoreMutation: () => true,
    destroy() { destroyed = true; revision++; clearTimeout(timer); unregister(); base.destroy?.() },
  }
}

export function installWritingMarkdownViews(view) {
  const previous = view.props.nodeViews || {}
  view.setProps({ nodeViews: { ...previous,
    code_block(node, editor, getPos, ...args) {
      const base = previous.code_block?.(node, editor, getPos, ...args)
      if (!base) return base
      if (String(node.attrs.language).toLowerCase() !== 'mermaid') {
        const update = base.update
        base.update = (next, ...rest) => String(next.attrs.language).toLowerCase() === 'mermaid' ? false : update?.call(base, next, ...rest)
        return base
      }
      return mermaidBlockView(node, base, editor, getPos)
    },
  } })
}
