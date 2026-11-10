<template>
  <main>
    <header class="app-bar" :inert="busy || !loaded">
      <div class="tabs" role="tablist" aria-label="笔记标签页">
        <div v-for="doc in documents" :key="doc.id" class="tab-item" :class="{ selected: doc.id === activeId }">
          <button role="tab" :aria-selected="doc.id === activeId" :title="doc.path || doc.title" @click="activate(doc.id)">{{ doc.title }}<span v-if="doc.dirty" aria-label="未保存"> ·</span></button>
          <button class="close-tab" :aria-label="`关闭 ${doc.title}`" @click="closeDocument(doc.id)">×</button>
        </div>
      </div>
      <nav aria-label="文档操作">
        <button @click="run(() => api.newDocument())">新建</button><button @click="run(() => api.open())">打开</button>
        <button :disabled="!ready[activeId]" :aria-pressed="sourceMode" @click="toggleSource">{{ sourceMode ? '返回正文' : '源码' }}</button>
        <button :disabled="!ready[activeId]" @click="save(false)">保存</button><button :disabled="!ready[activeId]" @click="save(true)">另存为</button>
        <button :disabled="!ready[activeId]" @click="exportPdf">PDF</button>
      </nav>
    </header>
    <div v-if="message" class="notice" role="alert">{{ message }}<button v-if="!fatal" @click="message = ''" aria-label="关闭提示">×</button></div>
    <div v-if="current?.conflict" class="conflict" role="alert">
      磁盘文件已变化，当前修改仍保留。
      <button :disabled="busy" @click="save(true)">另存当前修改</button><button :disabled="busy" @click="reloadDocument">重新读取磁盘</button>
    </div>
    <div v-if="!loaded" role="status" class="loading">正在打开笔记…</div>
    <div :inert="busy">
      <template v-for="doc in documents" :key="`${doc.id}-${doc.generation || 0}`">
        <DocumentPane v-if="visited.has(doc.id)" :ref="instance => setSession(doc.id, instance)" :document="doc" :active="doc.id === activeId" :status="saveStatus(doc)" @rename="title => rename(doc.id, title)" @finish-name="finishName(doc.id)" @change="text => change(doc.id, text)" @ready="value => ready[doc.id] = value" />
      </template>
    </div>
  </main>
