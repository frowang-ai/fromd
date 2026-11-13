<template>
  <section class="find-bar" role="search" aria-label="页内查找与替换" @keydown.esc.stop.prevent="$emit('close')">
    <div class="find-row">
      <input ref="queryInput" v-model="query" type="search" aria-label="查找正文" placeholder="查找正文" @keydown.enter="enterFind" />
      <span class="find-count" role="status">{{ status }}</span>
      <button :disabled="disabled || !result.count" aria-label="上一个匹配" @click="move(-1)">↑</button>
      <button :disabled="disabled || !result.count" aria-label="下一个匹配" @click="move(1)">↓</button>
      <button :aria-pressed="matchCase" aria-label="区分大小写" title="区分大小写" @click="matchCase = !matchCase">Aa</button>
      <button :aria-expanded="showReplace" @click="showReplace = !showReplace">替换</button>
      <button aria-label="关闭查找" @click="$emit('close')">×</button>
    </div>
    <div v-if="showReplace" class="find-row">
      <input v-model="replacement" aria-label="替换为" placeholder="替换为" @keydown.enter="enterReplace" />
      <button :disabled="disabled || !result.count" @click="replace(false)">替换当前</button>
      <button :disabled="disabled || !result.count || result.truncated" @click="replace(true)">全部替换</button>
    </div>
    <p v-if="result.truncated" class="find-limit">匹配超过 10,000 处，请缩小查找范围后再全部替换。</p>
  </section>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
const props = defineProps({ pane: Object, revision: Number, documentId: String, sourceMode: Boolean, disabled: Boolean, replaceMode: Boolean, beforeEdit: Function })
const emit = defineEmits(['close', 'error'])
const query = ref(''), replacement = ref(''), matchCase = ref(false), showReplace = ref(props.replaceMode), queryInput = ref(null)
const result = ref({ count: 0, index: -1, truncated: false }), replaced = ref(null)
let timer, disposed = false, changing = false, searchVersion = 0
const status = computed(() => {
  if (replaced.value !== null) return `已替换 ${replaced.value} 处`
  if (!query.value) return ''
  return result.value.count ? `${result.value.index + 1} / ${result.value.count}${result.value.truncated ? '+' : ''}` : '无匹配'
})
async function search(index = 0, select = true) {
  if (disposed || props.disabled || !props.pane) return
  const version = ++searchVersion, pane = props.pane, id = props.documentId, mode = props.sourceMode, text = query.value, sensitive = matchCase.value
  try {
    if (await props.beforeEdit?.() === false || disposed || version !== searchVersion || props.disabled || props.pane !== pane || props.documentId !== id || props.sourceMode !== mode || query.value !== text || matchCase.value !== sensitive) return
    result.value = pane.find(text, sensitive, index, select)
  }
  catch (error) { emit('error', error.message) }
}
function move(direction) { replaced.value = null; clearTimeout(timer); search(result.value.index + direction) }
function enterFind(event) { if (!event.isComposing) { event.preventDefault(); move(event.shiftKey ? -1 : 1) } }
function enterReplace(event) { if (!event.isComposing) { event.preventDefault(); void replace(false) } }
async function replace(all) {
  if (props.disabled || !props.pane) return
  const pane = props.pane, id = props.documentId, mode = props.sourceMode, text = query.value, value = replacement.value
  clearTimeout(timer); searchVersion++; changing = true
  try {
    if (await props.beforeEdit?.() === false || disposed || props.disabled || props.pane !== pane || props.documentId !== id || props.sourceMode !== mode || query.value !== text || replacement.value !== value) return
    const next = props.pane.replaceSearch(query.value, replacement.value, matchCase.value, result.value.index, all)
    result.value = next; replaced.value = next.replaced
  } catch (error) { emit('error', error.message) }
  finally { void nextTick(() => { changing = false }) }
}
async function focus(withReplace = props.replaceMode) {
  showReplace.value = withReplace || showReplace.value
  await nextTick(); queryInput.value?.focus(); queryInput.value?.select()
}
watch([query, matchCase], () => { replaced.value = null; clearTimeout(timer); timer = setTimeout(() => search(), 120) })
watch(() => props.replaceMode, value => { if (value) showReplace.value = true })
watch([() => props.documentId, () => props.sourceMode, () => props.pane], () => { replaced.value = null; void nextTick(() => search()) })
watch([() => props.revision, () => props.disabled], () => { if (!changing) { clearTimeout(timer); timer = setTimeout(() => search(result.value.index, false), 120) } })
onMounted(() => { void focus() })
onBeforeUnmount(() => { disposed = true; searchVersion++; clearTimeout(timer); props.pane?.clearSearch() })
defineExpose({ focus })
</script>
<style scoped>
.find-bar { position: sticky; top: 48px; z-index: 15; margin: 8px auto; width: min(780px, calc(100% - 32px)); padding: 8px 10px; background: var(--frowd-background, #fffefa); border: 1px solid var(--frowd-border, #dce3d9); border-radius: 6px; box-shadow: 0 3px 12px #27382912; }
.find-row { display: flex; align-items: center; gap: 4px; }
.find-row + .find-row { margin-top: 6px; }
.find-row input { min-width: 70px; flex: 1; padding: 6px 8px; color: inherit; background: transparent; border: 1px solid var(--frowd-border, #dce3d9); border-radius: 4px; }
.find-row button { flex-shrink: 0; padding: 5px 7px; }
.find-row button[aria-pressed=true] { background: var(--frowd-selected, #dceae1); }
.find-count { flex-shrink: 0; font-size: 12px; color: var(--frowd-muted, #728075); }
.find-limit { margin: 5px 0 0; font-size: 12px; }
@media (max-width: 600px) { .find-row { flex-wrap: wrap; } .find-row input { flex-basis: 50%; } }
</style>
