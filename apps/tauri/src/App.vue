<template>
  <div class="app-shell" :data-platform="platform.os" :data-native-menu="platform.nativeMenu" :data-theme="readingTheme" :data-zoom="zoom" :style="readingStyle(readingPreferences)" @dragover.capture="guardExternalFileDrag" @drop.capture="guardExternalFileDrop" @dragleave.capture="externalDragLeave">
    <WindowChrome :platform="platform" :title="current?.title" :open-drop-target="openHover==='top'" @error="coordinator.report($event)">
      <template #menu><nav class="app-menu" aria-label="应用菜单">
        <details ref="fileMenu"><summary>文件</summary><div class="menu-popup">
          <button @click="executeCommand('new')">新建页面 <kbd>{{ shortcutLabel('new') }}</kbd></button>
          <button @click="executeCommand('open')">打开… <kbd>{{ shortcutLabel('open') }}</kbd></button>
          <button :disabled="state.busy || !state.loaded" @click="executeCommand('import')">导入 TXT / HTML…</button>
          <button :disabled="!current" @click="executeCommand('save')">保存 <kbd>{{ shortcutLabel('save') }}</kbd></button>
          <button :disabled="!current" @click="executeCommand('saveAs')">另存为… <kbd>{{ shortcutLabel('saveAs') }}</kbd></button>
          <button :disabled="!current || state.busy || !state.loaded" @click="executeCommand('exportPdf')">导出 PDF…</button>
          <button :disabled="!current || state.busy" @click="executeCommand('insertImage')">插入图片… <kbd>{{ shortcutLabel('insertImage') }}</kbd></button>
          <button :disabled="!current || state.busy" @click="executeCommand('insertAttachment')">插入附件…</button>
          <button :disabled="!state.loaded" @click="executeCommand('checkUpdates')">检查更新…</button>
          <button :disabled="state.busy || !state.loaded || (!current && platform.os !== 'macos')" @click="executeCommand('collapse')">收起当前页面 <kbd>{{ shortcutLabel('collapse') }}</kbd></button>
          <button :disabled="!current" @click="executeCommand('remove')">移除当前页面</button>
        </div></details>
        <details><summary>编辑</summary><div class="menu-popup">
          <button @click="executeCommand('find')">查找 / 替换… <kbd>{{ shortcutLabel('find') }} / {{ shortcutLabel('replace') }}</kbd></button>
        </div></details>
        <details class="format-menu"><summary @mousedown.prevent>格式</summary><div class="menu-popup">
          <template v-for="(group, index) in formatMenu" :key="index">
            <hr v-if="index" />
            <button v-for="item in group" :key="item.id" @mousedown.prevent @click="executeCommand(item.id)">
              {{ item.label }} <kbd>{{ platform.os === 'macos' ? item.macos : item.windows }}</kbd>
            </button>
          </template>
        </div></details>
        <details><summary>视图</summary><div class="menu-popup">
          <button :disabled="!current" @click="executeCommand('rendered')">正文 <span v-if="mode === 'rendered'">✓</span></button>
          <button :disabled="!current" @click="executeCommand('sourceMode')">源码 <kbd>{{ shortcutLabel('source') }}</kbd><span v-if="mode === 'source'">✓</span></button>
          <button :disabled="zoom >= 200" @click="executeCommand('zoomIn')">放大 <kbd>{{ shortcutLabel('zoomIn') }}</kbd></button>
          <button :disabled="zoom <= 50" @click="executeCommand('zoomOut')">缩小 <kbd>{{ shortcutLabel('zoomOut') }}</kbd></button>
          <button @click="executeCommand('zoomReset')">实际大小（{{ zoom }}%） <kbd>{{ shortcutLabel('zoomReset') }}</kbd></button>
          <button @click="executeCommand('sidebar')">{{ sidebarOpen ? '隐藏' : '显示' }}工作栏</button>
          <button :disabled="state.busy || !state.loaded" @click="executeCommand('reading')">阅读设置… <kbd>{{ shortcutLabel('reading') }}</kbd></button>
        </div></details>
      </nav></template>
      <button ref="readingButton" class="reading-button" :disabled="state.busy || !state.loaded" :aria-expanded="readingOpen" aria-label="阅读设置" @click="openReading">阅读</button>
    </WindowChrome>

    <div class="workspace">
      <button v-if="sidebarOpen && narrow" class="drawer-dismiss" aria-label="关闭工作栏遮罩" @click="sidebarOpen = false"></button>
      <aside v-show="sidebarOpen" class="sidebar" :class="{ drawer: narrow, 'open-drop-target': openHover === 'sidebar' }" aria-label="页面工作栏">
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
            <div v-for="doc in filteredOpened" :key="doc.id" class="page-row" :class="{ active: doc.id === state.activeId }" :data-page-id="doc.id" @contextmenu.prevent="openContext($event,doc.id)" @keydown="contextTrigger($event,doc.id)">
              <button class="page-title" :disabled="state.busy || !state.loaded" @click="selectPage(doc.id)"><span class="page-symbol">▤</span>{{ doc.title }}</button>
              <button class="row-close" :disabled="state.busy || !state.loaded" :aria-label="'关闭页面 ' + doc.title" title="关闭页面" @click.stop="removePage(doc.id)">×</button>
              <button class="row-more" :disabled="state.busy || !state.loaded" :aria-label="'页面菜单 ' + doc.title" aria-haspopup="menu" :aria-expanded="contextPage === doc.id" @click.stop="openContext($event,doc.id,true)">⋯</button>
            </div>
            <p v-if="!filteredOpened.length" class="empty-list">{{ query ? '没有匹配页面' : '没有已展开页面' }}</p>
          </section>
          <section v-show="!query.trim()" class="page-group shelved-group" aria-label="已收起页面">
            <div class="group-heading"><span>已收起 {{ shelved.length }}</span></div>
            <div v-for="doc in filteredShelved" :key="doc.id" class="page-row shelved-row" :data-page-id="doc.id" @contextmenu.prevent="openContext($event,doc.id)" @keydown="contextTrigger($event,doc.id)">
              <button class="page-title" :disabled="state.busy || !state.loaded" @click="selectPage(doc.id)"><span class="page-symbol">▤</span>{{ doc.title }}</button>
              <span class="restore-icon" aria-hidden="true">↗</span>
              <button class="row-more" :disabled="state.busy || !state.loaded" :aria-label="'页面菜单 ' + doc.title" aria-haspopup="menu" :aria-expanded="contextPage === doc.id" @click.stop="openContext($event,doc.id,true)">⋯</button>
            </div>
            <p v-if="!filteredShelved.length" class="empty-list">{{ query ? '没有匹配页面' : '暂无收起页面' }}</p>
          </section>
        </template>
        <section v-else class="outline-list" aria-label="当前文稿大纲">
          <button v-for="heading in outline" :key="heading.start" :disabled="state.busy" :style="{paddingLeft: (10 + 12 * (heading.level - 1)) + 'px'}" @click="reveal(heading)">{{ heading.title }}</button>
          <p v-if="!outline.length" class="empty-list">{{ largeSource ? '长文源码模式下暂停生成大纲' : '当前文稿没有标题' }}</p>
        </section>
        <div class="sidebar-footer">{{ state.documents.length }} 个页面 · {{ shelved.length }} 个已收起</div>
      </aside>

      <main class="main-area">
        <div class="tabbar" :class="{ 'open-drop-target': openHover === 'top' }">
          <button class="workbar-toggle" aria-label="显示页面工作栏" @click="sidebarOpen = !sidebarOpen">◫</button>
          <div class="tabs" aria-label="已展开标签">
            <div v-for="doc in opened" :key="doc.id" class="tab" :class="{ selected: doc.id === state.activeId, 'drop-before': dropTarget === doc.id && !dropAfter, 'drop-after': dropTarget === doc.id && dropAfter }" :data-tab-id="doc.id" :draggable="!state.busy && state.loaded" @dragstart="startDrag($event,doc.id)" @dragover="overTab($event,doc.id)" @drop="dropTab($event,doc.id)" @dragend="endDrag" @contextmenu.prevent="openContext($event,doc.id)" @keydown="contextTrigger($event,doc.id)">
              <button :disabled="state.busy || !state.loaded" class="tab-title" :title="doc.path || doc.title" @click="selectPage(doc.id)">{{ doc.title }}</button>
              <button class="tab-minus" :disabled="state.busy || !state.loaded" :aria-label="'标签收起 ' + doc.title" :title="'收起（' + shortcutLabel('collapse') + '）'" @click="collapse(doc.id)">−</button>
            </div>
          </div>
          <button class="new-tab" aria-label="新建页面" :disabled="state.busy || !state.loaded" @click="action(() => coordinator.create())">＋</button>
          <button v-if="platform.nativeMenu" ref="readingButton" class="reading-button" :disabled="state.busy || !state.loaded" :aria-expanded="readingOpen" aria-label="阅读设置" :title="'阅读设置（' + shortcutLabel('reading') + '）'" @click="openReading">阅读</button>
        </div>

        <div v-if="state.error" class="error-notice" role="alert"><span>{{ state.error }}</span><button aria-label="关闭错误提示" @click="state.error = ''">×</button></div>
        <div v-if="state.importReport?.id === state.activeId" class="error-notice import-report" role="status" aria-label="导入说明"><span>{{ state.importReport.text }}</span><button aria-label="关闭导入说明" @click="state.importReport = null">×</button></div>
        <div v-if="findState.open" class="find-panel" role="dialog" aria-label="当前文档查找替换">
          <input ref="findInput" v-model="findState.query" aria-label="查找文字" placeholder="查找" @input="findInputChanged" @compositionstart="findState.composing = true" @compositionend="findCompositionEnd" @keydown.enter="findEnter" />
          <button :aria-pressed="findState.matchCase" :disabled="state.busy || findState.composing" aria-label="区分大小写" title="区分大小写" @click="toggleFindCase">Aa</button>
          <span class="find-count">{{ findState.query ? (findState.count ? (findState.index + 1) + '/' + findState.count + (findState.limited ? '+' : '') : '无匹配') : '输入查找文字' }}</span>
          <button :disabled="!findState.count" aria-label="上一处" @click="findStep(-1)">↑</button><button :disabled="!findState.count" aria-label="下一处" @click="findStep(1)">↓</button>
          <input v-model="findState.replacement" aria-label="替换为" placeholder="替换为" @compositionstart="findState.replacementComposing = true" @compositionend="findState.replacementComposing = false" @keydown.enter="replaceEnter" />
          <button :disabled="!findState.count || state.busy" @click="replaceOne">替换</button><button :disabled="!findState.count || findState.limited || state.busy" @click="replaceAll">全部替换</button>
          <button aria-label="关闭查找替换" @click="closeFind">×</button>
        </div>
        <div v-if="current" class="name-dock" :inert="editingLocked">
          <label v-if="platform.os === 'macos' && !current.path" for="document-name" class="name-label">名称</label>
          <span v-else aria-hidden="true">♧</span>
          <input v-if="!current.path" id="document-name" :key="current.id" :data-doc-id="current.id" :value="nameDraft" aria-label="当前页面名称" placeholder="未命名笔记" :title="platform.os === 'macos' ? '编辑页面名称，无需另存为文件' : undefined"
            @focus="nameFocus" @input="nameInput" @compositionstart="nameStart" @compositionend="nameEnd" @blur="finishName" @keydown.enter="nameEnter" />
          <span v-else class="file-name" :title="current.path">{{ current.title }}</span>
          <span class="save-state" role="status" aria-label="保存状态" :title="state.fileSyncErrors?.[current.id]">{{ saveStatus }}</span>
          <span v-if="largeSource" class="writing-count" role="status">长文源码模式</span>
          <span v-else-if="!state.pageError" class="writing-count" role="status" aria-label="字数统计" title="汉字、假名和韩文逐字，英文和数字按词；含代码和公式源码，不含文首元数据。字符数不含空白。">{{ readingAnalysis.wordCount }} 字词 · {{ readingAnalysis.characterCount }} 字符</span>
        </div>
        <div class="editor-panel" :class="{ empty: !current, 'open-drop-target': openHover === 'panel' }">
          <ProseMirrorPort :asset-source="current?.path ? { id: current.id, path: current.path } : null" :link-modifier="platform.linkModifier" :math-done-shortcut="platform.os === 'macos' ? '⌘Enter' : 'Ctrl+Enter'" ref="editor" v-show="current && !state.pageError" @insert-image="executeCommand('insertImage')" @resource-paste="pasteResource($event)" @resource-files="insertResource($event)" @change="coordinator.changed($event)" @view-change="scheduleView" @navigation-hint="state.error=$event" />
          <div v-if="state.pageError" class="loading-state" role="alert">{{ state.pageError }} <button @click="selectPage(current.id)">重试</button></div>
          <div v-if="state.loaded && !current" class="empty-desktop"><span>所有页面已收起</span><button @click="action(() => coordinator.create())">新建页面</button></div>
          <div v-if="!state.loaded || state.pageLoading" class="loading-state" role="status">{{ state.loaded ? '正在读取正文…' : '正在恢复页面…' }}</div>
        </div>
      </main>
    </div>

    <UpdateNotice :state="updateState" :raised="Boolean(state.undoRemoval && !undoDismissed)" :document-busy="state.busy" @update="updater.update()" @retry="updater.retry()" @close="updater.dismiss()" />
    <ReadingSettings v-if="readingOpen" ref="readingPanel" :preferences="readingPreferences" :error="readingError" @change="updateReading" @close="closeReading" />
      <div v-if="contextDocument" ref="contextMenu" class="page-context" role="menu" :style="{left:contextPosition.x+'px',top:contextPosition.y+'px'}" :aria-label="'页面操作 ' + contextDocument.title" @keydown="contextKey">
        <span class="context-title">{{ contextDocument.title }}</span>
        <button role="menuitem" v-if="!contextDocument.path" @click="focusName(contextPage)">改名</button>
        <button role="menuitem" v-if="!contextDocument.shelved" @click="collapse(contextPage)">收起</button>
        <button role="menuitem" @click="contextLayout('shelveOthers')">收起其他页面</button>
        <button role="menuitem" @click="contextLayout('shelveAll')">收起全部页面</button>
        <button role="menuitem" @click="removePage(contextPage)">移除页面…</button>
      </div>
    <div v-if="removalDialog" class="modal-backdrop">
      <section class="remove-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-title" @keydown.esc.prevent="answerRemoval('cancel')">
        <h2 id="remove-title">{{ removalDialog.path ? '保留文件修改？' : '保留这篇笔记？' }}</h2>
        <p>「{{ removalDialog.title }}」</p>
        <p>{{ removalDialog.path ? '移除页面不会删除磁盘原件。' : '保存为 Markdown 后，再从页面列表移除。' }}</p>
        <div class="dialog-actions"><button @click="answerRemoval('cancel')">取消</button><button @click="answerRemoval('discard')">{{ removalDialog.path ? '不保存' : '直接删除' }}</button><button v-if="removalDialog.bodyInDb !== false || !removalDialog.conflict" class="primary" @click="answerRemoval('save')">{{ removalDialog.conflict ? '另存为' : removalDialog.path ? '保存' : '保存为 Markdown' }}</button></div>
      </section>
    </div>
    <div v-if="state.undoRemoval && !undoDismissed" class="removal-notice" role="status">已移除 <button :disabled="state.busy || !state.loaded" @click="action(() => coordinator.undoRemove())">撤销</button><button aria-label="关闭移除提示" @click="undoDismissed = true">×</button></div>
    <div v-if="browserTestHost" class="test-host-badge">浏览器验证 · 模拟 IPC</div>
    <div v-if="dragFeedback" class="drag-hint" :class="'drag-hint-' + dragFeedback.kind" role="status" :style="dragFeedback.style">{{ dragFeedback.text }}</div>
  </div>
