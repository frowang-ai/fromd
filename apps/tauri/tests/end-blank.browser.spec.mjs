import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'

const original='原有首段。\n\n原有最后一段。\n'
const body=page=>page.locator('.ProseMirror:visible')
async function boot(page,markdown=original){
 await page.addInitScript(installMockHost,{markdown});await page.goto('/?testHost=1')
 await expect(page.locator('.loading-state')).toHaveCount(0);await expect(body(page)).toBeVisible()
 await page.evaluate(()=>document.fonts.ready)
}
async function snapshot(page){return page.locator('.pm-port').evaluate(el=>{const c=el.__vueParentComponent.exposed.capture();return{markdown:c.markdown,doc:c.pm.state.doc.toJSON(),id:c.id,generation:c.generation}})}
async function below(page,lines=1){return body(page).evaluate((el,lines)=>{
 const rect=el.getBoundingClientRect(),last=el.lastElementChild.getBoundingClientRect(),scale=rect.width/el.offsetWidth,line=parseFloat(getComputedStyle(el).lineHeight)*scale
 return{x:rect.left+40*scale,y:last.bottom+line*lines,line}
},lines)}
async function clickBelow(page,lines=1){const point=await below(page,lines);await page.mouse.click(point.x,point.y);return point}
async function sourceMode(page,value){await page.getByText('视图',{exact:true}).click();await page.locator('details[open] .menu-popup button').filter({hasText:value?'源码':'正文'}).first().click();await expect(value?page.getByRole('textbox',{name:'Markdown 源码'}):body(page)).toBeVisible()}

test('one click below the end inserts typed and pasted text in a real new paragraph',async({page})=>{
 await boot(page)
 await body(page).locator('p').first().click();await page.keyboard.press('Home')
 await clickBelow(page)
 await page.keyboard.insertText('末尾新输入')
 expect((await snapshot(page)).markdown).toBe('原有首段。\n\n原有最后一段。\n\n末尾新输入\n')
 await clickBelow(page)
 await body(page).evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','合成粘贴');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))})
 expect((await snapshot(page)).markdown).toContain('末尾新输入\n\n合成粘贴')
})

test('far blank click uses existing empty-paragraph semantics, reuses rows and is one undo step',async({page})=>{
 await boot(page)
 const point=await clickBelow(page,4.5),first=await snapshot(page)
 expect(first.doc.content.filter(n=>n.type==='paragraph'&&!n.content).length).toBeGreaterThan(1)
 expect(first.markdown).toBe(original)
 const caret=await page.evaluate(()=>{const node=getSelection().anchorNode,element=node.nodeType===1?node:node.parentElement,p=element.closest('p'),r=p.getBoundingClientRect();return{y:r.top+r.height/2,left:r.left}})
 expect(Math.abs(caret.y-point.y)).toBeLessThan(point.line*1.5)
 await page.mouse.click(point.x,point.y)
 expect((await snapshot(page)).doc).toEqual(first.doc)
 await page.keyboard.press('Control+z');expect((await snapshot(page)).markdown).toBe(original)
 await page.keyboard.press('Control+y');expect((await snapshot(page)).doc).toEqual(first.doc)
 await page.keyboard.insertText('远处输入')
 const typed=await snapshot(page)
 const blanks=typed.doc.content.filter(node=>node.type==='paragraph'&&!node.content).length
 expect(typed.markdown).toBe(original+'\n'.repeat(blanks+1)+'远处输入\n')
 expect(typed.markdown).not.toMatch(/[\u200b\u200c\ufeff]/)
 await sourceMode(page,true)
 const source=page.getByRole('textbox',{name:'Markdown 源码'})
 await expect(source).toHaveValue(typed.markdown)
 await sourceMode(page,false)
 expect((await snapshot(page)).doc).toEqual(typed.doc)
 await page.locator('[data-tab-id="b"] .tab-title').click()
 await page.locator('[data-tab-id="a"] .tab-title').click()
 expect((await snapshot(page)).doc).toEqual(typed.doc)
 const search=page.getByRole('searchbox',{name:'搜索全部页面'})
 await search.fill('远处输入')
 await page.locator('.search-result').click()
 await expect.poll(()=>page.evaluate(()=>getSelection().toString())).toBe('远处输入')

 // A harmless source newline forces an actual parser rebuild on returning.
 await sourceMode(page,true)
 await source.fill(typed.markdown+'\n');await sourceMode(page,false)
 const paragraphs=(await snapshot(page)).doc.content
 expect(paragraphs).toEqual(typed.doc.content)
})

