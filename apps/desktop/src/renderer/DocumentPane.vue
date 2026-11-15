<template>
  <section v-show="active" class="document-shell document-pane">
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
import { findTextMatches } from '@frowang/editor/search'
const props = defineProps({ document: { type: Object, required: true }, active: Boolean, editable: Boolean, status: String, engine: Object, richActive: Boolean })
const emit = defineEmits(['change', 'rename', 'finish-name'])
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
  if (/^_frowd-assets\/[0-9a-f]{64}\.(png|jpg|gif|webp)$/.test(src)) return `document-image://${props.document.id}/${encodeURIComponent(src)}`
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
function selectSourceRange(from, to) {
  const input = sourceInput.value
  if (!input) return false
  input.setSelectionRange(from, to)
  // Measure wrapped source lines with the textarea's actual width and font.
  const mirror = document.createElement('div'), marker = document.createElement('span'), style = getComputedStyle(input)
  for (const property of ['font', 'lineHeight', 'letterSpacing', 'padding', 'boxSizing', 'wordBreak', 'overflowWrap']) mirror.style[property] = style[property]
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', width: `${input.clientWidth}px`, left: '-100000px' })
  mirror.textContent = input.value.slice(0, from)
  marker.textContent = input.value.slice(from, to) || '\u200b'
  mirror.append(marker); document.body.append(mirror)
  input.scrollTop = Math.max(0, marker.offsetTop - input.clientHeight / 2)
  mirror.remove(); input.scrollIntoView({ block: 'nearest' })
  return true
}
function find(query, matchCase = false, index = 0, select = true) {
  if (!sourceMode.value) return props.engine.find(query, matchCase, index, select)
  const result = findTextMatches(source.value, query, matchCase), count = result.matches.length
  const selected = count ? ((index % count) + count) % count : -1
  const match = result.matches[selected]
  if (match && select) selectSourceRange(match.from, match.to)
  return { count, index: selected, truncated: result.truncated }
}
function replaceSourceRange(from, to, replacement) {
  const input = sourceInput.value, focused = document.activeElement
  const wasDisabled = input.disabled, inertAncestors = []
  for (let element = input.parentElement; element; element = element.parentElement) {
    if (element.inert) { inertAncestors.push(element); element.inert = false }
  }
  try {
    // Import commands hold the async command lock. Temporarily permit this
    // synchronous native edit so source insertions retain Chromium undo history.
    input.disabled = false; input.focus({ preventScroll: true }); input.setSelectionRange(from, to)
    if (!document.execCommand('insertText', false, replacement)) input.setRangeText(replacement, from, to, 'end')
    source.value = input.value; emit('change', source.value)
  } finally {
    input.disabled = wasDisabled
    for (const element of inertAncestors) element.inert = true
    if (focused !== input) focused?.focus({ preventScroll: true })
  }
}
function replaceSearch(query, replacement, matchCase = false, index = 0, all = false) {
  if (!props.editable) return { count: 0, index: -1, replaced: 0, truncated: false }
  if (!sourceMode.value) {
    const result = props.engine.replaceSearch(query, replacement, matchCase, index, all)
    emit('change', props.engine.getMarkdown())
    return result
  }
  const result = findTextMatches(source.value, query, matchCase), count = result.matches.length
  if (all && result.truncated) throw new Error('匹配超过 10,000 处，请缩小查找范围后再全部替换。')
  if (!count) return { count: 0, index: -1, replaced: 0, truncated: false }
  const selected = ((index % count) + count) % count
  if (all) {
    const parts = []
    let previous = 0
    for (const match of result.matches) { parts.push(source.value.slice(previous, match.from), replacement); previous = match.to }
    parts.push(source.value.slice(previous))
    replaceSourceRange(0, source.value.length, parts.join(''))
  } else {
    const match = result.matches[selected]
    replaceSourceRange(match.from, match.to, replacement)
  }
  const nextMatches = findTextMatches(source.value, query, matchCase).matches
  const nextIndex = all ? 0 : Math.max(0, nextMatches.findIndex(match => match.from >= result.matches[selected].from + replacement.length))
  return { ...find(query, matchCase, nextIndex), replaced: all ? count : 1 }
}
function clearSearch() { props.engine?.clearSearch() }
function insertImages(sources, dropPoint) {
  if (!sourceMode.value) {
    props.engine.insertImages(sources, dropPoint); emit('change', props.engine.getMarkdown()); return
  }
  const markdown = sources.map(source => {
    const image = typeof source === 'string' ? { src: source, alt: '' } : source
    return `![${(image.alt || '').replace(/[\[\]\\]/g, '\\$&')}](${image.src})`
  }).join('\n')
  replaceSourceRange(sourceInput.value.selectionStart, sourceInput.value.selectionEnd, markdown)
}
function goToHeading({ index, offset }) {
  if (!sourceMode.value) return props.engine.goToHeading(index)
  const selected = selectSourceRange(offset, offset)
  if (selected) sourceInput.value.focus({ preventScroll: true })
  return selected
}
defineExpose({ getMarkdown, toggleSource, focusEditor, sourceMode, resolveImage, syncMarkdown, captureViewState, restoreViewState,
  find, replaceSearch, clearSearch, selectSourceRange, insertImages, goToHeading })
</script>
