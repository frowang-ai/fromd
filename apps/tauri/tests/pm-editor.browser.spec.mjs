import {test,expect} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {installMockHost} from './mock-host.mjs'
const sample=(await readFile(new URL('./pm-table-sample.md',import.meta.url),'utf8')).replace(/\r\n/g,'\n')
const evidence=fileURLToPath(new URL('../../../output/pm-port-evidence/',import.meta.url))
test.beforeEach(async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.__errors=errors
 await page.addInitScript(installMockHost,{markdown:sample});await page.goto('/?testHost=1')
 await expect(page.locator('.loading-state')).toHaveCount(0);await expect(page.locator('.ProseMirror')).toBeVisible()
 await page.evaluate(()=>document.fonts.ready)
})
test.afterEach(async({page})=>expect(page.__errors).toEqual([]))
async function capture(page){return page.evaluate(()=>{
 const value=document.querySelector('.pm-port').__vueParentComponent.exposed.capture()
 const state=value.pm.state,selection=state.selection
 return {markdown:value.markdown,id:value.id,generation:value.generation,doc:state.doc.toJSON(),
  selection:{type:selection.constructor.name.replace(/^_/,""),anchor:selection.anchor,head:selection.head,row:selection.isRowSelection?.(),column:selection.isColSelection?.()},
  domText:getSelection()?.toString()}
})}
async function point(page,text,index,body=false){
 return page.locator(body?'.ProseMirror>p':'.ProseMirror td,.ProseMirror th').filter({hasText:text}).first().evaluate((el,{text,index})=>{
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT)
  for(let n;n=walker.nextNode();){const at=n.textContent.indexOf(text);if(at<0)continue
   const range=document.createRange();range.setStart(n,at+index);range.setEnd(n,at+index+1)
   const rect=range.getBoundingClientRect(),x=rect.left+1,y=rect.top+rect.height/2
   const caret=document.caretRangeFromPoint(x,y),root=el.closest('.ProseMirror')
   return {x,y,pos:root.pmViewDesc.posFromDOM(caret.startContainer,caret.startOffset,1)}
  }
  throw Error('drawn text not found')
 },{text,index})
}
async function drag(page,a,b){
 await page.mouse.move(a.x,a.y);await page.waitForTimeout(120);await page.mouse.down()
 await page.mouse.move(b.x,b.y,{steps:28});await page.mouse.up()
}
const plain='这是一段用于验证鼠标拖动选择行为的中文文本',other='跨单元格拖动时也需要如实记录实际选区和正文是否变化'
const before='表格前正文：这是一份专门用于鼠标拖选验证的合成材料',after='表格后正文：所有内容均为合成样本，不包含用户笔记'
const cases=[
 ['plain forward',[plain,5],[plain,12]],['plain reverse',[plain,12],[plain,5]],
 ['bold forward',['加粗文字',1],['加粗文字',3]],['bold reverse',['加粗文字',3],['加粗文字',1]],
 ['link forward',['示例链接',1],['示例链接',3]],['link reverse',['示例链接',3],['示例链接',1]],
 ['cross cell',[plain,5],[other,8]],['cross cell reverse',[other,8],[plain,5]],
 ['body to cell',[before,6,true],['加粗文字',3]],['cell to body reverse',['加粗文字',3],[before,6,true]],
 ['cell to body',['加粗文字',1],[after,8,true]],['body to cell reverse',[after,8,true],['加粗文字',1]],
 ['across marks',['这里有',1],['加粗文字',3]],['textblock start',[plain,5],[other,0]],
]
for(const [name,from,to]of cases)test('text-first actual drag '+name,async({page})=>{
 const a=await point(page,...from),b=await point(page,...to);await drag(page,a,b)
 await expect.poll(async()=>{const s=(await capture(page)).selection;return [s.type,s.anchor,s.head]}).toEqual(['TextSelection',a.pos,b.pos])
 const current=await capture(page);expect(current.markdown).toBe(sample);expect(current.domText.length).toBeGreaterThan(0)
 await expect(page.locator('.ProseMirror tr')).toHaveCount(4)
 if(name==='cross cell')await page.screenshot({path:evidence+'table-cross-cell.png'})
})
test('cross-mark replacement undo/redo preserves remaining rich marks and table structure',async({page})=>{
 await drag(page,await point(page,'这里有',1),await point(page,'加粗文字',3))
 await page.keyboard.insertText('改')
 await expect.poll(async()=>(await capture(page)).markdown).toContain('这改**字**与[示例链接](https://example.com)')
 const changed=(await capture(page)).markdown
 await page.keyboard.press('Control+z');expect((await capture(page)).markdown).toBe(sample)
 await page.keyboard.press('Control+y');expect((await capture(page)).markdown).toBe(changed)
 await expect(page.locator('.ProseMirror tr')).toHaveCount(4)
})
test('text-first survives switch, shelf restore, source roundtrip and reorder',async({page})=>{
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();await expect(page.locator('.tab.selected')).toContainText('公式推导')
 await page.locator('.tab-title').filter({hasText:'方案讨论'}).click();await expect(page.locator('.tab.selected')).toContainText('方案讨论')
 await page.getByRole('button',{name:'标签收起 方案讨论',exact:true}).click()
 await page.locator('.shelved-row .page-title').filter({hasText:'方案讨论'}).click();await expect(page.locator('.tab.selected')).toContainText('方案讨论')
 await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:'源码'}).click()
 await expect(page.getByRole('textbox',{name:'Markdown 源码'})).toHaveValue(sample)
 await page.getByText('视图',{exact:true}).click();await page.locator('details[open] .menu-popup button').filter({hasText:'正文'}).first().click()
 await page.locator('[data-tab-id="b"]').dragTo(page.locator('[data-tab-id="a"]'),{targetPosition:{x:2,y:12}})
 await expect(page.locator('.tab-title')).toHaveText(['公式推导','方案讨论'])
 const a=await point(page,plain,5),b=await point(page,other,8);await drag(page,a,b)
 await expect.poll(async()=>{const s=(await capture(page)).selection;return [s.type,s.anchor,s.head]}).toEqual(['TextSelection',a.pos,b.pos])
 expect((await capture(page)).markdown).toBe(sample)
})
test('row and column handles, deletion undo and Tab keep the original table behavior',async({page})=>{
 await page.mouse.click(...Object.values(await point(page,plain,5)).slice(0,2))
 await page.keyboard.press('Tab');expect((await capture(page)).selection.type).toBe('TextSelection')
 await page.keyboard.press('Shift+Tab')
 for(const [role,field]of [['row-drag-handle','row'],['col-drag-handle','column']]){
  await page.locator('.ProseMirror td').filter({hasText:plain}).hover();await page.waitForTimeout(150)
  const handle=page.locator('[data-role="'+role+'"]');await handle.click()
  expect((await capture(page)).selection[field]).toBe(true)
  await handle.locator('button').last().click()
  if(field==='row')await expect(page.locator('.ProseMirror tr')).toHaveCount(3)
  else await expect(page.locator('.ProseMirror tr').first().locator('th,td')).toHaveCount(1)
  await page.keyboard.press('Control+z');expect((await capture(page)).markdown).toBe(sample)
 }
})
test('ordinary link editing and Ctrl link callback stay document-owned; copy serializes the local selected text',async({page})=>{
 const a=await point(page,'示例链接',1);await page.mouse.click(a.x,a.y)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.open_document_link??0)).toBe(0)
 await page.keyboard.down('Control');await page.mouse.click(a.x,a.y);await page.keyboard.up('Control')
 await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.open_document_link??0)).toBe(1)
 const p=await point(page,'加粗文字',1),q=await point(page,'加粗文字',3);await drag(page,p,q)
 const copied=await page.locator('.ProseMirror').evaluate(el=>{
  const clipboardData=new DataTransfer(),event=new ClipboardEvent('copy',{clipboardData,bubbles:true,cancelable:true})
  el.dispatchEvent(event);return {text:clipboardData.getData('text/plain'),html:clipboardData.getData('text/html'),prevented:event.defaultPrevented}
 })
 expect(copied.text).toBe('粗文');expect(copied.html).toContain('strong');expect(copied.prevented).toBe(true)
 // DataTransfer exercises the serializer without reading or writing the OS clipboard.
})

