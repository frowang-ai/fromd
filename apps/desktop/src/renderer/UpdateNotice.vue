<template>
  <aside class="update-notice" aria-label="应用更新" :inert="busy">
    <span role="status" aria-live="polite">{{ label }}</span>
    <button v-if="['idle', 'current'].includes(state.status)" @click="act('check')">检查更新</button>
    <button v-if="state.status === 'available'" @click="act('download')">下载更新</button>
    <template v-if="state.status === 'ready' && !later">
      <button @click="act('restart')">重启更新</button><button @click="later = true">稍后</button>
    </template>
    <button v-if="state.status === 'ready' && later" @click="later = false">查看更新</button>
    <button v-if="state.status === 'error'" @click="act(state.version ? 'download' : 'check')">重试更新</button>
  </aside>
</template>
<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
defineProps({ busy: Boolean })
const api = window.desktop.updates
const state = ref({ status: 'idle', currentVersion: '', message: '' }), later = ref(false)
let dispose
const label = computed(() => {
  const s = state.value
  if (s.status === 'disabled') return `更新未启用 · ${s.message}`
  if (s.status === 'available') return `发现新版本 ${s.version}`
  if (s.status === 'downloading') return `正在下载 ${s.version} · ${Math.floor(s.progress)}%`
  if (s.status === 'ready') return s.message || `新版本 ${s.version} 已准备好`
  if (s.status === 'checking') return '正在检查更新…'
  return s.message || `版本 ${s.currentVersion}`
})
async function act(action) {
  try { state.value = await api[action]() }
  catch (error) { state.value = { ...state.value, status: 'error', message: error.message } }
}
onMounted(async () => {
  dispose = api.onChanged(value => { state.value = value })
  state.value = await api.state()
})
onBeforeUnmount(() => dispose?.())
</script>
<style scoped>
.update-notice { position: fixed; left: 10px; bottom: 8px; z-index: 30; max-width: calc(100vw - 20px); display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: center; padding: 4px 8px; border-radius: 6px; background: #fffefaee; color: #7b877f; font-size: 11px; }
.update-notice button { padding: 2px 6px; font-size: 11px; }
</style>
