import {test,expect} from '@playwright/test'
import {readFile,mkdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {installMockHost} from './mock-host.mjs'
const png=[...await readFile(new URL('./fixtures/synthetic-resource.png',import.meta.url))]
const evidence=fileURLToPath(new URL('../../../output/resource-reuse-evidence/',import.meta.url))
const body=page=>page.locator('.ProseMirror:visible'),source=page=>page.getByRole('textbox',{name:'Markdown 源码',exact:true})
const row=(page,id)=>page.evaluate(id=>window.__FROWD_TEST_HOST__.rows.get(id),id)
async function mode(page,name){await page.getByText('视图',{exact:true}).click();await page.locator('details[open] .menu-popup button').filter({hasText:name}).first().click()}
async function select(page,name){await page.locator('.tab-title').filter({hasText:name}).click();await expect(page.locator('.tab.selected')).toContainText(name)}
async function paste(page,data,keepSelection=false){
 const target=await source(page).isVisible()?source(page):body(page)
 if(!keepSelection){await target.click();await target.press('Control+End')}
 await target.evaluate((el,{html,text})=>{const data=new DataTransfer();if(html)data.setData('text/html',html);if(text)data.setData('text/plain',text);const unhandled=el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));if(unhandled&&el.tagName==='TEXTAREA'){el.setRangeText(text,el.selectionStart,el.selectionEnd,'end');el.dispatchEvent(new InputEvent('input',{inputType:'insertFromPaste',data:text,bubbles:true}))}},data)
}
async function prepare(page){
 await page.addInitScript(installMockHost,{markdown:'合成 A\n'})
 await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0)
 await body(page).click();await body(page).press('Control+End')
 await body(page).evaluate((el,png)=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(png)],'图.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))},png)
 await expect(page.locator('.ProseMirror img[data-editor-image-src]')).toHaveCount(1)
 await page.evaluate(()=>{const payload=[...new TextEncoder().encode('synthetic attachment')];window.__FROWD_TEST_HOST__.resourceChoice={payload,metadata:[{name:'附件.txt',size:payload.length,image:false}]}})
 await page.getByText('文件',{exact:true}).click();await page.getByRole('button',{name:'插入附件…',exact:true}).click()
 await expect(page.locator('.ProseMirror a')).toHaveCount(1)
 await expect.poll(async()=> (await row(page,'a')).markdown).toContain('[附件.txt]')
}
async function copy(page,kind,action='copy'){
 if(kind==='source'){
  await mode(page,'源码');await source(page).press('Control+a')
  return source(page).evaluate(el=>({text:el.value.slice(el.selectionStart,el.selectionEnd),html:''}))
 }
 await body(page).click();await body(page).press('Control+a')
 return body(page).evaluate((el,action)=>{const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent(action,{clipboardData:data,bubbles:true,cancelable:true}));return {html:data.getData('text/html'),text:data.getData('text/plain')}},action)
}

const clipboardLegacy='.frowd-assets/'+'e'.repeat(64)+'.png'
async function prepareDocumentAsset(page,withLegacy=false) {
 await page.addInitScript(installMockHost,{documents:[
  {id:'a',title:'来源',path:'/source/first.md',markdown:withLegacy?`来源正文 ![legacy](${clipboardLegacy})\n`:'来源正文\n'},
  {id:'b',title:'目标',path:'/target/second.md',markdown:'目标正文\n'},
  {id:'draft',title:'草稿',markdown:'草稿正文\n'},
 ],
 objects:withLegacy?[[clipboardLegacy,{mime:'image/png',base64:Buffer.from(png).toString('base64')}]]:[],
 bindings:withLegacy?[['a',[clipboardLegacy]]]:[]})
 await page.goto('/?testHost=1')
 await expect(body(page)).toBeVisible()
 await body(page).focus();await body(page).press('Control+End')
 await body(page).evaluate((el,png)=>{
  const data=new DataTransfer()
  data.items.add(new File([new Uint8Array(png)],'source image.png',{type:'image/png'}))
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))
 },png)
 await expect(body(page).locator('img[alt="source image.png"]')).toHaveJSProperty('naturalWidth',240)
 await expect.poll(async()=>(await row(page,'a')).markdown).toContain('first.assets/source%20image.png')
}

