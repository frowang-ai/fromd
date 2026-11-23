import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'

const markdown='# 一级标题\n\n## 二级标题\n\n### 三级标题\n\n#### 四级标题\n\n##### 五级标题\n\n###### 六级标题\n\n普通正文。'
for(const fontSize of [16,20])test(`rendered heading hierarchy never grows at a deeper level (${fontSize}px body)`,async({page},testInfo)=>{
 await page.addInitScript(installMockHost,{markdown})
 await page.goto('/?testHost=1')
 await expect(page.locator('.loading-state')).toHaveCount(0)
 const body=page.locator('.ProseMirror:visible')
 await expect(body).toBeVisible()
 if(fontSize!==16){
  await page.getByRole('button',{name:'阅读设置',exact:true}).click()
  await page.getByRole('combobox',{name:'正文字号',exact:true}).selectOption(String(fontSize))
  await page.getByRole('button',{name:'关闭阅读设置',exact:true}).click()
 }
 await expect(body).toHaveCSS('font-size',`${fontSize}px`)
 const headings=await body.locator('h1,h2,h3,h4,h5,h6').evaluateAll(nodes=>nodes.map(el=>{
  const style=getComputedStyle(el)
  return{tag:el.tagName,size:parseFloat(style.fontSize),weight:Number(style.fontWeight),lineHeight:parseFloat(style.lineHeight)}
 }))
 expect(headings.map(h=>h.tag)).toEqual(['H1','H2','H3','H4','H5','H6'])
 expect(headings[2].size).toBeGreaterThan(headings[3].size)
 for(let i=1;i<headings.length;i++){
  expect(headings[i].size,`${headings[i].tag} size must not exceed its parent level`).toBeLessThanOrEqual(headings[i-1].size)
  expect(headings[i].weight,`${headings[i].tag} weight must not exceed its parent level`).toBeLessThanOrEqual(headings[i-1].weight)
 }
 expect(headings.every(h=>h.size>=fontSize&&h.lineHeight>=h.size)).toBe(true)
 await page.screenshot({path:testInfo.outputPath(`headings-${fontSize}.png`)})
 await page.getByRole('button',{name:'大纲',exact:true}).click()
 await page.getByRole('button',{name:'四级标题',exact:true}).click()
 const selected=await page.locator('.pm-port').evaluate(el=>{
  const c=el.__vueParentComponent.exposed.capture(),n=c.pm.state.selection.$from.parent
  return{markdown:c.markdown,type:n.type.name,level:n.attrs.level,text:n.textContent}
 })
 expect(selected).toEqual({markdown,type:'heading',level:4,text:'四级标题'})
 await page.keyboard.press('Control+/')
 await expect(page.getByRole('textbox',{name:'Markdown 源码',exact:true})).toHaveValue(markdown)
})
