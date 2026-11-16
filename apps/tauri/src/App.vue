<template>
  <div class="app-shell" :data-theme="readingTheme" :style="readingStyle(readingPreferences)" @dragover.capture="guardExternalFileDrag" @drop.capture="guardExternalFileDrop">
    <header class="app-header">
      <div class="brand"><img src="./assets/icon.png" alt="" /><span>frowd</span></div>
      <nav class="app-menu" aria-label="应用菜单">
        <details ref="fileMenu"><summary>文件</summary><div class="menu-popup">
          <button @click="action(() => coordinator.create())">新建页面 <kbd>Ctrl+N</kbd></button>
          <button @click="action(() => coordinator.open())">打开… <kbd>Ctrl+O</kbd></button>
          <button :disabled="state.busy || !state.loaded" @click="action(() => coordinator.importFile())">导入 TXT / HTML…</button>
          <button :disabled="!current" @click="action(() => coordinator.save())">保存 <kbd>Ctrl+S</kbd></button>
          <button :disabled="!current" @click="action(() => coordinator.save(state.activeId, true))">另存为… <kbd>Ctrl+Shift+S</kbd></button>
          <button :disabled="!current || state.busy" @click="insertResource(null, 'image')">插入图片…</button>
          <button :disabled="!current || state.busy" @click="insertResource(null, 'attachment')">插入附件…</button>
          <button :disabled="!current" @click="removePage(state.activeId)">移除当前页面</button>
        </div></details>
        <details><summary>编辑</summary><div class="menu-popup">
          <button @click="openFind">查找 / 替换… <kbd>Ctrl+F / Ctrl+H</kbd></button>
        </div></details>
        <details><summary>视图</summary><div class="menu-popup">
          <button :disabled="!current" @click="setMode('rendered')">正文 <span v-if="mode === 'rendered'">✓</span></button>
          <button :disabled="!current" @click="setMode('source')">源码 <kbd>Ctrl+Shift+M</kbd><span v-if="mode === 'source'">✓</span></button>
          <button @click="sidebarOpen = !sidebarOpen; closeMenus()">{{ sidebarOpen ? '隐藏' : '显示' }}工作栏</button>
          <button :disabled="state.busy || !state.loaded" @click="openReading">阅读设置… <kbd>Ctrl+,</kbd></button>
        </div></details>
      </nav>
      <span class="window-document">{{ current?.title || 'frowd' }}</span>
      <button ref="readingButton" class="reading-button" :disabled="state.busy || !state.loaded" :aria-expanded="readingOpen" aria-label="阅读设置" @click="openReading">阅读</button>
    </header>

    <div class="workspace">
      <button v-if="sidebarOpen && narrow" class="drawer-dismiss" aria-label="关闭工作栏遮罩" @click="sidebarOpen = false"></button>
      <aside v-show="sidebarOpen" class="sidebar" :class="{ drawer: narrow }" aria-label="页面工作栏">
        <div class="sidebar-top"><div class="sidebar-switch">
          <button :aria-pressed="sidebarMode === 'pages'" @click="sidebarMode = 'pages'">页面</button>
          <button :aria-pressed="sidebarMode === 'outline'" @click="sidebarMode = 'outline'">大纲</button>
        </div><button class="sidebar-hide" aria-label="隐藏工作栏" @click="sidebarOpen = false">‹</button></div>
        <template v-if="sidebarMode === 'pages'">
          <input v-model="query" type="search" class="page-search" aria-label="搜索全部页面" placeholder="搜索名称或正文" maxlength="512" />
          <section v-if="query.trim()" class="search-results" aria-label="全文搜索结果" aria-live="polite">
            <p class="search-status">{{ state.searchError || (state.searching ? '搜索中…' : '匹配 ' + state.searchResults.length + ' 个页面（最多 100）') }}</p>
            <button v-if="state.searchError" class="search-retry" :disabled="state.busy" @click="search.request(query)">重试搜索</button>
            <button v-for="result in state.searchResults" :key="result.id" class="search-result" :data-result-id="result.id" :disabled="state.busy" @click="selectResult(result)">
              <span>{{ result.title }}<small v-if="result.shelved"> · 已收起</small></span><small>{{ result.snippet }}</small>
            </button>
          </section>
          <section v-show="!query.trim()" class="page-group" aria-label="已展开页面">
            <div class="group-heading"><span>已展开 {{ opened.length }}</span><button class="expand-all" :disabled="!shelved.length || state.busy" @click="action(() => coordinator.layout('expand'))">全部展开</button></div>
            <div v-for="doc in filteredOpened" :key="doc.id" class="page-row" :class="{ active: doc.id === state.activeId }" :data-page-id="doc.id" @contextmenu.prevent="contextPage = doc.id">
              <button class="page-title" :disabled="state.busy || !state.loaded" @click="selectPage(doc.id)"><span class="page-symbol">▤</span>{{ doc.title }}</button>
              <button class="row-minus" :disabled="state.busy || !state.loaded" :aria-label="'侧栏收起 ' + doc.title" title="收起" @click="collapse(doc.id)">−</button>
              <button class="row-more" :disabled="state.busy || !state.loaded" :aria-label="'页面菜单 ' + doc.title" @click="contextPage = contextPage === doc.id ? null : doc.id">⋯</button>
            </div>
            <p v-if="!filteredOpened.length" class="empty-list">{{ query ? '没有匹配页面' : '没有已展开页面' }}</p>
          </section>
          <section v-show="!query.trim()" class="page-group shelved-group" aria-label="已收起页面">
            <div class="group-heading"><span>已收起 {{ shelved.length }}</span></div>
            <div v-for="doc in filteredShelved" :key="doc.id" class="page-row shelved-row" :data-page-id="doc.id">
              <button class="page-title" :disabled="state.busy || !state.loaded" @click="selectPage(doc.id)"><span class="page-symbol">▤</span>{{ doc.title }}</button>
              <span class="restore-icon" aria-hidden="true">↗</span>
              <button class="row-more" :disabled="state.busy || !state.loaded" :aria-label="'页面菜单 ' + doc.title" @click="contextPage = contextPage === doc.id ? null : doc.id">⋯</button>
            </div>
            <p v-if="!filteredShelved.length" class="empty-list">{{ query ? '没有匹配页面' : '暂无收起页面' }}</p>
          </section>
        </template>
        <section v-else class="outline-list" aria-label="当前文稿大纲">
          <button v-for="heading in outline" :key="heading.start" :disabled="state.busy" :style="{paddingLeft: (10 + 12 * (heading.level - 1)) + 'px'}" @click="reveal(heading)">{{ heading.title }}</button>
          <p v-if="!outline.length" class="empty-list">当前文稿没有标题</p>
        </section>
        <div class="sidebar-footer">{{ state.documents.length }} 个页面 · {{ shelved.length }} 个已收起</div>
      </aside>

      <main class="main-area">
        <div class="tabbar">
          <button ref="pageAnchor" class="workbar-toggle" aria-label="显示页面工作栏" @click="sidebarOpen = !sidebarOpen">◫</button>
          <div class="tabs" aria-label="已展开标签">
            <div v-for="doc in opened" :key="doc.id" class="tab" :class="{ selected: doc.id === state.activeId, 'drop-before': dropTarget === doc.id && !dropAfter, 'drop-after': dropTarget === doc.id && dropAfter }" :data-tab-id="doc.id" :draggable="!state.busy && state.loaded" @dragstart="startDrag($event,doc.id)" @dragover.prevent="overTab($event,doc.id)" @drop.prevent="dropTab($event,doc.id)" @dragend="endDrag" @contextmenu.prevent="contextPage = doc.id">
              <button :disabled="state.busy || !state.loaded" class="tab-title" :title="doc.path || doc.title" @click="selectPage(doc.id)">{{ doc.title }}</button>
              <button class="tab-minus" :disabled="state.busy || !state.loaded" :aria-label="'标签收起 ' + doc.title" title="收起" @click="collapse(doc.id)">−</button>
            </div>
          </div>
          <button class="new-tab" aria-label="新建页面" :disabled="state.busy || !state.loaded" @click="action(() => coordinator.create())">＋</button>
        </div>

        <div v-if="state.error" class="error-notice" role="alert"><span>{{ state.error }}</span><button aria-label="关闭错误提示" @click="state.error = ''">×</button></div>
        <div v-if="state.importReport?.id === state.activeId" class="error-notice import-report" role="status" aria-label="导入说明"><span>{{ state.importReport.text }}</span><button aria-label="关闭导入说明" @click="state.importReport = null">×</button></div>
        <div v-if="findState.open" class="find-panel" role="dialog" aria-label="当前文档查找替换">
          <input ref="findInput" v-model="findState.query" aria-label="查找文字" placeholder="查找" @input="findInputChanged" @compositionstart="findState.composing = true" @compositionend="findCompositionEnd" @keydown.enter="findEnter" />
          <span class="find-count">{{ findState.query ? (findState.count ? (findState.index + 1) + '/' + findState.count + (findState.limited ? '+' : '') : '无匹配') : '输入查找文字' }}</span>
          <button :disabled="!findState.count" aria-label="上一处" @click="findStep(-1)">↑</button><button :disabled="!findState.count" aria-label="下一处" @click="findStep(1)">↓</button>
          <input v-model="findState.replacement" aria-label="替换为" placeholder="替换为" @compositionstart="findState.replacementComposing = true" @compositionend="findState.replacementComposing = false" @keydown.enter="replaceEnter" />
          <button :disabled="!findState.count || state.busy" @click="replaceOne">替换</button><button :disabled="!findState.count || findState.limited || state.busy" @click="replaceAll">全部替换</button>
          <button aria-label="关闭查找替换" @click="closeFind">×</button>
        </div>
        <div ref="editorPanel" class="editor-panel" :class="{ empty: !current }">
          <ProseMirrorPort ref="editor" v-show="current" @resource-paste="pasteResource($event)" @resource-files="insertResource($event)" @change="coordinator.changed($event)" @view-change="scheduleView" @navigation-hint="state.error=$event" />
          <div v-if="state.loaded && !current" class="empty-desktop"><span>所有页面已收起</span><button @click="action(() => coordinator.create())">新建页面</button></div>
          <div v-if="!state.loaded" class="loading-state" role="status">正在恢复页面…</div>
        </div>
        <div v-if="current" class="name-dock" data-html2canvas-ignore="true" :inert="editingLocked">
          <span aria-hidden="true">♧</span>
          <input v-if="!current.path" :key="current.id" :data-doc-id="current.id" :value="nameDraft" aria-label="当前页面名称" placeholder="未命名笔记"
            @input="nameInput" @compositionstart="nameStart" @compositionend="nameEnd" @blur="finishName" @keydown.enter="nameEnter" />
          <span v-else class="file-name" :title="current.path">{{ current.title }}</span>
          <span class="save-state" role="status" aria-label="保存状态">{{ state.saveState }}</span>
          <span class="writing-count" role="status" aria-label="字数统计" title="汉字、假名和韩文逐字，英文和数字按词；含代码和公式源码，不含文首元数据。字符数不含空白。">{{ readingAnalysis.wordCount }} 字词 · {{ readingAnalysis.characterCount }} 字符</span>
        </div>
      </main>
    </div>

    <ReadingSettings v-if="readingOpen" ref="readingPanel" :preferences="readingPreferences" :error="readingError" @change="updateReading" @close="closeReading" />
    <div v-if="contextDocument" class="context-backdrop" @click.self="contextPage = null">
      <div class="page-context" role="menu" :aria-label="'页面操作 ' + contextDocument.title">
        <span class="context-title">{{ contextDocument.title }}</span>
        <button role="menuitem" v-if="!contextDocument.path" @click="focusName(contextPage)">改名</button>
        <button role="menuitem" v-if="!contextDocument.shelved" @click="collapse(contextPage)">收起</button>
        <button role="menuitem" @click="contextLayout('shelveOthers')">收起其他页面</button>
        <button role="menuitem" @click="contextLayout('shelveAll')">收起全部页面</button>
        <button role="menuitem" @click="removePage(contextPage)">移除页面…</button>
      </div>
    </div>
    <div v-if="removalDialog" class="modal-backdrop">
      <section class="remove-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-title" @keydown.esc.prevent="answerRemoval('cancel')">
        <h2 id="remove-title">{{ removalDialog.path ? '保留文件修改？' : '保留这篇笔记？' }}</h2>
        <p>「{{ removalDialog.title }}」</p>
        <p>{{ removalDialog.path ? '移除页面不会删除磁盘原件。' : '保存为 Markdown 后，再从页面列表移除。' }}</p>
        <div class="dialog-actions"><button @click="answerRemoval('cancel')">取消</button><button @click="answerRemoval('discard')">{{ removalDialog.path ? '不保存' : '直接删除' }}</button><button class="primary" @click="answerRemoval('save')">{{ removalDialog.path ? '保存' : '保存为 Markdown' }}</button></div>
      </section>
    </div>
    <div v-if="state.undoRemoval && !undoDismissed" class="removal-notice" role="status">已移除 <button :disabled="state.busy || !state.loaded" @click="action(() => coordinator.undoRemove())">撤销</button><button aria-label="关闭移除提示" @click="undoDismissed = true">×</button></div>
    <div v-if="browserTestHost" class="test-host-badge">浏览器验证 · 模拟 IPC</div>
  </div>
