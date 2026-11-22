<template>
 <div ref="root" class="editor-root pm-port" aria-label="Markdown 编辑区" @dragover.capture="resourceDragOver" @drop.capture="resourceDrop">
  <div v-show="mode==='rendered'" ref="scroller" class="pm-scroller" @scroll="cancelEndClick();emit('view-change')" @pointerdown.capture="endPointerDown" @pointermove.capture="endPointerMove" @pointercancel="cancelEndClick" @dragstart.capture="cancelEndClick" @click="endBlankClick">
   <MarkdownEditor ref="engine" link-navigation resource-import @resource-paste="resourcePaste" @resource-files="resourceFiles" :resolve-image="resolveImage" :is-composing="()=>composing" @ready="onEngineReady" @session-release="onEngineRelease" @session-change="changed" @view-change="emit('view-change')" @open-link="openLink" />
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
let lastActivation=null,engineDetached=false,engineRecovery=Promise.resolve()
let endClick=null
function cancelEndClick(){endClick=null}
function primaryEndClick(event){return event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey}
function endPointerDown(event){
 cancelEndClick()
 if(!owner||frozen.value||composing||mode.value!=='rendered'||event.isPrimary===false||!primaryEndClick(event))return
 const target=event.target
 if(!(target instanceof Element)||target.closest('button,a,input,textarea,[contenteditable="false"],.cm-editor,.writing-math,.writing-mermaid'))return
 const neutral=target===scroller.value||target.matches('.ProseMirror,.writing-editor,.milkdown')||target.closest('p')?.textContent===''
 if(!neutral)return
 const bounds=scroller.value.getBoundingClientRect()
 if(event.clientY<bounds.top||event.clientY>=bounds.bottom)return
 const plan=engine.value.prepareEndBlank({x:event.clientX,y:event.clientY})
 if(plan)endClick={owner,plan,x:event.clientX,y:event.clientY}
}
function endPointerMove(event){if(endClick&&Math.hypot(event.clientX-endClick.x,event.clientY-endClick.y)>5)cancelEndClick()}
function endBlankClick(event){
 const intent=endClick;cancelEndClick()
 if(!intent||intent.owner!==owner||frozen.value||composing||mode.value!=='rendered'||!primaryEndClick(event)||event.detail!==1||Math.hypot(event.clientX-intent.x,event.clientY-intent.y)>5)return
 if(engine.value.placeEndBlank(intent.plan))event.preventDefault()
}
const resolveImage=src=>/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)?src:resourceImageUrl(renderDocId,src)
async function ready(){await nextTick();await engine.value.whenReady();await engineRecovery;if(disposed)throw Error('编辑器已关闭。')}
function owns(event){return !disposed&&owner&&event?.id===owner.id&&event.generation===owner.generation}
function onEngineRelease(event){
 if(!owns(event))return
 cancelEndClick()
 if(mode.value==='rendered')changed(event)
 if(lastActivation)lastActivation.viewState={selection:event.selection,scrollTop:scroller.value?.scrollTop??0}
 engineDetached=true
}
function onEngineReady(){
 if(!owner||!lastActivation||disposed){editable();return}
 const current=owner,child=engine.value,document=lastActivation
 engineRecovery=(async()=>{
  await nextTick()
  if(disposed||owner!==current||engine.value!==child||lastActivation!==document)return
  child.activateSession({...current,markdown:sourceText.value,snapshot:null,viewState:document.viewState,resolveImage})
  child.restoreSessionView();engineDetached=false;editable()
  await nextTick()
  if(disposed||owner!==current||engine.value!==child)return
  scroller.value.scrollTop=document.viewState?.scrollTop??0
 })()
 // Keep recovery failure visible; ready()/freeze must also see the rejection.
 engineRecovery.catch(error=>{if(owns(current)&&engine.value===child)emit('navigation-hint',String(error?.message??error))})
}
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
function markdown(){
 if(mode.value==='source')return source.value?.value??sourceText.value
 if(engineDetached||!engine.value?.captureSession())throw Error('编辑器正在恢复，请稍后重试。')
 return engine.value.getMarkdown()
}
function capture(){
 if(!owner||disposed)return null
 const pm=engine.value?.captureSession()
 // An unready/remounted child is not an empty document. Never read its Markdown
 // into the coordinator's buffer until it owns an active rendered session.
 if(mode.value==='rendered'&&(engineDetached||!pm))return null
 const text=mode.value==='source'?(source.value?.value??sourceText.value):engine.value.getMarkdown()
 sourceText.value=text
 if(mode.value==='source'){sourceRange=sourceSelection();sourceScroll=source.value?.scrollTop??sourceScroll}
 const viewState={mode:mode.value,scrollTop:scroller.value?.scrollTop??0,selection:engine.value?.selection(),
  sourceSelection:sourceRange,sourceScrollTop:sourceScroll}
 if(lastActivation&&!engineDetached&&pm)lastActivation.viewState=viewState
 return {...owner,markdown:text,pm,sourceHistory:history,viewState}
}
async function activate(doc){
 await ready();cancelEndClick();owner=null;renderDocId=doc.id;editable()
 const cached=doc.session,saved=cached?.viewState||doc.viewState
 mode.value=saved?.mode||'rendered';sourceText.value=doc.markdown
 history=cached?.sourceHistory?.text===doc.markdown?cached.sourceHistory:sourceHistory(doc.markdown)
 sourceRange=saved?.sourceSelection||{start:0,end:0};sourceScroll=saved?.sourceScrollTop||0
 engine.value.activateSession({id:doc.id,generation:doc.generation,snapshot:cached?.pm,markdown:doc.markdown,viewState:saved,resolveImage})
 owner={id:doc.id,generation:doc.generation};const current=owner
 lastActivation={...owner,viewState:saved};engineDetached=false
 await nextTick();engine.value.restoreSessionView();editable()
 await new Promise(r=>requestAnimationFrame(r))
 if(owner!==current||disposed)return
 scroller.value.scrollTop=saved?.scrollTop||0
 source.value.setSelectionRange(sourceRange.start,sourceRange.end);source.value.scrollTop=sourceScroll
}
function setFrozen(value){if(value)cancelEndClick();frozen.value=value;editable()}
function changed(event){
 if(!owns(event)||mode.value!=='rendered'||engineDetached)return
 sourceText.value=event.markdown
 emit('change',event)
}
function beforeInput(event){
 if(event.inputType==='historyUndo'||event.inputType==='historyRedo'){
  event.preventDefault();undoSource(event.inputType==='historyRedo');return
 }
 beforeRange=sourceSelection()
}
function sourceChanged(event){
 if(disposed||!owner||mode.value!=='source'||frozen.value||event.target!==source.value)return
 sourceText.value=event.target.value
 if(event.isComposing||composing)return
 history=recordSource(history,sourceText.value,beforeRange);sourceRange=sourceSelection()
 emit('change',{...owner,markdown:sourceText.value})
}
function undoSource(redo){
 if(frozen.value||!owner||composing)return
 const result=travelSource(history,redo,sourceSelection());history=result.history;sourceText.value=history.text
 source.value.value=history.text;const s=result.selection||{start:history.text.length,end:history.text.length}
 sourceRange=s;source.value.setSelectionRange(s.start,s.end);emit('change',{...owner,markdown:history.text})
}
const sourcePairs={'$':'$','*':'*','_':'_','`':'`','~':'~','(':')','[':']','{':'}','"':'"',"'":"'"}
function sourceKey(event){
 if(event.isComposing||composing)return
 if((event.ctrlKey||event.metaKey)&&!event.altKey&&['z','y'].includes(event.key.toLowerCase())){
  event.preventDefault();undoSource(event.key.toLowerCase()==='y'||event.shiftKey);return
 }
 const input=source.value,closing=sourcePairs[event.key]
 if(mode.value!=='source'||frozen.value||!owner||input?.readOnly||event.ctrlKey||event.metaKey||event.altKey||!closing)return
 const range=sourceSelection()
 if(range.start>=range.end)return
 event.preventDefault()
 const text=input.value,next=text.slice(0,range.start)+event.key+text.slice(range.start,range.end)+closing+text.slice(range.end)
 history=recordSource(history,next,range);sourceText.value=next;input.value=next
 sourceRange={start:range.start+1,end:range.end+1}
 input.setSelectionRange(sourceRange.start,sourceRange.end)
 emit('change',{...owner,markdown:next})
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
 const sourcePosition=markdown().slice(0,offset).replace(/\r\n?/g,'\n').length
 sourceRange={start:sourcePosition,end:sourcePosition}
 if(mode.value==='source'){source.value.setSelectionRange(offset,offset);source.value.focus();source.value.scrollTop=Math.max(0,source.value.scrollHeight*offset/Math.max(1,markdown().length)-40)}
 else if(!engine.value.revealMarkdown(offset))emit('navigation-hint','已定位文稿；可从视图菜单打开源码查看精确位置。')
}
async function revealHeading(heading,expectedOwner){
 await ready()
 if(!owner||owner.id!==expectedOwner?.id||owner.generation!==expectedOwner.generation)return false
 if(mode.value==='source'){
  const position=markdown().slice(0,heading.start).replace(/\r\n?/g,'\n').length
  selectSourceMatch(position,position)
 }else{
  const element=engine.value.revealHeading(heading,owner)
  if(!element)return false
  const host=scroller.value,rect=host.getBoundingClientRect(),scale=rect.width/host.offsetWidth
  host.scrollTop=Math.max(0,host.scrollTop+(element.getBoundingClientRect().top-rect.top)/scale-12)
 }
 emit('view-change')
 return true
}
async function revealMatch(location){
 await ready()
 const text=markdown(),offset=sourceOffset(text,location),sourcePosition=text.slice(0,offset).replace(/\r\n?/g,'\n').length
 sourceRange={start:sourcePosition,end:sourcePosition+location.needle.replace(/\r\n?/g,'\n').length}
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
function resourceDropPosition(clientX,clientY){return engine.value?.resourceDropPosition(clientX,clientY)??null}
function droppedFiles(event){return Array.from(event.dataTransfer?.files||[])}
function droppedDirectory(event){return Array.from(event.dataTransfer?.items||[]).some(item=>item.kind==='file'&&item.webkitGetAsEntry?.()?.isDirectory)||droppedFiles(event).some(file=>file.webkitRelativePath)
}
function resourceDragOver(event){
 const files=droppedFiles(event)
 if(!files.length)return
 event.preventDefault()
 if(event.dataTransfer)event.dataTransfer.dropEffect='copy'
}
function resourceDrop(event){
 const files=droppedFiles(event)
 if(!files.length)return
 event.preventDefault();event.stopPropagation()
 if(!owner||frozen.value){emit('navigation-hint','当前文档正忙，请等待当前操作完成后再拖入资源。');return}
 if(droppedDirectory(event)){emit('navigation-hint','暂不支持拖入目录，请选择单个或多个文件。');return}
 if(mode.value==='source'){emit('navigation-hint','源码模式暂不支持按坐标拖入，请切换到正文模式。');return}
 const position=engine.value?.resourceDropPosition(event.clientX,event.clientY),dropState=engine.value?.resourceDropState?.()
 if(!Number.isInteger(position)){emit('navigation-hint','无法确定拖入位置，请拖到正文内容区域后重试。');return}
 emit('resource-files',{...owner,mode:mode.value,files,dropPosition:position,dropState})
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
async function insertResources(items,position=null,dropState=null,dropMode=null){
 if(!owner||!frozen.value||composing)throw Error('资源插入需要已冻结的文档会话。')
 if(dropMode&&dropMode!==mode.value)throw Error('拖入期间编辑模式已变化，请重新拖入。')
 const markup=resourceMarkdown(items)
 if(mode.value==='rendered')engine.value.insertResources(items,position,dropState)
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
const FIND_LIMIT=10000
function literalMatches(text,query,matchCase=false){if(!query)return {matches:[],limited:false};const fold=value=>matchCase?value:value.replace(/[A-Z]/g,c=>c.toLowerCase()),wanted=fold(query),matches=[];let at=0,folded=fold(text);while((at=folded.indexOf(wanted,at))>=0){matches.push({from:at,to:at+query.length});if(matches.length>=FIND_LIMIT)break;at+=query.length||1}return {matches,limited:matches.length>=FIND_LIMIT}}
function nextLiteralIndex(matches,from){const index=matches.findIndex(match=>match.from>=from);return index<0?0:index}
function replaceLiteral(text,matches,replacement){let out='',cursor=0;for(const match of matches){out+=text.slice(cursor,match.from)+replacement;cursor=match.to}return out+text.slice(cursor)}
function selectSourceMatch(from,to){
 const input=source.value,style=getComputedStyle(input),mirror=document.createElement('div'),marker=document.createElement('span')
 sourceRange={start:from,end:to};input.setSelectionRange(from,to)
 // A selection on the unfocused, frozen textarea does not scroll itself.
 // Measure wrapped lines without stealing focus from the find input.
 for(const property of ['font','lineHeight','letterSpacing','padding','boxSizing','wordBreak','overflowWrap','tabSize'])mirror.style[property]=style[property]
 Object.assign(mirror.style,{position:'absolute',visibility:'hidden',whiteSpace:'pre-wrap',width:`${input.clientWidth}px`,left:'-100000px'})
 mirror.textContent=input.value.slice(0,from);marker.textContent=input.value.slice(from,to)||'\u200b';mirror.append(marker);document.body.append(mirror)
 try{input.scrollTop=Math.max(0,marker.offsetTop-input.clientHeight/2)}finally{mirror.remove()}
}
function findReplace(query,index=0,reveal=true,matchCase=false){if(!owner||!query)return {count:0,index:-1,limited:false,mode:mode.value};if(mode.value==='source'){const found=literalMatches(markdown(),query,matchCase),matches=found.matches,selected=matches.length?matches[((index%matches.length)+matches.length)%matches.length]:null;if(selected&&reveal)selectSourceMatch(selected.from,selected.to);return {count:matches.length,limited:found.limited,index:selected?matches.indexOf(selected):-1,mode:mode.value}}return {...engine.value.findMatch(query,index,reveal,matchCase),mode:mode.value}}
function utf8Bytes(text){return new TextEncoder().encode(text).byteLength}
function replaceFind(query,replacement,index=0,all=false,matchCase=false){if(!owner||!query)return {count:0,replaced:0,index:-1,limited:false,mode:mode.value};if(mode.value==='source'){const text=markdown(),found=literalMatches(text,query,matchCase),matches=found.matches;if(!matches.length)return {count:0,replaced:0,index:-1,limited:found.limited,mode:mode.value};if(all&&found.limited)throw Error('匹配数量达到 10000 上限，未执行全部替换。');const count=all?matches.length:1;if(utf8Bytes(text)+(utf8Bytes(replacement)-utf8Bytes(query))*count>10*1024*1024)throw Error('替换结果超过 10 MiB 文稿上限。');let next=text,nextIndex=-1;if(all){next=replaceLiteral(text,matches,replacement);sourceRange={start:0,end:0}}else{const selected=matches[((index%matches.length)+matches.length)%matches.length];next=replaceLiteral(text,[selected],replacement);const after=literalMatches(next,query,matchCase);nextIndex=nextLiteralIndex(after.matches,selected.from+replacement.length);sourceRange={start:selected.from+replacement.length,end:selected.from+replacement.length}}if(utf8Bytes(next)>10*1024*1024)throw Error('替换结果超过 10 MiB 文稿上限。');history=recordSource(history,next,sourceSelection());sourceText.value=next;source.value.value=next;source.value.setSelectionRange(sourceRange.start,sourceRange.end);emit('change',{...owner,markdown:next});return {count:all?matches.length:literalMatches(next,query,matchCase).matches.length,replaced:all?matches.length:1,index:all?-1:nextIndex,limited:false,mode:mode.value}}const result=engine.value.replaceFind(query,replacement,index,all,matchCase);emit('change',{...owner,markdown:engine.value.getMarkdown()});return {...result,mode:mode.value}}
function prepareFileImport(source){return engine.value.prepareFileImport(source)}
function currentOwner(){return owner?{...owner,viewState:{mode:mode.value}}:null}
function clear(){cancelEndClick();owner=null;lastActivation=null;engineDetached=false;renderDocId=null;engine.value?.clearSession();sourceText.value='';history=sourceHistory('');editable()}
function focus(){if(mode.value==='source')source.value?.focus();else engine.value?.focus()}
function start(){composing=true}
function end(event){
 composing=false
 if(event.target===source.value)sourceChanged({target:source.value,isComposing:false})
}
onMounted(()=>{root.value.addEventListener('compositionstart',start);root.value.addEventListener('compositionend',end);ready().then(editable).catch(()=>{})})
onBeforeUnmount(()=>{disposed=true;owner=null;root.value?.removeEventListener('compositionstart',start);root.value?.removeEventListener('compositionend',end)})
defineExpose({currentOwner,revealHeading,findReplace,replaceFind,prepareFileImport,prepareResourcePaste,commitResourcePaste,insertResources,resourceDropPosition,ready,waitComposition,capture,activate,setFrozen,setMode,reveal,revealMatch,clear,focus})
</script>
<style>
.pm-port{min-height:0}.pm-scroller{height:100%;overflow:auto;padding:14px 36px 108px}.pm-scroller>.writing-editor{max-width:860px;margin:0 auto}
.pm-port .writing-editor .milkdown>.ProseMirror{min-height:calc(100dvh - 220px)}
/* Skip cursor decorations before the first document block. The name dock has its own row. */
.pm-port .writing-editor .milkdown>.ProseMirror>:nth-child(1 of :not(.ProseMirror-widget,.prosemirror-virtual-cursor)){margin-top:0}
.pm-port .markdown-source{display:block;resize:none;width:100%;height:100%;border:0;background:transparent;outline:none;padding:14px 36px 108px;font:15px/1.85 Consolas,'Microsoft YaHei',monospace;tab-size:4}
.pm-port .milkdown .ProseMirror .tableWrapper{overflow:visible}
@media(max-width:760px){.pm-scroller,.pm-port .markdown-source{padding-left:22px;padding-right:22px}}
@media print{.pm-scroller{overflow:visible;height:auto;padding-bottom:0}}
</style>
