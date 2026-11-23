import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'
import {readFile} from 'node:fs/promises'

const resource='.frowd-assets/'+('a'.repeat(64))+'.png'
const base64=(await readFile(new URL('./fixtures/synthetic-resource.png',import.meta.url))).toString('base64')
const markdown='# 合成收起文稿\n\n| 项目 | 说明 |\n| --- | --- |\n| 表格 | 直接收起并保留内容 |\n\n公式 $E=mc^2$。\n\n最后一段。'
async function boot(page,motion='no-preference',options={}){
 await page.emulateMedia({reducedMotion:motion})
 await page.addInitScript(installMockHost,{markdown,...options})
 await page.goto('/?testHost=1')
 await expect(page.locator('.ProseMirror:visible')).toBeVisible()
 await expect(page.locator('.loading-state')).toHaveCount(0)
 await page.evaluate(()=>{
  window.__shelfVisualNodes=0
  new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&(node.matches('.page-flight,.page-flight-backdrop')||node.querySelector('.page-flight,.page-flight-backdrop')))window.__shelfVisualNodes++}).observe(document.body,{childList:true,subtree:true})
 })
}
async function noCaptureOrMotion(page){
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.calls.filter(c=>c.command==='capture_main_viewport').length)).toBe(0)
 expect(await page.evaluate(()=>window.__shelfVisualNodes)).toBe(0)
 await expect(page.locator('.page-flight,.page-flight-backdrop')).toHaveCount(0)
}

for(const [label,motion] of [['normal motion','no-preference'],['reduced motion','reduce']])test(`direct shelf under ${label} persists last input and restores without capture or animation`,async({page})=>{
 await boot(page,motion)
 const name=page.getByRole('textbox',{name:'当前页面名称',exact:true})
 await name.fill('直接收起 A');await name.press('Enter')
 await page.locator('.ProseMirror').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 最后输入未手动保存')
 await page.getByRole('button',{name:'标签收起 直接收起 A',exact:true}).click()
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','b')
 const saved=await page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a'))
 expect(saved.shelved).toBe(true);expect(saved.title).toBe('直接收起 A');expect(saved.markdown).toContain('最后输入未手动保存')
 await expect(page.locator('[aria-label="已收起页面"] [data-page-id="a"]')).toBeVisible()
 await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable','true')
 await page.locator('.ProseMirror').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' B可继续编辑')
 await page.locator('[data-page-id="a"] .page-title').click()
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','a')
 await expect(page.locator('.ProseMirror')).toContainText('最后输入未手动保存')
 await noCaptureOrMotion(page)
})

test('direct shelf works with the sidebar hidden and in a narrow drawer',async({page})=>{
 await boot(page)
 await page.getByRole('button',{name:'隐藏工作栏',exact:true}).click()
 await page.getByRole('button',{name:'标签收起 方案讨论',exact:true}).click()
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','b')
 await page.setViewportSize({width:540,height:820})
 await page.getByRole('button',{name:'显示页面工作栏',exact:true}).click()
 await page.locator('[data-page-id="a"] .page-title').click()
 await page.getByRole('button',{name:'标签收起 方案讨论',exact:true}).click()
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','b')
 await noCaptureOrMotion(page)
})

test('direct restoration retains managed images and resource bindings',async({page})=>{
 await boot(page,'no-preference',{markdown:markdown+'\n\n![合成资源]('+resource+')',objects:[[resource,{mime:'image/png',base64}]],bindings:[['a',[resource]]]})
 await expect.poll(()=>page.locator('.ProseMirror img').evaluateAll(images=>images.some(i=>i.naturalWidth===240))).toBe(true)
 await page.getByRole('button',{name:'标签收起 方案讨论',exact:true}).click()
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','b')
 await page.locator('[data-page-id="a"] .page-title').click()
 await expect.poll(()=>page.locator('.ProseMirror img').evaluateAll(images=>images.some(i=>i.naturalWidth===240))).toBe(true)
 expect(await page.evaluate(ref=>window.__FROWD_TEST_HOST__.bindings.get('a').has(ref),resource)).toBe(true)
 await noCaptureOrMotion(page)
})

test('inactive and all-page shelving retain identity, order and the empty-state recovery',async({page})=>{
 await boot(page)
 await page.getByRole('button',{name:'标签收起 公式推导',exact:true}).click()
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','a')
 await page.locator('[data-tab-id="a"]').click({button:'right'})
 await page.getByRole('menuitem',{name:'收起全部页面',exact:true}).click()
 await expect(page.locator('.empty-desktop')).toBeVisible()
 expect(await page.evaluate(()=>[...window.__FROWD_TEST_HOST__.rows.keys()])).toEqual(['a','b','c'])
 await page.getByRole('button',{name:'全部展开',exact:true}).click()
 await expect(page.locator('.tab-title')).toHaveText(['方案讨论','公式推导','阅读摘录'])
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','a')
 await noCaptureOrMotion(page)
})

for(const command of ['update_document','shelve_document'])test(`failed ${command} preserves the active page and does not report a successful shelf`,async({page})=>{
 await boot(page)
 await page.evaluate(command=>window.__FROWD_TEST_HOST__.fail=command,command)
 await page.locator('.ProseMirror').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 最后失败输入保留')
 await page.getByRole('button',{name:'标签收起 方案讨论',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('合成写入失败')
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','a')
 await expect(page.locator('.ProseMirror')).toContainText('最后失败输入保留')
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a').shelved)).toBe(false)
 await noCaptureOrMotion(page)
})