</template>
<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,reactive,ref,watch} from 'vue'
import ProseMirrorPort from './editor/ProseMirrorPort.vue'
import {DocumentCoordinator} from './documents/coordinator.mjs'
import {DocumentSearch} from './documents/search.mjs'
import {documentsApi,onHostClose,openDocumentLink,browserTestHost} from './documents/host.mjs'
import ReadingSettings from './reading/ReadingSettings.vue'
import {analyzeReading} from './reading/analysis.mjs'
import {loadReadingPreferences,saveReadingPreferences,resolvedReadingTheme,readingStyle} from './reading/preferences.mjs'
import './reading/reading.css'
import {startPageMotion} from './pageMotion.js'
import html2canvas from 'html2canvas'

const state=reactive({})
const editor=ref(null),editorPanel=ref(null),pageAnchor=ref(null),findInput=ref(null)
const sidebarOpen=ref(true),sidebarMode=ref('pages'),query=ref(''),mode=ref('rendered')
const contextPage=ref(null),removalDialog=ref(null),undoDismissed=ref(false),editingLocked=ref(false)
const nameDraft=ref(''),nameComposing=ref(false),narrow=ref(false)
const initialReading=loadReadingPreferences()
const readingPreferences=ref(initialReading.preferences),readingError=ref(initialReading.error),readingOpen=ref(false),readingPanel=ref(null),readingButton=ref(null)
const readingAnalysis=ref({headings:[],wordCount:0,characterCount:0})
const themeMedia=matchMedia('(prefers-color-scheme: dark)'),systemDark=ref(themeMedia.matches)
const readingTheme=computed(()=>resolvedReadingTheme(readingPreferences.value,systemDark.value))
let analysisTimer
function themeChanged(event){systemDark.value=event.matches}
watch(readingTheme,value=>{document.documentElement.dataset.readingTheme=value;document.documentElement.style.colorScheme=value},{immediate:true})
const dropTarget=ref(null),dropAfter=ref(false)
const findState=reactive({open:false,query:'',replacement:'',count:0,index:0,limited:false,composing:false,replacementComposing:false,owner:null,pending:null,mode:'rendered'})
let findSerial=0
let dragging=null
let globalComposing=false,removalResolve,viewTimer,closeDispose,cancelMotion,disposed=false
const media=matchMedia('(max-width: 760px)')
const current=computed(()=>state.documents?.find(d=>d.id===state.activeId)||null)
const opened=computed(()=>state.documents?.filter(d=>!d.shelved)||[])
const shelved=computed(()=>state.documents?.filter(d=>d.shelved)||[])
const matches=docs=>docs.filter(d=>d.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()))
const filteredOpened=computed(()=>matches(opened.value)),filteredShelved=computed(()=>matches(shelved.value))
const outline=computed(()=>readingAnalysis.value.headings)
const contextDocument=computed(()=>state.documents?.find(d=>d.id===contextPage.value))
const api={...documentsApi,shelve:async id=>{
 const snapshot=await documentsApi.shelve(id)
 if(id===state.activeId&&!media.matches){
  readingOpen.value=false;await nextTick()
  const colors=getComputedStyle(editorPanel.value)
  const flight=startPageMotion({element:editorPanel.value,anchor:pageAnchor.value,header:document.querySelector('.app-header'),backgroundColor:colors.backgroundColor,backdropColor:colors.getPropertyValue('--reading-surface').trim(),capture:async()=> {
   const canvas=await html2canvas(document.body,{width:innerWidth,height:innerHeight,windowWidth:innerWidth,windowHeight:innerHeight,scale:Math.min(devicePixelRatio||1,1.5,2048/innerWidth,1536/innerHeight),logging:false,ignoreElements:element=>element.classList.contains('crepe-drop-cursor'),backgroundColor:getComputedStyle(editorPanel.value).backgroundColor,allowTaint:false,useCORS:true})
   return canvas.toDataURL('image/png')
  },isCurrent:()=>state.activeId===id&&!disposed})
  cancelMotion=flight.cancel;await flight.finished;cancelMotion=null
 }
 return snapshot
}}
async function waitAllComposition(){
 for(let i=0;i<600&&(globalComposing||nameComposing.value);i++)await new Promise(r=>setTimeout(r,16))
 if(globalComposing||nameComposing.value)throw Error('请先完成输入法组合输入，再重试。')
 await editor.value?.waitComposition()
}
const port={
 findReplace:(query,index,reveal=true)=>editor.value.findReplace(query,index,reveal),
 replaceFind:(query,replacement,index,all)=>editor.value.replaceFind(query,replacement,index,all),
 prepareFileImport:source=>editor.value.prepareFileImport(source),
 ready:async()=>{await nextTick();await editor.value.ready()},
 prepareResourcePaste:payload=>editor.value.prepareResourcePaste(payload),
 commitResourcePaste:prepared=>editor.value.commitResourcePaste(prepared),
 insertResources:(items,position,dropState,dropMode)=>editor.value.insertResources(items,position,dropState,dropMode),
 capture:()=>editor.value?.capture(),
 waitComposition:waitAllComposition,
 activate:async doc=>{await editor.value.activate(doc);mode.value=doc.session?.viewState?.mode||doc.viewState?.mode||'rendered'},
 clear:()=>editor.value?.clear(),
 revealMatch:location=>editor.value.revealMatch(location),
 freeze:async()=>{await waitAllComposition();editor.value.setFrozen(true);editingLocked.value=true;return()=>{editor.value?.setFrozen(false);editingLocked.value=false}}
}
const coordinator=new DocumentCoordinator(api,port,state)
const search=new DocumentSearch(api,state,()=>coordinator.searchLive())
watch(()=>[state.activeId,state.markdown],([id,markdown],previous)=>{
 clearTimeout(analysisTimer)
 if(id!==previous?.[0])readingAnalysis.value={headings:[],wordCount:0,characterCount:0}
 analysisTimer=setTimeout(()=>{if(!disposed&&state.activeId===id)readingAnalysis.value=analyzeReading(markdown||'')},180)
},{immediate:true})
function updateReading(patch){const result=saveReadingPreferences({...readingPreferences.value,...patch});readingPreferences.value=result.preferences;readingError.value=result.error}
async function openReading(){
 if(state.busy||!state.loaded)return
 closeMenus()
 if(readingOpen.value){closeReading();return}
 if(findState.open)closeFind()
 if(narrow.value)sidebarOpen.value=false
 readingOpen.value=true
 await nextTick();readingPanel.value?.focus()
}
function closeReading(){readingOpen.value=false;readingButton.value?.focus()}
let searchTimer
watch(()=>[query.value,state.markdown,state.loaded,state.documents.map(d=>[d.id,d.title,d.revision,d.shelved].join(':')).join('|')],()=>{
 clearTimeout(searchTimer)
 // Invalidate old results immediately; only debounce issuing the next native query.
 search.request('')
 if(query.value.trim()&&state.loaded)searchTimer=setTimeout(()=>search.request(query.value),150)
})
function selectResult(result){return action(async()=>{await coordinator.activate(result.id,result.location);if(narrow.value)sidebarOpen.value=false})}
function startDrag(event,id){
 if(state.busy||event.target.closest('.tab-minus')){event.preventDefault();return}
 dragging={id,ids:opened.value.map(d=>d.id),revision:state.layoutRevision}
 event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-frowd-tab',id)
}
function overTab(event,id){
 if(!dragging)return
 event.dataTransfer.dropEffect='move';dropTarget.value=id
 const rect=event.currentTarget.getBoundingClientRect();dropAfter.value=event.clientX>rect.left+rect.width/2
}
function endDrag(){dragging=null;dropTarget.value=null}
function dropTab(event,id){
 if(!dragging)return
 const drag=dragging,after=dropAfter.value;endDrag()
 if(drag.id===id)return
 const ids=drag.ids.filter(value=>value!==drag.id),index=ids.indexOf(id)
 if(index<0)return
 ids.splice(index+(after?1:0),0,drag.id)
 if(ids.every((value,i)=>value===drag.ids[i]))return
 action(()=>coordinator.reorder(ids,drag.revision))
}
function invalidateFindTarget(){
 const targets=[findState.pending,findState.owner].filter(target=>target&&typeof target==='object'&&!target.pinned)
 for(const target of targets)target.cancelled=true
 if(!findState.owner?.pinned)findState.owner=null
 findState.pending=null
}
function closeFind(){
 findSerial++
 invalidateFindTarget()
 findState.open=false;findState.query='';findState.replacement='';findState.count=0;findState.limited=false;findState.index=0
 editor.value?.focus()
}
function currentFindTarget(query){
 const owner=editor.value?.currentOwner?.()
 return owner?{id:owner.id,generation:owner.generation,mode:owner.viewState?.mode||mode.value,query}:null
}
function findTargetLive(target){
 const attached=findState.pending?.serial===target?.serial||findState.owner?.serial===target?.serial
 return Boolean(target&&!target.cancelled&&target.serial===findSerial&&findState.open&&findState.query===target.query&&attached&&target.id===state.activeId)
}
async function waitForFindOwner(target){
 for(let attempt=0;attempt<60;attempt++){
  if(!findTargetLive(target))return null
  const owner=currentFindTarget(target.query)
  if(owner?.id===target.id){Object.assign(target,owner);return target}
  await new Promise(resolve=>setTimeout(resolve,16))
 }
 return null
}
async function refreshFind(index=findState.index,{reveal=true}={}){
 const serial=++findSerial
 invalidateFindTarget()
 const query=findState.query
 if(!findState.open||!query||!current.value){findState.count=0;findState.limited=false;return}
 const target={id:state.activeId,generation:null,mode:null,query,serial,cancelled:false,pinned:false}
 findState.pending=target
 try{
  await editor.value?.ready()
  if(!findTargetLive(target))return
  if(!await waitForFindOwner(target))return
  const result=await (reveal?coordinator.findReplace(query,index,target):coordinator.findPassive(query,index,target))
  if(!findTargetLive(target)||result.cancelled)return
  findState.pending=null;findState.owner=target
  findState.mode=result.mode;findState.count=result.count;findState.index=result.index<0?0:result.index;findState.limited=Boolean(result.limited)
 }catch(error){
  if(findTargetLive(target)&&!target.cancelled)coordinator.report(error)
 }finally{
  if(findState.pending?.serial===target.serial)findState.pending=null
 }
}
function openFind(){
 closeMenus()
 readingOpen.value=false
 findSerial++;invalidateFindTarget()
 findState.open=true;findState.owner=null;findState.pending=null
 nextTick(()=>{findInput.value?.focus();findInput.value?.select();refreshFind(0)})
}
function findInputChanged(){if(!findState.composing){findState.index=0;refreshFind(0)}else invalidateFindTarget()}
function findCompositionEnd(){findState.composing=false;findInputChanged()}
function findStep(direction){if(!findState.count)return;refreshFind((findState.index+direction+findState.count)%findState.count)}
function findEnter(event){if(event.isComposing||findState.composing||event.keyCode===229||state.busy)return;event.preventDefault();findStep(1)}
function replaceEnter(event){if(event.isComposing||findState.composing||findState.replacementComposing||globalComposing||event.keyCode===229||state.busy)return;event.preventDefault();replaceOne()}
function replaceOne(){action(async()=>{if(!findState.owner||findState.owner.cancelled){await refreshFind(findState.index)}const target=findState.owner;if(!target)throw Error('查找结果已失效，请重新查找。');target.pinned=true;try{const result=await coordinator.replaceFind(findState.query,findState.replacement,findState.index,false,target);findState.index=result.index<0?0:result.index;await refreshFind(findState.index)}finally{target.pinned=false}})}
function replaceAll(){action(async()=>{if(!findState.owner||findState.owner.cancelled){await refreshFind(findState.index)}const target=findState.owner;if(!target)throw Error('查找结果已失效，请重新查找。');target.pinned=true;try{await coordinator.replaceFind(findState.query,findState.replacement,findState.index,true,target);findState.index=0;await refreshFind(0)}finally{target.pinned=false}})}
function closeMenus(){document.querySelectorAll('.app-menu details').forEach(d=>d.open=false)}
async function action(work){closeMenus();contextPage.value=null;try{await work()}catch(error){coordinator.report(error)}}
function pasteResource(event){return action(()=>coordinator.pasteResources({id:event.id,generation:event.generation},event.payload))}
function externalFileGesture(event){return Array.from(event.dataTransfer?.types||[]).some(type=>type.toLowerCase()==='files')}
function insideEditorTarget(event){return Boolean(event.target?.closest?.('.ProseMirror, .markdown-source'))}
function guardExternalFileDrag(event){
 if(!externalFileGesture(event))return
 const editor=insideEditorTarget(event)
 if(editor&&!state.busy&&!editingLocked.value&&mode.value==='rendered')return
 event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='none'
}
function guardExternalFileDrop(event){
 if(!externalFileGesture(event))return
 const editor=insideEditorTarget(event)
 if(editor&&!state.busy&&!editingLocked.value&&mode.value==='rendered')return
 event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='none'
 if(editor)return
 if(!current.value)state.error='当前没有可接收资源的页面。'
 else if(state.busy||editingLocked.value)state.error='当前文档正忙，请等待当前操作完成后再拖入资源。'
 else state.error='请将图片或附件拖到正文编辑区。'
}
function insertResource(event,kind='auto'){
 if(state.busy||editingLocked.value){state.error='当前文档正忙，请等待当前操作完成后再拖入资源。';return}
 const owner=event||editor.value?.capture()
 if(owner)return action(()=>coordinator.importResources({id:owner.id,generation:owner.generation,mode:event?.mode},event?.files||null,kind,event?.dropPosition??null,event?.dropState,event?.mode))
}
function selectPage(id){return action(async()=>{await coordinator.activate(id);if(narrow.value)sidebarOpen.value=false})}
function collapse(id){contextPage.value=null;return action(()=>coordinator.layout('shelve',id))}
function contextLayout(name){const id=contextPage.value;return action(()=>coordinator.layout(name,id))}
async function setMode(value){await action(()=>coordinator.run(async()=>{await editor.value.setMode(value);mode.value=value;await coordinator.flush()}))}
function scheduleView(){clearTimeout(viewTimer);viewTimer=setTimeout(()=>{if(!state.busy)coordinator.flush().catch(e=>coordinator.report(e))},250)}
watch(()=>[current.value?.id,current.value?.title],()=>{if(!nameComposing.value)nameDraft.value=current.value?.title||''},{flush:'sync'})
watch(()=>[state.activeId,mode.value],()=>{if(findState.open){findState.count=0;findState.index=0;refreshFind(0,{reveal:true})}})
watch(()=>state.markdown,()=>{if(findState.open&&findState.query&&findState.owner&&!findState.pending)refreshFind(findState.index,{reveal:false})})
watch(()=>state.removalSequence,()=>undoDismissed.value=false)
function nameStart(){nameComposing.value=true}
function nameInput(event){nameDraft.value=event.target.value;if(!event.isComposing&&!nameComposing.value)coordinator.nameChanged(event.target.dataset.docId,event.target.value)}
function nameEnd(event){nameComposing.value=false;nameDraft.value=event.target.value;coordinator.nameChanged(event.target.dataset.docId,event.target.value)}
function finishName(event){if(nameComposing.value)return;coordinator.nameChanged(event.target.dataset.docId,event.target.value);coordinator.flushName(event.target.dataset.docId).catch(e=>coordinator.report(e))}
function nameEnter(event){if(event.isComposing||nameComposing.value||event.keyCode===229)return;event.preventDefault();event.target.blur()}
async function focusName(id){contextPage.value=null;await selectPage(id);await nextTick();const input=document.querySelector('.name-dock input');input?.focus();input?.select()}
function reveal(heading){
 const owner=editor.value?.currentOwner?.()
 return action(async()=>{
  let navigated=false
  await coordinator.run(async()=>{
  const live=editor.value?.currentOwner?.()
  if(!owner||live?.id!==owner.id||live.generation!==owner.generation)return
  coordinator.capture()
  readingAnalysis.value=analyzeReading(state.markdown||'')
  const matches=outline.value.filter(item=>item.title===heading.title&&item.level===heading.level)
  const target=matches.find(item=>item.index===heading.index)||(matches.length===1?matches[0]:null)
  if(!target){state.error='大纲已更新，请重新选择标题。';return}
  await editor.value.reveal(target.start)
  navigated=true
  if(narrow.value)sidebarOpen.value=false
  await coordinator.flush()
  })
  const live=editor.value?.currentOwner?.()
  if(navigated&&live?.id===owner?.id&&live?.generation===owner?.generation)editor.value.focus()
 })
}
function askRemoval(doc){removalDialog.value=doc;return new Promise(resolve=>{removalResolve=resolve;nextTick(()=>document.querySelector('.remove-dialog button')?.focus())})}
function answerRemoval(answer){removalDialog.value=null;removalResolve?.(answer);removalResolve=null}
function removePage(id){return action(()=>coordinator.remove(id,askRemoval))}
function globalStart(){globalComposing=true}
function globalEnd(){globalComposing=false}
function resize(){narrow.value=media.matches;if(narrow.value)sidebarOpen.value=false}
function shortcut(event){
 if(event.isComposing||globalComposing||removalDialog.value)return
 if(event.key==='Escape'){if(readingOpen.value){event.preventDefault();closeReading();return}if(findState.open){event.preventDefault();closeFind();return}contextPage.value=null;closeMenus();if(narrow.value)sidebarOpen.value=false}
 if(!(event.ctrlKey||event.metaKey)||event.altKey)return
 const key=event.key.toLowerCase()
 if(key===','){event.preventDefault();openReading();return}
 if(key==='n'){event.preventDefault();action(()=>coordinator.create())}
 if(key==='o'){event.preventDefault();action(()=>coordinator.open())}
 if(key==='s'){event.preventDefault();action(()=>coordinator.save(state.activeId,event.shiftKey))}
 if(key==='f'){event.preventDefault();openFind()}
 if(key==='h'){event.preventDefault();openFind()}
 if(key==='m'&&event.shiftKey){event.preventDefault();setMode(mode.value==='source'?'rendered':'source')}
 if(key==='tab'&&opened.value.length){event.preventDefault();const index=opened.value.findIndex(d=>d.id===state.activeId);selectPage(opened.value[(index+(event.shiftKey?-1:1)+opened.value.length)%opened.value.length].id)}
}
async function openLink(event){const detail=event.detail;if(!current.value||detail.id&&detail.id!==current.value.id)return;try{await openDocumentLink(current.value.id,detail.href)}catch(e){coordinator.report(e)}}
onMounted(async()=>{
 narrow.value=media.matches;sidebarOpen.value=!narrow.value;media.addEventListener('change',resize)
 themeMedia.addEventListener('change',themeChanged)
 window.addEventListener('compositionstart',globalStart,true);window.addEventListener('compositionend',globalEnd,true);window.addEventListener('keydown',shortcut,true);window.addEventListener('frowd:open-link',openLink)
 try{closeDispose=await onHostClose(async()=>{try{await coordinator.close()}catch(e){coordinator.report(e);await api.cancelClose()}});await coordinator.boot()}catch(e){coordinator.report(e)}
})
onBeforeUnmount(()=>{disposed=true;clearTimeout(analysisTimer);themeMedia.removeEventListener('change',themeChanged);search.dispose();clearTimeout(searchTimer);cancelMotion?.();clearTimeout(viewTimer);closeDispose?.();coordinator.dispose();media.removeEventListener('change',resize);window.removeEventListener('compositionstart',globalStart,true);window.removeEventListener('compositionend',globalEnd,true);window.removeEventListener('keydown',shortcut,true);window.removeEventListener('frowd:open-link',openLink)})
</script>
