import { renderMathPreview } from './writingMathPreview.js'

// Presentation for inline math only. The existing node view still owns edits,
// transactions, cancellation and undo; this layer owns sizing and the preview.
export function createInlineMathPresentation(dom, source) {
  const wrapper = document.createElement('span')
  wrapper.className = 'writing-math-source-wrap'; wrapper.hidden = true
  source.replaceWith(wrapper)
  for (let index = 0; index < 2; index++) {
    const marker = document.createElement('span')
    marker.className = 'writing-math-delimiter'; marker.textContent = '$'; marker.setAttribute('aria-hidden', 'true')
    wrapper.append(marker)
    if (index === 0) wrapper.append(source)
  }
  const tooltip = document.createElement('div')
  tooltip.className = 'writing-math-live-preview'
  tooltip.id = `math-preview-${crypto.randomUUID()}`
  tooltip.setAttribute('role', 'tooltip'); tooltip.setAttribute('aria-label', '公式预览')
  tooltip.addEventListener('pointerdown', event => event.preventDefault())
  const context = document.createElement('canvas').getContext('2d')
  let opened = false, frame = 0, lastValue
  function position() {
    if (!opened || !dom.isConnected) return
    const box = wrapper.getBoundingClientRect()
    if (!box.width || !box.height) { close(); return }
    const viewport = window.visualViewport
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0
    const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight
    tooltip.style.maxWidth = `${Math.max(80, width - 24)}px`
    tooltip.style.maxHeight = `${Math.max(36, Math.min(180, height - 24))}px`
    const bounds = tooltip.getBoundingClientRect()
    const x = Math.max(left + 8, Math.min(box.left, left + width - bounds.width - 8))
    const below = box.bottom + 6
    const y = below + bounds.height <= top + height - 8 ? below : box.top - bounds.height - 6
    tooltip.style.left = `${x}px`
    tooltip.style.top = `${Math.max(top + 8, Math.min(y, top + height - bounds.height - 8))}px`
  }
  function refresh() {
    if (!opened || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!opened) return
      const style = getComputedStyle(source)
      if (context) context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const measured = Math.max(...source.value.split('\n').map(line => context?.measureText(line || ' ').width ?? line.length * 8))
      const limit = Math.max(40, Math.min(520, (dom.closest('.ProseMirror')?.clientWidth || window.innerWidth) - 28))
      source.style.width = `${Math.max(8, Math.min(limit, Math.ceil(measured) + 3))}px`
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5
      source.style.height = '0px'
      source.style.height = `${Math.max(lineHeight, Math.min(lineHeight * 8, source.scrollHeight))}px`
      if (lastValue !== source.value) {
        lastValue = source.value
        renderMathPreview(tooltip, source.value)
      }
      position()
    })
  }
  function open() {
    if (opened) return
    opened = true; wrapper.hidden = false
    document.body.append(tooltip); source.setAttribute('aria-describedby', tooltip.id)
    window.addEventListener('resize', refresh); window.addEventListener('scroll', refresh, true)
    window.visualViewport?.addEventListener('resize', refresh)
    window.visualViewport?.addEventListener('scroll', refresh)
    refresh()
  }
  function close() {
    opened = false; wrapper.hidden = true; tooltip.remove(); source.removeAttribute('aria-describedby')
    cancelAnimationFrame(frame); frame = 0
    window.removeEventListener('resize', refresh); window.removeEventListener('scroll', refresh, true)
    window.visualViewport?.removeEventListener('resize', refresh)
    window.visualViewport?.removeEventListener('scroll', refresh)
  }
  return { open, close, refresh, destroy: close }
}
