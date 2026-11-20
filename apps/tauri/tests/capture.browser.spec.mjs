import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'
import {readFile} from 'node:fs/promises'

const resource='.frowd-assets/'+('a'.repeat(64))+'.png'
const resourceBase64=(await readFile(new URL('./fixtures/synthetic-resource.png',import.meta.url))).toString('base64')

const markdown='# 合成动效文稿\n\n| 项目 | 说明 |\n| --- | --- |\n| 表格 | 保留原画面和收起流程 |\n\n公式 $E=mc^2$。\n\n最后一段。'
async function boot(page,content=markdown,options={}){
 await page.emulateMedia({reducedMotion:'no-preference'})
 await page.addInitScript(installMockHost,{...options,markdown:content})
 await page.goto('/?testHost=1')
 await expect(page.locator('.ProseMirror:visible')).toBeVisible()
 await expect(page.locator('.loading-state')).toHaveCount(0)
}
const captureCount=page=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.capture_main_viewport||0)

test('table collapse actually draws motion frames and restores without another capture',async({page})=>{
 await boot(page)
 await page.getByRole('button',{name:'标签收起 方案讨论',exact:true}).click()
 await expect(page.locator('.page-flight')).toBeVisible({timeout:2500})
 await expect.poll(async()=>{const p=await page.locator('.page-flight').getAttribute('data-progress').catch(()=>null);return p!==null&&Number(p)>0&&Number(p)<1}).toBe(true)
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','b')
 await expect(page.locator('.page-flight,.page-flight-backdrop')).toHaveCount(0)
 expect(await captureCount(page)).toBe(1)
 await page.locator('[data-page-id="a"] .page-title').click()
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','a')
 await expect(page.locator('.ProseMirror')).toContainText('最后一段')
 expect(await captureCount(page)).toBe(1)
})

test('inactive collapse never captures the current document',async({page})=>{
 await boot(page)
 await page.getByRole('button',{name:'标签收起 公式推导',exact:true}).click()
 await expect(page.locator('[data-tab-id="b"]')).toHaveCount(0)
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','a')
 expect(await captureCount(page)).toBe(0)
})

test('capture failure retains the persisted shelf state and allows safe restoration',async({page})=>{
 await boot(page,markdown+'\n\n![合成资源]('+resource+')',{objects:[[resource,{mime:'image/png',base64:resourceBase64}]],bindings:[['a',[resource]]]})
 await expect.poll(()=>page.locator('.ProseMirror img').evaluateAll(images=>images.some(image=>image.naturalWidth===240))).toBe(true)
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.fail='capture_main_viewport')
 await page.getByRole('button',{name:'标签收起 方案讨论',exact:true}).click()
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','b')
 await expect(page.locator('.page-flight,.page-flight-backdrop')).toHaveCount(0)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a').shelved)).toBe(true)
 await page.locator('[data-page-id="a"] .page-title').click()
 await expect(page.locator('.ProseMirror')).toContainText('最后一段')
 await expect.poll(()=>page.locator('.ProseMirror img').evaluateAll(images=>images.some(image=>image.naturalWidth===240))).toBe(true)
 expect(await page.evaluate(reference=>window.__FROWD_TEST_HOST__.bindings.get('a').has(reference),resource)).toBe(true)
})

test('failed body persistence prevents shelf commit and never requests a capture',async({page})=>{
 await boot(page)
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.fail='update_document')
 await page.locator('.ProseMirror:visible').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('未确认最后输入')
 await page.getByRole('button',{name:'标签收起 方案讨论',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('合成写入失败')
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','a')
 expect(await captureCount(page)).toBe(0)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a').shelved)).toBe(false)
})

for(const change of ['resize','scroll','visibilitychange'])test(`${change} cancels a held capture and its late reply never paints the next document`,async({page})=>{
 await boot(page,change==='scroll'?markdown+'\n\n'+('合成长文滚动内容。\n\n'.repeat(80)):markdown)
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('capture_main_viewport'))
 await page.getByRole('button',{name:'标签收起 方案讨论',exact:true}).click()
 await expect.poll(()=>captureCount(page)).toBe(1)
 if(change==='resize')await page.setViewportSize({width:1180,height:820})
 else if(change==='scroll')await page.locator('.pm-scroller').evaluate(element=>element.scrollTop=80)
 else await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','b')
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('capture_main_viewport'))
 await expect(page.locator('.page-flight,.page-flight-backdrop')).toHaveCount(0)
 await expect(page.locator('.ProseMirror')).toContainText('第二篇')
})
