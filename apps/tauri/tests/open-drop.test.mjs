import {test} from 'node:test'
import assert from 'node:assert/strict'
import {OPEN_AREAS,classifyDrop,dropArea,externalFileDrag,openDropMessages,openableName,skippedNotice} from '../src/openDrop.mjs'
import {createOpenRequests} from '../src/documents/openRequests.mjs'
import {DocumentCoordinator} from '../src/documents/coordinator.mjs'
import {describePlatform} from '../src/platform.mjs'
import {DROP_MESSAGE_PREFIX,claimDroppedFiles,dropToken} from '../src/documents/dropClaim.mjs'

const mac=describePlatform({platform:'MacIntel'}),win=describePlatform({platform:'Win32'})
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
// Minimal Element stand-in: `closest` matches any listed ancestor class.
function element(...classes){
 return {closest:selector=>selector.split(',').map(part=>part.trim().replace(/^\./,'')).some(name=>classes.includes(name))?{}:null}
}
const file=(name,size=1)=>({name,size,webkitRelativePath:''})

test('only .md / .markdown / .txt are openable, case-insensitively',()=>{
 for(const name of ['a.md','B.MD','notes.Markdown','x.txt','中文.TXT','dots.v1.md'])assert.equal(openableName(name),true,name)
 for(const name of ['a.png','md','a.md.exe','.md/','a.mdx','a.text','','folder/'])assert.equal(openableName(name),false,name)
 assert.equal(externalFileDrag({types:['Files']}),true)
 assert.equal(externalFileDrag({types:['application/x-frowd-tab']}),false)
 assert.equal(externalFileDrag({types:['text/plain']}),false)
 assert.equal(externalFileDrag(null),false)
})

test('drop areas differ by platform: mac opens only from the sidebar, Windows also from both top bars',()=>{
 const cases=[
  [element('sidebar'),'sidebar','sidebar'],
  [element('page-row','sidebar'),'sidebar','sidebar'],
  [element('tab','tabbar','main-area'),'tabbar','top'],
  [element('app-header'),'other','top'],
  [element('ProseMirror','editor-root','editor-panel','main-area'),'body','body'],
  [element('pm-scroller','editor-root','editor-panel'),'body','body'],
  [element('name-dock','main-area'),'other','other'],
  [element('error-notice'),'other','other'],
 ]
 for(const [target,macArea,winArea] of cases){
  assert.equal(dropArea(target,mac),macArea)
  assert.equal(dropArea(target,win),winArea)
 }
 // No page: the editor panel has no attachment target, so it opens.
 assert.equal(dropArea(element('empty-desktop','editor-panel'),mac,{hasDocument:false}),'panel')
 assert.equal(dropArea(element('empty-desktop','editor-panel'),win,{hasDocument:false}),'panel')
 // Text nodes resolve through their parent element; detached targets are other.
 assert.equal(dropArea({parentElement:element('sidebar')},mac),'sidebar')
 assert.equal(dropArea(null,mac),'other')
 for(const area of ['sidebar','top','panel'])assert.equal(OPEN_AREAS.has(area),true)
 for(const area of ['body','tabbar','other'])assert.equal(OPEN_AREAS.has(area),false)
})

test('drop classification separates openable files, skipped files and directories',()=>{
 const items=[
  {kind:'file',getAsFile:()=>file('a.md'),webkitGetAsEntry:()=>({isDirectory:false})},
  {kind:'file',getAsFile:()=>file('photo.png'),webkitGetAsEntry:()=>({isDirectory:false})},
  {kind:'file',getAsFile:()=>file('folder.md',0),webkitGetAsEntry:()=>({isDirectory:true})},
  {kind:'string',getAsFile:()=>null},
  {kind:'file',getAsFile:()=>file('b.TXT')},
 ]
 const result=classifyDrop({items,files:[]})
 assert.deepEqual(result.openable.map(f=>f.name),['a.md','b.TXT'])
 assert.deepEqual(result.skipped.map(f=>f.name),['photo.png'])
 assert.equal(result.directories,1)
 // Without DataTransferItem support, fall back to the file list.
 const fallback=classifyDrop({files:[file('x.markdown'),{...file('dir'),webkitRelativePath:'dir/a'}]})
 assert.deepEqual(fallback.openable.map(f=>f.name),['x.markdown']);assert.equal(fallback.directories,1)
 assert.deepEqual(classifyDrop(null),{openable:[],skipped:[],directories:0})
})

