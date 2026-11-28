import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'

const body=page=>page.locator('.ProseMirror:visible')
async function boot(page,markdown){
 await page.addInitScript(installMockHost,{markdown});await page.goto('/?testHost=1')
 await expect(page.locator('.loading-state')).toHaveCount(0);await expect(body(page)).toBeVisible()
 await page.getByRole('button',{name:'大纲',exact:true}).click()
}
async function capture(page){return page.locator('.pm-port').evaluate(el=>{const c=el.__vueParentComponent.exposed.capture(),s=c.pm.state.selection;return{markdown:c.markdown,id:c.id,generation:c.generation,selected:{type:s.$from.parent.type.name,text:s.$from.parent.textContent,level:s.$from.parent.attrs.level,pos:s.from}}})}
async function visibleHeading(page,locator){
 const rect=await locator.boundingBox(),viewport=await page.locator('.pm-scroller').boundingBox()
 expect(rect.y).toBeGreaterThanOrEqual(viewport.y-1)
 expect(rect.y+rect.height).toBeLessThanOrEqual(viewport.y+viewport.height+1)
}
const filler=Array.from({length:32},(_,n)=>`合成前文第${n}段，供独立大纲导航验证。\n`).join('\n')

test('outline locates the actual heading after parsing plain blank lines',async({page})=>{
 const markdown='# 开始\n\n\n\n'+filler+'\n## 准确目标\n\n目标后正文。\n\n'+filler
 await boot(page,markdown)
 await page.getByRole('button',{name:'准确目标',exact:true}).click()
 await expect.poll(async()=> (await capture(page)).selected).toMatchObject({type:'heading',text:'准确目标'})
 await visibleHeading(page,body(page).locator('h2'))
 expect((await capture(page)).markdown).toBe(markdown)
 await expect(page.getByRole('alert')).toHaveCount(0)
})

const mixed='---\ntitle: metadata\n# YAML伪标题\n---\n\n# 开始\n\n<br />\n\n<br />\n\n| 项目 | 值 |\n| --- | --- |\n| 原表格 | 42 |\n\n$$\nE=mc^2\n$$\n\n```md\n# 代码伪标题\n```\n\n```mermaid\nflowchart LR\nA[起点] --> B[终点]\n```\n\n'+filler+'\n同名 **标题**\n---\n\n第一处。\n\n'+filler+'\n## 同名 **标题**\n\n第二处。\n\n> ### 引用 `code` 标题\n> 引用正文。\n\n脚注引用[^a]。\n\n[^a]: 定义内容。\n\n'+filler

test('outline distinguishes duplicate formatted Setext/ATX and quoted headings in mixed blocks',async({page})=>{
 await boot(page,mixed)
 await expect(page.locator('.outline-list button')).toHaveText(['开始','同名 标题','同名 标题','引用 code 标题'])
 await page.locator('.outline-list button').filter({hasText:'同名 标题'}).nth(1).click()
 const selected=await capture(page),second=body(page).locator('h2').filter({hasText:'同名 标题'}).nth(1)
 await visibleHeading(page,second)
 const expected=await body(page).evaluate(el=>{const c=el.closest('.pm-port').__vueParentComponent.exposed.capture();const matches=[];c.pm.state.doc.descendants((n,pos)=>{if(n.type.name==='heading'&&n.textContent==='同名 标题')matches.push(pos+1)});return matches[1]})
 expect(selected.selected.pos).toBe(expected)
 await page.getByRole('button',{name:'引用 code 标题',exact:true}).click()
 await expect.poll(async()=> (await capture(page)).selected.text).toBe('引用 code 标题')
 await visibleHeading(page,body(page).locator('blockquote h3'))
 expect((await capture(page)).markdown).toBe(mixed)
 await expect(page.getByRole('alert')).toHaveCount(0)
})

test('the same heading title at another level resolves to its own instance',async({page})=>{
 const markdown='# 同名\n\n'+filler+'\n### 同名\n\n'+filler
 await boot(page,markdown)
 await page.locator('.outline-list button').nth(1).click()
 expect((await capture(page)).selected).toMatchObject({type:'heading',level:3,text:'同名'})
 await visibleHeading(page,body(page).locator('h3'))
})

