// Native "open with" / Dock / second-instance / window-drop paths are queued by
// the Rust host. This gate drains that queue through the document coordinator
// only after the workspace booted, and coalesces bursts into one queued drain.
export function createOpenRequests({open, report}) {
  let ready = false, wanted = false, flight = null, disposed = false
  function pump() {
    if (disposed || !ready || !wanted || flight) return flight ?? Promise.resolve()
    wanted = false
    flight = (async () => {
      try { await open() } catch (error) { report(error) }
    })().finally(() => { flight = null; if (wanted) pump() })
    return flight
  }
  return {
    request() { wanted = true; return pump() },
    // `pending` comes from the host after boot, so an empty startup queue never
    // freezes the editor just to discover that nothing is waiting.
    start(pending = false) { ready = true; wanted ||= pending; return pump() },
    dispose() { disposed = true },
  }
}
