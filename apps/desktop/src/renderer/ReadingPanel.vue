<template>
  <aside class="reading-panel" aria-label="阅读工具" @keydown.esc.stop.prevent="$emit('close')">
    <header class="reading-panel-header">
      <div class="reading-panel-tabs" role="tablist" aria-label="阅读工具选项" @keydown="switchTab">
        <button ref="outlineTab" role="tab" id="reading-outline-tab" :aria-selected="mode === 'outline'" :tabindex="mode === 'outline' ? 0 : -1" aria-controls="reading-outline" @click="$emit('mode', 'outline')">大纲</button>
        <button ref="settingsTab" role="tab" id="reading-settings-tab" :aria-selected="mode === 'settings'" :tabindex="mode === 'settings' ? 0 : -1" aria-controls="reading-settings" @click="$emit('mode', 'settings')">阅读设置</button>
      </div>
      <button class="reading-close" aria-label="关闭阅读工具" @click="$emit('close')">×</button>
    </header>
    <section v-if="mode === 'outline'" id="reading-outline" role="tabpanel" aria-labelledby="reading-outline-tab" class="reading-outline">
      <p v-if="!headings.length" class="reading-empty">添加标题后，大纲会显示在这里。</p>
      <ol v-else aria-label="文档大纲">
        <li v-for="heading in headings" :key="heading.index">
          <button :disabled="busy" :style="{ paddingInlineStart: `${8 + (heading.level - 1) * 12}px` }" :title="heading.text" @click="$emit('navigate', heading)">{{ heading.text }}</button>
        </li>
      </ol>
    </section>
    <section v-else id="reading-settings" role="tabpanel" aria-labelledby="reading-settings-tab" class="reading-settings">
      <label>正文字号
        <select :value="preferences.fontSize" @change="$emit('preferences', { fontSize: Number($event.target.value) })">
          <option v-for="size in READING_FONT_SIZES" :key="size" :value="size">{{ size }} px</option>
        </select>
      </label>
      <label>正文宽度
        <select :value="preferences.width" @change="$emit('preferences', { width: Number($event.target.value) })">
          <option v-for="width in READING_WIDTHS" :key="width" :value="width">{{ width }} px</option>
        </select>
      </label>
      <label>主题
        <select :value="preferences.theme" @change="$emit('preferences', { theme: $event.target.value })">
          <option value="light">浅色</option>
          <option value="dark">深色</option>
          <option value="system">跟随系统</option>
        </select>
      </label>
      <p v-if="storageError" class="reading-error" role="alert">{{ storageError }}</p>
    </section>
  </aside>
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { READING_FONT_SIZES, READING_WIDTHS } from './readingPreferences.js'
const props = defineProps({
  mode: { type: String, default: 'outline' },
  headings: { type: Array, default: () => [] },
  preferences: { type: Object, required: true },
  busy: Boolean,
  storageError: { type: String, default: '' },
})
const emit = defineEmits(['mode', 'close', 'navigate', 'preferences'])
const outlineTab = ref(null), settingsTab = ref(null)
function focus() { (props.mode === 'outline' ? outlineTab : settingsTab).value?.focus() }
async function switchTab(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const mode = event.key === 'Home' ? 'outline' : event.key === 'End' ? 'settings' : props.mode === 'outline' ? 'settings' : 'outline'
  emit('mode', mode)
  await nextTick()
  focus()
}
defineExpose({ focus })
</script>

<style scoped>
.reading-panel { position: fixed; top: 58px; right: 12px; z-index: 25; width: min(300px, calc(100vw - 24px)); max-height: calc(100vh - 100px); display: flex; flex-direction: column; background: var(--frowd-background, #fffefa); color: var(--frowd-text, #333b38); border: 1px solid var(--frowd-border, #dce3d9); border-radius: 5px; box-shadow: 0 4px 18px #0002; }
.reading-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 9px 10px; border-bottom: 1px solid var(--frowd-border, #dce3d9); }
.reading-panel-tabs { display: flex; gap: 6px; }
.reading-panel-tabs button { padding: 5px 8px; font-size: 12px; }
.reading-panel-tabs [aria-selected=true] { color: var(--frowd-accent, #3c7161); background: var(--frowd-selected, #e4eee8); }
.reading-close { padding: 0 6px; font-size: 20px; line-height: 1.2; }
.reading-outline { overflow-y: auto; padding: 8px; scrollbar-width: thin; }
.reading-outline ol { margin: 0; padding: 0; list-style: none; }
.reading-outline button { width: 100%; text-align: left; padding: 6px 8px; font-size: 12px; overflow-wrap: anywhere; }
.reading-empty { margin: 8px; color: var(--frowd-muted, #849085); font-size: 12px; }
.reading-settings { padding: 16px; display: grid; gap: 16px; }
.reading-settings label { display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 12px; }
.reading-settings select { min-width: 120px; padding: 5px 8px; border: 1px solid var(--frowd-border, #dce3d9); border-radius: 3px; background: var(--frowd-background, #fffefa); color: inherit; font: inherit; }
.reading-settings select:focus-visible { outline: 2px solid var(--frowd-accent, #3c7161); outline-offset: 2px; }
.reading-error { margin: 0; color: var(--frowd-warning, #735d33); font-size: 12px; }
</style>
