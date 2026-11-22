import { linkTooltipAPI } from '@milkdown/kit/component/link-tooltip'

// Desktop-neutral link gestures. Keep Milkdown's sanitized href in the DOM;
// retrieve the original destination from the document model only on interaction.
export function linkGesture(event, modifier = 'ctrl') {
  return modifier === 'meta' ? Boolean(event.metaKey && !event.ctrlKey) : Boolean(event.ctrlKey && !event.metaKey)
}
export function installWritingLinks(view, { root, ctx, getOwner, onOpen, modifier = 'ctrl' }) {
  // Crepe replaces its .milkdown wrapper when sessions reset plugin state.
  // Listen on the stable host supplied by the owning editor component.
  let hovered = null, pointer = null, editing = null
  const originalAPI = ctx.get(linkTooltipAPI.key)
  const tooltipAPI = {
    ...originalAPI,
    editLink(mark, from, to) {
      editing = { owner: getOwner(), mark, from, to }
      originalAPI.editLink(mark, from, to)
    },
    addLink(from, to) {
      editing = { owner: getOwner(), mark: null, from, to }
      originalAPI.addLink(from, to)
    },
  }
  ctx.set(linkTooltipAPI.key, tooltipAPI)
  function confirmLocalEdit(event) {
    const input = event.target instanceof Element ? event.target.closest('.milkdown-link-edit')?.querySelector('input') : null
    if (!input || (event.type === 'keydown' ? event.key !== 'Enter' : !event.target.closest('.confirm'))) return
    if (event.isComposing || event.keyCode === 229) { event.stopPropagation(); return }
    const href = input.value.trim()
    if (!/^(file:|\/?[a-z]:[\\/])/i.test(href)) return
    // Crepe sanitizes the model when confirming edits, erasing local destinations.
    // Keep local values in the model; linkSchema still sanitizes every DOM href.
    event.preventDefault(); event.stopImmediatePropagation()
    const selection = view.state.selection
    if (editing?.owner && editing.owner === getOwner() && selection.from === editing.from && selection.to === editing.to) {
      const { from, to, mark } = editing, type = view.state.schema.marks.link
      if (href !== mark?.attrs.href) {
        const tr = view.state.tr.removeMark(from, to, type)
        if (from === to) tr.insertText(href, from)
        tr.addMark(from, from === to ? from + href.length : to, type.create({ ...mark?.attrs, href }))
        view.dispatch(tr)
      }
    }
    editing = null
    // Use the component's existing cancel/reset path to close and restore focus.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }
  function bodyLink(event) {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null
    return anchor && view.dom.contains(anchor) ? anchor : null
  }
  function linkAt(anchor) {
    try {
      const from = view.posAtDOM(anchor, 0), to = view.posAtDOM(anchor, anchor.childNodes.length)
      const pos = view.state.doc.resolve(from)
      const mark = (pos.nodeAfter?.marks || pos.marks()).find(mark => mark.type.name === 'link')
      return mark ? { from, to, mark, href: mark.attrs.href } : null
    } catch { return null }
  }
  function hover(event) {
    const anchor = bodyLink(event), info = anchor && linkAt(anchor)
    if (!info) return
    hovered = { owner: getOwner(), doc: view.state.doc, ...info }
    const toolbar = root.querySelector('.milkdown-link-preview .link-preview')
    if (!toolbar) return
    let button = toolbar.querySelector('.writing-link-open')
    if (info.href.trim().startsWith('#')) { button?.remove(); return }
    if (!button) {
      button = view.dom.ownerDocument.createElement('button')
      button.type = 'button'; button.className = 'writing-link-open'
      toolbar.append(button)
    }
    const label = /^https?:\/\//i.test(info.href.trim()) ? '打开网页' : '打开位置'
    if (button.textContent !== label) button.textContent = label
  }
  function down(event) {
    pointer = { x: event.clientX, y: event.clientY }
    // Ctrl-click is navigation, not a caret/table-selection gesture. Suppress
    // the editor's compatibility mousedown so it cannot swallow the later click.
    if (linkGesture(event, modifier) && event.button === 0 && !event.shiftKey && !event.altKey && !view.composing && bodyLink(event)) event.preventDefault()
  }
  function click(event) {
    const owner = getOwner(), anchor = bodyLink(event)
    const target = event.target instanceof Element ? event.target : null
    const openButton = target?.closest('.writing-link-open')
    const preview = openButton
      ? openButton.closest('.milkdown-link-preview')?.querySelector('.link-display')
      : target?.closest('.milkdown-link-preview .link-display')
    if (!anchor && !preview) return
    // Body links remain editable on an ordinary click, including normal caret
    // placement and selection handling by ProseMirror.
    if (anchor && !linkGesture(event, modifier)) { event.preventDefault(); return }
    const info = anchor ? linkAt(anchor) : hovered?.owner === owner && hovered?.doc === view.state.doc && hovered?.href === preview.textContent ? hovered : null
    if (!owner || !info || event.button !== 0 || event.shiftKey || event.altKey || view.composing ||
      (anchor && event.detail > 0 && pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5)) {
      event.preventDefault(); return
    }
    // An address click edits; the explicit button or Ctrl-click opens.
    if (preview && !openButton && !linkGesture(event, modifier)) {
      event.preventDefault(); event.stopPropagation()
      ctx.get(linkTooltipAPI.key).editLink(info.mark, info.from, info.to)
      return
    }
    // Ctrl-click on same-document anchors keeps the native in-page jump.
    if (info.href.trim().startsWith('#')) return
    event.preventDefault(); event.stopPropagation()
    onOpen({ ...owner, href: info.href })
  }
  root.addEventListener('keydown', confirmLocalEdit, true)
  // Milkdown's confirm icon invokes its handler on pointerdown, before click.
  root.addEventListener('pointerdown', confirmLocalEdit, true)
  root.addEventListener('mousemove', hover, true)
  root.addEventListener('pointerdown', down, true)
  root.addEventListener('click', click, true)
  return () => {
    root.removeEventListener('keydown', confirmLocalEdit, true)
    root.removeEventListener('pointerdown', confirmLocalEdit, true)
    if (ctx.get(linkTooltipAPI.key) === tooltipAPI) ctx.set(linkTooltipAPI.key, originalAPI)
    root.removeEventListener('mousemove', hover, true)
    root.removeEventListener('pointerdown', down, true)
    root.removeEventListener('click', click, true)
    root.querySelectorAll('.writing-link-open').forEach(button => button.remove())
  }
}
