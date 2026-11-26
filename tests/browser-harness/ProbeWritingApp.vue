<template>
  <div class="writing-app">
    <header class="app-bar">
      <div class="tabs" role="tablist" aria-label="笔记标签页">
        <div v-for="doc in documents" :key="doc.id" class="tab-item" :class="{ selected: doc.id === activeId }">
          <button :id="`tab-${doc.id}`" role="tab" :aria-selected="doc.id === activeId" :aria-controls="`panel-${doc.id}`" :tabindex="doc.id === activeId ? 0 : -1" :title="doc.title || '未命名笔记'" @click="selectDocument(doc.id)" @keydown="tabKeydown($event, doc.id)">{{ doc.title || '未命名笔记' }}</button>
          <button class="close-tab" :aria-label="`关闭 ${doc.title || '未命名笔记'}`" title="关闭笔记" @click="closeDocument(doc.id)">×</button>
        </div>
      </div>
      <nav aria-label="文档操作">
        <button @click="newDocument">新建</button>
        <button @click="fileInput.click()">打开 .md</button>
        <button :disabled="!ready[activeId]" :aria-pressed="sourceMode" @click="toggleSource">{{ sourceMode ? '返回正文' : '源码' }}</button>
        <button :disabled="!ready[activeId]" @click="downloadMarkdown">下载 .md</button>
        <button :disabled="!ready[activeId] || exporting" @click="exportPdf">{{ exporting ? '生成中…' : '导出 PDF' }}</button>
      </nav>
      <input ref="fileInput" type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" hidden @change="openFile" />
    </header>
    <div v-if="message" class="notice" role="status">{{ message }}</div>
    <template v-for="doc in documents" :key="doc.id">
      <ProbeWritingDocument v-if="visited.has(doc.id)" :ref="instance => setSession(doc.id, instance)" :document="doc" :active="doc.id === activeId" :save-status="saveStatus" @change="patchDocument(doc.id, $event)" @ready="ready[doc.id] = $event" />
    </template>
  </div>
</template>
<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import ProbeWritingDocument from './ProbeWritingDocument.vue'
import { downloadPreviewPdf } from './pdf-client.js'
import { mathNavigationSample } from './mathNavigationSample.js'

