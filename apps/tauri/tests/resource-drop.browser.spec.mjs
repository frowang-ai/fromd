import {test,expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {installMockHost} from './mock-host.mjs'

const png=[...await readFile(new URL('./fixtures/synthetic-resource.png',import.meta.url))]
const body=page=>page.locator('.ProseMirror:visible').first()
const row=page=>page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a'))

async function boot(page,markdown='Alpha\n\nBeta\n\nGamma\n'){
 await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown,shelved:false}]})
 await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0);await expect(body(page)).toBeVisible()
}
async function dropFiles(page,target,files,{x=null,y=null,directory=false,textOnly=false}={}){
 await target.evaluate((el,{files,x,y,directory,textOnly})=>{
  const rect=el.getBoundingClientRect(),clientX=x??rect.left+rect.width/2,clientY=y??rect.top+rect.height/2,data=new DataTransfer()
  for(const item of files){const file=new File([new Uint8Array(item.bytes)],item.name,{type:item.type});if(directory)Object.defineProperty(file,'webkitRelativePath',{value:'folder/'+item.name});data.items.add(file)}
  if(directory&&data.items[0])Object.defineProperty(data.items[0],'webkitGetAsEntry',{value:()=>({isDirectory:true})})
  if(textOnly)data.setData('text/plain','internal text drag')
  const dragOver=new DragEvent('dragover',{bubbles:true,cancelable:true,clientX,clientY,dataTransfer:data});el.dispatchEvent(dragOver)
  const drop=new DragEvent('drop',{bubbles:true,cancelable:true,clientX,clientY,dataTransfer:data});el.dispatchEvent(drop)
 },{files,x,y,directory,textOnly})
}
async function dropAtFirstParagraph(page,file){
 const target=body(page);await page.locator('.pm-scroller').evaluate(el=>el.scrollTop=0);const rect=await target.locator('p').first().boundingBox(),x=(rect?.x??0)+18,y=(rect?.y??0)+(rect?.height??20)/2,position=await page.evaluate(({x,y})=>document.querySelector('.pm-port').__vueParentComponent.exposed.resourceDropPosition(x,y),{x,y})
 await dropFiles(page,target,[file],{x,y});return position
}
async function dropAtLastParagraph(page,file){
 const target=body(page);await page.locator('.pm-scroller').evaluate(el=>el.scrollTop=0);const rect=await target.locator('p').last().boundingBox()
 const x=(rect?.x??0)+18,y=(rect?.y??0)+(rect?.height??20)*.75,position=await page.evaluate(({x,y})=>document.querySelector('.pm-port').__vueParentComponent.exposed.resourceDropPosition(x,y),{x,y})
 await dropFiles(page,target,[file],{x,y});return position
}

test('rendered image drop uses coordinate position and durable resource insertion',async({page})=>{
 await boot(page);const editor=body(page);await editor.click();await editor.press('Control+End');const position=await dropAtFirstParagraph(page,{name:'drop.png',type:'image/png',bytes:png});expect(Number.isInteger(position)).toBe(true);await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.import_resources||0)).toBe(1);await expect(editor.locator('img[data-editor-image-src]')).toHaveCount(1);await expect.poll(async()=> (await row(page)).markdown).toMatch(/!\[drop\.png\]\(\.frowd-assets\/[a-f0-9]{64}\.png\)/);const afterMarkdown=(await row(page)).markdown,imageIndex=afterMarkdown.indexOf('![drop.png]');expect(afterMarkdown).toContain('Al');expect(afterMarkdown).toContain('pha');expect(imageIndex).toBeGreaterThan(afterMarkdown.indexOf('Al'));expect(imageIndex).toBeLessThan(afterMarkdown.lastIndexOf('pha'))
 const after=await page.evaluate(()=>document.querySelector('.pm-port').__vueParentComponent.exposed.capture().viewState.selection);expect(Number.isInteger(after.anchor)).toBe(true)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.import_resources||0)).toBe(1)
})

