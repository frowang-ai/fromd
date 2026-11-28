import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'
const sample='标题\n\n中文😀 中文。\n\n**中文** 与 *中文*。\n\n| 列 | 值 |\n| --- | --- |\n| 中文 | 中文 |\n'
const body=page=>page.locator('.ProseMirror:visible')
async function boot(page){
 await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown:sample,shelved:false},{id:'b',title:'B',markdown:'B页 中文😀',shelved:false}]})
 await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0);await expect(body(page)).toBeVisible()
}
async function openFind(page){await page.keyboard.press('Control+f');await expect(page.getByRole('dialog',{name:'当前文档查找替换'})).toBeVisible()}
async function coordinatorBusy(page){return page.evaluate(()=>document.querySelector('.app-shell')?.__vueParentComponent?.setupState?.state?.busy??null)}
for(const mode of ['rendered','source'])test(`${mode} case toggle refreshes counts and replaces through the application coordinator`,async({page})=>{
 await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown:'**Aa** aa AA',shelved:false,viewState:{mode}}]})
 await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0)
 await openFind(page);await page.getByRole('textbox',{name:'查找文字',exact:true}).fill('aa')
 const toggle=page.getByRole('button',{name:'区分大小写',exact:true})
 await expect(toggle).toHaveAttribute('aria-pressed','false');await expect(page.locator('.find-count')).toHaveText('1/3')
 await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');await expect(page.locator('.find-count')).toHaveText('1/1')
 await page.getByRole('textbox',{name:'替换为',exact:true}).fill('X');await page.getByRole('button',{name:'全部替换',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a').markdown.trim())).toBe('**Aa** X AA')
 await expect(page.locator('.find-count')).toHaveText('无匹配');await toggle.click();await expect(page.locator('.find-count')).toHaveText('1/2')
 await page.getByRole('button',{name:'关闭查找替换',exact:true}).click()
 const input=mode==='source'?page.getByRole('textbox',{name:'Markdown 源码',exact:true}):body(page)
 await input.press('Control+z');await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a').markdown.trim())).toBe('**Aa** aa AA')
 await expect(page.getByRole('alert')).toHaveCount(0)
})
for(const mode of ['rendered','source'])test(`${mode} optional case-sensitive search replaces only exact case and retains undo`,async({page})=>{
 await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown:'**Aa** aa',shelved:false,viewState:{mode}}]})
 await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0)
 const result=await page.evaluate(()=>{
  const port=document.querySelector('.pm-port').__vueParentComponent.exposed
  const defaults=port.findReplace('aa',0,false),exact=port.findReplace('aa',0,false,true)
  const changed=port.replaceFind('aa','X',0,true,true)
  return {defaults:defaults.count,exact:exact.count,replaced:changed.replaced,markdown:port.capture().markdown}
 })
 expect(result.defaults).toBe(2);expect(result.exact).toBe(1);expect(result.replaced).toBe(1)
 expect(result.markdown.trim()).toBe('**Aa** X')
 const input=mode==='source'?page.getByRole('textbox',{name:'Markdown 源码'}):body(page)
 await input.press('Control+z')
 await expect.poll(()=>page.evaluate(()=>document.querySelector('.pm-port').__vueParentComponent.exposed.capture().markdown.trim())).toBe('**Aa** aa')
})
test('CRLF raw-syntax hit keeps raw Markdown and selects the matching LF textarea range',async({page})=>{
 const markdown='前行😀\r\n\r\n[普通链接](https://example.com/hidden-key)\r\n'
 await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown,shelved:false}]})
 await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0)
 await page.getByRole('searchbox',{name:'搜索全部页面'}).fill('hidden-key')
 await expect(page.locator('.search-result')).toHaveCount(1);await page.locator('.search-result').click()
 await expect(page.getByRole('alert')).toContainText('Markdown 源文')
 expect(await page.evaluate(()=>document.querySelector('.pm-port').__vueParentComponent.exposed.capture().markdown)).toBe(markdown)
 await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:'源码'}).click()
 const source=page.getByRole('textbox',{name:'Markdown 源码'})
 await expect(source).toBeVisible()
 expect(await source.evaluate(input=>input.value.slice(input.selectionStart,input.selectionEnd))).toBe('hidden-key')
})
test('rendered find remains bounded across atomic nodes in the same paragraph',async({page})=>{
 const markdown=Array(10000).fill('x').join(' ')+' $z$ x $z$ x'
 await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown,shelved:false}]})
 await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0)
 await openFind(page);await page.getByRole('textbox',{name:'查找文字'}).fill('x')
 await expect(page.locator('.find-count')).toHaveText('1/10000+')
 await expect(page.getByRole('button',{name:'全部替换',exact:true})).toBeDisabled()
})
test('source find reveals an offscreen match while retaining query focus',async({page})=>{
 const markdown=Array(160).fill('普通源码行').join('\n')+'\n定位末尾'
 await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown,shelved:false,viewState:{mode:'source'}}]})
 await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0)
 const source=page.getByRole('textbox',{name:'Markdown 源码'})
 await expect(source).toBeVisible();expect(await source.evaluate(input=>input.scrollTop)).toBe(0)
 await openFind(page);const query=page.getByRole('textbox',{name:'查找文字'});await query.fill('定位末尾')
 await expect(page.locator('.find-count')).toHaveText('1/1')
 await expect.poll(()=>source.evaluate(input=>input.scrollTop)).toBeGreaterThan(0)
 expect(await source.evaluate(input=>input.value.slice(input.selectionStart,input.selectionEnd))).toBe('定位末尾')
 await expect(query).toBeFocused()
})
test('rendered find counts Unicode across marks/table and cycles without writing',async({page})=>{
 const snapshot=()=>page.evaluate(()=>{const state=window.__FROWD_TEST_HOST__.snapshot();return {...state,documents:state.documents.map(({viewState,...doc})=>doc)}})
 await boot(page);const before=await snapshot();await openFind(page);const input=page.getByRole('textbox',{name:'查找文字'});await input.fill('中文');await expect(page.getByText('1/6')).toHaveCount(1)
 await page.getByRole('button',{name:'下一处'}).click();await expect(page.getByText('2/6')).toHaveCount(1);await expect.poll(()=>page.evaluate(()=>{const c=document.querySelector('.pm-port').__vueParentComponent.exposed.capture(),s=c.pm.state.selection;return c.pm.state.doc.textBetween(s.from,s.to,'')})).toBe('中文')
 // Selection/view persistence is independent of document text and revision.
 expect(await snapshot()).toEqual(before);await page.getByRole('button',{name:'关闭查找替换'}).click();await expect(page.getByRole('dialog')).toHaveCount(0)
})
test('single and all rendered replacements keep marks and one-step undo/redo',async({page})=>{
 await boot(page);await openFind(page);await page.getByRole('textbox',{name:'查找文字'}).fill('中文');await page.getByRole('textbox',{name:'替换为'}).fill('替');await page.getByRole('button',{name:'下一处'}).click();await page.getByRole('button',{name:'下一处'}).click();await page.getByRole('button',{name:'替换',exact:true}).click();await expect(body(page).locator('strong')).toHaveText('替')
 await page.getByRole('button',{name:'全部替换',exact:true}).click();await expect(body(page)).not.toContainText('中文');await body(page).press('Control+z');await expect(body(page)).toContainText('中文');await body(page).press('Control+y');await expect(body(page)).not.toContainText('中文')
})
test('source find and replace stays exact Markdown and does not switch mode',async({page})=>{
 await boot(page);await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:'源码'}).click();await openFind(page);await page.getByRole('textbox',{name:'查找文字'}).fill('**中文**');await expect(page.getByText('1/1')).toHaveCount(1);await page.getByRole('textbox',{name:'替换为'}).fill('**替换**');await page.getByRole('button',{name:'替换',exact:true}).click()
 await expect(page.getByRole('textbox',{name:'Markdown 源码'})).toHaveValue(sample.replace('**中文**','**替换**'));await page.getByRole('button',{name:'关闭查找替换'}).click();await expect(page.getByRole('textbox',{name:'Markdown 源码'})).toBeFocused()
})
test('find rebinds after switching page and find composition does not replace stale text',async({page})=>{
 await boot(page);await openFind(page);const input=page.getByRole('textbox',{name:'查找文字'});await input.dispatchEvent('compositionstart',{data:''});await input.fill('中文');await expect(page.getByText('输入查找文字')).toHaveCount(1);await input.dispatchEvent('compositionend',{data:'中文'});await expect(page.getByText('1/6')).toHaveCount(1)
 await page.locator('[data-tab-id="b"] .tab-title').click();await expect.poll(()=>page.locator('.tab.selected').textContent()).toContain('B');await expect.poll(()=>page.getByText('1/1').count()).toBe(1);await page.getByRole('textbox',{name:'替换为'}).fill('X');await page.getByRole('button',{name:'全部替换',exact:true}).click();await expect(body(page)).toContainText('X');await page.locator('[data-tab-id="a"] .tab-title').click();await expect(body(page)).toContainText('中文')
})
test('replace keeps visible text when persistence fails and retries on the next save',async({page})=>{
 await boot(page);await openFind(page);await page.getByRole('textbox',{name:'查找文字'}).fill('中文');await page.getByRole('textbox',{name:'替换为'}).fill('失败后保留');await page.evaluate(()=>window.__FROWD_TEST_HOST__.fail='update_document');await page.getByRole('button',{name:'替换',exact:true}).click();await expect(body(page)).toContainText('失败后保留');await expect(page.getByRole('alert')).toBeVisible()
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.fail=null);await page.getByRole('button',{name:'关闭查找替换'}).click();await body(page).click();await page.keyboard.press('End');await page.keyboard.type('x');await page.keyboard.press('Backspace');await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a').markdown)).toContain('失败后保留')
})
test('queued replacement is cancelled when a delayed page switch changes the owner',async({page})=>{
 await boot(page);await openFind(page);await page.getByRole('textbox',{name:'查找文字'}).fill('中文');await page.getByRole('textbox',{name:'替换为'}).fill('X');await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('read_document'))
 const switching=page.locator('[data-tab-id="b"] .tab-title').click();await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.read_document||0)).toBe(2);await page.getByRole('textbox',{name:'替换为'}).press('Enter');await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('read_document'));await switching;await expect(body(page)).toContainText('B页 中文😀');await expect(body(page)).not.toContainText('X')
})
test('source match limit is enforced at the replace-all execution layer',async({page})=>{
 const text=Array(10001).fill('x').join(' ');await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown:text,shelved:false}]});await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0);await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:'源码'}).click();await openFind(page);await page.getByRole('textbox',{name:'查找文字'}).fill('x');await expect(page.locator('.find-count')).toHaveText('1/10000+');await expect(page.getByRole('button',{name:'全部替换'})).toBeDisabled()
})
test('previous wraps and repeated replacement advances after the inserted range',async({page})=>{
 await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown:'needle needle needle',shelved:false}]});await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0);await openFind(page);await page.getByRole('textbox',{name:'查找文字'}).fill('needle');await page.getByRole('button',{name:'上一处'}).click();await expect(page.locator('.find-count')).toHaveText('3/3');await page.getByRole('textbox',{name:'替换为'}).fill('X');await page.getByRole('button',{name:'替换',exact:true}).click();await page.getByRole('button',{name:'替换',exact:true}).click();await page.getByRole('button',{name:'替换',exact:true}).click();await expect(body(page)).toContainText('X X X')
})
test('Enter during find-field composition is ignored and Esc closes with editor focus',async({page})=>{
 await boot(page);await openFind(page);const input=page.getByRole('textbox',{name:'替换为'});await page.getByRole('textbox',{name:'查找文字'}).fill('中文');await input.fill('X');const before=await body(page).innerText();await input.dispatchEvent('compositionstart',{data:''});const prevented=await input.evaluate(el=>{const event=new KeyboardEvent('keydown',{key:'Enter',isComposing:false,bubbles:true,cancelable:true});const result=el.dispatchEvent(event);return {defaultPrevented:event.defaultPrevented,result}});await expect.poll(()=>body(page).innerText()).toBe(before);expect(prevented.defaultPrevented).toBe(false);await input.dispatchEvent('compositionend',{data:'X'});await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>document.activeElement?.classList.contains('ProseMirror'))).toBe(true)
})
test('UTF-8 capacity uses actual replacement count and bytes',async({page})=>{
 const text=Array(1001).fill('x').join(' ');await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown:text,shelved:false}]});await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0);await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:'源码'}).click();await openFind(page);await page.getByRole('textbox',{name:'查找文字'}).fill('x');await page.getByRole('textbox',{name:'替换为'}).fill('汉'.repeat(11000));await page.getByRole('button',{name:'替换',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Markdown 源码'})).toHaveValue(/汉{1000}/)
 await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown:Array(2000).fill('x').join(' '),shelved:false}]});await page.reload();await expect(page.locator('.loading-state')).toHaveCount(0);await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:'源码'}).click();await openFind(page);const huge='汉'.repeat(12000);await page.getByRole('textbox',{name:'查找文字'}).fill('x');await page.getByRole('textbox',{name:'替换为'}).fill(huge);await page.getByRole('button',{name:'全部替换'}).click();await expect(page.getByRole('alert')).toContainText('64 MiB');await expect(page.getByRole('textbox',{name:'Markdown 源码'})).toHaveValue(/x/)
})
test('clearing or closing cancels a queued read-only find request',async({page})=>{
 await boot(page);await openFind(page);const input=page.getByRole('textbox',{name:'查找文字'});await input.fill('中文');await expect(page.getByText('1/6')).toHaveCount(1);const before=await page.evaluate(()=>{const c=document.querySelector('.pm-port').__vueParentComponent.exposed.capture(),s=c.pm.state.selection;return {from:s.from,to:s.to,text:c.pm.state.doc.textBetween(s.from,s.to,'')}})
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('save_document'));await page.keyboard.press('Control+s');await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.save_document||0)).toBe(1);await expect.poll(()=>coordinatorBusy(page)).toBe(true);await input.fill('标题');await input.fill('');await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('save_document'));await expect.poll(()=>coordinatorBusy(page)).toBe(false);await expect(page.getByText('输入查找文字')).toHaveCount(1);await expect.poll(()=>page.evaluate(()=>{const c=document.querySelector('.pm-port').__vueParentComponent.exposed.capture(),s=c.pm.state.selection;return {from:s.from,to:s.to,text:c.pm.state.doc.textBetween(s.from,s.to,'')}})).toEqual(before)
 await input.fill('标题');await expect(page.getByText('1/1')).toHaveCount(1);const beforeClose=await page.evaluate(()=>{const c=document.querySelector('.pm-port').__vueParentComponent.exposed.capture(),s=c.pm.state.selection;return {from:s.from,to:s.to,text:c.pm.state.doc.textBetween(s.from,s.to,'')}});await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('save_document'));await page.keyboard.press('Control+s');await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.save_document||0)).toBe(2);await expect.poll(()=>coordinatorBusy(page)).toBe(true);await input.fill('中文');await page.keyboard.press('Escape');await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('save_document'));await expect.poll(()=>coordinatorBusy(page)).toBe(false);await expect(page.getByRole('dialog')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>{const c=document.querySelector('.pm-port').__vueParentComponent.exposed.capture(),s=c.pm.state.selection;return {from:s.from,to:s.to,text:c.pm.state.doc.textBetween(s.from,s.to,'')}})).toEqual(beforeClose);await expect(page.getByRole('alert')).toHaveCount(0)
})
test('source queued read-only find cancellation preserves the source selection',async({page})=>{
 await boot(page);await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:'源码'}).click();const source=page.getByRole('textbox',{name:'Markdown 源码'});await expect(source).toBeVisible();await openFind(page);const input=page.getByRole('textbox',{name:'查找文字'});await input.fill('中文');await expect(page.getByText('1/6')).toHaveCount(1);const before=await source.evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,value:el.value.slice(el.selectionStart,el.selectionEnd)}));await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('save_document'));await page.keyboard.press('Control+s');await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.save_document||0)).toBe(1);await expect.poll(()=>coordinatorBusy(page)).toBe(true);await input.fill('标题');await page.keyboard.press('Escape');await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('save_document'));await expect.poll(()=>coordinatorBusy(page)).toBe(false);await expect(page.getByRole('dialog')).toHaveCount(0);await expect.poll(()=>source.evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,value:el.value.slice(el.selectionStart,el.selectionEnd)}))).toEqual(before);await expect(page.getByRole('alert')).toHaveCount(0)
})
test('source find rebinds to a switched page without refilling the query',async({page})=>{
 await page.addInitScript(installMockHost,{documents:[{id:'a',title:'A',markdown:sample,shelved:false,viewState:{mode:'source'}},{id:'b',title:'B',markdown:'B页 中文😀',shelved:false,viewState:{mode:'source'}}]});await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0);const source=page.getByRole('textbox',{name:'Markdown 源码'});await expect(source).toBeVisible();await openFind(page);const input=page.getByRole('textbox',{name:'查找文字'});await input.fill('中文');await expect(page.getByText('1/6')).toHaveCount(1);await page.locator('[data-tab-id="b"] .tab-title').click();await expect.poll(()=>page.locator('.tab.selected').textContent()).toContain('B');await expect.poll(()=>page.getByText('1/1').count()).toBe(1);await expect(source).toHaveValue('B页 中文😀')
})
test('reopening Find cancels its queued read-only lookup',async({page})=>{
 await boot(page);await openFind(page);const input=page.getByRole('textbox',{name:'查找文字'});await input.fill('中文');await expect(page.getByText('1/6')).toHaveCount(1);const before=await page.evaluate(()=>{const c=document.querySelector('.pm-port').__vueParentComponent.exposed.capture(),s=c.pm.state.selection;return {from:s.from,to:s.to,text:c.pm.state.doc.textBetween(s.from,s.to,'')}});await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('save_document'));await page.keyboard.press('Control+s');await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.save_document||0)).toBe(1);await expect.poll(()=>coordinatorBusy(page)).toBe(true);await page.keyboard.press('Control+f');await page.keyboard.press('Escape');await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('save_document'));await expect.poll(()=>coordinatorBusy(page)).toBe(false);await expect(page.getByRole('dialog')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>{const c=document.querySelector('.pm-port').__vueParentComponent.exposed.capture(),s=c.pm.state.selection;return {from:s.from,to:s.to,text:c.pm.state.doc.textBetween(s.from,s.to,'')}})).toEqual(before);await expect(page.getByRole('alert')).toHaveCount(0)
})
test('passive rendered find refresh does not move a caret during continued typing',async({page})=>{
 await boot(page);await openFind(page);await page.getByRole('textbox',{name:'查找文字'}).fill('中文');await expect(page.getByText('1/6')).toHaveCount(1);const editor=body(page);await editor.locator('p').first().click({position:{x:8,y:8}});await page.keyboard.type('Z');await page.keyboard.type('Y');const before=await page.evaluate(()=>document.querySelector('.pm-port').__vueParentComponent.exposed.capture());await expect.poll(()=>page.evaluate(()=>document.querySelector('.pm-port').__vueParentComponent.exposed.capture().markdown)).toContain('ZY');await new Promise(resolve=>setTimeout(resolve,300));const after=await page.evaluate(()=>document.querySelector('.pm-port').__vueParentComponent.exposed.capture());expect(after.viewState.selection).toEqual(before.viewState.selection);expect(after.markdown).toContain('ZY')
})
test('passive source find refresh does not move the source caret during continued typing',async({page})=>{
 await boot(page);await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:'源码'}).click();const source=page.getByRole('textbox',{name:'Markdown 源码'});await expect(source).toBeVisible();await openFind(page);await page.getByRole('textbox',{name:'查找文字'}).fill('中文');await expect(page.getByText('1/6')).toHaveCount(1);await source.click();await source.press('Control+Home');await page.keyboard.type('Z');await page.keyboard.type('Y');const before=await source.evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,value:el.value}));await expect.poll(()=>source.inputValue()).toContain('ZY');await new Promise(resolve=>setTimeout(resolve,300));const after=await source.evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,value:el.value}));expect(after).toEqual(before)
})
