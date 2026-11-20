import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'

const input=page=>page.getByRole('textbox',{name:'当前页面名称',exact:true})
async function boot(page){
 await page.addInitScript(installMockHost,{documents:[
  {id:'a',title:'未命名笔记',markdown:'# A 正文',shelved:false},
  {id:'b',title:'B 页面',markdown:'# B 正文',shelved:false},
 ]})
 await page.goto('/?testHost=1')
 await expect(input(page)).toHaveAttribute('data-doc-id','a')
 await expect(input(page)).toHaveValue('未命名笔记')
}
const stored=(page,id)=>page.evaluate(id=>window.__FROWD_TEST_HOST__.rows.get(id).title,id)
async function holdRename(page){await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('rename_document'))}
async function enteredRename(page,count=1){await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.rename_document||0)).toBe(count)}
async function releaseRename(page){await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('rename_document'))}

test('rename keeps empty input through autosave acknowledgement and accepts the exact new name',async({page})=>{
 await boot(page);await holdRename(page)
 await input(page).fill('')
 await expect(input(page)).toHaveAttribute('placeholder','未命名笔记')
 await expect(input(page)).toHaveValue('')
 await enteredRename(page) // Autosave actually reached the host, after its debounce.
 await releaseRename(page)
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('未命名笔记')
 await expect(input(page)).toHaveValue('')
 await expect(input(page)).toBeFocused()
 await page.keyboard.insertText('准确的新页面名')
 await expect(input(page)).toHaveValue('准确的新页面名')
 await input(page).press('Enter')
 await expect.poll(()=>stored(page,'a')).toBe('准确的新页面名')
})

for(const commit of ['Enter','blur'])test(`rename commits an empty title to the existing default on ${commit}`,async({page})=>{
 await boot(page);await input(page).fill('')
 if(commit==='Enter')await input(page).press('Enter')
 else await page.locator('.ProseMirror').click()
 await expect(input(page)).not.toBeFocused()
 await expect(input(page)).toHaveValue('未命名笔记')
 await expect.poll(()=>stored(page,'a')).toBe('未命名笔记')
})

test('rename retains later raw input and caret when delayed normalized acknowledgements arrive',async({page})=>{
 await boot(page);await holdRename(page)
 await input(page).fill('  较早名称  ');await enteredRename(page)
 await input(page).fill('  更晚名称  ')
 await input(page).evaluate(el=>el.setSelectionRange(3,5))
 await releaseRename(page)
 await expect(page.locator('.tab.selected .tab-title')).toHaveText('更晚名称')
 await expect.poll(()=>stored(page,'a')).toBe('更晚名称')
 await expect(input(page)).toHaveValue('  更晚名称  ')
 await expect(input(page)).toBeFocused()
 expect(await input(page).evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([3,5])
 await input(page).press('Enter')
 await expect(input(page)).toHaveValue('更晚名称')
})

test('rename flushes the latest A title before switching and never copies its editing draft into B',async({page})=>{
 await boot(page);await holdRename(page)
 await input(page).fill('旧 A 名称');await enteredRename(page)
 await input(page).fill('最终 A 名称')
 await page.locator('[data-tab-id="b"] .tab-title').click()
 await expect(input(page)).toHaveAttribute('data-doc-id','a')
 await releaseRename(page)
 await expect(input(page)).toHaveAttribute('data-doc-id','b')
 await expect(input(page)).toHaveValue('B 页面')
 await expect.poll(()=>stored(page,'a')).toBe('最终 A 名称')
 expect(await stored(page,'b')).toBe('B 页面')
 await input(page).fill('B 自己的名称');await input(page).press('Enter')
 await expect.poll(()=>stored(page,'b')).toBe('B 自己的名称')
 expect(await stored(page,'a')).toBe('最终 A 名称')
})

test('rename includes focused final input in the normal-close handshake without waiting for blur',async({page})=>{
 await boot(page);await input(page).fill('关闭前最后名称')
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.requestClose())
 expect(await stored(page,'a')).toBe('关闭前最后名称')
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.closed)).toBe(true)
})