test('notices name the platform Open shortcut and describe skipped items',()=>{
 const macMessages=openDropMessages(mac),winMessages=openDropMessages(win)
 assert.equal(macMessages.unavailable,'无法获取文件位置，请使用 文件 → 打开…（⌘O）')
 assert.equal(winMessages.unavailable,'无法获取文件位置，请使用 文件 → 打开…（Ctrl+O）')
 assert.equal(macMessages.unsupported,'只能打开 .md / .markdown / .txt，图片和附件请拖到正文')
 assert.match(macMessages.tabbar,/拖到侧栏可打开文档/)
 assert.equal(skippedNotice({skipped:[],directories:0},macMessages),'')
 assert.equal(skippedNotice({skipped:[file('a.png'),file('b.pdf')],directories:0},macMessages),'已跳过 2 个文件：只能打开 .md / .markdown / .txt，图片和附件请拖到正文')
 assert.match(skippedNotice({skipped:[file('a.png')],directories:2},macMessages),/已跳过 1 个文件.*已跳过 2 个文件夹/)
})

test('open requests wait for startup, coalesce bursts and report failures',async()=>{
 const gate=deferred(),errors=[];let opens=0
 const requests=createOpenRequests({open:async()=>{opens++;if(opens===1)await gate.promise;if(opens===2)throw Error('磁盘不可读')},report:error=>errors.push(error.message)})
 requests.request();requests.request()
 await new Promise(r=>setImmediate(r));assert.equal(opens,0)
 const first=requests.start(false)
 assert.equal(opens,1)
 requests.request();requests.request()
 gate.resolve();await first
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r))
 assert.equal(opens,2);assert.deepEqual(errors,['磁盘不可读'])
 requests.dispose();await requests.request();assert.equal(opens,2)
})

test('an empty startup queue does not drain, a pending one drains once',async()=>{
 let opens=0
 const idle=createOpenRequests({open:async()=>{opens++},report:assert.fail})
 await idle.start(false);assert.equal(opens,0)
 const pending=createOpenRequests({open:async()=>{opens++},report:assert.fail})
 await pending.start(true);assert.equal(opens,1)
})

function coordinatorFixture(){
 const rows=new Map([['a',{id:'a',title:'a',path:null,revision:0,position:0,shelved:false,markdown:'# a',viewState:null}]])
 let activeId='a';const calls=[],queue=[]
 const snapshot=()=>({documents:[...rows.values()].map(({markdown,...doc})=>({...doc})),activeId})
 const api={
  list:async()=>snapshot(),read:async id=>({...rows.get(id)}),
  update:async(id,markdown,revision)=>{calls.push('update:'+markdown);Object.assign(rows.get(id),{markdown,revision});return snapshot()},
  view:async()=>snapshot(),
  openPending:async()=>{
   calls.push('openPending');const errors=[];let opened=0
   for(const entry of queue.splice(0)){
    if(entry.error){errors.push(entry.error);continue}
    rows.set(entry.id,{id:entry.id,title:entry.id+'.md',path:'/synthetic/'+entry.id+'.md',revision:0,position:rows.size,shelved:false,markdown:entry.markdown,viewState:null});activeId=entry.id;opened++
   }
   return {snapshot:opened?snapshot():null,opened,errors}
  },
 }
 const port={current:null,ready:async()=>{},waitComposition:async()=>{},activate:async doc=>{calls.push('activate:'+doc.id);port.current={...doc,viewState:{mode:'rendered',scrollTop:0}}},capture:()=>port.current?{...port.current}:null,clear:()=>port.current=null}
 const state={}
 const coordinator=new DocumentCoordinator(api,port,state,{autosaveMs:60000})
 return {coordinator,api,port,state,rows,calls,queue}
}
test('coordinator opens queued paths after flushing the current page and activates the last one',async()=>{
 const {coordinator,port,state,calls,queue,rows}=coordinatorFixture()
 await coordinator.boot();calls.length=0
 port.current.markdown='# a 未保存的最后输入'
 queue.push({id:'one',markdown:'第一篇'},{error:'「bad.md」无法打开：文件不是 UTF-8 编码。'},{id:'two',markdown:'第二篇'})
 const result=await coordinator.openPending()
 assert.deepEqual(calls,['update:# a 未保存的最后输入','openPending','activate:two'])
 assert.equal(rows.get('a').markdown,'# a 未保存的最后输入')
 assert.equal(state.activeId,'two');assert.equal(state.markdown,'第二篇');assert.equal(result.opened,2)
 assert.match(state.error,/bad\.md/);assert.equal(state.busy,false)
 coordinator.dispose()
})
test('an empty drain keeps the current page and the coordinator queue stays serial',async()=>{
 const {coordinator,api,state,calls}=coordinatorFixture()
 await coordinator.boot();calls.length=0
 const gate=deferred(),original=api.update
 api.update=async(...args)=>{await gate.promise;return original(...args)}
 const save=coordinator.run(async()=>{calls.push('held');await gate.promise})
 const drain=coordinator.openPending()
 await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['held'])
 gate.resolve();await save;const result=await drain
 assert.deepEqual(calls,['held','openPending']);assert.equal(result.snapshot,null)
 assert.equal(state.activeId,'a');assert.equal(state.error,'')
 coordinator.dispose()
})

