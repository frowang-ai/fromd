<template>
  <main :aria-busy="!commandReady">
    <header class="app-bar" :inert="busy || operationPending || !loaded" @pointerdown="rememberView">
      <div class="tabs" role="tablist" aria-label="笔记标签页">
        <div v-for="doc in documents" :key="doc.id" class="tab-item" :class="{ selected: doc.id === activeId }">
          <button role="tab" :aria-label="doc.title" :aria-selected="doc.id === activeId" :title="doc.path || doc.title" @click="activate(doc.id)">{{ doc.title }}<span v-if="doc.dirty" aria-label="未保存"> ·</span></button>
          <button class="close-tab" :aria-label="`关闭 ${doc.title}`" @click="closeDocument(doc.id)">×</button>
        </div>
      </div>
      <button class="new-tab" :disabled="!commandReady" aria-label="新建笔记" title="新建笔记 (Ctrl+N)" @click="command('new')">+</button>
    </header>
    <div v-if="message" class="notice" role="alert">{{ message }}<button v-if="!fatal" @click="message = ''" aria-label="关闭提示">×</button></div>
    <div v-if="current?.conflict" class="conflict" role="alert">
      磁盘文件已变化，当前修改仍保留。
      <button :disabled="busy || operationPending" @click="save(true)">另存当前修改</button><button :disabled="busy || operationPending" @click="reloadDocument">重新读取磁盘</button>
    </div>
    <div v-if="!loaded" role="status" class="loading">正在打开笔记…</div>
    <div :inert="busy">
      <template v-for="doc in documents" :key="`${doc.id}-${doc.generation || 0}`">
        <DocumentPane v-if="visited.has(doc.id)" :ref="instance => setSession(doc.id, instance)" :document="doc" :active="doc.id === activeId" :editable="doc.id === activeId && ready[doc.id] && displayedId === doc.id && !busy" :inert="!ready[doc.id] || displayedId !== doc.id" :status="saveStatus(doc)" :engine="sharedEditor" :rich-active="displayedId === doc.id" @rename="title => rename(doc.id, title)" @finish-name="finishName(doc.id)" @change="text => change(doc.id, text)" />
      </template>
      <p v-if="bodyLoading" class="loading" role="status">正在读取笔记…</p>
      <div v-show="displayedId === activeId && !bodyLoading && !sourceMode" :inert="!ready[activeId]" class="document-shell shared-editor">
        <MarkdownEditor ref="sharedEditor" @session-change="sessionChanged" />
      </div>
    </div>
  </main>
