<template>
  <section v-show="active" :id="`panel-${document.id}`" role="tabpanel" :aria-labelledby="`tab-${document.id}`" class="document-shell">
    <div class="document-meta">
      <input :value="document.title" aria-label="文档名称" placeholder="未命名笔记" @input="emit('change', { title: $event.target.value })" />
      <span class="save-status" role="status">{{ saveStatus }}</span>
    </div>
    <textarea v-show="sourceMode" ref="sourceInput" v-model="source" class="markdown-source" aria-label="Markdown 源码" spellcheck="false" @input="emit('change', { markdown: source })" />
    <ProbeWritingEditor v-show="!sourceMode" ref="editor" :model-value="document.markdown" @update:model-value="onMarkdown" @ready="emit('ready', $event)" @edit-source="emit('edit-source')" />
  </section>
</template>
<script setup>
import { nextTick, ref } from 'vue'
import ProbeWritingEditor from '@frowang/editor'
const props = defineProps({ document: { type: Object, required: true }, active: Boolean, saveStatus: String })
const emit = defineEmits(['change', 'ready', 'edit-source'])
const editor = ref(null), sourceInput = ref(null), source = ref(''), sourceMode = ref(false)
function onMarkdown(markdown) {
  // A delayed editor event must not overwrite newer text entered in source mode.
  if (!sourceMode.value) emit('change', { markdown })
}
function getMarkdown() { return sourceMode.value ? source.value : editor.value?.getMarkdown() ?? props.document.markdown }
async function toggleSource() {
  if (sourceMode.value) {
    editor.value.replaceMarkdown(source.value)
    emit('change', { markdown: source.value })
    sourceMode.value = false
  } else {
    source.value = getMarkdown()
    emit('change', { markdown: source.value })
    sourceMode.value = true
    await nextTick(); sourceInput.value.focus()
  }
  return sourceMode.value
}
defineExpose({ getMarkdown, toggleSource, sourceMode })
</script>