test('drop claims send only name/size; WebView2 attaches the File objects to a string message first',async()=>{
 const files=[{name:'a.md',size:3,path:'/must/not/leak'},{name:'b.txt',size:5}],calls=[]
 const invoke=async(command,args)=>{calls.push(['invoke',command,structuredClone(args)]);return {unavailable:false,accepted:2,errors:[]}}
 const webview={postMessageWithAdditionalObjects:(message,objects)=>calls.push(['post',message,objects])}
 const token='0123456789abcdef0123456789abcdef'
 await claimDroppedFiles(files,{invoke,webview,token})
 assert.equal(calls[0][0],'post');assert.equal(calls[0][1],DROP_MESSAGE_PREFIX+token);assert.equal(calls[0][2],files)
 assert.deepEqual(calls[1],['invoke','claim_dropped_documents',{token,files:[{name:'a.md',size:3},{name:'b.txt',size:5}]}])
 assert.doesNotMatch(JSON.stringify(calls[1]),/must\/not\/leak/)
 // macOS WKWebView has no chrome.webview: the host reads its drag pasteboard.
 calls.length=0;await claimDroppedFiles(files,{invoke,webview:null,token})
 assert.deepEqual(calls.map(call=>call[0]),['invoke'])
 // Old WebView2 runtimes lack additional objects: no path, so no claim at all.
 calls.length=0
 assert.deepEqual(await claimDroppedFiles(files,{invoke,webview:{postMessage(){}},token}),{unavailable:true,accepted:0,errors:[]})
 assert.equal(calls.length,0)
 assert.match(dropToken(),/^[0-9a-f]{32}$/)
 assert.notEqual(dropToken(),dropToken())
})
test('a first launch through Open with does not add a blank page; otherwise boot still creates one',async()=>{
 for(const pending of [true,false]){
  let created=0
  const api={list:async()=>({documents:[],activeId:null}),create:async()=>{created++;return {documents:[{id:'n',title:'未命名笔记',path:null,revision:0,position:0,shelved:false}],activeId:'n'}},read:async id=>({id,markdown:'',revision:0}),hasPendingOpen:async()=>pending}
  const port={ready:async()=>{},activate:async()=>{},clear:()=>{},capture:()=>null}
  const state={},coordinator=new DocumentCoordinator(api,port,state,{autosaveMs:60000})
  await coordinator.boot();coordinator.dispose()
  assert.equal(created,pending?0:1);assert.equal(state.loaded,true);assert.equal(state.activeId,pending?null:'n')
 }
 // A failed probe must not block startup.
 let created=0
 const api={list:async()=>({documents:[],activeId:null}),create:async()=>{created++;return {documents:[],activeId:null}},hasPendingOpen:async()=>{throw Error('ipc')}}
 const coordinator=new DocumentCoordinator(api,{ready:async()=>{},clear:()=>{},capture:()=>null},{},{autosaveMs:60000})
 await coordinator.boot();coordinator.dispose();assert.equal(created,1)
})
