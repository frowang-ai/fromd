import {test,expect} from '@playwright/test'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {installMockHost} from './mock-host.mjs'
const png=[...await readFile(new URL('./fixtures/synthetic-resource.png',import.meta.url))]
const evidence=fileURLToPath(new URL('../../../output/resource-cell-paste-fixed/',import.meta.url))
const body=page=>page.locator('.ProseMirror:visible')
const table=prefix=>prefix+'前正文\n\n| '+prefix+'H1 | '+prefix+'H2 | '+prefix+'H3 |\n| --- | --- | --- |\n'+[1,2,3].map(r=>'| '+[1,2,3].map(c=>prefix+r+c).join(' | ')+' |').join('\n')+'\n\n'+prefix+'后正文\n'
async function boot(page,resources){
 await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown:table('A'),shelved:false},{id:'b',title:'B',markdown:table('B'),shelved:false}]})
 await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0)
 if(resources){
  await page.locator('.ProseMirror td').filter({hasText:'A11'}).locator('p').click();await page.keyboard.press('End')
  await body(page).evaluate((el,png)=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(png)],'PNG.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))},png)
  await expect(page.locator('img[data-editor-image-src]')).toHaveCount(1)
  await page.locator('.ProseMirror td').filter({hasText:'A12'}).locator('p').click();await page.keyboard.press('End')
  await page.evaluate(()=>{const payload=[1,2,3];window.__FROWD_TEST_HOST__.resourceChoice={payload,metadata:[{name:'附件.txt',size:3,image:false}]}})
  await page.getByText('文件',{exact:true}).click();await page.getByRole('button',{name:'插入附件…'}).click()
  await expect(page.locator('.ProseMirror a')).toHaveCount(1)
 }
}
async function capture(page){
 return page.evaluate(()=>{
  const s=document.querySelector('.pm-port').__vueParentComponent.exposed.capture(),doc=s.pm.state.doc,selection=s.pm.state.selection,tables=[]
  doc.descendants(node=>{if(node.type.name==='table'){const rows=[];node.forEach(row=>{const cells=[];row.forEach(cell=>cells.push({text:cell.textContent.replaceAll('附件.txt','').replace(/\s/g,''),colspan:cell.attrs.colspan,rowspan:cell.attrs.rowspan}));rows.push(cells)});tables.push(rows)}})
  let images=0,links=0;doc.descendants(n=>{if(n.type.name==='image')images++;if(n.marks.some(m=>m.type.name==='link'))links++})
  return {id:s.id,markdown:s.markdown,tables,images,links,pipeline:(()=>{const c=document.querySelector('.writing-editor').__vueParentComponent;const v=c.setupState.view?.();return v? v.state.plugins.filter(p=>p.props.handlePaste).map(p=>p.key):Object.keys(c.setupState)})(),type:selection.constructor.name,selection:selection.toJSON(),selected:document.querySelectorAll('.selectedCell').length,text:doc.textContent}
 })
}
async function rowSelection(page,prefix,two){
 await page.locator('.ProseMirror td').filter({hasText:prefix+'11'}).hover();await page.waitForTimeout(120)
 await page.locator('[data-role="row-drag-handle"]').click()
 if(two)await body(page).press('Shift+ArrowDown')
 const s=await capture(page);expect(s.type).toMatch(/^CellSelection/);expect(s.selected).toBe(two?6:3)
}
async function copy(page,shape){
 if(shape==='single'){await page.locator('.ProseMirror td').filter({hasText:'A11'}).locator('p').click({clickCount:3,position:{x:6,y:12}});expect((await capture(page)).type).toMatch(/^CellSelection/)}
 else await rowSelection(page,'A',true)
 return body(page).evaluate(el=>{const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return {html:data.getData('text/html'),text:data.getData('text/plain')}})
}
async function paste(page,data){
 await body(page).evaluate((el,data)=>{const clipboardData=new DataTransfer();clipboardData.setData('text/plain',data.text);clipboardData.setData('text/html',data.html);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}))},data)
}
async function scenario(browser,resources,shape,target){
 const context=await browser.newContext({viewport:{width:1280,height:860},reducedMotion:'reduce'}),page=await context.newPage()
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('paste-page-error',e.message)})
 await boot(page,resources);const copied=await copy(page,shape)
 expect(copied.html).toContain('table')
 if(resources)expect(copied.html).toContain('data-editor-image-src=".frowd-assets/')
 await page.locator('[data-tab-id="b"] .tab-title').click();await expect.poll(async()=> (await capture(page)).id).toBe('b');await expect(body(page)).toHaveAttribute('contenteditable','true')
 if(target==='rectangle')await rowSelection(page,'B',true)
 else if(target==='column'){await page.locator('.ProseMirror td').filter({hasText:'B11'}).hover();await page.waitForTimeout(120);await page.locator('[data-role="col-drag-handle"]').click();expect((await capture(page)).selected).toBe(4)}
 else if(target==='text-cell'){await page.locator('.ProseMirror td').filter({hasText:'B11'}).locator('p').click();await page.keyboard.press('End');expect((await capture(page)).type).toMatch(/TextSelection/)}
 else {await body(page).locator(':scope>p').last().click();await page.keyboard.press('End');expect((await capture(page)).type).toMatch(/TextSelection/)}
 const before=await capture(page)
 await page.evaluate(()=>{
  const v=document.querySelector('.writing-editor').__vueParentComponent.setupState.view()
  window.__pasteTrace=[];window.__pasteDispatches=[]
  const dispatch=v.dispatch.bind(v)
  v.dispatch=tr=>{if(tr.docChanged)window.__pasteDispatches.push({domEditable:v.dom.getAttribute('contenteditable'),inert:document.querySelector('.pm-port').inert});return dispatch(tr)}
  for(const plugin of v.state.plugins)if(plugin.props.handlePaste){
   const original=plugin.props.handlePaste
   plugin.props.handlePaste=function(...args){const result=original.apply(this,args);window.__pasteTrace.push({key:plugin.key,handled:Boolean(result),planning:args[0]!==v,domEditable:document.querySelector('.ProseMirror').getAttribute('contenteditable'),inert:document.querySelector('.pm-port').inert});return result}
  }
 })
 await paste(page,copied)
 await expect.poll(async()=> (await capture(page)).text).toContain('A11')
 await expect.poll(()=>page.evaluate(()=>document.querySelector('.ProseMirror').getAttribute('contenteditable'))).toBe('true')
 const after=await capture(page);after.handlerTrace=await page.evaluate(()=>window.__pasteTrace);after.dispatchTrace=await page.evaluate(()=>window.__pasteDispatches);expect(after.text).toContain('B前正文');expect(after.text).toContain('B后正文')
 if(resources){
  expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.reuse_resources)).toBe(1)
  await expect.poll(()=>page.locator('img[data-editor-image-src]').evaluateAll(imgs=>imgs.filter(i=>i.naturalWidth>0).length)).toBe(after.images)
 }
 await mkdir(evidence,{recursive:true});await writeFile(evidence+(resources?'resource-':'control-')+shape+'-'+target+'.json',JSON.stringify({before,after,copied,errors},null,2))
 await page.screenshot({path:evidence+(resources?'resource-':'control-')+shape+'-'+target+'.png'})
 expect(errors).toEqual([])
 return {context,page,before,after}
}
for(const [shape,target] of [['single','rectangle'],['rows','rectangle'],['rows','text-cell'],['single','column'],['single','body']])test('resource table paste matches native control '+shape+' -> '+target,async({browser})=>{
 const control=await scenario(browser,false,shape,target),resources=await scenario(browser,true,shape,target)
 try{
  expect(resources.after.tables).toEqual(control.after.tables)
  expect(resources.after.text.replaceAll('附件.txt','').replace(/\s/g,'' )).toBe(control.after.text.replace(/\s/g,''))
  for(const run of [control,resources]){
   expect(run.after.tables).toHaveLength(target==='body'?2:1)
   if(target!=='column')expect(run.after.tables[0][0]).toEqual(run.before.tables[0][0])
   if(target!=='column')expect(run.after.tables[0][3]).toEqual(run.before.tables[0][3])
   expect(run.after.tables[0]).toHaveLength(4)
   if(target!=='body'){
    if(target==='column'){expect(run.after.tables[0].map(row=>row[0].text)).toEqual(['A11','A11','A11','A11']);expect(run.after.tables[0].map(row=>row.slice(1))).toEqual(run.before.tables[0].map(row=>row.slice(1)))}
    else expect(run.after.tables[0].slice(1,3).map(r=>r.map(c=>c.text))).toEqual(shape==='single'?[['A11','A11','A11'],['A11','A11','A11']]:target==='narrow'?[['A11','A12','B13'],['A21','A22','B23']]:[['A11','A12','A13'],['A21','A22','A23']])
    expect(run.after.handlerTrace).toHaveLength(1);expect(run.after.handlerTrace[0].key).toBe('selectingCells$')
   }else {expect(run.after.tables[0]).toEqual(run.before.tables[0]);expect(run.after.handlerTrace[0].key).toBe('MILKDOWN_CLIPBOARD$')}
   expect(run.after.handlerTrace[0].handled).toBe(true)
   await body(run.page).press('Control+z');await expect.poll(async()=> (await capture(run.page)).markdown).toBe(run.before.markdown)
   await body(run.page).press('Control+y');await expect.poll(async()=> (await capture(run.page)).markdown).toBe(run.after.markdown)
  }
  expect(resources.after.images).toBe(target==='column'?4:shape==='single'&&target==='rectangle'?6:1)
  expect(resources.after.links).toBe(shape==='rows'?1:0)
  if(target!=='body')expect(resources.after.handlerTrace[0].planning).toBe(true)
  expect(resources.after.dispatchTrace).toEqual([{domEditable:'false',inert:true}])

 }finally{await control.context.close();await resources.context.close()}
})