</template>
<script setup>
import {computed,nextTick,onBeforeUnmount,onMounted,reactive,ref,watch} from 'vue'
import ProseMirrorPort from './editor/ProseMirrorPort.vue'
import {DocumentCoordinator} from './documents/coordinator.mjs'
import {initializeCloseHandshake} from './documents/closeHandshake.mjs'
import {DocumentSearch} from './documents/search.mjs'
import {documentsApi,updatesApi,onHostClose,onHostMenuCommand,onHostOpenRequest,openDocumentLink,requestWindowClose,browserTestHost} from './documents/host.mjs'
import {createOpenRequests} from './documents/openRequests.mjs'
import {OPEN_AREAS,classifyDrop,dropArea,externalFileDrag,openDropMessages,skippedNotice} from './openDrop.mjs'
import UpdateNotice from './updates/UpdateNotice.vue'
import {UpdateController} from './updates/controller.mjs'
import ReadingSettings from './reading/ReadingSettings.vue'
import {analyzeReading} from './reading/analysis.mjs'
import {isLargeDocument} from './editor/largeDocument.mjs'
import {formatMenu,formatMenuCommands} from './editor/formatMenu.mjs'
import {loadReadingPreferences,saveReadingPreferences,resolvedReadingTheme,readingStyle} from './reading/preferences.mjs'
import './reading/reading.css'
import './reading/markdown-theme.css'
import {nativeWindow,setPageZoom} from './window.mjs'
import WindowChrome from './WindowChrome.vue'
import {describePlatform,formatShortcut,matchCommand,usesNativeAccelerator} from './platform.mjs'
const platform=describePlatform({browserTestHost,nativeWindow})
const shortcutLabel=id=>formatShortcut(id,platform)
const openMessages=openDropMessages(platform)
let menuDispose,openDispose

