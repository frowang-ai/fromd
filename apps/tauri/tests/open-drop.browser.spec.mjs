import {test,expect} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
import {installMockHost} from './mock-host.mjs'

// Synthetic files only. The mock's dropSource stands in for the macOS drag
// pasteboard / WebView2 File paths; claims are matched by name and size.
const png=[...await readFile(new URL('./fixtures/synthetic-resource.png',import.meta.url))]
const disk=[['/synthetic/one.md','# 第一篇\n\n合成正文一。\n'],['/synthetic/two.markdown','# 第二篇\n'],['/synthetic/three.txt','纯文本合成。\n']]
const text=path=>disk.find(entry=>entry[0]===path)[1]
const bytes=path=>new TextEncoder().encode(text(path)).length
const source=(...paths)=>paths.map(path=>({path,size:bytes(path)}))
const file=path=>({name:path.split('/').pop(),text:text(path),type:path.endsWith('.txt')?'text/plain':'text/markdown'})
const image={name:'photo.png',bytes:png,type:'image/png'}
const host=page=>page.evaluate(()=>{const h=window.__FROWD_TEST_HOST__;return {entered:{...h.entered},calls:h.calls.map(call=>call.command),claims:h.calls.filter(call=>call.command==='claim_dropped_documents').map(call=>call.args),rows:[...h.rows.values()].map(({id,title,path,markdown,shelved})=>({id,title,path,markdown,shelved})),pending:h.pendingOpen.length}})
const tabTitles=page=>page.locator('.tab .tab-title').allTextContents()

async function boot(page,platform,options={}){
 await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown:'Alpha\n\nBeta\n',shelved:false}],disk,...options})
 await page.goto('/?testHost=1&testPlatform='+platform)
 await expect(page.locator('.loading-state')).toHaveCount(0)
}
async function drag(target,files,{x=null,y=null,directory=false,drop=true}={}){
 return target.evaluate((el,{files,x,y,directory,drop})=>{
  const rect=el.getBoundingClientRect(),clientX=x??rect.left+Math.min(rect.width/2,40),clientY=y??rect.top+rect.height/2,data=new DataTransfer()
  for(const item of files){const value=new File([item.bytes?new Uint8Array(item.bytes):item.text],item.name,{type:item.type});if(directory)Object.defineProperty(value,'webkitRelativePath',{value:item.name+'/inner.md'});data.items.add(value)}
  if(directory&&data.items[0])Object.defineProperty(data.items[0],'webkitGetAsEntry',{value:()=>({isDirectory:true})})
  // Observe the effect the app requests; synthetic DataTransfer ignores it.
  let effect='none';Object.defineProperty(data,'dropEffect',{configurable:true,get:()=>effect,set:value=>{effect=value}})
  const over=new DragEvent('dragover',{bubbles:true,cancelable:true,clientX,clientY,dataTransfer:data});el.dispatchEvent(over)
  const result={overPrevented:over.defaultPrevented,dropEffect:data.dropEffect}
  if(drop){const event=new DragEvent('drop',{bubbles:true,cancelable:true,clientX,clientY,dataTransfer:data});el.dispatchEvent(event);result.dropPrevented=event.defaultPrevented}
  return result
 },{files,x,y,directory,drop})
}
const alert=page=>page.getByRole('alert')

test('macOS sidebar drop opens the real file through a name/size-only native claim',async({page})=>{
 await boot(page,'macos',{dropSource:source('/synthetic/one.md')})
 const result=await drag(page.locator('.sidebar .page-search'),[file('/synthetic/one.md')])
 expect(result.dropPrevented).toBe(true)
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('one.md')
 await expect(page.locator('.ProseMirror:visible')).toContainText('合成正文一')
 await expect(page.locator('.name-dock .file-name')).toHaveText('one.md')
 const state=await host(page)
 expect(state.claims).toHaveLength(1)
 expect(state.claims[0].files).toEqual([{name:'one.md',size:bytes('/synthetic/one.md')}])
 expect(JSON.stringify(state.claims[0])).not.toContain('/synthetic')
 expect(state.entered.open_pending_documents).toBe(1)
 expect(state.entered.import_resources??0).toBe(0);expect(state.entered.create_document??0).toBe(0)
 await expect(alert(page)).toHaveCount(0)
})