test('ordinary non-table HTML and formula recovery preserve marks, table and undo',async({page})=>{
 await boot(page,false);await body(page).locator(':scope>p').last().click();await page.keyboard.press('End')
 const before=await capture(page)
 await paste(page,{html:'<p>HTML <strong>粗体</strong> <em>斜体</em></p>',text:'HTML 粗体 斜体'})
 await expect(body(page).locator('strong')).toHaveText('粗体');await expect(body(page).locator('em')).toHaveText('斜体')
 expect((await capture(page)).tables).toEqual(before.tables)
 await body(page).press('Control+z');await expect.poll(async()=> (await capture(page)).markdown).toBe(before.markdown)
 await body(page).press('Control+y');await expect(body(page).locator('strong')).toHaveText('粗体')
 await paste(page,{html:'<p>公式 </p>',text:'公式 \\(x+1\\)'})
 await expect.poll(async()=> (await capture(page)).markdown).toContain('$x+1$')
 expect((await capture(page)).tables).toEqual(before.tables)
})
test('literal code clipboard stays literal and never grants resource ownership',async({page})=>{
 const fence=String.fromCharCode(96).repeat(3),literal='![example](.frowd-assets/'+'b'.repeat(64)+'.png)'
 await page.addInitScript(installMockHost,{markdown:'前正文\n\n'+fence+'text\nCODE\n'+fence+'\n\n后正文\n'})
 await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0)
 const code=page.locator('.cm-content:visible').first();await code.click();await code.press('Control+End')
 await code.evaluate((el,text)=>{const clipboardData=new DataTransfer();clipboardData.setData('text/plain',text);clipboardData.setData('text/html','<strong>not rich in code</strong>');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}))},literal)
 await expect(code).toContainText(literal)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.reuse_resources||0)).toBe(0)
 await expect(page.locator('img[data-editor-image-src]')).toHaveCount(0)
})
for(const unknown of [false,true])test('resource qualification covers formula-recovered final slice (unknown='+unknown+')',async({page})=>{
 await boot(page,true)
 const ref=await page.evaluate(()=>[...window.__FROWD_TEST_HOST__.bindings.get('a')].find(ref=>ref.endsWith('.png')))
 await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:'源码'}).click()
 await page.getByRole('textbox',{name:'Markdown 源码',exact:true}).fill('A11 ![PNG]('+ref+')\n')
 await page.getByText('视图',{exact:true}).click();await page.locator('details[open] .menu-popup button').filter({hasText:'正文'}).first().click()
 await body(page).click();await body(page).press('Control+a')
 const copied=await body(page).evaluate(el=>{const clipboardData=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{clipboardData,bubbles:true,cancelable:true}));return {html:clipboardData.getData('text/html'),text:clipboardData.getData('text/plain')}})
 expect(copied.html).toContain('data-editor-image-src')
 copied.text='A11 \\(x+1\\) ![PNG]('+ref+')'+(unknown?' ![unknown](.frowd-assets/'+'b'.repeat(64)+'.png)':'')
 await page.locator('[data-tab-id="b"] .tab-title').click()
 await body(page).locator(':scope>p').last().click();await page.keyboard.press('End')
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 const before=await capture(page);await paste(page,copied)
 if(unknown){
  await expect(page.getByRole('alert')).toContainText('重新导入')
  const after=await capture(page);expect(after.markdown).toBe(before.markdown);expect(after.selection).toEqual(before.selection)
  expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.bindings.get('b')?.size||0)).toBe(0)
 }else{
  await expect.poll(async()=> (await capture(page)).markdown).toContain('$x+1$')
  await expect(page.locator('img[data-editor-image-src]')).toHaveCount(1)
  expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.reuse_resources)).toBe(1)
  expect((await capture(page)).tables).toEqual(before.tables)
  await body(page).press('Control+z');await expect.poll(async()=> (await capture(page)).markdown).toBe(before.markdown)
 }
})

