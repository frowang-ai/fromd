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
        <DocumentPane v-if="visited.has(doc.id)" :ref="instance => setSession(doc.id, instance)" :document="doc" :active="doc.id === activeId" :status="doc.backup || (doc.dirty ? '未保存到文件' : doc.path ? '已保存' : '未命名笔记')" @change="text => change(doc.id, text)" @ready="value => ready[doc.id] = value" />
      </template>
    </div>
  </main>
</template>
<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { buildPdfDocument } from '@frowang/editor/pdf'
import DocumentPane from './DocumentPane.vue'
const api = window.desktop
const documents = ref([]), activeId = ref(null), visited = reactive(new Set()), ready = reactive({})
const current = computed(() => documents.value.find(doc => doc.id === activeId.value))
const sessions = new Map(), timers = new Map(), writes = new Set(), positions = new Map()
const busy = ref(false), loaded = ref(false), message = ref(''), fatal = ref(false), sourceMode = ref(false)
let disposers = [], writeFailure = false
function setSession(id, instance) { if (instance) sessions.set(id, instance); else sessions.delete(id) }
function adopt(snapshot, reloadId = null, preserveEdits = false) {
  const previous = new Map(documents.value.map(doc => [doc.id, doc]))
  documents.value = snapshot.documents.map(doc => {
    const old = previous.get(doc.id)
    if (old && doc.id !== reloadId) return { ...old, ...doc, ...(preserveEdits ? { markdown: old.markdown, revision: old.revision, dirty: old.dirty } : { backup: '' }), generation: old.generation }
    if (old) delete ready[doc.id]
    return { ...doc, generation: (old?.generation || 0) + 1 }
  })
  activeId.value = snapshot.activeId; visited.add(activeId.value)
  sourceMode.value = sessions.get(activeId.value)?.sourceMode ?? false
  if (snapshot.warning) message.value = snapshot.warning
  document.title = `${current.value?.title || '未命名笔记'} — Frowang Markdown`
}
function change(id, markdown) {
  const doc = documents.value.find(doc => doc.id === id)
  if (!doc || doc.markdown === markdown) return
  doc.markdown = markdown; doc.revision++; doc.dirty = true; doc.backup = '正在备份草稿…'
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => { timers.delete(id); void backup(doc).catch(() => {}) }, 200))
}
async function backup(doc) {
  const revision = doc.revision, text = doc.markdown
  const pending = api.update(doc.id, text, revision)
  writes.add(pending)
  try {
    const result = await pending
    if (doc.revision === revision && !result.stale) {
      doc.dirty = result.dirty
      if (result.warning) message.value = result.warning
      doc.backup = result.backedUp ? (doc.dirty ? '草稿已备份 · 未写入文件' : doc.path ? '已保存' : '草稿已备份') : '草稿未备份'
    }
  } catch (error) { writeFailure = true; doc.backup = '备份失败'; message.value = error.message; throw error }
  finally { writes.delete(pending) }
}
async function flush() {
  writeFailure = false
  for (const doc of documents.value) {
    const text = sessions.get(doc.id)?.getMarkdown()
    if (text !== undefined) change(doc.id, text)
    clearTimeout(timers.get(doc.id)); timers.delete(doc.id)
  }
  await Promise.allSettled([...writes])
  await Promise.all(documents.value.map(doc => backup(doc)))
  if (writeFailure) throw new Error('草稿备份失败，请重试保存。')
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
  const text = sessions.get(previous)?.getMarkdown(); if (text !== undefined) change(previous, text)
  activeId.value = id; visited.add(id); sourceMode.value = sessions.get(id)?.sourceMode ?? false
  document.title = `${current.value.title} — Frowang Markdown`
  try { await api.activate(id) } catch (error) { message.value = error.message }
  await nextTick(); window.scrollTo({ top: positions.get(id) || 0 })
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
  await run(async () => { const result = await api.close(id); if (result.snapshot) adopt(result.snapshot) })
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
onBeforeUnmount(() => { timers.forEach(clearTimeout); disposers.forEach(dispose => dispose()); window.removeEventListener('keydown', shortcut) })
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
.document-meta > :last-child { white-space: nowrap; }
.markdown-source { display: block; width: 100%; min-height: 75vh; border: 0; outline: none; resize: vertical; background: #fffefa; color: #405c4c; font: 14px/1.9 Consolas, 'Microsoft YaHei', monospace; }
.notice, .conflict { padding: 10px 24px; background: #f4edda; color: #735d33; }
.notice button { float: right; }
.loading { padding: 40px; color: #849085; }
@media (max-width: 700px) { .app-bar { flex-wrap: wrap; gap: 4px; } .tabs { flex-basis: 100%; } nav { margin-left: auto; } .document-shell { padding: 24px 22px 60px; } }
</style>
