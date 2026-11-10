<template>
  <section v-show="active" class="document-shell">
    <div class="document-meta">
      <input v-if="!document.path" v-model="nameValue" class="draft-name" aria-label="草稿名称" :aria-invalid="!!document.nameError" placeholder="未命名笔记" @input="nameInput" @compositionstart="composing = true" @compositionend="endComposition" @blur="finishNameOnBlur" @keydown.enter="finishName" />
      <span v-else :title="document.path">{{ document.path }}</span>
      <span role="status" aria-label="自动保存状态">{{ status }}</span>
    </div>
    <textarea v-show="sourceMode" ref="sourceInput" v-model="source" class="markdown-source" aria-label="Markdown 源码" spellcheck="false" @input="emit('change', source)" />
    <MarkdownEditor v-show="!sourceMode" ref="editor" :model-value="document.markdown" :resolve-image="resolveImage" @update:model-value="onMarkdown" @ready="emit('ready', $event)" />
  </section>
</template>
<script setup>
import { nextTick, ref, watch } from 'vue'
import MarkdownEditor from '@frowang/editor'
const props = defineProps({ document: { type: Object, required: true }, active: Boolean, status: String })
const emit = defineEmits(['change', 'ready', 'rename', 'finish-name'])
const composing = ref(false), nameValue = ref(props.document.draftName ?? props.document.title)
watch(() => props.document.draftName ?? props.document.title, value => { if (!composing.value) nameValue.value = value })
function nameInput(event) { if (!event.isComposing && !composing.value) emit('rename', event.target.value) }
function endComposition(event) {
  composing.value = false; nameValue.value = event.target.value
  emit('rename', nameValue.value)
}
function finishNameOnBlur() { if (!composing.value) emit('finish-name') }
function finishName(event) {
  if (event.isComposing || composing.value) return
  event.preventDefault(); event.target.blur()
}
const sourceMode = ref(false), source = ref(''), sourceInput = ref(null), editor = ref(null)
function resolveImage(src) {
  if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)) return src
  if (!props.document.path || !src || /^[a-z][\w+.-]*:|^[/\\]/i.test(src)) return null
  return `document-image://${props.document.id}/${encodeURIComponent(src)}`
}
function onMarkdown(text) { if (!sourceMode.value) emit('change', text) }
function getMarkdown() { return sourceMode.value ? source.value : editor.value?.getMarkdown() ?? props.document.markdown }
async function toggleSource() {
  if (sourceMode.value) { editor.value.replaceMarkdown(source.value); emit('change', source.value); sourceMode.value = false }
  else { source.value = getMarkdown(); emit('change', source.value); sourceMode.value = true; await nextTick(); sourceInput.value.focus() }
  return sourceMode.value
}
defineExpose({ getMarkdown, toggleSource, sourceMode, resolveImage })
</script>