</template>
<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, reactive, ref, watchEffect } from 'vue'
import { buildPdfDocument } from '@frowang/editor/pdf'
import DocumentPane from './DocumentPane.vue'
const api = window.desktop
const documents = ref([]), activeId = ref(null), visited = reactive(new Set()), ready = reactive({})
const current = computed(() => documents.value.find(doc => doc.id === activeId.value))
const sessions = new Map(), timers = new Map(), nameTimers = new Map(), nameWrites = new Map(), writes = new Set(), positions = new Map(), closedIds = new Set(), discardingIds = new Set()
const busy = ref(false), loaded = ref(false), message = ref(''), fatal = ref(false), sourceMode = ref(false)
let disposers = []
const normalizeName = title => title.trim() || '未命名笔记'
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
function forgetDocument(id) {
  closedIds.add(id)
  clearTimeout(timers.get(id)); timers.delete(id)
  clearTimeout(nameTimers.get(id)); nameTimers.delete(id)
  visited.delete(id); delete ready[id]; positions.delete(id)
}
function adopt(snapshot, reloadId = null, preserveEdits = false) {
  const previous = new Map(documents.value.map(doc => [doc.id, doc]))
  const nextIds = new Set(snapshot.documents.map(doc => doc.id))
  // documents:changed announces second-instance opens, never deletions. A
  // delayed snapshot can omit newer local tabs; only an explicit close removes one.
  const retained = documents.value.filter(doc => !nextIds.has(doc.id) && !closedIds.has(doc.id))
  const selected = retained.some(doc => doc.id === activeId.value) || closedIds.has(snapshot.activeId) ? activeId.value : snapshot.activeId
  documents.value = snapshot.documents.filter(doc => !closedIds.has(doc.id)).map(doc => {
    const old = previous.get(doc.id)
    if (old && doc.id !== reloadId) {
      const local = preserveEdits ? { markdown: old.markdown, revision: old.revision, dirty: old.dirty } : {}
      // A second-instance snapshot can arrive while a title request is in flight.
      // Keep the same reactive object so pending replies can check its identity.
      if (!doc.path && (preserveEdits || old.nameVersion !== old.nameAcknowledged || old.nameBackup === 'failed')) local.title = old.title
      Object.assign(old, doc, local)
      if (old.path) { old.draftName = old.title; old.nameBackup = 'saved' }
      else if (!preserveEdits && old.nameVersion === old.nameAcknowledged && old.nameBackup !== 'failed') old.draftName = old.title
      if (!preserveEdits) old.backup = snapshot.warning ? 'failed' : 'saved'
      return old
    }
    if (old) delete ready[doc.id]
    return { ...doc, draftName: doc.title, nameVersion: 0, nameAcknowledged: 0,
      nameBackup: snapshot.warning ? 'failed' : 'saved', backup: snapshot.warning ? 'failed' : 'saved', generation: (old?.generation || 0) + 1 }
  }).concat(retained)
  activeId.value = documents.value.some(doc => doc.id === selected) ? selected : documents.value[0]?.id
  if (activeId.value) visited.add(activeId.value)
  sourceMode.value = sessions.get(activeId.value)?.sourceMode ?? false
  if (snapshot.warning) message.value = snapshot.warning
}
function rename(id, title) {
  const doc = findDocument(id)
  if (!doc || doc.path || discardingIds.has(id) || doc.draftName === title) return
  doc.draftName = title; doc.title = normalizeName(title); doc.nameVersion++; doc.nameBackup = 'pending'
  clearTimeout(nameTimers.get(id))
  nameTimers.set(id, setTimeout(() => { nameTimers.delete(id); void persistName(doc).catch(() => {}) }, 250))
}
function finishName(id) {
  const doc = findDocument(id)
  if (!doc || doc.path) return
  doc.draftName = doc.title
  clearTimeout(nameTimers.get(id)); nameTimers.delete(id)
  void persistName(doc).catch(() => {})
}
async function persistName(doc) {
  if (!isLive(doc) || doc.path || discardingIds.has(doc.id)) return
  if (nameWrites.has(doc.id)) return nameWrites.get(doc.id)
  if (doc.nameVersion === doc.nameAcknowledged && doc.nameBackup !== 'failed') return
  const pending = (async () => {
    // Only one request per document is sent at a time; newer input is coalesced.
    while (isLive(doc) && !doc.path && !discardingIds.has(doc.id)) {
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
  if (!doc || discardingIds.has(id) || doc.markdown === markdown) return
  doc.markdown = markdown; doc.revision++; doc.dirty = true; doc.backup = 'pending'
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => { timers.delete(id); void backup(doc).catch(() => {}) }, 200))
}
async function backup(doc) {
  const revision = doc.revision, text = doc.markdown
  const pending = (async () => {
    try {
      const result = await api.update(doc.id, text, revision)
      if (!isLive(doc) || doc.revision !== revision) return
      if (result.stale || result.closed) throw new Error('草稿内容未能保存，请重试。')
      doc.dirty = result.dirty
      if (result.warning) message.value = result.warning
      doc.backup = result.backedUp ? 'saved' : 'failed'
    } catch (error) {
      if (!isLive(doc) || doc.revision !== revision) return
      doc.backup = 'failed'; message.value = error.message; throw error
    }
  })()
  writes.add(pending)
  try { await pending } finally { writes.delete(pending) }
}
async function flush(excludeId = null) {
  const pendingDocuments = documents.value.filter(doc => doc.id !== excludeId)
  for (const doc of pendingDocuments) {
    const text = sessions.get(doc.id)?.getMarkdown()
    if (text !== undefined) change(doc.id, text)
    if (!doc.path) doc.draftName = doc.title
    clearTimeout(timers.get(doc.id)); timers.delete(doc.id)
    clearTimeout(nameTimers.get(doc.id)); nameTimers.delete(doc.id)
  }
  // Retry the latest local values after any old failed requests have settled.
  await Promise.allSettled([...writes, ...nameWrites.values()])
  await Promise.all(pendingDocuments.filter(isLive).flatMap(doc => [backup(doc), persistName(doc)]))
}
async function run(operation) {
  if (busy.value || !loaded.value) return
  busy.value = true
  try { await flush(); const snapshot = await operation(); if (snapshot?.documents) adopt(snapshot) }
  catch (error) { message.value = error.message }
  finally { busy.value = false }
}
async function activate(id) {
  if (busy.value || activeId.value === id) return
  const previous = activeId.value
  positions.set(previous, window.scrollY)
  await run(async () => {
    await api.activate(id)
    activeId.value = id; visited.add(id); sourceMode.value = sessions.get(id)?.sourceMode ?? false
    await nextTick(); window.scrollTo({ top: positions.get(id) || 0 })
  })
}
async function toggleSource() { sourceMode.value = await sessions.get(activeId.value).toggleSource() }
async function save(saveAs) {
  await run(async () => {
    const result = await api.save(activeId.value, saveAs)
    if (result.snapshot) adopt(result.snapshot)
    if (result.warning) message.value = result.warning
    if (result.conflict) message.value = '文件已被其他程序修改，本次未覆盖。可重新读取或另存为。'
  })
}
async function closeDocument(id) {
  const doc = findDocument(id)
  if (!doc || busy.value || !loaded.value) return
  if (doc.path) {
    await run(async () => {
      const result = await api.close(id)
      if (result.closed) forgetDocument(id)
      if (result.snapshot) adopt(result.snapshot)
    })
    return
  }
  busy.value = true; discardingIds.add(id)
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
    discardingIds.delete(id); busy.value = false
    // If deletion failed, keep the local draft and resume its pending writes.
    if (isLive(doc)) { void backup(doc).catch(() => {}); void persistName(doc).catch(() => {}) }
  }
}
async function reloadDocument() {
  await run(async () => { const id = activeId.value, result = await api.reload(id); if (result.reloaded) adopt(result.snapshot, id) })
}
async function exportPdf() {
  await run(async () => {
    const doc = current.value, pane = sessions.get(doc.id)
    const html = await buildPdfDocument({ markdown: doc.markdown, title: doc.title, resolveImage: pane.resolveImage })
    await api.exportPdf(doc.id, html)
  })
}
async function closeApplication() {
  if (busy.value) { await api.cancelClose(); return }
  busy.value = true
  try { await flush(); await api.closeReady() }
  catch (error) { message.value = error.message; await api.cancelClose() }
  finally { busy.value = false }
}
async function command(name) {
  if (name === 'new') await run(() => api.newDocument())
  if (name === 'open') await run(() => api.open())
  if (name === 'save') await save(false)
  if (name === 'saveAs') await save(true)
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
    disposers = [api.onClose(closeApplication), api.onCommand(command), api.onDocuments(snapshot => adopt(snapshot, null, true))]
    adopt(await api.list()); loaded.value = true
    await api.ready()
  } catch (error) { fatal.value = true; message.value = `启动失败：${error.message}` }
})
onBeforeUnmount(() => { timers.forEach(clearTimeout); nameTimers.forEach(clearTimeout); disposers.forEach(dispose => dispose()); window.removeEventListener('keydown', shortcut) })
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
.tabs { display: flex; flex: 1; min-width: 0; overflow-x: auto; gap: 2px; scrollbar-width: thin; }
.tab-item { display: flex; flex: 0 0 auto; align-items: center; max-width: 210px; border-bottom: 1px solid transparent; }
.tab-item.selected { border-bottom-color: #71917e; }
.tab-item [role=tab] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.close-tab { padding: 4px 6px; font-size: 15px; color: #8b958c; }
nav { display: flex; flex-shrink: 0; }
nav button { font-size: 12px; }
nav button[aria-pressed=true] { background: #e6eee5; }
.document-shell { max-width: 900px; margin: 0 auto; padding: 30px 38px 100px; }
.document-meta { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 30px; color: #849085; font-size: 11px; }
.document-meta > :first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.draft-name { flex: 1; min-width: 0; padding: 2px 4px; margin: -2px -4px; border: 0; border-radius: 3px; background: transparent; color: #53645d; }
.draft-name:hover, .draft-name:focus { background: #edf2ed; }
.document-meta > :last-child { white-space: nowrap; }
.markdown-source { display: block; width: 100%; min-height: 75vh; border: 0; outline: none; resize: vertical; background: #fffefa; color: #405c4c; font: 14px/1.9 Consolas, 'Microsoft YaHei', monospace; }
.notice, .conflict { padding: 10px 24px; background: #f4edda; color: #735d33; }
.notice button { float: right; }
.loading { padding: 40px; color: #849085; }
@media (max-width: 700px) { .app-bar { flex-wrap: wrap; gap: 4px; } .tabs { flex-basis: 100%; } nav { margin-left: auto; } .document-shell { padding: 24px 22px 60px; } }
</style>
