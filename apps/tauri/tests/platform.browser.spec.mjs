import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'
async function boot(page,platform,{native=false,markdown='[网页](https://example.com/)\n\n$$\nx^2\n$$\n'}={}){
 await page.addInitScript(installMockHost,{markdown})
 await page.goto(`/?testHost=1&testPlatform=${platform}${native?'&testNativeChrome=1':''}`)
 await expect(page.locator('.loading-state')).toHaveCount(0)
 await expect(page.locator('.ProseMirror:visible')).toBeVisible()
}
for(const platform of ['windows','macos']){
 const primary=platform==='macos'?'Meta':'Control'
 test(`${platform}: platform chrome and shortcut labels`,async({page})=>{
  await boot(page,platform)
  await page.getByText('文件',{exact:true}).click()
  await expect(page.getByRole('button',{name:/新建页面.*(?:Ctrl\+N|⌘N)/})).toContainText(platform==='macos'?'⌘N':'Ctrl+N')
  await page.keyboard.press('Escape')
  await page.getByText('编辑',{exact:true}).click()
  await expect(page.getByRole('button',{name:/查找 \/ 替换/})).toContainText(platform==='macos'?'⌥⌘F':'Ctrl+H')
  await page.keyboard.press('Escape')
  await page.locator('.writing-math-block .writing-math-preview').click()
  await expect(page.locator('.writing-block-code .cm-scroller')).toHaveCSS('font-family',/SF Mono.*Menlo.*Monaco.*Consolas/)
  await expect(page.locator('.writing-block-done')).toHaveAttribute('title',`完成编辑（${platform==='macos'?'⌘Enter':'Ctrl+Enter'}）`)
  await boot(page,platform,{native:true})
  await expect(page.locator('.window-controls')).toHaveCount(platform==='macos'?0:1)
  await expect(page.locator('.app-menu')).toHaveCount(platform==='macos'?0:1)
  await expect(page.getByRole('button',{name:'阅读设置',exact:true})).toBeVisible()
 })
 test(`${platform}: source, find, zoom and explicit Ctrl+Tab`,async({page})=>{
  await boot(page,platform)
  await page.keyboard.press(`${primary}+/`)
  await expect(page.getByRole('textbox',{name:'Markdown 源码',exact:true})).toBeVisible()
  await page.keyboard.press(`${primary}+/`)
  await expect(page.locator('.ProseMirror:visible')).toBeVisible()
  await page.keyboard.press(platform==='macos'?'Alt+Meta+f':'Control+h')
  await expect(page.getByRole('dialog',{name:'当前文档查找替换'})).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press(`${primary}+=`);await expect(page.locator('.app-shell')).toHaveAttribute('data-zoom','110')
  await page.keyboard.press(`${primary}+0`);await expect(page.locator('.app-shell')).toHaveAttribute('data-zoom','100')
  await page.keyboard.press('Control+Tab');await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','b')
  await page.keyboard.press('Control+Shift+Tab');await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','a')
  if(platform==='macos'){
   const prevented=await page.evaluate(()=>['h','Tab'].map(key=>{const e=new KeyboardEvent('keydown',{key,metaKey:true,bubbles:true,cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}))
   expect(prevented).toEqual([false,false]);await expect(page.getByRole('dialog',{name:'当前文档查找替换'})).toHaveCount(0)
   await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','a')
  }
 })
 test(`${platform}: links require the platform modifier and reject Ctrl+Meta`,async({page})=>{
  await boot(page,platform)
  const link=page.locator('.ProseMirror a').filter({hasText:'网页'})
  const calls=()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.calls.filter(c=>c.command==='open_document_link'))
  await link.click();expect(await calls()).toHaveLength(0)
  await link.click({modifiers:[platform==='macos'?'Control':'Meta']});expect(await calls()).toHaveLength(0)
  await link.click({modifiers:['Control','Meta']});expect(await calls()).toHaveLength(0)
  await link.click({modifiers:[primary]});await expect.poll(async()=>(await calls()).length).toBe(1)
  expect((await calls())[0].args.href).toBe('https://example.com/')
 })
}
