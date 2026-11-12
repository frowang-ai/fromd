// The native window capture includes fonts, KaTeX, images and textarea scroll,
// without cloning editor DOM or requesting any additional document resources.
const lerp = (a, b, t) => a + (b - a) * t
function smooth(a, b, value) {
  const x = Math.max(0, Math.min(1, (value - a) / (b - a)))
  return x * x * (3 - 2 * x)
}
function shape(rect, target, p) {
  const pinch = smooth(0, .53, p), pull = smooth(.31, 1, p)
  const top = lerp(rect.top, target.y, pinch), bottom = lerp(rect.bottom, target.y, pull)
  const topCenter = lerp(rect.left + rect.width / 2, target.x, pinch)
  const bottomCenter = lerp(rect.left + rect.width / 2, target.x, pull)
  const topWidth = lerp(rect.width, .7, pinch), bottomWidth = lerp(rect.width, .7, pull)
  return q => {
    const center = lerp(topCenter, bottomCenter, q * q * (3 - 2 * q))
    const width = lerp(topWidth, bottomWidth, Math.pow(q, 1.28))
    return { left: center - width / 2, right: center + width / 2, y: lerp(top, bottom, q) }
  }
}
function drawSheet(ctx, image, rect, target, p, viewport, dpr) {
  const at = shape(rect, target, p), rows = Math.min(640, Math.ceil(rect.height / 1.4))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewport.width, viewport.height)
  ctx.imageSmoothingQuality = 'high'
  const outline = new Path2D()
  for (let i = 0; i <= 48; i++) { const point = at(i / 48); if (!i) outline.moveTo(point.left, point.y); else outline.lineTo(point.left, point.y) }
  for (let i = 48; i >= 0; i--) { const point = at(i / 48); outline.lineTo(point.right, point.y) }
  outline.closePath()
  ctx.save()
  ctx.shadowColor = 'rgba(43,63,44,.14)'; ctx.shadowBlur = 18 * (1 - p); ctx.shadowOffsetY = 5
  ctx.fillStyle = '#fffefa'; ctx.fill(outline); ctx.restore()
  ctx.save(); ctx.clip(outline)
  const sourceRow = rect.height / rows, sx = image.naturalWidth / viewport.width, sy = image.naturalHeight / viewport.height
  for (let i = 0; i < rows; i++) {
    const a = at(i / rows), b = at((i + 1) / rows), width = a.right - a.left
    if (width < .1 || b.y - a.y < .02) continue
    ctx.setTransform(dpr * width / rect.width, 0, dpr * (b.left - a.left) / sourceRow, dpr * (b.y - a.y) / sourceRow, dpr * a.left, dpr * a.y)
    const y = i * sourceRow, height = Math.min(sourceRow + .6, rect.height - y)
    ctx.drawImage(image, rect.left * sx, (rect.top + y) * sy, rect.width * sx, height * sy, 0, 0, rect.width, height)
  }
  ctx.restore(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.strokeStyle = `rgba(139,159,137,${.43 * (1 - p)})`; ctx.lineWidth = .8; ctx.stroke(outline)
}

