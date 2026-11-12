<template>
  <div ref="menu" role="menu" :aria-label="`${document.title} 页面操作`" class="tab-menu" :style="{ left: `${left}px`, top: `${top}px` }" @keydown="keydown" @contextmenu.prevent>
    <template v-for="item in items" :key="item.name">
      <div v-if="item.separator" role="separator" class="tab-menu-separator"></div>
      <button role="menuitem" :class="{ danger: item.name === 'remove' }" @click="$emit('action', item.name)">{{ item.label }}</button>
    </template>
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
const props = defineProps({ document: { type: Object, required: true }, x: Number, y: Number })
const emit = defineEmits(['action', 'close'])
const menu = ref(null), left = ref(props.x), top = ref(props.y)
const items = computed(() => [
  ...(!props.document.path ? [{ name: 'rename', label: '重命名' }] : []),
  { name: 'saveAs', label: props.document.path ? '另存为…' : '保存为 Markdown…' },
  { name: 'shelve', label: '收起此页', separator: true },
  { name: 'shelveOthers', label: '收起其他页' },
  { name: 'shelveAll', label: '收起全部页' },
  { name: 'remove', label: '移除页面', separator: true },
])
function outside(event) { if (!menu.value?.contains(event.target)) emit('close', false) }
function keydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close', true); return }
  if (event.key === 'Tab') { emit('close', false); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault(); event.stopPropagation()
  const buttons = [...menu.value.querySelectorAll('[role=menuitem]')], index = buttons.indexOf(document.activeElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}
onMounted(async () => {
  await nextTick()
  const bounds = menu.value.getBoundingClientRect()
  left.value = Math.max(8, Math.min(props.x, window.innerWidth - bounds.width - 8))
  top.value = Math.max(8, Math.min(props.y, window.innerHeight - bounds.height - 8))
  menu.value.querySelector('[role=menuitem]')?.focus({ preventScroll: true })
  window.addEventListener('pointerdown', outside, true)
  window.addEventListener('resize', dismiss)
  window.addEventListener('scroll', dismiss, true)
})
function dismiss() { emit('close', false) }
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outside, true)
  window.removeEventListener('resize', dismiss)
  window.removeEventListener('scroll', dismiss, true)
})
</script>
<style scoped>
.tab-menu { position:fixed; z-index:40; min-width:174px; max-width:calc(100vw - 16px); max-height:calc(100vh - 16px); overflow:auto; padding:5px; background:#fffefa; border:1px solid #dce3d9; border-radius:5px; box-shadow:0 4px 18px #27382920; }
.tab-menu button { display:block; width:100%; padding:5px 11px; text-align:left; font-size:12px; border-radius:3px; }
.tab-menu button:focus { outline:0; background:#edf2ed; }
.tab-menu button.danger { color:#9a554b; }
.tab-menu-separator { height:1px; margin:4px 5px; background:#e7ebe3; }
</style>