test('cross-cell copy serializes selected portions rather than the whole table',async({page})=>{
 await drag(page,await point(page,plain,5),await point(page,other,8))
 const data=await page.locator('.ProseMirror').evaluate(el=>{
  const clipboardData=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{clipboardData,bubbles:true,cancelable:true}))
  return {text:clipboardData.getData('text/plain'),html:clipboardData.getData('text/html')}
 })
 expect(data.text).toContain(plain.slice(5));expect(data.text).toContain(other.slice(0,8))
 expect(data.text).not.toContain(plain.slice(0,5));expect(data.text).not.toContain(other.slice(8))
 expect(data.text).not.toContain('表格前正文');expect(data.text).not.toContain('表格后正文')
 expect(data.html).toContain('table')
})
async function sourceMode(page,value){
 await page.getByText('视图',{exact:true}).click()
 await page.locator('details[open] .menu-popup button').filter({hasText:value?'源码':'正文'}).first().click()
 return page.getByRole('textbox',{name:'Markdown 源码',exact:true})
}
test('source undo/redo belongs to its docId across switches and cannot undo into another page',async({page})=>{
 const input=await sourceMode(page,true);await input.press('Control+End');await input.pressSequentially(' A-local')
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();await expect(page.locator('.tab.selected')).toContainText('公式推导')
 const otherInput=await sourceMode(page,true),original=await otherInput.inputValue()
 await otherInput.press('Control+End');await page.keyboard.insertText(' B-local')
 await otherInput.press('Control+z');await expect(otherInput).toHaveValue(original)
 await otherInput.press('Control+y');await expect(otherInput).toHaveValue(original+' B-local')
 await page.locator('.tab-title').filter({hasText:'方案讨论'}).click();await expect(page.locator('.tab.selected')).toContainText('方案讨论')
 await expect(input).toHaveValue(sample+' A-local')
 // Source history uses logical input steps; undo the last typed character only.
 await input.press('Control+z');await expect(input).toHaveValue(sample+' A-loca')
 expect((await capture(page)).id).toBe('a')
})
test('source composition finishes before a real readonly/inert handoff and retains its committed text',async({page})=>{
 const input=await sourceMode(page,true)
 await input.dispatchEvent('compositionstart',{data:'zhong'})
 await input.evaluate(el=>{el.value+=' 中文提交';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}))})
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('activate_document'))
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();await page.waitForTimeout(80)
 expect(await input.evaluate(el=>el.readOnly)).toBe(false)
 await input.dispatchEvent('compositionend',{data:'中文提交'})
 await expect.poll(()=>input.evaluate(el=>el.readOnly)).toBe(true)
 expect(await page.locator('.pm-port').evaluate(el=>el.inert)).toBe(true)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a').markdown)).toContain('中文提交')
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('activate_document'))
 await expect(page.locator('.tab.selected')).toContainText('公式推导');expect((await capture(page)).id).toBe('b')
})
test('raw syntax search retains its source range and the View menu stays the only mode entry',async({page})=>{
 const search=page.getByRole('searchbox',{name:'搜索全部页面'});await search.fill('https://example.com')
 await page.locator('.search-result').click()
 await expect(page.locator('.ProseMirror')).toBeVisible();await expect(page.getByRole('alert')).toContainText('Markdown 源文')
 const input=await sourceMode(page,true)
 const selected=await input.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd))
 expect(selected).toBe('https://example.com')
})

