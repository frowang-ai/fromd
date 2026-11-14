<template>
  <div class="app-shell">
    <header class="topbar"><div class="brand"><span class="brand-mark">f</span><b>frowd</b></div><nav class="tabs"><div v-for="doc in openDocuments" :key="doc.id" class="tab" :class="{ active: doc.id === activeId }"><button @click="activate(doc.id)">{{ doc.title }}</button><button class="minus" @click.stop="shelve(doc.id)">−</button></div><button class="new" @click="createDocument">＋</button></nav><button class="quiet" @click="sidebarOpen = !sidebarOpen">{{ sidebarOpen ? '隐藏工作栏' : '显示工作栏' }}</button><button class="quiet" @click="sourceMode ? switchToRendered() : switchToSource()">{{ sourceMode ? '正文' : '源码' }}</button></header>
    <div class="workspace">
      <aside v-if="sidebarOpen" class="sidebar"><div class="switch"><button :class="{ selected: sidebarMode === 'pages' }" @click="sidebarMode = 'pages'">页面</button><button :class="{ selected: sidebarMode === 'outline' }" @click="sidebarMode = 'outline'">大纲</button></div><template v-if="sidebarMode === 'pages'"><input v-model="query" class="search" placeholder="搜索页面" /><div class="group-title"><span>已展开 {{ openDocuments.length }}</span><button class="link" :disabled="!shelvedDocuments.length" @click="expandAll">全部展开</button></div><button v-for="doc in filteredOpenDocuments" :key="doc.id" class="page" :class="{ active: doc.id === activeId }" @click="activate(doc.id)"><span>{{ doc.title }}</span><span class="page-actions"><i @click.stop="shelve(doc.id)">−</i><i @click.stop="removeDocument(doc)">×</i></span></button><p v-if="!filteredOpenDocuments.length" class="empty">没有匹配的已展开页面</p><div class="group-title collapsed-title">已收起 {{ shelvedDocuments.length }}</div><button v-for="doc in filteredShelvedDocuments" :key="doc.id" class="page shelved" @click="activate(doc.id)"><span>{{ doc.title }}</span><i>↗</i></button><p v-if="!filteredShelvedDocuments.length" class="empty">暂无已收起页面</p></template><template v-else><div class="group-title">当前文稿 {{ outline.length }} 个标题</div><button v-for="heading in outline" :key="heading.key" class="outline" :style="{ paddingLeft: (8 + heading.level * 12) + 'px' }" @click="revealHeading(heading)">{{ heading.text }}</button><p v-if="!outline.length" class="empty">当前文稿没有标题</p></template></aside>
      <main class="main"><p v-if="message" class="message">{{ message }}</p><div v-if="currentDocument" class="stage"><textarea v-if="sourceMode" ref="sourceInput" v-model="sourceText" class="source" @input="sourceChanged" /><MarkdownEditor v-else ref="editor" :model-value="currentMarkdown" link-navigation @session-change="editorChanged" /><div class="name-bar"><input v-if="!currentDocument.path" :value="currentDocument.title" @input="nameChanged" @compositionstart="nameComposing = true" @compositionend="endNameComposition" @blur="finishName" @keydown.enter.prevent="finishName" /><span v-else>{{ currentDocument.title }}</span><small>{{ saveState }}</small></div></div><div v-else class="empty-stage"><p>所有页面已收起</p><button @click="createDocument">新建页面</button></div></main>
    </div>
    <div v-if="undoRemoval" class="undo"><span>已移除「{{ undoRemoval }}」</span><button @click="undoRemove">撤销</button><button @click="undoRemoval = ''">×</button></div>
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import MarkdownEditor from '@frowang/editor'
const invoke = (command, args = {}) => window.__TAURI_INTERNALS__.invoke(command, args)
const api = {
  list: () => invoke('list_metadata'),
  read: id => invoke('read_document', { id }),
  create: () => invoke('create_document', { markdown: '', title: '未命名笔记' }),
  update: (id, markdown, revision) => invoke('update_document', { id, markdown, revision }),
  rename: (id, title) => invoke('rename_document', { id, title }),
  view: (id, value) => invoke('set_view_state', { id, viewState: value }),
  activate: id => invoke('activate_document', { id }),
  shelve: id => invoke('shelve_document', { id }),
  expand: () => invoke('expand_all'),
  undo: () => invoke('undo_remove'),
  remove: id => invoke('remove_document', { id }),
}
const documents = ref([]), activeId = ref(null), sidebarOpen = ref(true), sidebarMode = ref('pages'), query = ref('')
const currentMarkdown = ref(''), sourceText = ref(''), sourceMode = ref(false), message = ref(''), undoRemoval = ref('')
const editor = ref(null), sourceInput = ref(null), composing = ref(false), nameComposing = ref(false), pending = ref(false), saveState = ref('已保存'), busy = ref(false)
let generation = 0, timer = null
const openDocuments = computed(() => documents.value.filter(doc => !doc.shelved))
const shelvedDocuments = computed(() => documents.value.filter(doc => doc.shelved))
const currentDocument = computed(() => documents.value.find(doc => doc.id === activeId.value) || null)
const filteredOpenDocuments = computed(() => filter(openDocuments.value))
const filteredShelvedDocuments = computed(() => filter(shelvedDocuments.value))
const outline = computed(() => {
  const result = []; let fence = false
  currentMarkdown.value.split(/\n/).forEach((line, index) => { if (/^\s*\x60\x60\x60/.test(line)) { fence = !fence; return } if (fence) return; const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line); if (match) result.push({ key: index + ':' + match[2], level: match[1].length, text: match[2], line: index }) })
  return result
})
function filter(list) { const needle = query.value.trim().toLocaleLowerCase(); return needle ? list.filter(doc => doc.title.toLocaleLowerCase().includes(needle)) : list }
function apply(snapshot) { documents.value = snapshot.documents || []; activeId.value = snapshot.activeId || null; undoRemoval.value = snapshot.undoRemoval || ''; if (snapshot.warning) message.value = snapshot.warning }
function text() { return sourceMode.value ? sourceText.value : (editor.value && editor.value.getMarkdown ? editor.value.getMarkdown() : currentMarkdown.value) }
async function waitIme() { for (let i = 0; composing.value && i < 120; i++) await new Promise(resolve => requestAnimationFrame(resolve)) }
async function flush() {
  await waitIme(); const doc = currentDocument.value; if (!doc || !pending.value) return
  const body = text(); if (body === currentMarkdown.value && !sourceMode.value) { pending.value = false; return }
  try { apply(await api.update(doc.id, body, doc.revision + 1)); currentMarkdown.value = body; pending.value = false; saveState.value = '已保存' } catch (error) { saveState.value = '保存失败'; message.value = String(error); throw error }
}
function schedule() { pending.value = true; saveState.value = '保存中…'; clearTimeout(timer); timer = setTimeout(() => flush().catch(() => {}), 250) }
function editorChanged(event) { if (!event || event.id !== activeId.value) return; currentMarkdown.value = event.markdown; schedule() }
function sourceChanged() { currentMarkdown.value = sourceText.value; schedule() }
function activateName(value) { const doc = currentDocument.value; if (!doc || doc.path) return; clearTimeout(doc.nameTimer); doc.nameTimer = setTimeout(() => api.rename(doc.id, value).then(apply).catch(error => { message.value = String(error) }), 220) }
function nameChanged(event) { if (!event.isComposing && !nameComposing.value) activateName(event.target.value) }
function endNameComposition(event) { nameComposing.value = false; activateName(event.target.value) }
function finishName(event) { if (!nameComposing.value) activateName(event && event.target ? event.target.value : (currentDocument.value ? currentDocument.value.title : '')) }
async function loadActive() {
  const id = activeId.value; if (!id) return
  const doc = await api.read(id); currentMarkdown.value = doc.markdown; sourceText.value = doc.markdown; sourceMode.value = doc.viewState && doc.viewState.mode === 'source'; generation += 1; await nextTick(); if (sourceMode.value) sourceInput.value && sourceInput.value.focus(); else editor.value && editor.value.activateSession({ id, generation, markdown: doc.markdown, viewState: doc.viewState })
}
async function activate(id) {
  if (busy.value || !id) return; busy.value = true
  try { await flush(); apply(await api.activate(id)); await loadActive() } catch (error) { message.value = String(error) } finally { busy.value = false }
}
async function createDocument() { if (busy.value) return; busy.value = true; try { await flush(); const snap = await api.create(); apply(snap); await loadActive() } catch (error) { message.value = String(error) } finally { busy.value = false } }
async function shelve(id) { if (busy.value) return; busy.value = true; try { await flush(); apply(await api.shelve(id)); if (activeId.value) await loadActive() } catch (error) { message.value = String(error) } finally { busy.value = false } }
async function expandAll() { if (busy.value) return; busy.value = true; try { await flush(); apply(await api.expand()); if (activeId.value) await loadActive() } catch (error) { message.value = String(error) } finally { busy.value = false } }
async function undoRemove() { if (busy.value) return; busy.value = true; try { apply(await api.undo()); await loadActive() } catch (error) { message.value = String(error) } finally { busy.value = false } }
async function removeDocument(doc) { if (busy.value || !doc || !confirm('移除「' + doc.title + '」？草稿保留在本次会话的撤销入口。')) return; busy.value = true; try { await flush(); apply(await api.remove(doc.id)); await loadActive() } catch (error) { message.value = String(error) } finally { busy.value = false } }
async function switchToSource() { await flush(); sourceText.value = text(); sourceMode.value = true; await nextTick(); sourceInput.value && sourceInput.value.focus() }
async function switchToRendered() { await flush(); currentMarkdown.value = sourceText.value; sourceMode.value = false; generation += 1; await nextTick(); editor.value && editor.value.activateSession({ id: activeId.value, generation, markdown: sourceText.value, viewState: currentDocument.value && currentDocument.value.viewState }) }
function revealHeading(heading) {
  if (sourceMode.value) { const input = sourceInput.value; if (!input) return; const before = sourceText.value.split(/\n/).slice(0, heading.line).join('\n'); const start = before.length + (heading.line ? 1 : 0); input.focus(); input.setSelectionRange(start, start + heading.text.length); input.scrollTop = Math.max(0, heading.line * 24 - 120); return }
  const nodes = Array.from(document.querySelectorAll('.ProseMirror h1,.ProseMirror h2,.ProseMirror h3,.ProseMirror h4,.ProseMirror h5,.ProseMirror h6')); const node = nodes.find(item => item.textContent.trim() === heading.text); if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
function handleScroll() { const doc = currentDocument.value; if (!doc) return; clearTimeout(doc.viewTimer); doc.viewTimer = setTimeout(() => api.view(doc.id, { mode: sourceMode.value ? 'source' : 'rendered', scrollTop: window.scrollY, ...(sourceInput.value ? { sourceScrollTop: sourceInput.value.scrollTop, sourceSelection: { start: sourceInput.value.selectionStart, end: sourceInput.value.selectionEnd } } : {}) }).catch(() => {}), 220) }
function keydown(event) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); flush().catch(() => {}) } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); createDocument() } }
async function boot() { try { let snap = await api.list(); if (!snap.documents.length) snap = await api.create(); apply(snap); await loadActive() } catch (error) { message.value = String(error) } }
onMounted(() => { window.addEventListener('keydown', keydown, true); window.addEventListener('compositionstart', () => composing.value = true, true); window.addEventListener('compositionend', () => { composing.value = false; schedule() }, true); window.addEventListener('scroll', handleScroll, true); boot() })
onBeforeUnmount(() => { clearTimeout(timer); window.removeEventListener('keydown', keydown, true); window.removeEventListener('scroll', handleScroll, true) })
</script>