// Returns a cancel function immediately. Every capture/decode/frame wait is bounded
// or abortable; motion failure never rejects the document operation which called it.
export function startPageMotion({ element, anchor, header, footer, capture, isCurrent = () => true }) {
  const controller = new AbortController(), media = matchMedia('(prefers-reduced-motion: reduce)')
  let canvas, backdrop, image, frame, timer, previousVisibility, visibilityChanged = false
  const cancel = () => controller.abort()
  const scrollPositions = new Map()
  const cancelOnScroll = event => {
    const node = event.target === document ? document.scrollingElement : event.target
    const before = scrollPositions.get(node)
    // Restoring viewState can enqueue a scroll event before motion starts. An
    // event at the already-captured position is not a new viewport change.
    if (!before || node.scrollTop !== before.top || node.scrollLeft !== before.left) cancel()
  }
  const live = () => !controller.signal.aborted && isCurrent() && !media.matches && !document.hidden
  async function bounded(promise, milliseconds) {
    if (!live()) throw new DOMException('Motion cancelled', 'AbortError')
    let timeout, abort
    const stopped = new Promise((_, reject) => {
      abort = () => reject(new DOMException('Motion cancelled', 'AbortError'))
      controller.signal.addEventListener('abort', abort, { once: true })
      timeout = setTimeout(() => reject(new Error('Page motion timed out')), milliseconds)
    })
    try { return await Promise.race([promise, stopped]) }
    finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', abort) }
  }
  const finished = (async () => {
    if (!element || !anchor || !header || !live()) return false
    for (const node of [document.scrollingElement, ...element.querySelectorAll('textarea,.cm-scroller')])
      scrollPositions.set(node, { top: node.scrollTop, left: node.scrollLeft })
    window.addEventListener('resize', cancel)
    window.addEventListener('scroll', cancelOnScroll, true)
    document.addEventListener('visibilitychange', cancel)
    media.addEventListener('change', cancel)
    try {
      const viewport = { width: innerWidth, height: innerHeight }
      const top = Math.max(0, Math.min(viewport.height, header.getBoundingClientRect().bottom))
      const footerTop = footer?.getBoundingClientRect().top
      const bottom = footerTop > top ? Math.min(viewport.height, footerTop - 4) : viewport.height
      const rect = { left: 0, top, width: document.documentElement.clientWidth, height: bottom - top, bottom }
      const destination = anchor.getBoundingClientRect(), target = { x: destination.left + destination.width / 2, y: destination.top + destination.height / 2 }
      if (rect.height < 1 || rect.width < 1) return false
      // Let the shelf close and restored editor paint before capturing its actual surface.
      await bounded(new Promise(resolve => { frame = requestAnimationFrame(() => { frame = requestAnimationFrame(resolve) }) }), 250)
      const dataUrl = await bounded(capture(), 900)
      if (!live()) return false
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('Invalid page capture')
      image = new Image(); image.src = dataUrl
      await bounded(image.decode(), 500)
      if (!live()) return false
      const dpr = Math.min(devicePixelRatio || 1, 2, 2048 / viewport.width, 1536 / viewport.height)
      canvas = document.createElement('canvas'); canvas.className = 'page-flight'; canvas.setAttribute('aria-hidden', 'true')
      canvas.dataset.direction = 'collapse'
      canvas.width = Math.ceil(viewport.width * dpr); canvas.height = Math.ceil(viewport.height * dpr)
      Object.assign(canvas.style, { position: 'fixed', inset: '0', width: `${viewport.width}px`, height: `${viewport.height}px`, zIndex: '41', pointerEvents: 'none' })
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable')
      backdrop = document.createElement('div'); backdrop.setAttribute('aria-hidden', 'true'); backdrop.className = 'page-flight-backdrop'
      Object.assign(backdrop.style, { position: 'fixed', left: '0', right: '0', top: `${top}px`, bottom: `${viewport.height - bottom}px`, background: '#f0f3ed', zIndex: '40', pointerEvents: 'none' })
      previousVisibility = element.style.visibility
      element.style.visibility = 'hidden'; visibilityChanged = true
      document.body.append(backdrop, canvas)
      await new Promise((resolve, reject) => {
        const abort = () => resolve()
        controller.signal.addEventListener('abort', abort, { once: true })
        // rAF can stop when minimized; do not strand the editor's operation lock.
        timer = setTimeout(resolve, 1200)
        let start
        const step = time => {
          try {
            if (!live()) { resolve(); return }
            start ??= time
            const elapsed = Math.min(1, (time - start) / 450), p = elapsed
            canvas.dataset.progress = p.toFixed(3)
            drawSheet(ctx, image, rect, target, p, viewport, dpr)
            if (elapsed < 1) frame = requestAnimationFrame(step)
            else { controller.signal.removeEventListener('abort', abort); resolve() }
          } catch (error) { controller.signal.removeEventListener('abort', abort); reject(error) }
        }
        frame = requestAnimationFrame(step)
      })
      return live()
    } catch (error) {
      if (error.name !== 'AbortError') console.warn('[page-motion] skipped:', error.name)
      return false
    } finally {
      controller.abort(); cancelAnimationFrame(frame); clearTimeout(timer)
      canvas?.remove(); backdrop?.remove()
      if (image) image.src = ''
      if (visibilityChanged) element.style.visibility = previousVisibility
      window.removeEventListener('resize', cancel)
      window.removeEventListener('scroll', cancelOnScroll, true)
      document.removeEventListener('visibilitychange', cancel)
      media.removeEventListener('change', cancel)
    }
  })()
  return { finished, cancel }
}