const state=reactive({})
const editor=ref(null),findInput=ref(null)
const sidebarOpen=ref(true),sidebarMode=ref('pages'),query=ref(''),mode=ref('rendered')
const contextPage=ref(null),removalDialog=ref(null),undoDismissed=ref(false),editingLocked=ref(false)
const contextMenu=ref(null),contextPosition=reactive({x:0,y:0}),zoom=ref(100)
let contextOrigin=null,contextRequest=0,zoomTimer,zoomFlight=false,zoomApplied=100
const nameDraft=ref(''),nameComposing=ref(false),nameEditingId=ref(null),narrow=ref(false)
const initialReading=loadReadingPreferences()
const readingPreferences=ref(initialReading.preferences),readingError=ref(initialReading.error),readingOpen=ref(false),readingPanel=ref(null),readingButton=ref(null)
const readingAnalysis=ref({headings:[],wordCount:0,characterCount:0})
const themeMedia=matchMedia('(prefers-color-scheme: dark)'),systemDark=ref(themeMedia.matches)
const readingTheme=computed(()=>resolvedReadingTheme(readingPreferences.value,systemDark.value))
let analysisTimer
function themeChanged(event){systemDark.value=event.matches}
watch(readingTheme,value=>{document.documentElement.dataset.readingTheme=value;document.documentElement.style.colorScheme=value},{immediate:true})
const dropTarget=ref(null),dropAfter=ref(false),openHover=ref(null),dragFeedback=ref(null)
let dragFeedbackTimer
const findState=reactive({open:false,query:'',replacement:'',matchCase:false,count:0,index:0,limited:false,composing:false,replacementComposing:false,owner:null,pending:null,mode:'rendered'})
let findSerial=0
let dragging=null
let globalComposing=false,removalResolve,viewTimer,closeDispose,disposed=false
const media=matchMedia('(max-width: 760px)')
const current=computed(()=>state.documents?.find(d=>d.id===state.activeId)||null)
const largeSource=computed(()=>mode.value==='source'&&editor.value?.largeDocument)
const saveStatus=computed(()=>{
 const doc=current.value
 if(state.pageError)return '正文不可用'
 if(!doc?.path)return state.saveState
 if(doc.conflict)return '外部文件已变更，未自动覆盖（请另存为）'
 if(state.saveState==='暂存失败')return state.saveState
 if(state.syncingId===doc.id)return '正在同步到文件…'
 if(state.fileSyncErrors?.[doc.id])return '文件同步失败，草稿已暂存'
 if(state.saveState==='保存中…')return state.saveState
 if(doc.dirty)return '有修改待写入文件'
 return '已保存到文件'
})
const opened=computed(()=>state.documents?.filter(d=>!d.shelved)||[])
const shelved=computed(()=>state.documents?.filter(d=>d.shelved)||[])
const matches=docs=>docs.filter(d=>d.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()))
const filteredOpened=computed(()=>matches(opened.value)),filteredShelved=computed(()=>matches(shelved.value))
const outline=computed(()=>readingAnalysis.value.headings)
const contextDocument=computed(()=>state.documents?.find(d=>d.id===contextPage.value))
const api={...documentsApi,shelve:async id=>{
 const snapshot=await documentsApi.shelve(id)
 if(id===state.activeId)readingOpen.value=false
 return snapshot
}}
async function waitAllComposition(){
 for(let i=0;i<600&&(globalComposing||nameComposing.value);i++)await new Promise(r=>setTimeout(r,16))
 if(globalComposing||nameComposing.value)throw Error('请先完成输入法组合输入，再重试。')
 await editor.value?.waitComposition()
}
const port={
 findReplace:(query,index,reveal=true,matchCase=false)=>editor.value.findReplace(query,index,reveal,matchCase),
 replaceFind:(query,replacement,index,all,matchCase=false)=>editor.value.replaceFind(query,replacement,index,all,matchCase),
 prepareFileImport:source=>editor.value.prepareFileImport(source),
 ready:async()=>{await nextTick();await editor.value.ready()},
 prepareResourcePaste:payload=>editor.value.prepareResourcePaste(payload),
 commitResourcePaste:(prepared,copied)=>editor.value.commitResourcePaste(prepared,copied),
 insertResources:(items,position,dropState,dropMode)=>editor.value.insertResources(items,position,dropState,dropMode),
 capture:()=>editor.value?.capture(),
 waitComposition:waitAllComposition,
 activate:async doc=>{mode.value=await editor.value.activate(doc)},
 clear:()=>editor.value?.clear(),
 revealMatch:location=>editor.value.revealMatch(location),
 freeze:async()=>{await waitAllComposition();editor.value.setFrozen(true);editingLocked.value=true;return()=>{editor.value?.setFrozen(false);editingLocked.value=false}}
}
const coordinator=new DocumentCoordinator(api,port,state)
const updateState=reactive({})
const updater=new UpdateController(updatesApi,coordinator,updateState)
const search=new DocumentSearch(api,state,()=>coordinator.searchLive())
const openRequests=createOpenRequests({open:()=>coordinator.openPending(),report:error=>coordinator.report(error)})
watch(()=>[state.activeId,state.markdown,mode.value,largeSource.value],([id,markdown,view,long],previous)=>{
 clearTimeout(analysisTimer)
 if(id!==previous?.[0]||long)readingAnalysis.value={headings:[],wordCount:0,characterCount:0}
 if(long)return
 analysisTimer=setTimeout(()=>{
  if(disposed||state.activeId!==id)return
  if(view==='source'&&isLargeDocument(markdown||'')){
   readingAnalysis.value={headings:[],wordCount:0,characterCount:0}
   return
  }
  readingAnalysis.value=analyzeReading(markdown||'')
 },180)
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
function selectResult(result){return action(async()=>{
 await coordinator.activate(result.id,result.location)
 const owner=editor.value?.currentOwner?.()
 if(narrow.value)sidebarOpen.value=false
 // The location is selected while the command owns a frozen editor. Focus only
 // after the DOM unfreezes, so ProseMirror can publish that selection to the DOM.
 await nextTick()
 const currentOwner=editor.value?.currentOwner?.()
 if(!state.busy&&state.activeId===result.id&&owner?.id===result.id&&currentOwner?.id===owner.id&&currentOwner?.generation===owner.generation)editor.value?.focus()
})}
function startDrag(event,id){
 if(state.busy||event.target.closest('.tab-minus')){event.preventDefault();return}
 dragging={id,ids:opened.value.map(d=>d.id),revision:state.layoutRevision}
 event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-frowd-tab',id)
}
// Only the tab drag started here reorders; external files never show the insertion bar.
function overTab(event,id){
 if(!dragging||externalFileDrag(event.dataTransfer))return
 event.preventDefault()
 event.dataTransfer.dropEffect='move';dropTarget.value=id
 const rect=event.currentTarget.getBoundingClientRect();dropAfter.value=event.clientX>rect.left+rect.width/2
}
function endDrag(){dragging=null;dropTarget.value=null}
function dropTab(event,id){
 if(!dragging||externalFileDrag(event.dataTransfer))return
 event.preventDefault()
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
 return owner?{id:owner.id,generation:owner.generation,mode:owner.viewState?.mode||mode.value,query,matchCase:findState.matchCase}:null
}
function findTargetLive(target){
 const attached=findState.pending?.serial===target?.serial||findState.owner?.serial===target?.serial
 return Boolean(target&&!target.cancelled&&target.serial===findSerial&&findState.open&&findState.query===target.query&&findState.matchCase===target.matchCase&&attached&&target.id===state.activeId)
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
 const query=findState.query,matchCase=findState.matchCase
 if(!findState.open||!query||!current.value){findState.count=0;findState.limited=false;return}
 const target={id:state.activeId,generation:null,mode:null,query,matchCase,serial,cancelled:false,pinned:false}
 findState.pending=target
 try{
  await editor.value?.ready()
  if(!findTargetLive(target))return
  if(!await waitForFindOwner(target))return
  const result=await (reveal?coordinator.findReplace(query,index,target,matchCase):coordinator.findPassive(query,index,target,matchCase))
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
function toggleFindCase(){findState.matchCase=!findState.matchCase;findState.index=0;refreshFind(0)}
function findCompositionEnd(){findState.composing=false;findInputChanged()}
function findStep(direction){if(!findState.count)return;refreshFind((findState.index+direction+findState.count)%findState.count)}
function findEnter(event){if(event.isComposing||findState.composing||event.keyCode===229||state.busy)return;event.preventDefault();findStep(1)}
function replaceEnter(event){if(event.isComposing||findState.composing||findState.replacementComposing||globalComposing||event.keyCode===229||state.busy)return;event.preventDefault();replaceOne()}
function replaceOne(){action(async()=>{if(!findState.owner||findState.owner.cancelled){await refreshFind(findState.index)}const target=findState.owner;if(!target)throw Error('查找结果已失效，请重新查找。');target.pinned=true;try{const result=await coordinator.replaceFind(findState.query,findState.replacement,findState.index,false,target,findState.matchCase);findState.index=result.index<0?0:result.index;await refreshFind(findState.index)}finally{target.pinned=false}})}
function replaceAll(){action(async()=>{if(!findState.owner||findState.owner.cancelled){await refreshFind(findState.index)}const target=findState.owner;if(!target)throw Error('查找结果已失效，请重新查找。');target.pinned=true;try{await coordinator.replaceFind(findState.query,findState.replacement,findState.index,true,target,findState.matchCase);findState.index=0;await refreshFind(0)}finally{target.pinned=false}})}
function closeMenus(){document.querySelectorAll('.app-menu details').forEach(d=>d.open=false)}
function closeContext(restore=false){
 contextRequest++;contextPage.value=null
 if(restore&&contextOrigin?.isConnected)contextOrigin.focus()
}
function contextResize(){closeContext()}
async function openContext(event,id,anchor=false,keyboard=false){
 if(state.busy||!state.loaded)return
 if(anchor&&contextPage.value===id){closeContext(true);return}
 closeMenus()
 const token=++contextRequest
 contextOrigin=event.target.closest('button')||event.currentTarget.querySelector('button')
 const rect=(anchor?event.currentTarget:contextOrigin)?.getBoundingClientRect()
 const atAnchor=anchor||keyboard||event.clientX===0&&event.clientY===0
 const x=atAnchor?rect?.left||0:event.clientX,y=atAnchor?rect?.bottom||0:event.clientY
 contextPage.value=id
 await nextTick()
 if(token!==contextRequest||!contextMenu.value)return
 const menu=contextMenu.value.getBoundingClientRect()
 const scale=nativeWindow?1:zoom.value/100
 contextPosition.x=Math.max(4,Math.min(x,innerWidth-menu.width-4))/scale
 contextPosition.y=Math.max(4,Math.min(y,innerHeight-menu.height-4))/scale
 contextMenu.value.querySelector('button')?.focus()
}
function contextTrigger(event,id){
 if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey){event.preventDefault();event.stopPropagation();openContext(event,id,false,true)}
}
function contextKey(event){
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeContext(true);return}
 if(event.key==='Tab'){closeContext();return}
 const items=Array.from(contextMenu.value?.querySelectorAll('button:not(:disabled)')||[])
 const index=items.indexOf(document.activeElement)
 if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
  event.preventDefault()
  items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()
 }
}
function outsideMenus(event){
 if(contextPage.value&&!event.target.closest('.page-context,.row-more'))closeContext()
 if(!event.target.closest('.app-menu'))closeMenus()
}
function changeZoom(delta,reset=false){
 closeMenus();closeContext()
 zoom.value=reset?100:Math.max(50,Math.min(200,zoom.value+delta))
 clearTimeout(zoomTimer);zoomTimer=setTimeout(applyZoom,16)
}
async function applyZoom(){
 if(zoomFlight||disposed)return
 const requested=zoom.value
 if(requested===zoomApplied)return
 zoomFlight=true
 try{await setPageZoom(requested);zoomApplied=requested}
 catch(error){zoom.value=zoomApplied;coordinator.report(error)}
 finally{zoomFlight=false;if(zoomApplied!==zoom.value&&!disposed)zoomTimer=setTimeout(applyZoom,16)}
}
function zoomWheel(event){
 if(!(event.ctrlKey||platform.os==='macos'&&event.metaKey)||event.altKey)return
 event.preventDefault();event.stopPropagation()
 if(event.deltaY!==0)changeZoom(event.deltaY<0?10:-10)
}
async function action(work){closeMenus();contextPage.value=null;try{await work()}catch(error){coordinator.report(error)}}
function pasteResource(event){return action(()=>coordinator.pasteResources({id:event.id,generation:event.generation},event.payload))}
// Body/margins keep the resource drop path; open areas (sidebar, Windows top
// bars, or the empty editor panel) open .md/.markdown/.txt through the host.
function insideEditorRoot(event){return Boolean(event.target?.closest?.('.editor-root'))}
function areaOf(event){return dropArea(event.target,platform,{hasDocument:Boolean(current.value)})}
function hideDragFeedback(){clearTimeout(dragFeedbackTimer);openHover.value=null;dragFeedback.value=null}
// Beside the cursor, flipped near the right/bottom edges so it stays readable.
function hintStyle(x,y){
 const right=x>window.innerWidth-280,bottom=y>window.innerHeight-64
 return {[right?'right':'left']:`${right?window.innerWidth-x+12:x+14}px`,[bottom?'bottom':'top']:`${bottom?window.innerHeight-y+12:y+18}px`}
}
// Feedback is shown while hovering: a target whose dragover leaves dropEffect
// 'none' never receives drop, so a rejection explained only on drop is never
// seen. dragover repeats while hovering; the timer also covers a drag that
// leaves the window without a final dragleave.
function showDragFeedback(event,area,kind,text){
 openHover.value=kind==='open'?area:null
 dragFeedback.value={kind,text,style:hintStyle(event.clientX,event.clientY)}
 clearTimeout(dragFeedbackTimer);dragFeedbackTimer=setTimeout(hideDragFeedback,800)
}
function externalDragLeave(event){if(!event.relatedTarget&&externalFileDrag(event.dataTransfer))hideDragFeedback()}
function bodyAccepts(area,event){return area==='body'&&insideEditorRoot(event)&&!state.busy&&!editingLocked.value&&mode.value==='rendered'}
// Why an external file cannot be dropped here (never an open area or an accepting body).
function dropRejection(area,event){
 if(area==='tabbar')return openMessages.tabbar
 if(!current.value)return '当前没有可接收资源的页面。'
 if(state.busy||editingLocked.value)return '当前文档正忙，请等待当前操作完成后再拖入资源。'
 if(area==='body'&&insideEditorRoot(event)&&mode.value==='source')return '源码模式暂不支持按坐标拖入，请切换到正文模式。'
 return '请将图片或附件拖到正文编辑区。'
}
function guardExternalFileDrag(event){
 if(!externalFileDrag(event.dataTransfer))return
 const area=areaOf(event)
 if(OPEN_AREAS.has(area)){
  // File names are unknown while hovering; the type is checked on drop.
  event.preventDefault();event.stopPropagation()
  if(event.dataTransfer)event.dataTransfer.dropEffect='copy'
  showDragFeedback(event,area,'open','松开以打开');return
 }
 if(bodyAccepts(area,event)){hideDragFeedback();return}
 event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='none'
 showDragFeedback(event,area,'reject',dropRejection(area,event))
}
function guardExternalFileDrop(event){
 if(!externalFileDrag(event.dataTransfer))return
 const area=areaOf(event)
 hideDragFeedback()
 if(OPEN_AREAS.has(area)){event.preventDefault();event.stopPropagation();openDroppedFiles(event.dataTransfer);return}
 if(bodyAccepts(area,event))return
 event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='none'
 // The editor port explains its own (source/busy) refusal if a drop gets there.
 if(area==='body'&&insideEditorRoot(event))return
 state.error=dropRejection(area,event)
}
// Classification and the native claim start inside the drop event, before any
// await: the macOS drag pasteboard and DataTransfer are only fresh right now.
// Opening itself waits in the coordinator queue (busy/source/IME are honored).
function openDroppedFiles(dataTransfer){
 const dropped=classifyDrop(dataTransfer),skipped=skippedNotice(dropped,openMessages)
 if(!dropped.openable.length){
  state.error=dropped.skipped.length&&dropped.directories?skipped:dropped.directories?openMessages.directory:openMessages.unsupported
  return
 }
 state.error=skipped
 let claim
 try{claim=api.claimDropped(dropped.openable)}catch(error){claim=Promise.reject(error)}
 return claim.then(async result=>{
  if(!result||result.unavailable){state.error=[skipped,openMessages.unavailable].filter(Boolean).join('。');return}
  const notes=[skipped,...(result.errors||[])].filter(Boolean),initial=notes.join('。')
  if(initial)state.error=initial
  if(result.accepted){
   await openRequests.request()
   if(initial&&state.error&&state.error!==initial)state.error=`${initial} ${state.error}`
  }
 },()=>{state.error=[skipped,openMessages.unavailable].filter(Boolean).join('。')})
}
function insertResource(event,kind='auto'){
 if(state.busy||editingLocked.value){state.error='当前文档正忙，请等待当前操作完成后再拖入资源。';return}
 const owner=event||editor.value?.capture()
 if(owner)return action(()=>coordinator.importResources({id:owner.id,generation:owner.generation,mode:event?.mode},event?.files||null,kind,event?.dropPosition??null,event?.dropState,event?.mode))
}
function selectPage(id){return action(async()=>{await coordinator.activate(id);if(narrow.value)sidebarOpen.value=false})}
function collapse(id){contextPage.value=null;return action(()=>coordinator.layout('shelve',id))}
function contextLayout(name){const id=contextPage.value;return action(()=>coordinator.layout(name,id))}
async function setMode(value){await action(()=>coordinator.run(async()=>{
 if(state.pageError)return
 await editor.value.setMode(value);mode.value=value;await coordinator.flush()
}))}
function scheduleView(){clearTimeout(viewTimer);viewTimer=setTimeout(()=>{if(!state.busy)coordinator.flush().catch(e=>coordinator.report(e))},250)}
watch(()=>[current.value?.id,current.value?.title],([id,title],previous)=>{
 if(id!==previous?.[0]){nameEditingId.value=null;nameDraft.value=title||''}
 // The host may normalize a saved title while this input still owns a raw draft.
 else if(nameEditingId.value!==id&&!nameComposing.value)nameDraft.value=title||''
},{flush:'sync'})
watch(()=>[state.activeId,mode.value],()=>{if(findState.open){findState.count=0;findState.index=0;refreshFind(0,{reveal:true})}})
watch(()=>state.markdown,()=>{if(findState.open&&findState.query&&findState.owner&&!findState.pending)refreshFind(findState.index,{reveal:false})})
watch(()=>state.removalSequence,()=>undoDismissed.value=false)
function nameFocus(event){if(event.target.dataset.docId===current.value?.id)nameEditingId.value=event.target.dataset.docId}
function nameStart(event){if(event.target.dataset.docId===current.value?.id){nameFocus(event);nameComposing.value=true}}
function nameInput(event){if(event.target.dataset.docId===current.value?.id)nameDraft.value=event.target.value;if(!event.isComposing&&!nameComposing.value)coordinator.nameChanged(event.target.dataset.docId,event.target.value)}
function nameEnd(event){if(event.target.dataset.docId===current.value?.id){nameComposing.value=false;nameDraft.value=event.target.value}coordinator.nameChanged(event.target.dataset.docId,event.target.value)}
function finishName(event){if(nameComposing.value)return;const id=event.target.dataset.docId;if(nameEditingId.value===id)nameEditingId.value=null;coordinator.nameChanged(id,event.target.value);coordinator.flushName(id).catch(e=>coordinator.report(e))}
function nameEnter(event){if(event.isComposing||nameComposing.value||event.keyCode===229)return;event.preventDefault();event.target.blur()}
async function focusName(id){contextPage.value=null;await selectPage(id);await nextTick();const input=document.querySelector('.name-dock input');input?.focus();input?.select()}
function reveal(heading){
 const displayed=outline.value
 if(!displayed.includes(heading))return
 const owner=editor.value?.currentOwner?.()
 return action(async()=>{
  let navigated=false
  await coordinator.run(async()=>{
  const live=editor.value?.currentOwner?.()
  if(!owner||live?.id!==owner.id||live.generation!==owner.generation)return
  coordinator.capture()
  readingAnalysis.value=analyzeReading(state.markdown||'')
  const fresh=outline.value,matches=fresh.filter(item=>item.title===heading.title&&item.level===heading.level)
  const unchanged=displayed.length===fresh.length&&displayed.every((item,index)=>item.title===fresh[index].title&&item.level===fresh[index].level)
  let target=null
  if(unchanged)target=fresh[heading.index]
  else if(matches.length===1&&displayed.filter(item=>item.title===heading.title&&item.level===heading.level).length===1)target=matches[0]
  if(!target){state.error='大纲已更新，请重新选择标题。';return}
  navigated=await editor.value.revealHeading(target,owner)
  if(!navigated){state.error='暂时无法定位这个标题，请重试。';return}
  if(['大纲已更新，请重新选择标题。','暂时无法定位这个标题，请重试。'].includes(state.error))state.error=''
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
function rememberEditableFocus(event){editor.value?.rememberEditableFocus(event.target)}
function resize(){narrow.value=media.matches;if(narrow.value)sidebarOpen.value=false}
function shortcut(event){
 if(event.isComposing||event.keyCode===229||globalComposing||removalDialog.value)return
 if(event.key==='Escape'){if(contextPage.value){event.preventDefault();event.stopPropagation();closeContext(true);return}if(readingOpen.value){event.preventDefault();closeReading();return}if(findState.open){event.preventDefault();closeFind();return}closeMenus();if(narrow.value)sidebarOpen.value=false}
 const command=matchCommand(event,platform)
 if(!command)return
 // AppKit owns registered accelerators; Ctrl+Tab is DOM-only on both platforms.
 if(usesNativeAccelerator(command,event,platform))return
 event.preventDefault();event.stopImmediatePropagation();executeCommand(command)
}
function executeCommand(command){
 if(removalDialog.value||!state.loaded)return
 const formatting=formatMenuCommands.get(command)
 if(formatting)return executeFormatMenu(formatting)
 // Save/open/new and tab navigation retain the coordinator's serial queue,
 // including a page switch requested while resource registration is in flight.
 if(state.busy&&['import','exportPdf','insertImage','insertAttachment','remove','source','sourceMode','rendered','reading'].includes(command))return
 const active=Boolean(current.value)
 if(state.pageError&&['save','saveAs','exportPdf','insertImage','insertAttachment','source','sourceMode','rendered','find','replace'].includes(command))return
 switch(command){
  case 'checkUpdates': closeMenus();return updater.check()
  case 'new': return action(()=>coordinator.create())
  case 'open': return action(()=>coordinator.open())
  case 'import': return action(()=>coordinator.importFile())
  case 'save': case 'saveAs': return active&&action(()=>coordinator.save(state.activeId,command==='saveAs'))
  case 'exportPdf': return active&&action(()=>coordinator.exportPdf())
  case 'insertImage': case 'insertAttachment': return active&&insertResource(null,command==='insertImage'?'image':'attachment')
  case 'collapse':
   if(state.busy||globalComposing)return
   if(active)return collapse(state.activeId)
   if(!opened.value.length&&platform.os==='macos'&&(nativeWindow||browserTestHost))return action(requestWindowClose)
   return
  case 'remove': return active&&removePage(state.activeId)
  case 'source': return active&&setMode(mode.value==='source'?'rendered':'source')
  case 'sourceMode': return active&&setMode('source')
  case 'rendered': return active&&setMode('rendered')
  case 'find': case 'replace': return active&&openFind()
  case 'reading': return openReading()
  case 'zoomIn': return changeZoom(10)
  case 'zoomOut': return changeZoom(-10)
  case 'zoomReset': return changeZoom(0,true)
  case 'sidebar': sidebarOpen.value=!sidebarOpen.value;closeMenus();return
  case 'nextTab': case 'previousTab': {
   if(!opened.value.length)return
   const index=opened.value.findIndex(d=>d.id===state.activeId)
   return selectPage(opened.value[(index+(command==='previousTab'?-1:1)+opened.value.length)%opened.value.length].id)
  }
 }
}
function executeFormatMenu(shortcut){
 closeMenus()
 if(current.value&&!state.pageError&&!editingLocked.value&&!globalComposing)
  editor.value?.formatFromMenu(shortcut)
}
async function openLink(event){const detail=event.detail;if(!current.value||detail.id&&detail.id!==current.value.id)return;try{await openDocumentLink(current.value.id,detail.href)}catch(e){coordinator.report(e)}}
onMounted(async()=>{
 narrow.value=media.matches;sidebarOpen.value=!narrow.value;media.addEventListener('change',resize)
 themeMedia.addEventListener('change',themeChanged)
 window.addEventListener('pointerdown',outsideMenus,true);window.addEventListener('wheel',zoomWheel,{capture:true,passive:false});window.addEventListener('resize',contextResize)
 if(nativeWindow)setPageZoom(100).catch(error=>coordinator.report(error))
 if(platform.nativeMenu)menuDispose=await onHostMenuCommand(executeCommand)
 window.addEventListener('focusin',rememberEditableFocus,true);window.addEventListener('compositionstart',globalStart,true);window.addEventListener('compositionend',globalEnd,true);window.addEventListener('keydown',shortcut,true);window.addEventListener('frowd:open-link',openLink)
 try{openDispose=await onHostOpenRequest(()=>openRequests.request())}catch(error){coordinator.report(error)}
 closeDispose=await initializeCloseHandshake({
  listen:onHostClose,acknowledge:()=>api.ackCloseListener(),
  boot:()=>coordinator.boot(),close:()=>updater.blocksClose?api.cancelClose():coordinator.close(),
  cancel:()=>api.cancelClose(),report:error=>coordinator.report(error)
 })
 if(disposed){closeDispose();openDispose?.();return}
 // Cold-start Open With / argv paths were queued natively before this listener.
 if(state.loaded){
  let pending=false
  try{pending=await api.hasPendingOpen()}catch(error){coordinator.report(error)}
  if(disposed)return
  openRequests.start(pending)
 }
})
onBeforeUnmount(()=>{disposed=true;updater.dispose();menuDispose?.();openDispose?.();openRequests.dispose();hideDragFeedback();clearTimeout(zoomTimer);window.removeEventListener('pointerdown',outsideMenus,true);window.removeEventListener('wheel',zoomWheel,true);window.removeEventListener('resize',contextResize);clearTimeout(analysisTimer);themeMedia.removeEventListener('change',themeChanged);search.dispose();clearTimeout(searchTimer);clearTimeout(viewTimer);closeDispose?.();coordinator.dispose();media.removeEventListener('change',resize);window.removeEventListener('focusin',rememberEditableFocus,true);window.removeEventListener('compositionstart',globalStart,true);window.removeEventListener('compositionend',globalEnd,true);window.removeEventListener('keydown',shortcut,true);window.removeEventListener('frowd:open-link',openLink)})
</script>
