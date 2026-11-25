import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'
import {inlineCodeWrapMarkdown, measureInlineCodeWrap, expectInlineCodeWrap} from '../../../tests/fixtures/writing-inline-code-wrap.mjs'

const markdown='# SoloMD 风格排版\n\n正文使用系统无衬线字体，保留 **重点**、*强调*、[示例链接](https://example.com/) 和 `inline_code`。\n\n### 三级标题\n\n#### 四级标题\n\n> 引用使用浅色背景，正文保持清楚的层次。\n\n- 列表第一项\n- 列表第二项\n- [ ] 合成待办\n\n| 项目 | 状态 |\n| --- | --- |\n| 字体与颜色 | 统一 |\n| 编辑与保存 | 保留 |\n\n```js\nconst answer = "hello"; // comment\nconsole.log(answer);\n```\n\n正文公式 $x^2$。\n\n$$\nE=mc^2\n$$\n\n---\n\n最后一段。'
const body=page=>page.locator('.ProseMirror:visible')
async function capture(page){return page.locator('.pm-port').evaluate(el=>el.__vueParentComponent.exposed.capture().markdown)}
async function boot(page, content=markdown){
 await page.addInitScript(installMockHost,{markdown:content});await page.goto('/?testHost=1')
 await expect(page.locator('.loading-state')).toHaveCount(0);await expect(body(page)).toBeVisible()
 await page.evaluate(()=>document.fonts.ready)
}
async function theme(page,value){
 await page.getByRole('button',{name:'阅读设置',exact:true}).click()
 await page.getByRole('combobox',{name:'主题',exact:true}).selectOption(value)
 await page.getByRole('button',{name:'关闭阅读设置',exact:true}).click()
 await expect(page.locator('.app-shell')).toHaveAttribute('data-theme',value)
}
for(const mode of ['light','dark'])test(`inline code wraps within table cells and prose (${mode})`,async({page},testInfo)=>{
 await page.setViewportSize({width:560,height:950})
 await boot(page,inlineCodeWrapMarkdown);if(mode==='dark')await theme(page,mode)
 const layout=await body(page).evaluate(measureInlineCodeWrap)
 await testInfo.attach('inline-code-layout',{body:JSON.stringify(layout,null,2),contentType:'application/json'})
 expectInlineCodeWrap(expect,layout)
 expect(await capture(page)).toBe(inlineCodeWrapMarkdown)
 await body(page).locator('.milkdown-code-block').scrollIntoViewIfNeeded()
 await expect(body(page).locator('.milkdown-code-block .cm-scroller')).toHaveCSS('line-height','20.8px')
 // Click the second visual fragment, then type through the real editor selection.
 const code=body(page).locator('td code').first()
 await code.scrollIntoViewIfNeeded()
 const point=await code.evaluate(el=>{const r=el.getClientRects()[1];return {x:r.left+8,y:(r.top+r.bottom)/2}})
 await page.mouse.click(point.x,point.y)
 expect(await page.evaluate(()=>Boolean(getSelection().anchorNode?.parentElement?.closest('code')))).toBe(true)
 await page.keyboard.insertText('EDIT')
 await expect(code).toContainText('EDIT')
 await page.keyboard.press('Control+z')
 await expect(code).not.toContainText('EDIT')
})

for(const mode of ['light','dark'])test(`SoloMD writing palette preserves document semantics and editing (${mode})`,async({page},testInfo)=>{
 await page.setViewportSize({width:1280,height:1150})
 await boot(page);if(mode==='dark')await theme(page,mode)
 await expect(page.locator('.editor-panel')).toHaveCSS('background-color',mode==='light'?'rgb(255, 255, 255)':'rgb(28, 28, 30)')
 const text=body(page)
 await expect(text).toHaveCSS('color',mode==='light'?'rgb(31, 30, 28)':'rgb(236, 234, 230)')
 expect(await text.evaluate(el=>getComputedStyle(el).fontFamily)).toContain('Segoe UI')
 await expect(text).toHaveCSS('line-height','28.8px')
 await expect(text.locator('p').first()).toHaveCSS('line-height','28.8px')
 await expect(text.locator('a')).toHaveCSS('color',mode==='light'?'rgb(180, 86, 27)':'rgb(244, 162, 107)')
 await expect(text.locator('blockquote')).toHaveCSS('background-color',mode==='light'?'rgb(247, 246, 243)':'rgb(38, 38, 40)')
 await expect(text.locator('blockquote')).toHaveCSS('border-left-width','0px')
 await expect(text.locator('table.children td p').first()).toHaveCSS('line-height','25.6px')
 await expect(text.locator('table.children')).toHaveCount(1)
 await expect(text.locator('table.children td')).toHaveCount(4)
 await expect(text.locator('.writing-math-inline .katex')).toHaveCount(1)
 await expect(text.locator('.writing-math-block .katex')).toHaveCount(1)
 await expect(text.locator('.writing-block-source')).toBeHidden()
 expect(await capture(page)).toBe(markdown)
 const top=await text.locator('h1').evaluate(el=>el.getBoundingClientRect().top-el.closest('.pm-scroller').getBoundingClientRect().top)
 expect(top).toBeCloseTo(14,0)
 await page.screenshot({path:testInfo.outputPath(`markdown-${mode}.png`)})
 await text.getByRole('checkbox',{name:'标为已完成',exact:true}).click()
 await expect(text.getByRole('checkbox',{name:'标为未完成',exact:true})).toHaveAttribute('aria-checked','true')
 expect(await capture(page)).toContain('[x] 合成待办')
 await text.press('Control+z');expect(await capture(page)).toBe(markdown)
 await page.keyboard.press('Control+/')
 const source=page.getByRole('textbox',{name:'Markdown 源码',exact:true});await expect(source).toHaveValue(markdown)
 await page.keyboard.press('Control+/');expect(await capture(page)).toBe(markdown)
})

test('SoloMD narrow layout keeps tables and code inside the writing viewport',async({page},testInfo)=>{
 await page.setViewportSize({width:560,height:880});await boot(page)
 const initial=await capture(page)
 for(const mode of ['light','dark']){
  await theme(page,mode)
  const bounds=await body(page).evaluate(el=>({body:el.getBoundingClientRect().right,viewport:innerWidth,page:document.documentElement.scrollWidth}))
  expect(bounds.body).toBeLessThanOrEqual(bounds.viewport);expect(bounds.page).toBeLessThanOrEqual(bounds.viewport)
  await body(page).locator('.cm-content').scrollIntoViewIfNeeded()
  const code=await body(page).locator('.cm-editor').boundingBox()
  expect(code.x).toBeGreaterThanOrEqual(0);expect(code.x+code.width).toBeLessThanOrEqual(560)
  await page.screenshot({path:testInfo.outputPath(`markdown-narrow-${mode}.png`)})
  expect(await capture(page)).toBe(initial)
 }
})
