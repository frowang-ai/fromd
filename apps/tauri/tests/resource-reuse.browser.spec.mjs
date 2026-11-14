import {test,expect} from '@playwright/test'
import {readFile,mkdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {installMockHost} from './mock-host.mjs'
const png=[...await readFile(new URL('./fixtures/synthetic-resource.png',import.meta.url))]
const evidence=fileURLToPath(new URL('../../../output/resource-reuse-evidence/',import.meta.url))
const body=page=>page.locator('.ProseMirror:visible'),source=page=>page.getByRole('textbox',{name:'Markdown 源码',exact:true})
const row=(page,id)=>page.evaluate(id=>window.__FROWD_TEST_HOST__.rows.get(id),id)
async function mode(page,name){await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:name}).first().click()}
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
async function copy(page,kind){
 if(kind==='source'){
  await mode(page,'源码');await source(page).press('Control+a')
  return source(page).evaluate(el=>({text:el.value.slice(el.selectionStart,el.selectionEnd),html:''}))
 }
 await body(page).click();await body(page).press('Control+a')
 return body(page).evaluate(el=>{const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return {html:data.getData('text/html'),text:data.getData('text/plain')}})
}
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