test('hovering an open area shows release-to-open with a copy effect; tab reorder ignores files',async({page})=>{
 await boot(page,'windows')
 const row=page.locator('.sidebar .page-row').first(),before=await row.boundingBox()
 const over=await drag(page.locator('.sidebar'),[file('/synthetic/one.md')],{drop:false})
 expect(over).toMatchObject({overPrevented:true,dropEffect:'copy'})
 await expect(page.locator('.sidebar.open-drop-target')).toBeVisible()
 await expect(page.locator('.drag-hint.drag-hint-open')).toHaveText('松开以打开')
 // The hint floats beside the cursor: hovering never shifts the sidebar rows.
 expect(await row.boundingBox()).toEqual(before)
 // Body keeps the resource path: no open feedback there.
 await drag(page.locator('.ProseMirror:visible'),[file('/synthetic/one.md')],{drop:false})
 await expect(page.locator('.open-drop-target')).toHaveCount(0)
 await expect(page.locator('.drag-hint')).toHaveCount(0)
 // Windows top bars highlight together; external files show no insertion bar.
 const tab=page.locator('.tab').first()
 expect(await drag(tab,[file('/synthetic/one.md')],{drop:false})).toMatchObject({overPrevented:true,dropEffect:'copy'})
 await expect(page.locator('.tabbar.open-drop-target')).toBeVisible()
 await expect(page.locator('.app-header.open-drop-target')).toBeVisible()
 await expect(page.locator('.tab.drop-before, .tab.drop-after')).toHaveCount(0)
 await expect(page.locator('.open-drop-target')).toHaveCount(0,{timeout:3000})
})

test('macOS tab bar rejects with a sidebar hint; Windows titlebar and tab bar both open',async({page})=>{
 await boot(page,'macos',{dropSource:source('/synthetic/one.md')})
 // A refused target (dropEffect none) never receives drop, so the hint must show while hovering.
 expect(await drag(page.locator('.tab').first(),[file('/synthetic/one.md')],{drop:false})).toMatchObject({overPrevented:true,dropEffect:'none'})
 await expect(page.locator('.drag-hint.drag-hint-reject')).toContainText('拖到侧栏可打开文档')
 await expect(page.locator('.tabbar.open-drop-target')).toHaveCount(0)
 await drag(page.locator('.tab').first(),[file('/synthetic/one.md')])
 await expect(alert(page)).toContainText('拖到侧栏可打开文档')
 await expect(page.locator('.tab.drop-before, .tab.drop-after')).toHaveCount(0)
 expect((await host(page)).claims).toHaveLength(0)
 expect(await tabTitles(page)).toEqual(['A'])

 await boot(page,'windows',{dropSource:source('/synthetic/one.md','/synthetic/two.markdown')})
 await drag(page.locator('.tab').first(),[file('/synthetic/one.md')])
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('one.md')
 await drag(page.locator('.app-header .window-document'),[file('/synthetic/two.markdown')])
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('two.markdown')
 // New tabs are appended; no insertion between tabs.
 expect(await tabTitles(page)).toEqual(['A','one.md','two.markdown'])
 await expect(alert(page)).toHaveCount(0)
})

test('mixed drops open text files and name the skipped ones; images and folders alone are refused',async({page})=>{
 await boot(page,'macos',{dropSource:source('/synthetic/one.md')})
 await drag(page.locator('.sidebar'),[file('/synthetic/one.md'),image])
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('one.md')
 await expect(alert(page)).toContainText('已跳过 1 个文件：只能打开 .md / .markdown / .txt，图片和附件请拖到正文')
 expect((await host(page)).claims[0].files.map(f=>f.name)).toEqual(['one.md'])
 await page.getByRole('button',{name:'关闭错误提示'}).click()

 await drag(page.locator('.sidebar'),[image])
 expect(await alert(page).locator('span').textContent()).toBe('只能打开 .md / .markdown / .txt，图片和附件请拖到正文')
 await page.getByRole('button',{name:'关闭错误提示'}).click()
 await drag(page.locator('.sidebar'),[{name:'notes.md',text:'',type:''}],{directory:true})
 await expect(alert(page)).toContainText('不能打开文件夹')
 const state=await host(page)
 expect(state.claims).toHaveLength(1);expect(state.entered.import_resources??0).toBe(0)
})

