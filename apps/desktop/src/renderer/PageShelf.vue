<template>
  <div class="shelf-dismiss" @click="$emit('close')" aria-hidden="true"></div>
  <aside class="page-shelf" aria-label="页面列表" :inert="busy" @keydown.esc.stop.prevent="$emit('close')">
    <div class="shelf-heading"><h2>页面</h2><button aria-label="收起页面列表" @click="$emit('close')">‹</button></div>
    <input ref="searchInput" v-model="search" class="shelf-search" aria-label="搜索页面" placeholder="搜索页面" />
    <div class="shelf-filters">
      <button :aria-pressed="!onlyShelved" @click="onlyShelved = false">全部 {{ documents.length }}</button>
      <button :aria-pressed="onlyShelved" @click="onlyShelved = true">已收起 {{ documents.filter(doc => doc.shelved).length }}</button>
    </div>
    <div ref="list" class="shelf-list">
      <article v-for="doc in filtered" :key="doc.id" :data-page-id="doc.id" class="page-card" :class="{ current: doc.id === activeId }">
        <button class="page-card-open" :aria-label="`打开 ${doc.title}`" @click="$emit('open', doc.id)">
          <div class="page-thumbnail" aria-hidden="true" inert>
            <div v-if="visible.has(doc.id)" class="page-thumbnail-content" v-html="preview(doc)"></div>
          </div>
          <span class="page-card-caption"><span>{{ doc.title }}</span><small>{{ doc.id === activeId ? '当前' : doc.shelved ? '已收起' : '已打开' }}</small></span>
        </button>
        <button class="page-card-delete" :aria-label="`${doc.path ? '移除' : '删除'} ${doc.title}`" :title="doc.path ? '移除页面' : '删除页面'" @click="$emit('remove', doc.id)">×</button>
      </article>
      <p v-if="!filtered.length" class="shelf-empty">{{ search ? '没有匹配的页面' : onlyShelved ? '没有已收起的页面' : '暂无页面' }}</p>
    </div>
  </aside>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { renderMarkdown } from '@frowang/editor/markdown'
const props = defineProps({ documents: { type: Array, required: true }, activeId: String, busy: Boolean })
defineEmits(['open', 'remove', 'close'])
const search = ref(''), onlyShelved = ref(false), list = ref(null), searchInput = ref(null)
const visible = reactive(new Set()), cache = new Map()
const filtered = computed(() => props.documents.filter(doc => (!onlyShelved.value || doc.shelved) && doc.title.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))
let observer
function focusSearch() { searchInput.value?.focus({ preventScroll: true }) }
defineExpose({ focusSearch })
function preview(doc) {
  const text = (doc.markdown ?? doc.preview ?? '').slice(0, 1200)
  if (cache.get(doc.id)?.text !== text) {
    const template = document.createElement('template')
    template.innerHTML = renderMarkdown(text)
    // Thumbnails are inert, bounded text previews: don't load images, media or embedded controls.
    template.content.querySelectorAll('img,svg,video,audio,iframe,input,button,textarea,select').forEach(node => node.remove())
    cache.set(doc.id, { text, html: template.innerHTML || '<p>空白页面</p>' })
  }
  return cache.get(doc.id).html
}
async function observe() {
  await nextTick()
  observer?.disconnect()
  list.value?.querySelectorAll('[data-page-id]').forEach(node => observer?.observe(node))
  const ids = new Set(props.documents.map(doc => doc.id))
  for (const id of cache.keys()) if (!ids.has(id)) { cache.delete(id); visible.delete(id) }
}
onMounted(() => {
  observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) visible.add(entry.target.dataset.pageId) }), { root: list.value, rootMargin: '120px' })
  void observe(); focusSearch()
})
watch(filtered, observe)
onBeforeUnmount(() => observer?.disconnect())
</script>
<style scoped>
.shelf-dismiss { position:fixed; inset:48px 0 0; z-index:24; }
.page-shelf { position:fixed; left:12px; top:58px; bottom:42px; width:min(284px,calc(100vw - 24px)); display:flex; flex-direction:column; padding:12px; background:#fffefa; border:1px solid #dce3d9; border-radius:5px; box-shadow:0 4px 18px #27382916; z-index:25; }
.shelf-heading { display:flex; align-items:center; justify-content:space-between; margin-bottom:9px; }
.shelf-heading h2 { margin:0; font-size:14px; font-weight:500; }
.shelf-heading button { padding:0 7px; font-size:22px; line-height:1.2; }
.shelf-search { width:100%; padding:5px 8px; border:1px solid #e3e7df; border-radius:3px; background:transparent; color:#53645d; font-size:12px; }
.shelf-filters { display:flex; gap:12px; margin:8px 0 12px; }
.shelf-filters button { padding:3px 0; font-size:11px; color:#899486; border-radius:0; border-bottom:1px solid transparent; }
.shelf-filters button[aria-pressed=true] { color:#536f59; border-color:#71917e; }
.shelf-list { overflow-y:auto; min-height:0; scrollbar-width:thin; padding:1px 3px; }
.page-card { position:relative; margin-bottom:14px; }
.page-card-open { display:block; width:100%; padding:0; text-align:left; }
.page-card-open:hover { background:transparent; }
.page-thumbnail { height:140px; overflow:hidden; border:1px solid #e3e7df; border-radius:3px; background:#fffefa; pointer-events:none; position:relative; }
.page-thumbnail::after { content:''; position:absolute; left:0; right:0; bottom:0; height:16px; background:linear-gradient(transparent,#fffefa); }
.page-card.current .page-thumbnail, .page-card-open:hover .page-thumbnail { border-color:#91a58b; }
.page-thumbnail-content { width:650px; padding:25px 38px; transform:scale(.38); transform-origin:top left; color:#333b38; font-size:15px; line-height:1.7; overflow-wrap:anywhere; }
.page-thumbnail-content :deep(*) { max-width:100%; }
.page-thumbnail-content :deep(h1) { font-size:25px; }
.page-thumbnail-content :deep(h2) { font-size:21px; }
.page-thumbnail-content :deep(pre) { white-space:pre-wrap; }
.page-thumbnail-content :deep(blockquote) { padding-left:15px; border-left:2px solid #b6c7af; margin-inline:0; }
.page-card-caption { display:flex; align-items:center; gap:8px; padding:5px 1px 0; color:#53645d; font-size:11px; }
.page-card-caption > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.page-card-caption small { margin-left:auto; flex-shrink:0; color:#949e8e; font-size:10px; }
.page-card-delete { position:absolute; right:4px; top:4px; width:25px; height:25px; padding:0; line-height:1; font-size:17px; color:#8b958c; background:#fffefaeb; border-radius:3px; }
.page-card-delete:hover { color:#a35248; background:#f8eae5; }
.shelf-empty { margin:24px 0; text-align:center; color:#899486; font-size:12px; }
</style>