test('HTML paste in a text cell preserves rich marks, other cells and undo',async({page})=>{
 const a=await point(page,'加粗文字',2);await page.mouse.click(a.x,a.y)
 await page.locator('.ProseMirror').evaluate(el=>{
  const clipboardData=new DataTransfer();clipboardData.setData('text/plain','插入');clipboardData.setData('text/html','<strong>插入</strong>')
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}))
 })
 await expect(page.locator('.ProseMirror strong')).toContainText('插入')
 const text=(await capture(page)).markdown;expect(text).toContain(plain);expect(text).toContain(other)
 await expect(page.locator('.ProseMirror tr')).toHaveCount(4)
 await expect(page.locator('.ProseMirror td,.ProseMirror th')).toHaveCount(8)
 await page.keyboard.press('Control+z');expect((await capture(page)).markdown).toBe(sample)
})
test('cross-cell text replacement keeps unselected boundaries and supports undo/redo',async({page})=>{
 await drag(page,await point(page,plain,5),await point(page,other,8));await page.keyboard.insertText('跨格替换')
 const changed=await capture(page);expect(changed.markdown).toContain('跨格替换')
 expect(changed.markdown).toContain(plain.slice(0,5));expect(changed.markdown).toContain(other.slice(8))
 expect(changed.markdown).toContain(before);expect(changed.markdown).toContain(after)
 await expect(page.locator('.ProseMirror table.children')).toHaveCount(1)
 await page.keyboard.press('Control+z');expect((await capture(page)).markdown).toBe(sample)
 await page.keyboard.press('Control+y');expect((await capture(page)).markdown).toBe(changed.markdown)
})

test('ordinary double-click selects a local word rather than a table block',async({page})=>{
 const a=await point(page,'示例链接',1);await page.mouse.dblclick(a.x,a.y)
 const current=await capture(page);expect(current.selection.type).toBe('TextSelection')
 expect(current.domText.length).toBeGreaterThan(0);expect(current.domText.length).toBeLessThanOrEqual(4)
 expect(current.markdown).toBe(sample)
})
test('rich-body composition completes before switching and retains committed final input',async({page})=>{
 const body=page.locator('.ProseMirror');await body.click();await page.keyboard.press('Control+End')
 await body.dispatchEvent('compositionstart',{data:'zhong'});await page.keyboard.insertText(' 正文中文提交')
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();await page.waitForTimeout(80)
 await expect(body).toHaveAttribute('contenteditable','true')
 await body.dispatchEvent('compositionend',{data:'正文中文提交'})
 await expect(page.locator('.tab.selected')).toContainText('公式推导')
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a').markdown)).toContain('正文中文提交')
 expect((await capture(page)).id).toBe('b')
})
test('unmodified source is exact; edited serialization normalization is recorded and undo restores source',async({page})=>{
 expect((await capture(page)).markdown).toBe(sample)
 await page.locator('.ProseMirror').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 合成追加')
 const edited=(await capture(page)).markdown;expect(edited).toContain('合成追加');expect(edited).toContain(plain)
 await writeFile(evidence+'normalization.json',JSON.stringify({raw:sample,edited,scope:'Synthetic PM serialization comparison; unmodified exact, edited Markdown may normalize tables/marks/spacing/trailing newline.'},null,2))
 await page.screenshot({path:evidence+'pm-workbench.png',fullPage:true})
 await page.keyboard.press('Control+z');expect((await capture(page)).markdown).toBe(sample)
})