for(const [platform,shortcut] of [['macos','⌘O'],['windows','Ctrl+O']])test(`${platform}: no real path means no draft, only the ${shortcut} hint`,async({page})=>{
 await boot(page,platform,{dropSource:null})
 const before=(await host(page)).rows.length
 await drag(page.locator('.sidebar'),[file('/synthetic/one.md')])
 await expect(alert(page)).toContainText(`无法获取文件位置，请使用 文件 → 打开…（${shortcut}）`)
 expect(await alert(page).locator('span').textContent()).toBe(`无法获取文件位置，请使用 文件 → 打开…（${shortcut}）`)
 const state=await host(page)
 expect(state.rows).toHaveLength(before);expect(state.entered.create_document??0).toBe(0);expect(state.entered.open_pending_documents??0).toBe(0)
 expect(await tabTitles(page)).toEqual(['A'])
})

test('several files open in order with the last active; an already-open file is reactivated',async({page})=>{
 await boot(page,'macos',{dropSource:source('/synthetic/one.md','/synthetic/two.markdown','/synthetic/three.txt')})
 await drag(page.locator('.sidebar'),['/synthetic/one.md','/synthetic/two.markdown','/synthetic/three.txt'].map(file))
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('three.txt')
 expect(await tabTitles(page)).toEqual(['A','one.md','two.markdown','three.txt'])
 await page.locator('.tab .tab-title').first().click();await expect(page.locator('.tab.selected .tab-title')).toHaveText('A')
 await drag(page.locator('.sidebar'),[file('/synthetic/one.md')])
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('one.md')
 expect(await tabTitles(page)).toEqual(['A','one.md','two.markdown','three.txt'])
})

test('with every page shelved the empty editor panel opens instead of rejecting',async({page})=>{
 await boot(page,'macos',{documents:[{id:'a',title:'A',markdown:'收起',shelved:true}],activeId:null,dropSource:source('/synthetic/two.markdown')})
 await expect(page.locator('.empty-desktop')).toBeVisible()
 expect(await drag(page.locator('.empty-desktop'),[file('/synthetic/two.markdown')],{drop:false})).toMatchObject({dropEffect:'copy'})
 await expect(page.locator('.editor-panel.open-drop-target')).toBeVisible()
 await drag(page.locator('.empty-desktop'),[file('/synthetic/two.markdown')])
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('two.markdown')
 await expect(page.locator('.ProseMirror:visible')).toContainText('第二篇')
})

test('body side margins insert attachments at the nearest line position; .md in the body stays an attachment link',async({page})=>{
 await boot(page,'windows')
 const scroller=await page.locator('.pm-scroller').boundingBox(),first=await page.locator('.ProseMirror:visible p').first().boundingBox()
 const content=await page.locator('.ProseMirror:visible').boundingBox()
 const left=scroller.x+8,right=scroller.x+scroller.width-8,y=first.y+first.height/2
 expect(left).toBeLessThan(content.x);expect(right).toBeGreaterThan(content.x+content.width)
 expect(await page.evaluate(({x,y})=>document.querySelector('.pm-port').__vueParentComponent.exposed.resourceDropPosition(x,y),{x:left,y})).toEqual(expect.any(Number))
 await drag(page.locator('.pm-scroller'),[image],{x:left,y})
 await expect.poll(async()=>(await host(page)).rows[0].markdown).toMatch(/^!\[photo\.png\]\(\.frowd-assets\/[a-f0-9]{64}\.png\)Alpha/)
 const line=await page.locator('.ProseMirror:visible p').first().boundingBox()
 await drag(page.locator('.pm-scroller'),[{name:'notes.md',text:'# 附件',type:'text/markdown'}],{x:right,y:line.y+line.height/2})
 await expect.poll(async()=>(await host(page)).rows[0].markdown).toMatch(/Alpha ?\[notes\.md\]\(\.frowd-assets\/[a-f0-9]{64}\.md\)\n\nBeta/)
 const state=await host(page)
 expect(state.entered.import_resources).toBe(2);expect(state.claims).toHaveLength(0)
 await expect(alert(page)).toHaveCount(0)
})

