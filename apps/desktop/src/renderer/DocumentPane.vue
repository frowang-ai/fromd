<template>
  <section v-show="active" ref="element" class="document-shell document-pane">
    <div class="document-meta">
      <input v-if="!document.path" :disabled="!editable" v-model="nameValue" class="draft-name" aria-label="草稿名称" :aria-invalid="!!document.nameError" placeholder="未命名笔记" @input="nameInput" @compositionstart="composing = true" @compositionend="endComposition" @blur="finishNameOnBlur" @keydown.enter="finishName" />
      <span v-else :title="document.path">{{ document.path }}</span>
      <span role="status" aria-label="自动保存状态">{{ status }}</span>
    </div>
    <textarea v-if="sourceCreated" :disabled="!editable" v-show="sourceMode" ref="sourceInput" v-model="source" class="markdown-source" aria-label="Markdown 源码" spellcheck="false" @input="sourceChanged" @compositionend="sourceChanged" />
  </section>
</template>
<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps({ document: { type: Object, required: true }, active: Boolean, editable: Boolean, status: String, engine: Object, richActive: Boolean })
const emit = defineEmits(['change', 'rename', 'finish-name'])
const element = ref(null)
const composing = ref(false), nameValue = ref(props.document.draftName ?? props.document.title)
watch(() => props.document.draftName ?? props.document.title, value => { if (!composing.value) nameValue.value = value })
function nameInput(event) { if (!event.isComposing && !composing.value) emit('rename', event.target.value) }
function endComposition(event) {
  composing.value = false; nameValue.value = event.target.value
  emit('rename', nameValue.value)
}
function finishNameOnBlur() {
  if (composing.value) return
  if (!nameValue.value.trim()) nameValue.value = '未命名笔记'
  emit('finish-name')
}
function finishName(event) {
  if (event.isComposing || composing.value) return
  event.preventDefault(); event.target.blur()
}
const sourceMode = ref(props.document.viewState?.mode === 'source'), source = ref(props.document.markdown ?? ''), sourceInput = ref(null)
const sourceCreated = ref(sourceMode.value)
let readingState = props.document.viewState, disposed = false
onBeforeUnmount(() => { disposed = true })
function sourceChanged(event) {
  if (!event.isComposing) { source.value = event.target.value; emit('change', source.value) }
}
function syncMarkdown(markdown) {
  if (typeof markdown !== 'string') return
  source.value = markdown
}
function resolveImage(src) {
  if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)) return src
  if (!props.document.path || !src || /^[a-z][\w+.-]*:|^[/\\]/i.test(src)) return null
  return `document-image://${props.document.id}/${encodeURIComponent(src)}`
}
function getMarkdown() { return sourceMode.value ? source.value : props.richActive ? props.engine?.getMarkdown() ?? props.document.markdown : props.document.markdown }
function captureViewState() {
  const input = sourceInput.value
  readingState = { mode: sourceMode.value ? 'source' : 'rendered', scrollTop: window.scrollY,
    ...(props.richActive ? { selection: props.engine?.selection() } : {}),
    ...(input ? { sourceSelection: { start: input.selectionStart, end: input.selectionEnd }, sourceScrollTop: input.scrollTop } : {}),
  }
  return readingState
}
async function restoreViewState(isCurrent) {
  await nextTick()
  await new Promise(resolve => requestAnimationFrame(resolve))
  if (!props.active || disposed || !isCurrent()) return false
  const saved = props.document.viewState || readingState
  readingState = saved
  if (sourceMode.value && sourceInput.value) {
    const input = sourceInput.value
    if (saved?.sourceSelection) input.setSelectionRange(saved.sourceSelection.start, saved.sourceSelection.end)
    input.scrollTop = saved?.sourceScrollTop || 0
  }
  window.scrollTo({ top: saved?.scrollTop || 0 })
  return true
}
async function toggleSource() {
  if (sourceMode.value) { await props.engine?.whenReady?.(); props.engine.replaceMarkdown(source.value); emit('change', source.value); sourceMode.value = false }
  else { source.value = getMarkdown(); sourceCreated.value = true; emit('change', source.value); sourceMode.value = true; await nextTick(); sourceInput.value.focus() }
  return sourceMode.value
}
function focusEditor() { if (sourceMode.value) sourceInput.value?.focus(); else props.engine?.focusSessionView() }
function focusName() { const input = element.value?.querySelector('.draft-name'); input?.focus(); input?.select() }
defineExpose({ getMarkdown, toggleSource, focusEditor, focusName, sourceMode, resolveImage, syncMarkdown, captureViewState, restoreViewState })
</script>