test('source outline uses normalized CRLF offsets and measured textarea scrolling',async({page})=>{
 const markdown=mixed.replaceAll('\n','\r\n'),normalized=markdown.replaceAll('\r\n','\n')
 await boot(page,markdown)
 await page.keyboard.press('Control+/')
 const source=page.getByRole('textbox',{name:'Markdown 源码',exact:true});await expect(source).toBeVisible()
 const before=await source.inputValue()
 await page.locator('.outline-list button').filter({hasText:'同名 标题'}).nth(1).click()
 expect(await source.evaluate(el=>el.selectionStart)).toBe(normalized.indexOf('## 同名'))
 expect(await source.evaluate(el=>el.scrollTop)).toBeGreaterThan(500)
 const position=await source.evaluate(el=>{
  const style=getComputedStyle(el),mirror=document.createElement('div'),marker=document.createElement('span')
  for(const p of ['font','lineHeight','letterSpacing','padding','boxSizing','wordBreak','overflowWrap','tabSize'])mirror.style[p]=style[p]
  Object.assign(mirror.style,{position:'absolute',visibility:'hidden',whiteSpace:'pre-wrap',width:el.clientWidth+'px'})
  mirror.textContent=el.value.slice(0,el.selectionStart);marker.textContent='X';mirror.append(marker);document.body.append(mirror)
  const y=marker.offsetTop-el.scrollTop;mirror.remove();return{y,height:el.clientHeight}
 })
 expect(position.y).toBeGreaterThanOrEqual(0);expect(position.y).toBeLessThan(position.height)
 await expect(source).toHaveValue(before)
 await expect(page.getByRole('alert')).toHaveCount(0)
})

test('fresh blank paragraphs created by end clicks do not disable heading navigation',async({page})=>{
 await boot(page,'# 开始\n\n## 文末前标题\n\n末段。\n')
 const point=await body(page).evaluate(el=>{const r=el.getBoundingClientRect(),last=el.lastElementChild.getBoundingClientRect();return{x:r.left+30,y:last.bottom+parseFloat(getComputedStyle(el).lineHeight)*4}})
 await page.mouse.click(point.x,point.y);await page.keyboard.insertText('文末续写')
 const before=await capture(page);expect(before.markdown).toMatch(/末段。\n{3,}文末续写/)
 expect(before.markdown).not.toContain('<br />')
 await page.getByRole('button',{name:'文末前标题',exact:true}).click()
 expect((await capture(page)).selected.text).toBe('文末前标题')
 expect((await capture(page)).markdown).toBe(before.markdown)
 await expect(page.getByRole('alert')).toHaveCount(0)
})

test('an ambiguous stale duplicate request refreshes the outline instead of choosing a shifted index',async({page})=>{
 const markdown='# 同名\n\n第一处。\n\n# 同名\n\n第二处。\n'
 await boot(page,markdown);await page.keyboard.press('Control+/')
 const source=page.getByRole('textbox',{name:'Markdown 源码',exact:true});await expect(source).toBeVisible()
 const updated='# 同名\n\n新增。\n\n'+markdown
 const position=await source.evaluate((el,text)=>{
  const oldSecond=document.querySelectorAll('.outline-list button')[1]
  el.value=text;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}))
  const caret=el.selectionStart;oldSecond.dispatchEvent(new MouseEvent('click',{bubbles:true}));return caret
 },updated)
 await expect(page.getByRole('alert')).toContainText('大纲已更新')
 expect(await source.evaluate(el=>el.selectionStart)).toBe(position)
 await expect(page.locator('.outline-list button')).toHaveCount(3)
 await page.locator('.outline-list button').nth(2).click()
 expect(await source.evaluate(el=>el.selectionStart)).toBe(updated.lastIndexOf('# 同名'))
 await expect(page.getByRole('alert')).toHaveCount(0)
})

test('outline refreshes source positions after body edits and ignores a request queued behind a page switch',async({page})=>{
 await boot(page,'# 开始\n\n可编辑前段。\n\n<br />\n\n'+filler+'\n## 之后目标\n\n'+filler)
 await body(page).locator('p').first().click();await page.keyboard.press('Home');await page.keyboard.insertText('新编辑前缀。')
 const edited=(await capture(page)).markdown
 await page.getByRole('button',{name:'之后目标',exact:true}).click()
 await expect.poll(async()=> (await capture(page)).selected.text).toBe('之后目标')
 expect((await capture(page)).markdown).toBe(edited)
 await page.evaluate(()=>{
  const target=[...document.querySelectorAll('.outline-list button')].find(el=>el.textContent==='之后目标')
  document.querySelector('[data-tab-id="b"] .tab-title').dispatchEvent(new MouseEvent('click',{bubbles:true}))
  target.dispatchEvent(new MouseEvent('click',{bubbles:true}))
 })
 await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id','b')
 const b=await capture(page)
 expect(b.id).toBe('b');expect(b.markdown).toBe('# 第二篇\n\n数学 $x^2$ 与代码。')
 expect(b.selected.text).not.toBe('之后目标')
 await expect(page.getByRole('alert')).toHaveCount(0)
})