for(const {target,name,action,reference} of [
 {target:'b',name:'目标',action:'copy',reference:/second\.assets\/source%20image\.png/},
 {target:'draft',name:'草稿',action:'cut',reference:/\.frowd-assets\/[a-f0-9]{64}\.png/},
])test(`in-app document image ${action} into ${target} imports the actual image and undoes in one step`,async({page})=>{
 await prepareDocumentAsset(page)
 const before=(await row(page,target)).markdown
 const copied=await copy(page,'html',action)
 expect(copied.html).toContain('data-frowd-copy=')
 expect(copied.html).toContain('first.assets/source%20image.png')
 if(action==='cut')await expect.poll(async()=>(await row(page,'a')).markdown).not.toContain('first.assets/')
 await select(page,name)
 await paste(page,copied)
 const image=body(page).locator('img[data-editor-image-src]')
 await expect(image).toHaveJSProperty('naturalWidth',240)
 await expect.poll(async()=>(await row(page,target)).markdown).toMatch(reference)
 expect((await row(page,target)).markdown).not.toContain('first.assets/')
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.calls.find(call=>call.command==='copy_document_images').args))
  .toEqual({id:target,sourceId:'a',sourcePath:'/source/first.md',images:['first.assets/source%20image.png'],legacyReferences:[]})
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.objects.size)).toBe(target==='draft'?1:0)
 await body(page).press('Control+z')
 await expect.poll(async()=>(await row(page,target)).markdown).toBe(before)
 await body(page).press('Control+y')
 await expect(image).toHaveJSProperty('naturalWidth',240)
})

test('source Save As after cut refuses same-named replacement and leaves target untouched',async({page})=>{
 await prepareDocumentAsset(page,true)
 const before=(await row(page,'b')).markdown
 const copied=await copy(page,'html','cut')
 expect(copied.html).toContain('data-frowd-copy=')
 expect(copied.html).toContain(clipboardLegacy)
 expect(copied.html+copied.text).not.toContain('/source/first.md')
 await expect.poll(async()=>(await row(page,'a')).markdown).not.toContain('first.assets/')
 await page.evaluate(()=>{
  const host=window.__FROWD_TEST_HOST__
  host.saveAsPath='/moved/first.md'
  const canvas=document.createElement('canvas')
  const ctx=canvas.getContext('2d');ctx.fillStyle='blue';ctx.fillRect(0,0,canvas.width,canvas.height)
  host.localResources.set('/moved/first.assets/source%20image.png',{mime:'image/png',base64:canvas.toDataURL().split(',')[1]})
 })
 await page.getByText('文件',{exact:true}).click()
 await page.getByRole('button',{name:/另存为/}).click()
 await expect.poll(async()=>(await row(page,'a')).path).toBe('/moved/first.md')
 await select(page,'目标')
 await paste(page,copied)
 await expect(page.getByRole('alert')).toContainText('来源文稿路径已变化，请重新复制图片')
 expect((await row(page,'b')).markdown).toBe(before)
 expect(await page.evaluate(()=>{
  const host=window.__FROWD_TEST_HOST__
  return {
   sourcePath:host.calls.find(call=>call.command==='copy_document_images').args.sourcePath,
   imports:host.entered.import_resources,
   targetBindings:host.bindings.get('b')?.size??0,
   targetFiles:[...host.localResources.keys()].filter(path=>path.startsWith('/target/')),
  }
 })).toEqual({sourcePath:'/source/first.md',imports:1,targetBindings:0,targetFiles:[]})
 await select(page,'来源')
 const afterSave=(await row(page,'a')).markdown
 await paste(page,copied)
 await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.copy_document_images)).toBe(2)
 await expect(body(page)).toHaveAttribute('contenteditable','true')
 await expect(page.getByRole('alert')).toContainText('来源文稿路径已变化，请重新复制图片')
 expect((await row(page,'a')).markdown).toBe(afterSave)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.import_resources)).toBe(1)
})