test('ordinary marked HTML fills a header/data column and preserves other columns',async({page})=>{
 await boot(page,false);await page.locator('[data-tab-id="b"] .tab-title').click()
 await expect.poll(async()=> (await capture(page)).id).toBe('b')
 await page.locator('.ProseMirror td').filter({hasText:'B11'}).hover();await page.waitForTimeout(120);await page.locator('[data-role="col-drag-handle"]').click()
 expect((await capture(page)).selected).toBe(4)
 const before=await capture(page);await paste(page,{html:'<p><strong>FILL</strong></p>',text:'FILL'})
 await expect.poll(async()=> (await capture(page)).tables[0].map(row=>row[0].text)).toEqual(['FILL','FILL','FILL','FILL'])
 const after=await capture(page);expect(after.tables).toHaveLength(1)
 expect(after.tables[0].map(row=>row.slice(1))).toEqual(before.tables[0].map(row=>row.slice(1)))
 await expect(page.locator('.ProseMirror strong')).toHaveCount(4)
 await body(page).press('Control+z');await expect.poll(async()=> (await capture(page)).markdown).toBe(before.markdown)
})

test('new File paste uses the same frozen table continuation and one undo',async({page})=>{
 await boot(page,false);await rowSelection(page,'A',true);const before=await capture(page)
 await body(page).evaluate((el,png)=>{const clipboardData=new DataTransfer();clipboardData.items.add(new File([new Uint8Array(png)],'PNG.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}))},png)
 await expect.poll(()=>page.locator('img[data-editor-image-src]').evaluateAll(imgs=>imgs.filter(img=>img.naturalWidth>0).length)).toBe(6)
 const after=await capture(page);expect(after.tables).toHaveLength(1);expect(after.tables[0]).toHaveLength(4)
 expect(after.tables[0][0]).toEqual(before.tables[0][0]);expect(after.tables[0][3]).toEqual(before.tables[0][3])
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.import_resources)).toBe(1)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.reuse_resources||0)).toBe(0)
 await body(page).press('Control+z');await expect.poll(async()=> (await capture(page)).markdown).toBe(before.markdown)
 await body(page).press('Control+y');await expect(page.locator('img[data-editor-image-src]')).toHaveCount(6)
})