test('source mode and busy states wait, flush the current page, then open',async({page})=>{
 await boot(page,'macos',{dropSource:source('/synthetic/one.md','/synthetic/two.markdown')})
 await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:'源码'}).click()
 const textarea=page.getByRole('textbox',{name:'Markdown 源码'})
 await textarea.click();await textarea.press('End');await textarea.pressSequentially('源码追加')
 await drag(page.locator('.sidebar'),[file('/synthetic/one.md')])
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('one.md')
 expect((await host(page)).rows.find(row=>row.id==='a').markdown).toContain('源码追加')

 // A held resource import keeps the coordinator busy; the claim happens now,
 // opening only after the import finishes.
 await page.locator('.tab .tab-title').first().click();await expect(page.locator('.tab.selected .tab-title')).toHaveText('A')
 await page.getByText('视图',{exact:true}).click();await page.locator('details[open] .menu-popup button').filter({hasText:'正文'}).click()
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('import_resources'))
 await drag(page.locator('.ProseMirror:visible'),[image])
 await expect(page.locator('.ProseMirror:visible')).toHaveAttribute('contenteditable','false')
 await drag(page.locator('.sidebar'),[file('/synthetic/two.markdown')])
 await expect.poll(async()=>(await host(page)).claims.length).toBe(2)
 expect((await host(page)).entered.open_pending_documents).toBe(1)
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('import_resources'))
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('two.markdown')
 const state=await host(page)
 expect(state.entered.open_pending_documents).toBe(2)
 expect(state.rows.find(row=>row.id==='a').markdown).toContain('.frowd-assets/')
})

test('Open with requests queued before boot are claimed once; live requests open and report failures',async({page})=>{
 await boot(page,'macos',{pendingOpen:[{path:'/synthetic/one.md'}]})
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('one.md')
 let state=await host(page)
 expect(state.entered.has_pending_open).toBe(1);expect(state.entered.open_pending_documents).toBe(1);expect(state.pending).toBe(0)
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.requestOpen([{path:'/synthetic/three.txt'},{error:'「bad.md」无法打开：文件不是 UTF-8 编码。请先以 UTF-8 保存再打开。'}]))
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('three.txt')
 await expect(alert(page)).toContainText('bad.md')
 state=await host(page)
 expect(state.entered.open_pending_documents).toBe(2)
})

test('first launch through Open with shows the file without an extra blank page',async({page})=>{
 await boot(page,'windows',{documents:[],activeId:null,pendingOpen:[{path:'/synthetic/one.md'}]})
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('one.md')
 expect(await tabTitles(page)).toEqual(['one.md'])
 expect((await host(page)).entered.create_document??0).toBe(0)
})

test('live Open with backs up and syncs the outgoing file before draining the native queue',async({page})=>{
 await boot(page,'windows',{
  documents:[{id:'a',title:'A.md',path:'/synthetic/a.md',markdown:'Alpha'}],
  holds:['sync_document_file']
 })
 const editor=page.locator('.ProseMirror:visible')
 await editor.focus();await page.keyboard.press('End');await page.keyboard.insertText(' outgoing edit')
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.requestOpen([{path:'/synthetic/one.md'}]))
 await expect.poll(async()=>(await host(page)).entered.sync_document_file??0).toBe(1)
 const pending=await host(page)
 expect(pending.calls.indexOf('update_document')).toBeLessThan(pending.calls.indexOf('sync_document_file'))
 expect(pending.entered.open_pending_documents??0).toBe(0)
 expect(pending.rows.find(row=>row.id==='a').markdown).toContain('outgoing edit')
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('sync_document_file'))
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('one.md')
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a').savedText)).toContain('outgoing edit')
})

test('an idle startup never freezes the editor to look for open requests',async({page})=>{
 await boot(page,'macos')
 const state=await host(page)
 expect(state.entered.has_pending_open).toBe(1);expect(state.entered.open_pending_documents??0).toBe(0)
 await expect(page.locator('.ProseMirror:visible')).toHaveAttribute('contenteditable','true')
})