test('nine same-directory document images paste by reference without importing files',async({page})=>{
 const refs=Array.from({length:9},(_,index)=>`first.assets/${index+1}.png`)
 const image={mime:'image/png',base64:Buffer.from(png).toString('base64')}
 await page.addInitScript(installMockHost,{
  documents:[
   {id:'a',title:'来源',path:'/shared/first.md',markdown:refs.map(ref=>`![test](${ref})`).join(' ')+'\n'},
   {id:'b',title:'目标',path:'/shared/second.md',markdown:'目标正文\n'},
  ],
  localResources:refs.map(ref=>['/shared/'+ref,image]),
 })
 await page.goto('/?testHost=1')
 await expect(body(page).locator('img[data-editor-image-src]')).toHaveCount(9)
 const copied=await copy(page,'html')
 await select(page,'目标');await paste(page,copied)
 await expect.poll(()=>body(page).locator('img[data-editor-image-src]').evaluateAll(images=>images.filter(img=>img.naturalWidth>0).length)).toBe(9)
 expect(await page.evaluate(()=>{
  const host=window.__FROWD_TEST_HOST__
  return [host.calls.find(call=>call.command==='copy_document_images').args.images,host.entered.import_resources??0,host.localResources.size]
 })).toEqual([refs,0,9])
 await body(page).press('Control+z')
 await expect(body(page).locator('img[data-editor-image-src]')).toHaveCount(0)
})

test('external HTML with a copied relative path cannot claim the in-app image origin',async({page})=>{
 await prepareDocumentAsset(page)
 const copied=await copy(page,'html')
 expect(copied.html).toContain('data-frowd-copy=')
 await select(page,'目标')
 await paste(page,{html:'<img src="first.assets/source%20image.png" data-frowd-copy="forged" alt="external">'})
 await expect.poll(async()=>(await row(page,'b')).markdown).toContain('first.assets/source%20image.png')
 await expect(body(page).locator('img[alt^="external"]')).toHaveJSProperty('naturalWidth',0)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.copy_document_images??0)).toBe(0)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.localResources.size)).toBe(1)
})
for(const kind of ['source','html'])test('cross-document managed references reuse from actual '+kind+' copy',async({page})=>{
 await prepare(page);const copied=await copy(page,kind)
 if(kind==='html'){expect(copied.html).toContain('data-editor-image-src=".frowd-assets/');expect(copied.html).toContain('href=".frowd-assets/')}
 else expect(copied.text).toContain('![图.png](.frowd-assets/')
 const refs=await page.evaluate(()=>[...window.__FROWD_TEST_HOST__.bindings.get('a')])
 await select(page,'公式推导');if(kind==='source')await mode(page,'源码')
 await paste(page,copied)
 await expect.poll(async()=> (await row(page,'b')).markdown).toContain('.frowd-assets/')
 await expect.poll(()=>page.evaluate(refs=>refs.every(ref=>window.__FROWD_TEST_HOST__.bindings.get('b')?.has(ref)),refs)).toBe(true)
 if(kind==='source')await mode(page,'正文')
 await expect.poll(()=>page.locator('.ProseMirror img[data-editor-image-src]').evaluateAll(nodes=>nodes.filter(n=>n.naturalWidth>0).length)).toBe(1)
 expect((await row(page,'b')).markdown).not.toMatch(/blob:|frowd-resource:|frowd-resource\.localhost/)
 await expect.poll(async()=> (await row(page,'b')).markdown).toContain('.frowd-assets/')
 const pasted=(await row(page,'b')).markdown
 await body(page).press('Control+z')
 await expect.poll(async()=> (await row(page,'b')).markdown).not.toContain('.frowd-assets/')
 await body(page).press('Control+y')
 await expect.poll(async()=> (await row(page,'b')).markdown).toBe(pasted)
 await page.locator('.ProseMirror a').filter({hasText:'附件.txt'}).click({modifiers:['Control']})
 await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.calls.filter(c=>c.command==='open_document_link').length)).toBe(1)
 await select(page,'方案讨论')
 await page.getByText('文件',{exact:true}).click();await page.getByRole('button',{name:'移除当前页面',exact:true}).click();await page.getByRole('button',{name:'直接删除',exact:true}).click()
 await expect(page.locator('.tab.selected')).toContainText('公式推导')
 await expect.poll(()=>page.locator('.ProseMirror img[data-editor-image-src]').evaluateAll(nodes=>nodes.filter(n=>n.naturalWidth>0).length)).toBe(1)
 await page.getByText('文件',{exact:true}).click();await page.getByRole('button',{name:'移除当前页面',exact:true}).click();await page.getByRole('button',{name:'直接删除',exact:true}).click()
 await page.getByRole('button',{name:'撤销',exact:true}).click()
 await expect(page.locator('.tab.selected')).toContainText('公式推导')
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.snapshot().activeId)).toMatch(/^undo-/)
 await expect.poll(()=>page.locator('.ProseMirror img[data-editor-image-src]').evaluateAll(nodes=>nodes.filter(n=>n.naturalWidth>0).length)).toBe(1)
 await mkdir(evidence,{recursive:true});await page.screenshot({path:evidence+kind+'-reused.png'})
})