const storageKey = 'frowang-writing-probe-v2'
const legacyKey = 'frowang-writing-probe-v1'
const makeDocument = (markdown = '', title = '未命名笔记') => ({ id: crypto.randomUUID(), title, markdown })
let saved, loadError = false
try {
  const raw = localStorage.getItem(storageKey)
  if (raw !== null) {
    saved = JSON.parse(raw)
    if (!Array.isArray(saved?.documents) || !saved.documents.length || saved.documents.some(doc => typeof doc.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(doc.id) || typeof doc.title !== 'string' || typeof doc.markdown !== 'string') || new Set(saved.documents.map(doc => doc.id)).size !== saved.documents.length) throw new Error('Invalid saved documents')
  } else {
    const oldRaw = localStorage.getItem(legacyKey)
    if (oldRaw !== null) {
      const old = JSON.parse(oldRaw)
      if (typeof old?.markdown !== 'string' || typeof old?.title !== 'string') throw new Error('Invalid legacy draft')
      const doc = makeDocument(old.markdown, old.title)
      saved = { documents: [doc], activeId: doc.id }
    }
  }
} catch { loadError = true }
const documents = ref(saved?.documents && !loadError ? saved.documents : [makeDocument()])
const activeId = ref(documents.value.some(doc => doc.id === saved?.activeId) ? saved.activeId : documents.value[0].id)
const current = computed(() => documents.value.find(doc => doc.id === activeId.value))
const visited = reactive(new Set([activeId.value])), ready = reactive({}), sessions = new Map(), positions = new Map()
const fileInput = ref(null), sourceMode = ref(false), exporting = ref(false)
const message = ref(loadError ? '本机笔记读取失败，原存储已保留。请先下载当前内容备份。' : '')
const saveStatus = ref(loadError ? '本机笔记读取失败' : '已保存到本机')
let timer, navigation = 0
function setSession(id, instance) { if (instance) sessions.set(id, instance); else sessions.delete(id) }
function patchDocument(id, patch) { const doc = documents.value.find(item => item.id === id); if (doc) Object.assign(doc, patch) }
function currentMarkdown() { return sessions.get(activeId.value)?.getMarkdown() ?? current.value.markdown }
function captureCurrent() { current.value.markdown = currentMarkdown(); positions.set(activeId.value, window.scrollY) }
function persist() {
  clearTimeout(timer)
  if (loadError) { saveStatus.value = '未写入本机，请下载 .md'; return }
  try { localStorage.setItem(storageKey, JSON.stringify({ documents: documents.value, activeId: activeId.value })); saveStatus.value = '已保存到本机' }
  catch { saveStatus.value = '本机保存失败，请下载 .md'; message.value = '浏览器存储不可用或空间不足，内容仍保留在各标签中。' }
}
watch([documents, activeId], () => { saveStatus.value = '正在保存…'; clearTimeout(timer); timer = setTimeout(persist, 250) }, { deep: true, flush: 'sync' })
watch(() => current.value.title, title => { document.title = title.trim() || '未命名笔记' }, { immediate: true })
async function selectDocument(id, focus = false) {
  if (id === activeId.value || !documents.value.some(doc => doc.id === id)) return
  captureCurrent(); activeId.value = id; visited.add(id)
  sourceMode.value = sessions.get(id)?.sourceMode ?? false
  persist()
  const revision = ++navigation
  await nextTick()
  if (revision !== navigation) return
  document.getElementById(`tab-${id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  window.scrollTo({ top: positions.get(id) || 0 })
  if (focus) document.getElementById(`tab-${id}`)?.focus({ preventScroll: true })
}
function newDocument(markdown = '', title = '未命名笔记') {
  // Vue passes the click event to handlers; only explicit strings are content.
  const doc = makeDocument(typeof markdown === 'string' ? markdown : '', title)
  documents.value.push(doc); selectDocument(doc.id)
}
async function closeDocument(id) {
  captureCurrent()
  const index = documents.value.findIndex(doc => doc.id === id), doc = documents.value[index]
  if (!doc) return
  if (doc.markdown.trim() && !window.confirm(`关闭「${doc.title || '未命名笔记'}」并移除本机草稿？需要保留时请先下载 .md。`)) return
  if (id === activeId.value) {
    if (documents.value.length === 1) documents.value.push(makeDocument())
    const next = documents.value[index + 1] || documents.value[index - 1]
    await selectDocument(next.id)
  }
  documents.value = documents.value.filter(item => item.id !== id)
  visited.delete(id); positions.delete(id); delete ready[id]; persist()
}
function tabKeydown(event, id) {
  const index = documents.value.findIndex(doc => doc.id === id), length = documents.value.length
  const targets = { ArrowRight: (index + 1) % length, ArrowLeft: (index - 1 + length) % length, Home: 0, End: length - 1 }
  if (event.key in targets) { event.preventDefault(); selectDocument(documents.value[targets[event.key]].id, true) }
}
async function toggleSource() { sourceMode.value = await sessions.get(activeId.value).toggleSource() }
async function openFile(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file) return
  try { newDocument(await file.text(), file.name.replace(/\.(md|markdown|txt)$/i, '')) }
  catch { message.value = '文件读取失败，已有笔记未改变。' }
}
function downloadMarkdown() {
  const blob = new Blob([currentMarkdown()], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = (current.value.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || '笔记') + '.md'
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function exportPdf() {
  exporting.value = true; message.value = ''
  const markdown = currentMarkdown(), title = current.value.title
  try { await downloadPreviewPdf({ markdown, title }) }
  catch (error) { message.value = error.message || 'PDF 导出失败，请重试。' }
  finally { exporting.value = false }
}
function saveBeforeLeave() { captureCurrent(); persist() }
function saveShortcut(event) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveBeforeLeave() } }
onMounted(() => {
  persist(); window.addEventListener('keydown', saveShortcut); window.addEventListener('pagehide', saveBeforeLeave)
  const url = new URL(window.location.href)
  if (url.searchParams.get('sample') === 'math-navigation') {
    newDocument(mathNavigationSample, '公式上下移动样例')
    url.searchParams.delete('sample'); window.history.replaceState(window.history.state, '', url)
  }
})
onBeforeUnmount(() => { saveBeforeLeave(); clearTimeout(timer); window.removeEventListener('keydown', saveShortcut); window.removeEventListener('pagehide', saveBeforeLeave) })
</script>
<style>
* { box-sizing: border-box; }
body { margin: 0; background: #fffefa; color: #333b38; font: 14px/1.6 'Microsoft YaHei', 'PingFang SC', sans-serif; }
button, input, textarea { font: inherit; }
button { color: #53645d; cursor: pointer; border: 0; background: transparent; border-radius: 5px; padding: 7px 11px; }
button:hover { background: #edf2ed; }
button:disabled { opacity: .45; cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid #6c9b86; outline-offset: 2px; }
.app-bar { position: sticky; top: 0; z-index: 20; min-height: 48px; padding: 6px 24px; display: flex; align-items: center; gap: 20px; background: #fffefaed; backdrop-filter: blur(12px); border-bottom: 1px solid #edf0e8; }
.tabs { display: flex; flex: 1; min-width: 0; overflow-x: auto; gap: 2px; scrollbar-width: thin; }
.tab-item { display: flex; flex: 0 0 auto; align-items: center; max-width: 220px; border-bottom: 1px solid transparent; }
.tab-item.selected { border-bottom-color: #71917e; }
.tab-item [role=tab] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; padding: 7px 8px; }
.close-tab { padding: 4px 6px; font-size: 15px; color: #8b958c; }
nav { display: flex; gap: 2px; flex-shrink: 0; }
nav button { font-size: 12px; padding: 7px 9px; }
nav button[aria-pressed=true] { background: #e6eee5; color: #32644d; }
.document-shell { max-width: 832px; margin: 0 auto; padding: 36px 38px 90px; }
.document-meta { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 32px; color: #919990; font-size: 11px; }
.document-meta input { color: #839084; border: 0; background: transparent; min-width: 0; width: 60%; padding: 4px 0; }
.save-status { white-space: nowrap; }
.markdown-source { display: block; width: 100%; min-height: 75vh; border: 0; outline: none; resize: vertical; background: #fffefa; color: #405c4c; font: 14px/1.9 Consolas, 'Microsoft YaHei', monospace; }
.notice { padding: 10px 24px; background: #f4edda; color: #735d33; }
@media (max-width: 640px) { .app-bar { padding: 5px 12px; flex-wrap: wrap; gap: 4px; } .tabs { flex-basis: 100%; } nav { margin-left: auto; } nav button { padding: 6px 8px; } .document-shell { padding: 24px 22px 60px; } .document-meta { margin-bottom: 25px; } }
</style>