const missing='.frowd-assets/'+'d'.repeat(64)+'.png'
test('cross-directory cell paste copies only kept images and reuses legacy bindings',async({page})=>{
 const kept='first.assets/kept.png',clipped='first.assets/clipped.png'
 const legacy='.frowd-assets/'+'b'.repeat(64)+'.png'
 const image={mime:'image/png',base64:Buffer.from(png).toString('base64')}
 await page.addInitScript(installMockHost,{
  documents:[
   {id:'a',title:'A',path:'/source/first.md',markdown:table('A')
    .replace('A11',`A11 ![kept](${kept}) ![legacy](${legacy})`).replace('A12',`A12 ![clipped](${clipped})`)},
   {id:'b',title:'B',path:'/target/second.md',markdown:table('B')},
  ],
  localResources:[['/source/'+kept,image],['/source/'+clipped,image]],
  objects:[[legacy,image]],bindings:[['a',[legacy]]],
 })
 await page.goto('/?testHost=1');await expect(body(page)).toBeVisible()
 const copied=await copy(page,'rows')
 expect(copied.html).toContain('data-frowd-copy')
 expect(copied.html).toContain(clipped)
 await page.locator('[data-tab-id="b"] .tab-title').click()
 await expect.poll(async()=>(await capture(page)).id).toBe('b')
 await body(page).locator('td').filter({hasText:'B11'}).locator('p').click({clickCount:3,position:{x:6,y:12}})
 const before=await capture(page)
 expect(before.selected).toBe(1)
 await paste(page,copied)
 await expect.poll(async()=>(await capture(page)).markdown).toContain('second.assets/kept.png')
 const after=await capture(page)
 expect(after.markdown).not.toContain(clipped)
 expect(after.markdown).toContain(legacy)
 expect(after.images).toBe(2)
 expect(after.tables[0][1].slice(1)).toEqual(before.tables[0][1].slice(1))
 const migrated=await page.evaluate(()=>window.__FROWD_TEST_HOST__.calls.filter(c=>c.command==='copy_document_images').map(c=>c.args.images))
 expect(migrated).toEqual([[kept]])
 await body(page).press('Control+z')
 await expect.poll(async()=>(await capture(page)).markdown).toBe(before.markdown)
})