test.beforeEach(async({page})=>{page.__errors=[];page.on('pageerror',error=>page.__errors.push(error.message))})
test.afterEach(async({page})=>expect(page.__errors).toEqual([]))
async function observation(page){
 return page.evaluate(()=>{const c=document.querySelector('.pm-port').__vueParentComponent.exposed.capture();return {markdown:c.markdown,selection:c.viewState.mode==='source'?c.viewState.sourceSelection:c.viewState.selection}})
}
for(const kind of ['source','html'])test('unknown '+kind+' reference rejects the whole paste and preserves selected target',async({page})=>{
 await prepare(page);const copied=await copy(page,kind)
 copied[kind==='html'?'html':'text']=copied[kind==='html'?'html':'text'].replace(/\.frowd-assets\/[a-f0-9]{64}\.png/g,'.frowd-assets/'+'b'.repeat(64)+'.png')
 await select(page,'公式推导');if(kind==='source')await mode(page,'源码')
 const target=kind==='source'?source(page):body(page);await target.click();await target.press('Control+a')
 const before=await observation(page);await paste(page,copied,true)
 await expect(page.getByRole('alert')).toContainText('重新导入')
 expect(await observation(page)).toEqual(before);expect((await row(page,'b')).markdown).toBe(before.markdown)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.bindings.get('b')?.size||0)).toBe(0)
})
test('code examples and plain path strings in source do not request resource ownership',async({page})=>{
 await prepare(page);const copied=await copy(page,'source'),fence=String.fromCharCode(96).repeat(3)
 await select(page,'公式推导');await mode(page,'源码')
 await paste(page,{text:'\n\n'+fence+'markdown\n'+copied.text+'\n'+fence+'\n\n普通文字 '+copied.text.match(/\.frowd-assets\/[a-f0-9]{64}\.png/)[0]})
 await expect.poll(async()=> (await row(page,'b')).markdown).toContain(fence+'markdown')
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.reuse_resources||0)).toBe(0)
 await mode(page,'正文');await expect(page.locator('.ProseMirror img[data-editor-image-src]')).toHaveCount(0)
})
for(const url of ['blob:other-editor','http://frowd-resource.localhost/image?id=a&ref=private'])test('HTML display URL never becomes persistent resource: '+url.split(':')[0],async({page})=>{
 await prepare(page);const copied=await copy(page,'html')
 copied.html=await page.evaluate(({html,url})=>{const root=document.createElement('div');root.innerHTML=html;root.querySelectorAll('img').forEach(img=>{img.removeAttribute('data-editor-image-src');img.src=url});return root.innerHTML},{html:copied.html,url})
 await select(page,'公式推导');const before=(await row(page,'b')).markdown;await paste(page,copied)
 await expect(page.getByRole('alert')).toContainText('展示地址')
 expect((await row(page,'b')).markdown).toBe(before);expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.reuse_resources||0)).toBe(0)
})
test('delayed reuse freezes actual input and queues page switch without changing the source page',async({page})=>{
 await prepare(page);const copied=await copy(page,'html'),original=(await row(page,'a')).markdown
 await select(page,'公式推导');await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('reuse_resources'))
 await paste(page,copied);await expect(body(page)).toHaveAttribute('contenteditable','false')
 expect((await row(page,'b')).markdown).not.toContain('.frowd-assets/')
 await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',ctrlKey:true,bubbles:true,cancelable:true})))
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('reuse_resources'))
 await expect(page.locator('.tab.selected')).toContainText('方案讨论')
 expect((await row(page,'a')).markdown).toBe(original);expect((await row(page,'b')).markdown).toContain('.frowd-assets/')
})