for(const [kind,text]of [['table','| 列 | 值 |\n| --- | --- |\n| 原值 | 1 |\n'],['list','- 原条目一\n- 原条目二\n'],['code','```js\nconst answer = 42;\n```\n'],['Mermaid','```mermaid\nflowchart LR\nA[起点] --> B[终点]\n```\n']])test(`end click after ${kind} appends outside the existing block`,async({page})=>{
 await boot(page,text)
 if(kind==='Mermaid')await expect(page.locator('.writing-mermaid-svg')).toBeVisible()
 const before=await snapshot(page)
 await clickBelow(page);await page.keyboard.insertText('块外新段')
 const after=await snapshot(page)
 expect(after.doc.content[0]).toEqual(before.doc.content[0])
 expect(after.doc.content.at(-1)).toMatchObject({type:'paragraph',content:[{type:'text',text:'块外新段'}]})
})

test('content, modifier, right and drag clicks do not append; frozen editor rejects end clicks',async({page})=>{
 await boot(page)
 await body(page).locator('p').first().click();expect((await snapshot(page)).markdown).toBe(original)
 const point=await below(page,2)
 await page.mouse.click(point.x,point.y,{button:'right'});await page.keyboard.press('Escape')
 await page.keyboard.down('Control');await page.mouse.click(point.x,point.y);await page.keyboard.up('Control')
 await page.keyboard.down('Shift');await page.mouse.click(point.x,point.y);await page.keyboard.up('Shift')
 expect((await snapshot(page)).markdown).toBe(original)
 const content=await body(page).locator('p').first().boundingBox()
 await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(content.x+40,content.y+10,{steps:8});await page.mouse.up()
 expect((await snapshot(page)).markdown).toBe(original)
 await page.locator('.pm-port').evaluate(el=>el.__vueParentComponent.exposed.setFrozen(true))
 await page.mouse.click(point.x,point.y)
 expect((await snapshot(page)).markdown).toBe(original)
 await page.locator('.pm-port').evaluate(el=>el.__vueParentComponent.exposed.setFrozen(false))
 await sourceMode(page,true)
 await page.getByRole('textbox',{name:'Markdown 源码'}).click({position:{x:40,y:200}})
 expect((await snapshot(page)).markdown).toBe(original)
})

test('no active document never appends a new page from editor blank space',async({page})=>{
 await boot(page)
 await page.locator('[data-tab-id="a"]').click({button:'right'})
 await page.getByRole('menuitem',{name:'收起全部页面',exact:true}).click()
 await expect(page.locator('.empty-desktop')).toBeVisible()
 await page.locator('.editor-panel').click({position:{x:300,y:250}})
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.size)).toBe(3)
 expect(await page.locator('.pm-port').evaluate(el=>el.__vueParentComponent.exposed.capture())).toBeNull()
})

test('end clicks honor document ownership and browser layout zoom',async({page})=>{
 await boot(page)
 await page.keyboard.press('Control+Shift+=');await page.keyboard.press('Control+Shift+=')
 await expect(page.locator('.app-shell')).toHaveAttribute('data-zoom','120')
 await expect(page.locator('html')).toHaveCSS('zoom','1.2')
 const point=await clickBelow(page,3)
 const p=await page.evaluate(()=>{const n=getSelection().anchorNode,e=n.nodeType===1?n:n.parentElement,r=e.closest('p').getBoundingClientRect();return{top:r.top,height:r.height}})
 expect(Math.abs(p.top+p.height/2-point.y)).toBeLessThan(point.line*1.5)
 await page.keyboard.insertText('A 页末尾')
 await page.locator('[data-tab-id="b"] .tab-title').click()
 await clickBelow(page);await page.keyboard.insertText('B 页末尾')
 await page.locator('[data-tab-id="a"] .tab-title').click()
 const a=await snapshot(page);expect(a.id).toBe('a');expect(a.markdown).toContain('A 页末尾');expect(a.markdown).not.toContain('B 页末尾')
})
