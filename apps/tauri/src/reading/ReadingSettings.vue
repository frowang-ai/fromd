<template>
  <section class="reading-settings" role="dialog" aria-label="阅读设置" @keydown.esc.stop.prevent="$emit('close')">
    <header><span>阅读设置</span><button aria-label="关闭阅读设置" @click="$emit('close')">×</button></header>
    <label>正文字号
      <select ref="first" :value="preferences.fontSize" @change="$emit('change', {fontSize: Number($event.target.value)})">
        <option v-for="size in READING_FONT_SIZES" :key="size" :value="size">{{ size }} px</option>
      </select>
    </label>
    <label>正文宽度
      <select :value="preferences.width" @change="$emit('change', {width: Number($event.target.value)})">
        <option v-for="width in READING_WIDTHS" :key="width" :value="width">{{ width }} px{{ width === 860 ? '（默认）' : '' }}</option>
      </select>
    </label>
    <label>主题
      <select :value="preferences.theme" @change="$emit('change', {theme: $event.target.value})">
        <option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option>
      </select>
    </label>
    <p v-if="error" class="reading-settings-error" role="alert">{{ error }}</p>
  </section>
</template>
<script setup>
import { ref } from 'vue'
import { READING_FONT_SIZES, READING_WIDTHS } from './preferences.mjs'
defineProps({ preferences: {type: Object, required: true}, error: String })
defineEmits(['change', 'close'])
const first = ref(null)
defineExpose({ focus: () => first.value?.focus() })
</script>