test('source Markdown copied into rendered body reuses references through the real parser',async({page})=>{
 await prepare(page);const copied=await copy(page,'source')
 await select(page,'公式推导');await paste(page,copied)
 await expect.poll(()=>page.locator('.ProseMirror img[data-editor-image-src]').evaluateAll(nodes=>nodes.filter(n=>n.naturalWidth>0).length)).toBe(1)
 expect((await row(page,'b')).markdown).toContain('.frowd-assets/')
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.bindings.get('b').size)).toBe(2)
})
test('pasted definition reuses its newly resolved earlier source link',async({page})=>{
 await prepare(page);const refs=await page.evaluate(()=>[...window.__FROWD_TEST_HOST__.bindings.get('a')])
 await select(page,'公式推导');await mode(page,'源码')
 await paste(page,{text:'\n\n[已有标签][asset-ref]\n\n'})
 await paste(page,{text:'\n[asset-ref]: '+refs[0]+'\n'})
 await expect.poll(()=>page.evaluate(ref=>window.__FROWD_TEST_HOST__.bindings.get('b')?.has(ref),refs[0])).toBe(true)
 await mode(page,'正文');await expect(page.locator('.ProseMirror a').filter({hasText:'已有标签'})).toHaveAttribute('href',refs[0])
})
test('source paste waits IME and close drains the held binding before inserting and checkpointing',async({page})=>{
 await prepare(page);const copied=await copy(page,'source');await select(page,'公式推导');await mode(page,'源码')
 const target=source(page);await target.click();await target.dispatchEvent('compositionstart',{data:''})
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('reuse_resources'))
 await paste(page,copied);await expect(target).not.toHaveAttribute('readonly','')
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.reuse_resources||0)).toBe(0)
 await page.keyboard.insertText('组合完成');await target.dispatchEvent('compositionend',{data:'组合完成'})
 await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.reuse_resources||0)).toBe(1)
 await expect(target).toHaveAttribute('readonly','')
 await page.evaluate(()=>{window.__closing=window.__FROWD_TEST_HOST__.requestClose()})
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.closed)).toBe(false)
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('reuse_resources'))
 await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.closed)).toBe(true)
 expect((await row(page,'b')).markdown).toContain('组合完成');expect((await row(page,'b')).markdown).toContain('.frowd-assets/')
})
test('backup failure after successful binding keeps visible pasted content and retries before switching',async({page})=>{
 await prepare(page);const copied=await copy(page,'html'),before=(await row(page,'b')).markdown
 await select(page,'公式推导');await page.evaluate(()=>window.__FROWD_TEST_HOST__.fail='update_document')
 await paste(page,copied);await expect(page.getByRole('alert')).toContainText('合成写入失败')
 await expect(page.locator('.ProseMirror img[data-editor-image-src]')).toHaveCount(1)
 expect((await row(page,'b')).markdown).toBe(before)
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.fail=null);await select(page,'方案讨论')
 expect((await row(page,'b')).markdown).toContain('.frowd-assets/')
 await select(page,'公式推导')
 await expect.poll(()=>page.locator('.ProseMirror img[data-editor-image-src]').evaluateAll(nodes=>nodes.filter(n=>n.naturalWidth>0).length)).toBe(1)
})