test('attachment and multi-file drops share the resource batch path',async({page})=>{
 await boot(page);const editor=body(page);await editor.click();await editor.press('Control+End');await dropFiles(page,editor,[{name:'notes.txt',type:'text/plain',bytes:[...new TextEncoder().encode('notes')]}]);await expect(editor.locator('a')).toHaveCount(1);await expect.poll(async()=> (await row(page)).markdown).toContain('notes.txt')
 await dropFiles(page,editor,[{name:'one.txt',type:'text/plain',bytes:[1]},{name:'two.txt',type:'text/plain',bytes:[2]}]);await expect(editor.locator('a')).toHaveCount(3);await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.import_resources||0)).toBe(2)
})

test('directory, SVG image, and source drops are rejected without IPC or text changes',async({page})=>{
 await boot(page);const editor=body(page),before=await row(page),original={markdown:before.markdown,revision:before.revision};await dropFiles(page,editor,[{name:'folder.png',type:'image/png',bytes:png}],{directory:true});await expect(page.getByRole('alert')).toContainText('目录');expect((await row(page)).markdown).toBe(original.markdown);expect((await row(page)).revision).toBe(original.revision);expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.import_resources||0)).toBe(0)
 await page.getByRole('button',{name:'关闭错误提示'}).click();await dropFiles(page,editor,[{name:'vector.svg',type:'image/svg+xml',bytes:[60,115,118,103,62]}]);await expect(page.getByRole('alert')).toContainText('SVG');expect((await row(page)).markdown).toBe(original.markdown);expect((await row(page)).revision).toBe(original.revision);expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.import_resources||0)).toBe(0)
 await page.getByRole('button',{name:'关闭错误提示'}).click();await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:'源码'}).click();const source=page.getByRole('textbox',{name:'Markdown 源码'});await dropFiles(page,source,[{name:'source.png',type:'image/png',bytes:png}]);await expect(page.getByRole('alert')).toContainText('源码模式');expect((await row(page)).markdown).toBe(original.markdown);expect((await row(page)).revision).toBe(original.revision);expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.import_resources||0)).toBe(0)
})

test('non-file drop is ignored and a held resource registration keeps the owner frozen',async({page})=>{
 await boot(page);const editor=body(page),before=await row(page);await dropFiles(page,editor,[],{textOnly:true});await expect.poll(async()=> (await row(page)).markdown).toBe(before.markdown);expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.import_resources||0)).toBe(0)
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('import_resources'));await dropFiles(page,editor,[{name:'held.png',type:'image/png',bytes:png}]);await expect(editor).toHaveAttribute('contenteditable','false');expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.import_resources||0)).toBe(1);await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('import_resources'));await expect.poll(async()=> (await row(page)).markdown).toContain('.frowd-assets/')
})
test('long document drop keeps the new resource visible instead of returning to the old caret',async({page})=>{
 const markdown=Array.from({length:80},(_,index)=>'Line '+index).join('\n\n')+'\n';await boot(page,markdown);const editor=body(page);await editor.click();await editor.press('Control+Home');const scroller=page.locator('.pm-scroller');await scroller.evaluate(el=>el.scrollTop=el.scrollHeight);const target=editor.locator('p').last(),rect=await target.boundingBox(),x=(rect?.x??0)+18,y=(rect?.y??0)+(rect?.height??20)/2;const beforeScroll=await scroller.evaluate(el=>el.scrollTop);await dropFiles(page,editor,[{name:'long.png',type:'image/png',bytes:png}],{x,y});await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.import_resources||0)).toBe(1);await expect.poll(async()=> (await row(page)).markdown).toContain('long.png');const afterScroll=await scroller.evaluate(el=>el.scrollTop);const image=editor.locator('img[data-editor-image-src]');expect(await image.count()).toBe(1);expect(afterScroll).toBeGreaterThan(beforeScroll*.65)
})
