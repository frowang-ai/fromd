// Desktop-neutral link gestures. Keep Milkdown's sanitized href in the DOM;
// retrieve the original destination from the document model only on interaction.
export function installWritingLinks(view, { root, getOwner, onOpen }) {
  // Crepe replaces its .milkdown wrapper when sessions reset plugin state.
  // Listen on the stable host supplied by the owning editor component.
  let hovered = null, pointer = null
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
  root.addEventListener('mousemove', hover, true)
  root.addEventListener('pointerdown', down, true)
  root.addEventListener('click', click, true)
  return () => {
    root.removeEventListener('mousemove', hover, true)
    root.removeEventListener('pointerdown', down, true)
    root.removeEventListener('click', click, true)
  }
}
