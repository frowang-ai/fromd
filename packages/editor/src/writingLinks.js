import { linkTooltipAPI } from '@milkdown/kit/component/link-tooltip'

// Desktop-neutral link gestures. Keep Milkdown's sanitized href in the DOM;
// retrieve the original destination from the document model only on interaction.
export function installWritingLinks(view, { root, ctx, getOwner, onOpen }) {
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
  function hrefOf(anchor) {
    try {
      const pos = view.state.doc.resolve(view.posAtDOM(anchor, 0))
      return (pos.nodeAfter?.marks || pos.marks()).find(mark => mark.type.name === 'link')?.attrs.href
    } catch { return undefined }
  }
  function hover(event) {
    const anchor = bodyLink(event)
    if (anchor) hovered = { owner: getOwner(), href: hrefOf(anchor) }
  }
  function down(event) { pointer = { x: event.clientX, y: event.clientY } }
  function click(event) {
    const owner = getOwner(), anchor = bodyLink(event)
    const preview = event.target instanceof Element ? event.target.closest('.milkdown-link-preview .link-display') : null
    if (!anchor && !preview) return
    const href = anchor ? hrefOf(anchor) : hovered?.owner === owner && hovered?.href === preview.textContent ? hovered.href : undefined
    // Leave same-document anchors to the editor/browser, never send to the OS.
    if (typeof href === 'string' && href.trim().startsWith('#')) return
    event.preventDefault()
    event.stopPropagation()
    if (!owner || typeof href !== 'string' || event.button !== 0 || event.shiftKey || event.altKey || view.composing) return
    // Restoring a session or editing a link may leave a selected range. A plain
    // click still opens; suppress only an actual drag or the Shift gesture above.
    if (anchor && event.detail > 0 && pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) return
    onOpen({ ...owner, href })
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
  }
}
