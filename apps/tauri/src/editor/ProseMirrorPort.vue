<template>
 <div ref="root" class="editor-root pm-port" aria-label="Markdown 编辑区">
  <div v-show="mode==='rendered'" ref="scroller" class="pm-scroller" @scroll="emit('view-change')">
   <MarkdownEditor ref="engine" link-navigation resource-import @resource-paste="resourcePaste" @resource-files="resourceFiles" :resolve-image="resolveImage" @session-change="changed" @view-change="emit('view-change')" @open-link="openLink" />
  </div>
  <textarea v-show="mode==='source'" ref="source" class="markdown-source" aria-label="Markdown 源码" spellcheck="false" :value="sourceText" :readonly="frozen||!owner"
   @paste="sourcePaste" @beforeinput="beforeInput" @input="sourceChanged" @keydown="sourceKey" @select="emit('view-change')" @scroll="emit('view-change')" />
 </div>
</template>
<script setup>
import {ref,nextTick,onMounted,onBeforeUnmount} from 'vue'
import MarkdownEditor from '@frowang/editor'
import {sourceOffset} from '@frowang/editor/location'
import {resourceImageUrl} from '../documents/host.mjs'
import {resourceMarkdown} from '../documents/resources.mjs'
import {sourceHistory,recordSource,travelSource} from './sourceHistory.mjs'
const emit=defineEmits(['change','view-change','navigation-hint','resource-files','resource-paste'])
const root=ref(null),engine=ref(null),scroller=ref(null),source=ref(null),sourceText=ref(''),mode=ref('rendered'),frozen=ref(false)
let renderDocId=null,owner=null,disposed=false,composing=false,history=sourceHistory(''),sourceRange={start:0,end:0},sourceScroll=0,beforeRange=sourceRange
const resolveImage=src=>/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)?src:resourceImageUrl(renderDocId,src)
async function ready(){await nextTick();await engine.value.whenReady();if(disposed)throw Error('编辑器已关闭。')}
function editable(){engine.value?.setEditable(Boolean(owner)&&!frozen.value&&mode.value==='rendered');if(root.value)root.value.inert=frozen.value;if(source.value)source.value.readOnly=frozen.value||!owner}
async function waitComposition(){
 await ready()
 for(let i=0;i<600&&composing;i++)await new Promise(r=>setTimeout(r,16))
 if(composing)throw Error('请先完成输入法组合输入，再重试。')
 await engine.value.settleComposition()
 // The compositionend input handler must finish before any owner/freeze change.
 await nextTick()
}
function sourceSelection(){return source.value?{start:source.value.selectionStart,end:source.value.selectionEnd}:sourceRange}
function markdown(){return mode.value==='source'?(source.value?.value??sourceText.value):engine.value.getMarkdown()}
function capture(){
 if(!owner)return null
 const text=markdown();if(mode.value==='source'){sourceRange=sourceSelection();sourceScroll=source.value?.scrollTop??sourceScroll}
 return {...owner,markdown:text,pm:engine.value.captureSession(),sourceHistory:history,viewState:{
  mode:mode.value,scrollTop:scroller.value?.scrollTop??0,selection:engine.value.selection(),
  sourceSelection:sourceRange,sourceScrollTop:sourceScroll
 }}
}
async function activate(doc){
 await ready();owner=null;renderDocId=doc.id;editable()
 const cached=doc.session,saved=cached?.viewState||doc.viewState
 mode.value=saved?.mode||'rendered';sourceText.value=doc.markdown
 history=cached?.sourceHistory?.text===doc.markdown?cached.sourceHistory:sourceHistory(doc.markdown)
 sourceRange=saved?.sourceSelection||{start:0,end:0};sourceScroll=saved?.sourceScrollTop||0
 engine.value.activateSession({id:doc.id,generation:doc.generation,snapshot:cached?.pm,markdown:doc.markdown,viewState:saved,resolveImage})
 owner={id:doc.id,generation:doc.generation};const current=owner
 await nextTick();engine.value.restoreSessionView();editable()
 await new Promise(r=>requestAnimationFrame(r))
 if(owner!==current||disposed)return
 scroller.value.scrollTop=saved?.scrollTop||0
 source.value.setSelectionRange(sourceRange.start,sourceRange.end);source.value.scrollTop=sourceScroll
}
function setFrozen(value){frozen.value=value;editable()}
function changed(event){
 if(!owner||mode.value!=='rendered'||event.id!==owner.id||event.generation!==owner.generation)return
 emit('change',event)
}
function beforeInput(event){
 if(event.inputType==='historyUndo'||event.inputType==='historyRedo'){
  event.preventDefault();undoSource(event.inputType==='historyRedo');return
 }
 beforeRange=sourceSelection()
}
function sourceChanged(event){
 if(!owner||mode.value!=='source'||frozen.value)return
 sourceText.value=event.target.value
 if(event.isComposing||composing)return
 history=recordSource(history,sourceText.value,beforeRange);sourceRange=sourceSelection()
 emit('change',{...owner,markdown:sourceText.value})
}
function undoSource(redo){
 if(frozen.value||!owner||composing)return
 const result=travelSource(history,redo,sourceSelection());history=result.history;sourceText.value=history.text
 source.value.value=history.text;const s=result.selection||{start:history.text.length,end:history.text.length}
 source.value.setSelectionRange(s.start,s.end);emit('change',{...owner,markdown:history.text})
}
function sourceKey(event){
 if(event.isComposing||composing)return
 if((event.ctrlKey||event.metaKey)&&!event.altKey&&['z','y'].includes(event.key.toLowerCase())){
  event.preventDefault();undoSource(event.key.toLowerCase()==='y'||event.shiftKey)
 }
}
async function setMode(value){
 await waitComposition()
 if(value===mode.value)return
 if(value==='source'){
  sourceText.value=engine.value.getMarkdown()
  if(history.text!==sourceText.value)history=sourceHistory(sourceText.value)
  mode.value='source';await nextTick();source.value.setSelectionRange(sourceRange.start,sourceRange.end);source.value.scrollTop=sourceScroll
 }else{
  const text=markdown();sourceRange=sourceSelection();sourceScroll=source.value.scrollTop
  if(engine.value.getMarkdown()!==text)engine.value.replaceMarkdown(text)
  mode.value='rendered';await nextTick()
 }
 editable();emit('view-change')
}
async function reveal(offset){
 await ready()
 sourceRange={start:offset,end:offset}
 if(mode.value==='source'){source.value.setSelectionRange(offset,offset);source.value.focus();source.value.scrollTop=Math.max(0,source.value.scrollHeight*offset/Math.max(1,markdown().length)-40)}
 else if(!engine.value.revealMarkdown(offset))emit('navigation-hint','已定位文稿；可从视图菜单打开源码查看精确位置。')
}
async function revealMatch(location){
 await ready()
 const offset=sourceOffset(markdown(),location);sourceRange={start:offset,end:offset+location.needle.length}
 source.value.setSelectionRange(sourceRange.start,sourceRange.end)
 if(mode.value==='source'){await reveal(offset);source.value.setSelectionRange(sourceRange.start,offset+location.needle.length)}
 else if(!engine.value.revealMarkdown(offset,location.needle))emit('navigation-hint','命中 Markdown 源文；可从视图菜单打开源码查看精确范围。')
}
function openLink(detail){
 if(!owner||detail.id!==owner.id||detail.generation!==owner.generation||frozen.value||mode.value!=='rendered')return
 window.dispatchEvent(new CustomEvent('frowd:open-link',{detail}))
}
function resourceFiles(event){
 if(!owner||frozen.value||event.id!==owner.id||event.generation!==owner.generation)return
 emit('resource-files',{...owner,files:event.files})
}
function sourcePaste(event){
 const files=Array.from(event.clipboardData?.files||[])
 if(files.length){event.preventDefault();if(owner&&!frozen.value)emit('resource-files',{...owner,files});return}
 const text=event.clipboardData?.getData('text/plain')||''
 if(!/(?:\.frowd-assets\/|blob:|frowd-resource[.:])/i.test(text))return
 event.preventDefault()
 if(owner&&!frozen.value)emit('resource-paste',{...owner,payload:{mode:'source',text}})
}
function resourcePaste(event){
 if(!owner||frozen.value||event.id!==owner.id||event.generation!==owner.generation)return
 emit('resource-paste',{...owner,payload:event.payload})
}
function prepareResourcePaste(payload){
 if(!owner||!frozen.value||payload.mode!==mode.value)throw Error('粘贴页面或模式已变化，请重试。')
 if(mode.value==='rendered'){const prepared=engine.value.prepareResourcePaste(payload);return {owner:{...owner},mode:mode.value,prepared,references:prepared.references}}
 const before=markdown(),range=sourceSelection(),text=payload.text
 const next=before.slice(0,range.start)+text+before.slice(range.end)
 const references=engine.value.resourceMarkdownReferences(next,{from:range.start,to:range.start+text.length},before)
 return {owner:{...owner},mode:mode.value,before,range,text,next,references}
}
async function commitResourcePaste(prepared){
 if(!owner||!frozen.value||prepared.owner.id!==owner.id||prepared.owner.generation!==owner.generation||prepared.mode!==mode.value)throw Error('粘贴归属已变化，请重试。')
 if(mode.value==='rendered')engine.value.commitResourcePaste(prepared.prepared)
 else {
  const range=sourceSelection()
  if(markdown()!==prepared.before||range.start!==prepared.range.start||range.end!==prepared.range.end)throw Error('正文或选区已变化，请重新粘贴。')
  history=recordSource(history,prepared.next,range);sourceText.value=prepared.next;source.value.value=prepared.next
  sourceRange={start:range.start+prepared.text.length,end:range.start+prepared.text.length}
  source.value.setSelectionRange(sourceRange.start,sourceRange.end)
  emit('change',{...owner,markdown:prepared.next})
 }
}
async function insertResources(items){
 if(!owner||!frozen.value||composing)throw Error('资源插入需要已冻结的文档会话。')
 const markup=resourceMarkdown(items)
 if(mode.value==='rendered')engine.value.insertResources(items)
 else {
  const range=sourceSelection(),text=markdown()
  const next=text.slice(0,range.start)+markup+text.slice(range.end)
  history=recordSource(history,next,range)
  sourceText.value=next;source.value.value=next
  sourceRange={start:range.start+markup.length,end:range.start+markup.length}
  source.value.setSelectionRange(sourceRange.start,sourceRange.end)
  emit('change',{...owner,markdown:next})
 }
}
function clear(){owner=null;renderDocId=null;engine.value?.clearSession();sourceText.value='';history=sourceHistory('');editable()}
function focus(){if(mode.value==='source')source.value?.focus();else engine.value?.focus()}
function start(){composing=true}
function end(event){
 composing=false
 if(event.target===source.value)sourceChanged({target:source.value,isComposing:false})
}
onMounted(()=>{root.value.addEventListener('compositionstart',start);root.value.addEventListener('compositionend',end);ready().then(editable).catch(()=>{})})
onBeforeUnmount(()=>{disposed=true;owner=null;root.value?.removeEventListener('compositionstart',start);root.value?.removeEventListener('compositionend',end)})
defineExpose({prepareResourcePaste,commitResourcePaste,insertResources,ready,waitComposition,capture,activate,setFrozen,setMode,reveal,revealMatch,clear,focus})
</script>
<style>
.pm-port{min-height:0}.pm-scroller{height:100%;overflow:auto;padding:46px 36px 108px}.pm-scroller>.writing-editor{max-width:860px;margin:0 auto}
.pm-port .writing-editor .milkdown>.ProseMirror{min-height:calc(100dvh - 220px)}
.pm-port .markdown-source{display:block;resize:none;width:100%;height:100%;border:0;background:transparent;outline:none;padding:46px 36px 108px;font:15px/1.85 Consolas,'Microsoft YaHei',monospace;tab-size:4}
.pm-port .milkdown .ProseMirror .tableWrapper{overflow:visible}
@media(max-width:760px){.pm-scroller,.pm-port .markdown-source{padding-left:22px;padding-right:22px}}
@media print{.pm-scroller{overflow:visible;height:auto;padding-bottom:0}}
</style>