</template>
<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, reactive, ref, watchEffect } from 'vue'
import MarkdownEditor from '@frowang/editor'
import { buildPdfDocument } from '@frowang/editor/pdf'
import DocumentPane from './DocumentPane.vue'
const api = window.desktop
const documents = ref([]), activeId = ref(null), visited = reactive(new Set()), ready = reactive({})
const current = computed(() => documents.value.find(doc => doc.id === activeId.value))
const sessions = new Map(), timers = new Map(), nameTimers = new Map(), nameWrites = new Map(), writes = new Set(), closedIds = new Set(), discardingIds = new Set()
const sharedEditor = ref(null), displayedId = ref(null), bodyLoading = ref(false)
const editorStates = new Map(), dirtyViews = new Set()
let loadVersion = 0, composing = false, compositionWaiters = []
const busy = ref(false), operationPending = ref(false), loaded = ref(false), message = ref(''), fatal = ref(false), sourceMode = ref(false)
let disposers = [], selectionVersion = 0, openEventVersion = 0, menuRevision = 0
const commandReady = computed(() => loaded.value && !busy.value && !operationPending.value && !!current.value && !!ready[activeId.value] && displayedId.value === activeId.value)
watchEffect(() => {
  api.setMenuState({ documentId: activeId.value, ready: commandReady.value, busy: busy.value || operationPending.value,
    sourceMode: sourceMode.value, revision: ++menuRevision })
}, { flush: 'sync' })
const normalizeName = title => title.trim() || '未命名笔记'
const nameError = title => new TextEncoder().encode(title).length > 1024 ? '笔记名称过长，最多支持 1024 UTF-8 字节；请缩短名称，或另存正文。' : ''
const findDocument = id => documents.value.find(doc => doc.id === id)
const isLive = doc => findDocument(doc.id) === doc
watchEffect(() => { document.title = `${current.value?.title || '未命名笔记'} — Frowang Markdown` })
function saveStatus(doc) {
  const states = [doc.backup, ...(!doc.path ? [doc.nameBackup] : [])]
  if (states.includes('failed')) return '自动保存失败 · 请另存到文件'
  if (states.includes('pending')) return '正在自动保存…'
  return doc.path ? (doc.dirty ? '已自动保存 · 未写入文件' : '已保存') : '已自动保存'
}
function setSession(id, instance) { if (instance) sessions.set(id, instance); else sessions.delete(id) }
function startComposition() { composing = true }
function endComposition() {
  composing = false
  // A native composition event can checkpoint microtasks between its listeners.
  // Wait through the commit frame so the textarea/v-model input handlers finish
  // before a pending command disables or replaces the focused editing surface.
  requestAnimationFrame(() => { const waiters = compositionWaiters; compositionWaiters = []; waiters.forEach(resolve => resolve()) })
}
async function waitComposition() {
  do {
    if (composing) await new Promise(resolve => compositionWaiters.push(resolve))
    await sharedEditor.value?.settleComposition()
  } while (composing)
}
function rememberView() { captureDisplayed(); sharedEditor.value?.rememberView() }
function sessionChanged({ id, generation, markdown }) {
  const doc = findDocument(id)
  if (!doc || doc.generation !== generation || displayedId.value !== id || sessions.get(id)?.sourceMode) return
  sessions.get(id)?.syncMarkdown(markdown)
  change(id, markdown)
}
function captureDisplayed() {
  const id = displayedId.value, doc = findDocument(id), pane = sessions.get(id)
  if (!doc || !pane || !ready[id] || discardingIds.has(id)) return
  const text = pane.sourceMode ? pane.getMarkdown() : sharedEditor.value?.getMarkdown()
  if (typeof text === 'string') change(id, text)
  if (id === activeId.value && !bodyLoading.value) {
    const state = pane.captureViewState()
    if (JSON.stringify(doc.viewState) !== JSON.stringify(state)) { doc.viewState = state; dirtyViews.add(id) }
  }
  const snapshot = sharedEditor.value.captureSession()
  if (snapshot) editorStates.set(id, { generation: doc.generation, snapshot })
}
function showActive() { void revealActive().catch(error => { message.value = error.message }) }
async function revealActive() {
  const ticket = ++loadVersion, id = activeId.value, doc = findDocument(id)
  if (!doc) return
  ready[id] = false; bodyLoading.value = true
  await waitComposition()
  if (ticket !== loadVersion) return
  captureDisplayed()
  try {
    await nextTick(); await sharedEditor.value.whenReady()
    const loadedDocument = doc.bodyPending ? null : await api.read(id)
    if (ticket !== loadVersion || activeId.value !== id || !isLive(doc) || closedIds.has(id)) return
    if (loadedDocument && loadedDocument.revision >= doc.revision && !doc.bodyPending) {
      if (typeof doc.markdown === 'string' && doc.markdown !== loadedDocument.markdown) {
        editorStates.delete(id); visited.delete(id); doc.generation++
        await nextTick()
      }
      const title = !loadedDocument.path && (doc.nameVersion !== doc.nameAcknowledged || doc.nameBackup === 'failed') ? doc.title : loadedDocument.title
      const localView = dirtyViews.has(id) ? { viewState: doc.viewState } : {}
      Object.assign(doc, loadedDocument, { title, ...localView })
      sessions.get(id)?.syncMarkdown(loadedDocument.markdown)
      if (loadedDocument.warning) { message.value = loadedDocument.warning; doc.backup = 'failed' }
    }
    visited.add(id); await nextTick()
    if (ticket !== loadVersion || !isLive(doc)) return
    const pane = sessions.get(id), cached = editorStates.get(id)
    sharedEditor.value.activateSession({ id, generation: doc.generation,
      snapshot: cached?.generation === doc.generation ? cached.snapshot : null,
      markdown: doc.markdown, viewState: doc.viewState, resolveImage: pane.resolveImage,
    })
    const generation = doc.generation
    const isCurrent = () => ticket === loadVersion && isLive(doc) && activeId.value === id && doc.generation === generation && !closedIds.has(id)
    displayedId.value = id; sourceMode.value = pane.sourceMode
    bodyLoading.value = false
    await nextTick()
    if (!isCurrent()) return
    sharedEditor.value.restoreSessionView()
    if (!await pane.restoreViewState(isCurrent) || !isCurrent()) return
    ready[id] = true
    await nextTick()
    if (!isCurrent()) return
    if (!sourceMode.value) sharedEditor.value.focusSessionView()
  } finally { if (ticket === loadVersion) bodyLoading.value = false }
}
function forgetDocument(id) {
  closedIds.add(id)
  clearTimeout(timers.get(id)); timers.delete(id)
  clearTimeout(nameTimers.get(id)); nameTimers.delete(id)
  visited.delete(id); delete ready[id]; editorStates.delete(id); dirtyViews.delete(id)
  loadVersion++
  if (displayedId.value === id) { sharedEditor.value?.clearSession(); displayedId.value = null }
}
function adopt(snapshot, reloadId = null, preserveEdits = false, preferredActiveId = null) {
  const previous = new Map(documents.value.map(doc => [doc.id, doc]))
  const nextIds = new Set(snapshot.documents.map(doc => doc.id))
  // documents:changed announces second-instance opens, never deletions. A
  // delayed snapshot can omit newer local tabs; only an explicit close removes one.
  const retained = documents.value.filter(doc => !nextIds.has(doc.id) && !closedIds.has(doc.id))
  const selected = preferredActiveId || snapshot.activeId
  documents.value = snapshot.documents.filter(doc => !closedIds.has(doc.id)).map(doc => {
    const old = previous.get(doc.id)
    if (old && doc.id !== reloadId) {
      const local = preserveEdits ? { markdown: old.markdown, revision: old.revision, dirty: old.dirty } : {}
      // A second-instance snapshot can arrive while a title request is in flight.
      // Keep the same reactive object so pending replies can check its identity.
      if (!doc.path && (preserveEdits || old.nameVersion !== old.nameAcknowledged || old.nameBackup === 'failed')) local.title = old.title
      if (preserveEdits && old.path) Object.assign(local, { path: old.path, title: old.title, conflict: old.conflict })
      if (dirtyViews.has(doc.id)) local.viewState = old.viewState
      Object.assign(old, doc, local)
      if (old.path) { old.draftName = old.title; old.nameBackup = 'saved'; old.nameError = '' }
      else if (!preserveEdits && old.nameVersion === old.nameAcknowledged && old.nameBackup !== 'failed') old.draftName = old.title
      if (!preserveEdits) old.backup = snapshot.warning ? 'failed' : 'saved'
      return old
    }
    if (old) {
      delete ready[doc.id]; editorStates.delete(doc.id); visited.delete(doc.id)
      if (displayedId.value === doc.id) { sharedEditor.value?.clearSession(); displayedId.value = null }
    }
    return { ...doc, draftName: doc.title, nameError: '', nameVersion: 0, nameAcknowledged: 0,
      nameBackup: snapshot.warning ? 'failed' : 'saved', backup: snapshot.warning ? 'failed' : 'saved', generation: (old?.generation || 0) + 1 }
  }).concat(retained)
  if (!preserveEdits) selectionVersion++
  activeId.value = documents.value.some(doc => doc.id === selected) ? selected : documents.value[0]?.id
  sourceMode.value = sessions.get(activeId.value)?.sourceMode ?? false
  if (snapshot.warning) message.value = snapshot.warning
}
async function documentsChanged(snapshot) {
  const selection = selectionVersion, eventVersion = ++openEventVersion
  try {
    // Open events can be delivered after a newer activate/save. Read the current
    // selection, and do not apply that reply over a user action completed meanwhile.
    const metadata = await api.listMetadata()
    await waitComposition(); captureDisplayed()
    const selected = selection === selectionVersion && eventVersion === openEventVersion ? metadata.activeId : activeId.value
    adopt({ ...snapshot, activeId: selected }, null, true, selected)
    if (displayedId.value !== activeId.value || !ready[activeId.value]) showActive()
  } catch (error) {
    adopt({ ...snapshot, activeId: activeId.value }, null, true, activeId.value)
    if (displayedId.value !== activeId.value || !ready[activeId.value]) showActive()
    message.value = error.message
  }
}
function rename(id, title) {
  const doc = findDocument(id)
  if (!doc || doc.path || discardingIds.has(id) || doc.draftName === title) return
  const previousError = doc.nameError
  doc.draftName = title; doc.nameVersion++; doc.nameError = nameError(title)
  if (!doc.nameError && message.value === previousError) message.value = ''
  clearTimeout(nameTimers.get(id)); nameTimers.delete(id)
  if (doc.nameError) { doc.nameBackup = 'failed'; message.value = doc.nameError; return }
  doc.title = normalizeName(title); doc.nameBackup = 'pending'
  nameTimers.set(id, setTimeout(() => { nameTimers.delete(id); void persistName(doc).catch(() => {}) }, 250))
}
function finishName(id) {
  const doc = findDocument(id)
  if (!doc || doc.path) return
  if (!doc.nameError) doc.draftName = doc.title
  clearTimeout(nameTimers.get(id)); nameTimers.delete(id)
  void persistName(doc).catch(() => {})
}
async function persistName(doc) {
  if (!isLive(doc) || doc.path || discardingIds.has(doc.id)) return
  if (nameWrites.has(doc.id)) return nameWrites.get(doc.id)
  if (doc.nameError) throw new Error(doc.nameError)
  if (doc.nameVersion === doc.nameAcknowledged && doc.nameBackup !== 'failed') return
  const pending = (async () => {
    // Only one request per document is sent at a time; newer input is coalesced.
    while (isLive(doc) && !doc.path && !discardingIds.has(doc.id)) {
      if (doc.nameError) throw new Error(doc.nameError)
      const version = doc.nameVersion, title = doc.title
      try {
        const result = await api.rename(doc.id, title)
        if (!isLive(doc) || doc.path || discardingIds.has(doc.id)) return
        if (result.id !== doc.id || result.stale || result.closed) throw new Error('草稿名称未能保存，请重试。')
        if (doc.nameVersion === version) {
          doc.title = result.title; doc.nameAcknowledged = version
          doc.nameBackup = result.backedUp ? 'saved' : 'failed'
          if (result.warning) message.value = result.warning
          return
        }
      } catch (error) {
        if (!isLive(doc) || discardingIds.has(doc.id)) return
        if (doc.nameVersion !== version) continue
        doc.nameBackup = 'failed'; message.value = error.message; throw error
      }
    }
  })()
  nameWrites.set(doc.id, pending)
  try { await pending } finally { if (nameWrites.get(doc.id) === pending) nameWrites.delete(doc.id) }
}
function change(id, markdown) {
  const doc = findDocument(id)
  if (!doc || discardingIds.has(id) || typeof markdown !== 'string' || doc.markdown === markdown) return
  doc.markdown = markdown; doc.revision++; doc.dirty = true; doc.backup = 'pending'; doc.bodyPending = true
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => { timers.delete(id); void backup(doc).catch(() => {}) }, 200))
}
async function backup(doc) {
  if (!isLive(doc) || typeof doc.markdown !== 'string' || (doc.backup === 'saved' && !doc.bodyPending)) return
  const revision = doc.revision, text = doc.markdown
  const pending = (async () => {
    try {
      const result = await api.update(doc.id, text, revision)
      if (!isLive(doc) || doc.revision !== revision) return
      if (result.stale || result.closed) throw new Error('草稿内容未能保存，请重试。')
      doc.dirty = result.dirty
      if (result.warning) message.value = result.warning
      doc.backup = result.backedUp ? 'saved' : 'failed'; doc.bodyPending = !result.backedUp
    } catch (error) {
      if (!isLive(doc) || doc.revision !== revision) return
      doc.backup = 'failed'; message.value = error.message; throw error
    }
  })()
  writes.add(pending)
  try { await pending } finally { writes.delete(pending) }
}
async function flush(excludeId = null, allowNameFailure = false) {
  await waitComposition()
  captureDisplayed()
  const pendingDocuments = documents.value.filter(doc => doc.id !== excludeId)
  for (const doc of pendingDocuments) {
    const pane = sessions.get(doc.id)
    const text = pane?.sourceMode ? pane.getMarkdown() : (doc.id === displayedId.value ? sharedEditor.value?.getMarkdown() : undefined)
    if (typeof text === 'string') change(doc.id, text)
    if (!doc.path && !doc.nameError) doc.draftName = doc.title
    clearTimeout(timers.get(doc.id)); timers.delete(doc.id)
    clearTimeout(nameTimers.get(doc.id)); nameTimers.delete(doc.id)
  }
  // Retry the latest local values after any old failed requests have settled.
  await Promise.allSettled([...writes, ...nameWrites.values()])
  await Promise.all(pendingDocuments.filter(isLive).flatMap(doc => [backup(doc), persistName(doc).catch(error => {
    // An invalid/unavailable name must not block the external-file escape route.
    // Body failures still reject, and normal exit still requires every name.
    if (!allowNameFailure) throw error
    message.value = error.message
  })]))
  await Promise.all(pendingDocuments.filter(isLive).map(async doc => {
    if (!dirtyViews.has(doc.id)) return
    const state = doc.viewState, result = await api.setViewState(doc.id, JSON.parse(JSON.stringify(state)))
    if (result.saved && doc.viewState === state) dirtyViews.delete(doc.id)
    if (result.warning) message.value = result.warning
  }))
}
async function run(operation, allowNameFailure = false) {
  if (busy.value || operationPending.value || !loaded.value) return
  const id = activeId.value, doc = current.value, generation = doc?.generation, selection = selectionVersion
  // Exclude a second command without disabling/defocusing the composing input.
  // The accepted command's menuRevision changes with this lock, so after the
  // wait check document identity and selection intent, not that menu revision.
  operationPending.value = true
  try {
    await waitComposition()
    if (!doc || activeId.value !== id || !isLive(doc) || doc.generation !== generation ||
      selectionVersion !== selection || !ready[id] || displayedId.value !== id) return
    busy.value = true; selectionVersion++
    await flush(null, allowNameFailure)
    const snapshot = await operation()
    if (snapshot?.documents) { adopt(snapshot); await revealActive() }
  }
  catch (error) { message.value = error.message }
  finally { busy.value = false; operationPending.value = false }
}
async function activate(id) {
  if (busy.value || operationPending.value) return
  selectionVersion++
  if (activeId.value === id) { await api.activate(id); return }
  busy.value = true
  try {
    await waitComposition(); captureDisplayed(); await flush()
    await api.activate(id)
    selectionVersion++
    activeId.value = id; sourceMode.value = sessions.get(id)?.sourceMode ?? false
  } catch (error) { message.value = error.message }
  finally { busy.value = false; showActive() }
}
async function toggleSource() {
  const id = activeId.value, doc = current.value, pane = sessions.get(id)
  if (!commandReady.value || !pane) return
  const generation = doc.generation, selection = selectionVersion
  let switched = false
  operationPending.value = true
  try {
    await waitComposition()
    if (activeId.value !== id || !isLive(doc) || doc.generation !== generation ||
      selectionVersion !== selection || !ready[id] || displayedId.value !== id) return
    busy.value = true
    rememberView()
    const mode = await pane.toggleSource()
    if (activeId.value === id && isLive(doc)) { sourceMode.value = mode; switched = true }
  } catch (error) { message.value = error.message }
  finally {
    busy.value = false; operationPending.value = false; await nextTick()
    if (switched && activeId.value === id && isLive(doc)) pane.focusEditor()
  }
}
async function save(saveAs) {
  const id = activeId.value
  await run(async () => {
    const result = await api.save(id, saveAs)
    if (result.warning) message.value = result.warning
    if (result.conflict) message.value = '文件已被其他程序修改，本次未覆盖。可重新读取或另存为。'
    return result.snapshot
  }, true)
}
async function closeDocument(id) {
  const doc = findDocument(id)
  if (!doc || busy.value || operationPending.value || !loaded.value) return
  if (doc.path) {
    await run(async () => {
      const result = await api.close(id)
      if (result.closed) forgetDocument(id)
      return result.snapshot
    })
    return
  }
  await waitComposition()
  busy.value = true; selectionVersion++; discardingIds.add(id)
  clearTimeout(timers.get(id)); timers.delete(id)
  clearTimeout(nameTimers.get(id)); nameTimers.delete(id)
  try {
    // A draft's × means discard. Do not submit its still-unsent edits just to delete it.
    await flush(id)
    const result = await api.close(id)
    if (result.closed) forgetDocument(id)
    if (result.snapshot) adopt(result.snapshot)
  } catch (error) { message.value = error.message }
  finally {
    discardingIds.delete(id); busy.value = false; showActive()
    // If deletion failed, keep the local draft and resume its pending writes.
    if (isLive(doc)) { void backup(doc).catch(() => {}); void persistName(doc).catch(() => {}) }
  }
}
async function reloadDocument() {
  const id = activeId.value
  await run(async () => { const result = await api.reload(id); return result.reloaded ? result.snapshot : undefined })
}
async function exportPdf() {
  const id = activeId.value
  await run(async () => {
    const doc = findDocument(id), pane = sessions.get(id)
    const html = await buildPdfDocument({ markdown: doc.markdown, title: doc.title, resolveImage: pane.resolveImage })
    await api.exportPdf(doc.id, html)
  })
}
async function closeApplication() {
  if (busy.value || operationPending.value) { await api.cancelClose(); return }
  await waitComposition()
  busy.value = true
  try { await flush(); await api.closeReady() }
  catch (error) { message.value = error.message; await api.cancelClose() }
  finally { busy.value = false }
}
async function command(request) {
  const name = typeof request === 'string' ? request : request?.name
  if (!commandReady.value) return
  if (typeof request !== 'string' && (request.documentId !== activeId.value || request.revision !== menuRevision)) return
  if (name === 'new') await run(() => api.newDocument())
  if (name === 'open') await run(() => api.open())
  if (name === 'save') await save(false)
  if (name === 'saveAs') await save(true)
  if (name === 'pdf') await exportPdf()
  if (name === 'source') await toggleSource()
}
function shortcut(event) {
  if (event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return
  const key = event.key.toLowerCase()
  const action = key === 's' ? (event.shiftKey ? 'saveAs' : 'save') : !event.shiftKey && ({ n: 'new', o: 'open' })[key]
  if (action) { event.preventDefault(); void command(action) }
}
onMounted(async () => {
  try {
    window.addEventListener('keydown', shortcut)
    window.addEventListener('compositionstart', startComposition, true)
    window.addEventListener('compositionend', endComposition, true)
    disposers = [api.onClose(closeApplication), api.onCommand(command), api.onDocuments(documentsChanged)]
    adopt(await api.list()); await revealActive(); loaded.value = true
    await api.ready()
  } catch (error) { fatal.value = true; message.value = `启动失败：${error.message}` }
})
onBeforeUnmount(() => { timers.forEach(clearTimeout); nameTimers.forEach(clearTimeout); disposers.forEach(dispose => dispose()); window.removeEventListener('keydown', shortcut); window.removeEventListener('compositionstart', startComposition, true); window.removeEventListener('compositionend', endComposition, true) })
</script>
<style>
* { box-sizing: border-box; }
body { margin: 0; background: #fffefa; color: #333b38; font: 14px/1.6 'Microsoft YaHei', 'PingFang SC', sans-serif; }
button, input, textarea { font: inherit; }
button { color: #53645d; cursor: pointer; border: 0; background: transparent; border-radius: 5px; padding: 7px 9px; }
button:hover { background: #edf2ed; }
button:disabled { opacity: .45; cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid #6c9b86; outline-offset: 2px; }
.app-bar { position: sticky; top: 0; z-index: 20; min-height: 48px; padding: 6px 20px; display: flex; align-items: center; gap: 12px; background: #fffefaed; backdrop-filter: blur(12px); border-bottom: 1px solid #edf0e8; }
.tabs { display: flex; flex: 0 1 auto; min-width: 0; overflow-x: auto; gap: 2px; scrollbar-width: thin; }
.tab-item { display: flex; flex: 0 0 auto; align-items: center; max-width: 210px; border-bottom: 1px solid transparent; }
.tab-item.selected { border-bottom-color: #71917e; }
.tab-item [role=tab] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.close-tab { padding: 4px 6px; font-size: 15px; color: #8b958c; }
.new-tab { flex: 0 0 32px; width: 32px; height: 32px; padding: 0; font-size: 23px; line-height: 1; }
.document-shell { max-width: 900px; margin: 0 auto; padding: 30px 38px 100px; }
.document-pane { padding-bottom: 0; }
.shared-editor { padding-top: 0; }
.document-meta { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 30px; color: #849085; font-size: 11px; }
.document-meta > :first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.draft-name { flex: 1; min-width: 0; padding: 2px 4px; margin: -2px -4px; border: 0; border-radius: 3px; background: transparent; color: #53645d; }
.draft-name:hover, .draft-name:focus { background: #edf2ed; }
.document-meta > :last-child { white-space: nowrap; }
.markdown-source { display: block; width: 100%; min-height: 75vh; border: 0; outline: none; resize: vertical; background: #fffefa; color: #405c4c; font: 14px/1.9 Consolas, 'Microsoft YaHei', monospace; }
.notice, .conflict { padding: 10px 24px; background: #f4edda; color: #735d33; }
.notice button { float: right; }
.loading { padding: 40px; color: #849085; }
@media (max-width: 700px) { .app-bar { padding-inline: 12px; gap: 6px; } .document-shell { padding: 24px 22px 60px; } }
</style>