test('protected dragover with empty files list still enables copy drop on sidebar and body margins',async({page})=>{
 await boot(page,'macos')
 const probe=(locator,coords={})=>locator.evaluate((el,{x,y})=>{
  const rect=el.getBoundingClientRect(),clientX=x??rect.left+12,clientY=y??rect.top+12
  let effect='none'
  const fakeTransfer={types:['Files'],files:[],items:[{kind:'file',type:''}],get dropEffect(){return effect},set dropEffect(v){effect=v}}
  const over=new Event('dragover',{bubbles:true,cancelable:true})
  Object.defineProperties(over,{clientX:{value:clientX},clientY:{value:clientY},dataTransfer:{value:fakeTransfer}})
  el.dispatchEvent(over)
  return {prevented:over.defaultPrevented,dropEffect:effect}
 },coords)
 expect(await probe(page.locator('.sidebar'))).toEqual({prevented:true,dropEffect:'copy'})
 await expect(page.locator('.sidebar.open-drop-target')).toBeVisible()
 const scroller=await page.locator('.pm-scroller').boundingBox(),first=await page.locator('.ProseMirror:visible p').first().boundingBox()
 expect(await probe(page.locator('.pm-scroller'),{x:scroller.x+6,y:first.y+8})).toEqual({prevented:true,dropEffect:'copy'})
 await expect(page.locator('.open-drop-target')).toHaveCount(0)
 await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:'源码'}).click()
 expect(await probe(page.getByRole('textbox',{name:'Markdown 源码'}))).toEqual({prevented:true,dropEffect:'none'})
 await expect(page.locator('.drag-hint.drag-hint-reject')).toHaveText('源码模式暂不支持按坐标拖入，请切换到正文模式。')
 // Outside the body and the open areas (e.g. the status row) the hint names the target.
 expect(await probe(page.locator('.save-state'))).toEqual({prevented:true,dropEffect:'none'})
 await expect(page.locator('.drag-hint.drag-hint-reject')).toHaveText('请将图片或附件拖到正文编辑区。')
})

test('reopening a shelved file unshelves and activates it; mixed drop preserves both skipped and open errors',async({page})=>{
 await boot(page,'macos',{
  documents:[
   {id:'a',title:'A',markdown:'Alpha\n',shelved:false},
   {id:'s',title:'one.md',path:'/synthetic/one.md',markdown:'# 第一篇\n',shelved:true},
  ],
  dropSource:[{path:'/synthetic/one.md',size:bytes('/synthetic/one.md')},{path:'/synthetic/missing.md',size:5}],
 })
 expect(await tabTitles(page)).toEqual(['A'])
 await drag(page.locator('.sidebar'),[file('/synthetic/one.md'),{name:'missing.md',text:'12345',type:'text/markdown'},image])
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('one.md')
 expect(await tabTitles(page)).toEqual(['A','one.md'])
 await expect(alert(page)).toContainText('已跳过 1 个文件')
 await expect(alert(page)).toContainText('missing.md')
})

// Real Chromium drag pipeline (CDP Input.dispatchDragEvent with an on-disk
// synthetic file). Unlike the synthetic DataTransfer events above, the browser
// itself decides here whether drop fires: only where dragover accepted it.
async function realDragOver(page,locator,path){
 const box=await locator.boundingBox(),x=Math.round(box.x+Math.min(box.width/2,40)),y=Math.round(box.y+box.height/2)
 const client=await page.context().newCDPSession(page),data={items:[],files:[path],dragOperationsMask:1}
 await client.send('Input.dispatchDragEvent',{type:'dragEnter',x,y,data})
 for(let i=0;i<3;i++){await client.send('Input.dispatchDragEvent',{type:'dragOver',x,y,data});await page.waitForTimeout(40)}
 return ()=>client.send('Input.dispatchDragEvent',{type:'drop',x,y,data})
}
test('real drag pipeline: macOS tab bar explains while hovering and never drops; sidebar and Windows tab bar open',async({page},testInfo)=>{
 const onDisk=testInfo.outputPath('one.md')
 await writeFile(onDisk,text('/synthetic/one.md'))
 await boot(page,'macos',{dropSource:source('/synthetic/one.md')})
 let release=await realDragOver(page,page.locator('.tab').first(),onDisk)
 await expect(page.locator('.drag-hint.drag-hint-reject')).toContainText('拖到侧栏可打开文档')
 await release()
 await expect(page.locator('.drag-hint')).toHaveCount(0)
 expect((await host(page)).claims).toHaveLength(0)
 expect(await tabTitles(page)).toEqual(['A'])

 release=await realDragOver(page,page.locator('.sidebar .page-row').first(),onDisk)
 await expect(page.locator('.drag-hint.drag-hint-open')).toHaveText('松开以打开')
 await release()
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('one.md')
 expect((await host(page)).claims).toHaveLength(1)

 await boot(page,'windows',{dropSource:source('/synthetic/one.md')})
 release=await realDragOver(page,page.locator('.tab').first(),onDisk)
 await release()
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('one.md')
 await expect(alert(page)).toHaveCount(0)
})
