<template>
  <button @click="showFind(false)">查找</button><button @click="showFind(true)">替换正文</button>
  <button @click="toggleSource">切换源码</button><button @click="insertImage">插入测试图片</button>
  <FindBar v-if="finding" :pane="pane" :revision="document.revision" :document-id="document.id" :source-mode="sourceMode" :replace-mode="replaceMode" :before-edit="settle" @close="finding = false" @error="error = $event" />
  <p v-if="error" role="alert">{{ error }}</p>
  <DocumentPane ref="pane" :document="document" active :editable="ready" :engine="editor" rich-active @change="change" />
  <MarkdownEditor v-show="!sourceMode" ref="editor" @ready="initialize" @session-change="event => change(event.markdown)" />
  <output aria-label="测试就绪">{{ ready ? 'ready' : 'loading' }}</output>
</template>
<script setup>
import { nextTick, reactive, ref } from 'vue'
import MarkdownEditor from '@frowang/editor'
import DocumentPane from '../../apps/desktop/src/renderer/DocumentPane.vue'
import FindBar from '../../apps/desktop/src/renderer/FindBar.vue'
const document = reactive({ id: 'search-probe', generation: 1, title: '查找测试', path: null, markdown: localStorage.getItem('search-probe') || '', revision: 0 })
const editor = ref(null), pane = ref(null), ready = ref(false), sourceMode = ref(false), finding = ref(false), replaceMode = ref(false), error = ref('')
function change(markdown) { if (document.markdown !== markdown) { document.markdown = markdown; document.revision++ } }
async function initialize() {
  await nextTick(); await editor.value.whenReady()
  editor.value.activateSession({ id: document.id, generation: document.generation, markdown: document.markdown, resolveImage: pane.value.resolveImage })
  ready.value = true
}
function showFind(replace) { replaceMode.value = replace; finding.value = true }
async function toggleSource() { sourceMode.value = await pane.value.toggleSource() }
function settle() { return editor.value.settleComposition() }
function insertImage() { pane.value.insertImages([{ src: `_frowd-assets/${'a'.repeat(64)}.png`, alt: '测试图片' }]) }
</script>
<style>
body { font: 14px/1.6 sans-serif; color: #333b38; background: #fffefa; }
.markdown-source { width: 100%; height: 500px; font: 16px/1.8 monospace; }
button { cursor: pointer; }
</style>