async function cropFixture(page,kind){
 await boot(page,true)
 const refs=await page.evaluate(()=>[...window.__FROWD_TEST_HOST__.bindings.get('a')])
 const image=refs.find(ref=>ref.endsWith('.png')),attachment=refs.find(ref=>ref.endsWith('.txt'))
 const values=[['A11','A12','A13'],['A21','A22','A23']]
 if(kind==='all-clipped'){values[0][1]+=' ![known]('+image+')';values[1][2]+=' ![missing]('+missing+')'}
 else if(kind==='kept-unknown'){values[0][0]+=' ![known]('+image+')';values[1][0]+=' ![missing]('+missing+')'}
 else {values[0][0]+=' ![known]('+image+')';values[0][1]+=' [attachment]('+attachment+')';if(kind.startsWith('horizontal'))values[0][2]+=' ![missing]('+missing+')';if(kind==='vertical')values[1][0]+=' ![missing]('+missing+')'}
 const markdown='A前正文\n\n| AH1 | AH2 | AH3 |\n| --- | --- | --- |\n'+values.map(row=>'| '+row.join(' | ')+' |').join('\n')+'\n| A31 | A32 | A33 |\n\nA后正文\n'
 await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:'源码'}).click()
 await page.getByRole('textbox',{name:'Markdown 源码',exact:true}).fill(markdown)
 await page.getByText('视图',{exact:true}).click();await page.locator('details[open] .menu-popup button').filter({hasText:'正文'}).first().click()
 const copied=await copy(page,'rows')
 expect(copied.html).toContain('data-pm-slice')
 await page.locator('[data-tab-id="b"] .tab-title').click()
 await expect.poll(async()=> (await capture(page)).id).toBe('b');await expect(body(page)).toHaveAttribute('contenteditable','true')
 if(kind==='kept-unknown'){
  await page.locator('.ProseMirror td').filter({hasText:'B11'}).hover();await page.waitForTimeout(120);await page.locator('[data-role="col-drag-handle"]').click()
 }else{
  await page.locator('.ProseMirror td').filter({hasText:'B11'}).locator('p').click({clickCount:3,position:{x:6,y:12}})
  if(kind==='horizontal-rectangle')await body(page).press('Shift+ArrowDown')
 }
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 expect((await capture(page)).selection.type).toBe('cell')
 return {copied,image,attachment}
}
for(const kind of ['horizontal','horizontal-rectangle','vertical','all-clipped','known-clipped','kept-unknown'])test('table crop binds only effective cells: '+kind,async({page})=>{
 const {copied,image}=await cropFixture(page,kind),before=await capture(page)
 if(kind==='horizontal-rectangle')await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('reuse_resources'))
 await paste(page,copied)
 if(kind==='horizontal-rectangle'){
  await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.reuse_resources||0)).toBe(1)
  const waiting=await capture(page);expect(waiting.markdown).toBe(before.markdown);expect(waiting.selection).toEqual(before.selection)
  await expect(body(page)).toHaveAttribute('contenteditable','false');await expect(page.locator('.pm-port')).toHaveJSProperty('inert',true)
  await expect(page.locator('img[data-editor-image-src]')).toHaveCount(0)
  expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.bindings.get('b')?.size||0)).toBe(0)
  await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('reuse_resources'))
 }
 await expect.poll(async()=>await page.getByRole('alert').count()>0||(await capture(page)).tables[0][1][0].text==='A11').toBe(true)
 await mkdir(evidence,{recursive:true});await writeFile(evidence+'crop-observed-'+kind+'.json',JSON.stringify({before,observed:await capture(page),copied,host:await page.evaluate(()=>({calls:window.__FROWD_TEST_HOST__.calls.filter(c=>c.command==='reuse_resources'),bindings:[...window.__FROWD_TEST_HOST__.bindings.get('b')||[]],alert:document.querySelector('[role=alert]')?.textContent}))},null,2));await page.screenshot({path:evidence+'crop-observed-'+kind+'.png'})
 if(kind==='kept-unknown'){
  await expect(page.getByRole('alert')).toContainText('重新导入')
  const after=await capture(page)
  expect(after.markdown).toBe(before.markdown);expect(after.selection).toEqual(before.selection)
  expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.bindings.get('b')?.size||0)).toBe(0)
  const requested=await page.evaluate(()=>window.__FROWD_TEST_HOST__.calls.filter(c=>c.command==='reuse_resources').map(c=>c.args.references.map(r=>r.reference)))
  expect(requested).toEqual([[image,missing]])
 }else{
  await expect.poll(async()=> (await capture(page)).tables[0][1][0].text).toBe('A11')
  const after=await capture(page)
  expect(after.tables).toHaveLength(1);expect(after.tables[0]).toHaveLength(4)
  expect(after.tables[0][0]).toEqual(before.tables[0][0])
  const height=kind==='horizontal-rectangle'?2:1
  expect(before.selected).toBe(height)
  expect(after.tables[0].slice(1+height)).toEqual(before.tables[0].slice(1+height))
  if(height===2){expect(after.tables[0][2][0].text).toBe('A21');expect(after.tables[0][2].slice(1)).toEqual(before.tables[0][2].slice(1))}
  expect(after.tables[0][1].slice(1)).toEqual(before.tables[0][1].slice(1))
  expect(after.text).toContain('B前正文');expect(after.text).toContain('B后正文')
  const requested=await page.evaluate(()=>window.__FROWD_TEST_HOST__.calls.filter(c=>c.command==='reuse_resources').map(c=>c.args.references.map(r=>r.reference)))
  expect(requested).toEqual(kind==='all-clipped'?[]:[[image]])
  expect(await page.evaluate(()=>[...window.__FROWD_TEST_HOST__.bindings.get('b')||[]])).toEqual(kind==='all-clipped'?[]:[image])
  expect(after.images).toBe(kind==='all-clipped'?0:1);expect(after.links).toBe(0)
  if(after.images)await expect(page.locator('img[data-editor-image-src]')).toHaveJSProperty('naturalWidth',240)
  await body(page).press('Control+z');await expect.poll(async()=> (await capture(page)).markdown).toBe(before.markdown)
  await body(page).press('Control+y');await expect.poll(async()=> (await capture(page)).markdown).toBe(after.markdown)
  await mkdir(evidence,{recursive:true});await writeFile(evidence+'crop-'+kind+'.json',JSON.stringify({before,after,requested,copied},null,2))
  await page.screenshot({path:evidence+'crop-'+kind+'.png'})
 }
})
