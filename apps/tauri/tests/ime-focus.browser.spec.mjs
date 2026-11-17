import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'

// These are DOM focus/ownership regressions. Physical IME acceptance still needs
// a Windows candidate window and native keystrokes in the debug Tauri app.
for(const command of ['switch','create']){
 test(`source IME keeps focus until candidate commit before ${command}`,async({page})=>{
  const original='# Original\n\nAlpha\n',committed=original+'测试'
  await page.addInitScript(installMockHost,{markdown:original})
  await page.goto('/?testHost=1')
  await expect(page.locator('.loading-state')).toHaveCount(0)
  await page.getByText('视图',{exact:true}).click()
  await page.locator('.menu-popup button').filter({hasText:'源码'}).click()
  const input=page.getByRole('textbox',{name:'Markdown 源码',exact:true})
  await input.focus()
  await input.dispatchEvent('compositionstart',{data:''})
  await input.evaluate(el=>{
   el.value+="c's"
   el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:"c's"}))
  })
  const target=command==='switch'?page.locator('.tab-title').filter({hasText:'公式推导'}):page.getByRole('button',{name:'新建页面',exact:true})
  await target.click()
  // click-only composition tests missed the preceding default mousedown blur.
  await expect(input).toBeFocused({timeout:1500})
  await expect(page.locator('.tab.selected')).toContainText('方案讨论')
  expect(await input.evaluate(el=>el.readOnly)).toBe(false)
  expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a').markdown)).toBe(original)
  expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.size)).toBe(3)

  await input.evaluate((el,value)=>{
   el.value=value
   el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'测试'}))
   el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'测试'}))
  },committed)
  await expect(page.locator('.tab.selected')).toContainText(command==='switch'?'公式推导':'未命名笔记')
  expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a').markdown)).toBe(committed)
  const next=await page.evaluate(()=>{
   const host=window.__FROWD_TEST_HOST__
   return host.rows.get(document.querySelector('.tab.selected').dataset.tabId).markdown
  })
  expect(next).not.toContain("c's")
  expect(next).not.toContain('测试')
  await page.locator('.tab-title').filter({hasText:'方案讨论'}).click()
  await expect(input).toHaveValue(committed)
  await input.press('Control+z')
  await expect(input).toHaveValue(original)
  await input.press('Control+y')
  await expect(input).toHaveValue(committed)
 })
}
