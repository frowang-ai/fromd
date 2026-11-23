<template>
  <section v-if="state.visible" class="update-notice" :style="raised ? {bottom: '64px'} : null" role="status" aria-label="应用更新" aria-live="polite" :aria-busy="busy">
    <header><strong>应用更新</strong><button :disabled="busy" aria-label="关闭更新提示" @click="$emit('close')">×</button></header>
    <p v-if="state.phase === 'checking'">正在检查更新…</p>
    <p v-else-if="state.phase === 'upToDate'">当前已是最新版本（v{{ state.currentVersion }}）</p>
    <p v-else-if="state.phase === 'available'">发现新版本 <strong>v{{ state.version }}</strong></p>
    <template v-else-if="state.phase === 'downloading'">
      <p>正在下载更新 v{{ state.version }}<span v-if="state.total"> · {{ percent }}%</span>…</p>
      <progress :value="state.total ? state.downloaded : undefined" :max="state.total || 1" aria-label="更新下载进度"></progress>
    </template>
    <p v-else-if="state.phase === 'installing'">正在保存文稿并启动安装程序…</p>
    <p v-else-if="state.phase === 'opening'">正在打开更新下载页…</p>
    <p v-else-if="state.phase === 'error'" class="update-error">{{ state.error }}</p>
    <div class="update-actions" v-if="state.phase === 'available'">
      <button class="update-primary" :disabled="documentBusy" @click="$emit('update')">{{ state.platform === 'windows' ? '立即更新' : '前往下载更新' }}</button>
      <button @click="$emit('close')">稍后</button>
    </div>
    <div class="update-actions" v-else-if="state.phase === 'error'"><button class="update-primary" :disabled="documentBusy" @click="$emit('retry')">重试</button><button @click="$emit('close')">稍后</button></div>
  </section>
</template>
<script setup>
import {computed} from 'vue'
const props=defineProps({state:{type:Object,required:true},documentBusy:Boolean,raised:Boolean})
defineEmits(['update','retry','close'])
const busy=computed(()=>['checking','downloading','installing','opening'].includes(props.state.phase))
const percent=computed(()=>Math.min(100,Math.floor(props.state.downloaded/props.state.total*100)))
</script>
<style scoped>
.update-notice{position:fixed;left:12px;bottom:12px;z-index:60;width:min(330px,calc(100vw - 24px));box-sizing:border-box;padding:12px 14px;border:1px solid var(--reading-border);border-radius:8px;background:var(--reading-background);color:var(--reading-text);box-shadow:0 4px 20px #0003;font-size:13px;line-height:1.5}
header{display:flex;justify-content:space-between;align-items:center;gap:12px}header button{font-size:18px;padding:0 4px}.update-notice p{margin:8px 0;overflow-wrap:anywhere}.update-actions{display:flex;align-items:center;gap:10px;margin-top:10px}.update-actions button{padding:5px 10px;border:1px solid var(--reading-border);border-radius:4px}.update-actions .update-primary{background:var(--reading-accent);color:var(--reading-background);border-color:var(--reading-accent)}button:disabled{opacity:.55;cursor:default}progress{width:100%;height:7px;accent-color:var(--reading-accent)}.update-error{white-space:pre-wrap;max-height:160px;overflow:auto}
@media print{.update-notice{display:none!important}}
</style>
