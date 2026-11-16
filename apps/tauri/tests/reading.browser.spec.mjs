import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'

const body = page => page.locator('.ProseMirror:visible')
const source = page => page.getByRole('textbox',{name:'Markdown 源码',exact:true})
const count = page => page.getByRole('status',{name:'字数统计',exact:true})
const setting = (page,name) => page.getByRole('combobox',{name,exact:true})
async function boot(page,markdown){
  await page.addInitScript(installMockHost,{markdown})
  await page.goto('/?testHost=1')
  await expect(page.locator('.tab.selected')).toContainText('方案讨论')
  await expect(body(page)).toBeVisible()
  await expect(page.locator('.loading-state')).toHaveCount(0)
}
async function settings(page){
  const button=page.getByRole('button',{name:'阅读设置',exact:true})
  if(await button.getAttribute('aria-expanded')!=='true')await button.click()
  await expect(setting(page,'正文字号')).toBeVisible()
}
async function sourceMode(page){await page.keyboard.press('Control+Shift+M');await expect(source(page)).toBeVisible()}
const pageErrors=new WeakMap()
test.beforeEach(async({page})=>{const errors=[];pageErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.message))})
test.afterEach(async({page})=>expect(pageErrors.get(page)).toEqual([]))

test('outline preserves the workbar, excludes metadata and code, and locates repeated Setext/ATX headings',async({page})=>{
  const markdown='---\ntitle: metadata\n# hidden\n---\n\n# 开始\n\n```md\n# fake\n```\n\n同名\n---\n\n第一处\n\n## 同名\n\n第二处'
  await boot(page,markdown)
  await expect(page.locator('.sidebar-switch button')).toHaveText(['页面','大纲'])
  await page.locator('.sidebar-switch').getByRole('button',{name:'大纲',exact:true}).click()
  const outline=page.getByRole('region',{name:'当前文稿大纲'})
  await expect(outline.getByRole('button')).toHaveText(['开始','同名','同名'])
  await outline.getByRole('button',{name:'同名',exact:true}).nth(1).click()
  await expect.poll(()=>page.evaluate(()=>{
    const h=window.getSelection()?.anchorNode?.parentElement?.closest('h2')
    return [...document.querySelectorAll('.ProseMirror h2')].filter(node=>node.textContent==='同名').indexOf(h)
  })).toBe(1)
  await sourceMode(page)
  await outline.getByRole('button',{name:'同名',exact:true}).nth(0).click()
  await expect(source(page)).toBeFocused()
  expect(await source(page).evaluate(input=>input.selectionStart)).toBe(markdown.indexOf('同名'))
  await outline.getByRole('button',{name:'同名',exact:true}).nth(1).click()
  expect(await source(page).evaluate(input=>input.selectionStart)).toBe(markdown.lastIndexOf('## 同名'))
  await expect(source(page)).toHaveValue(markdown)
})

test('statistics follow source/rich edits and page ownership, retaining literal punctuation',async({page})=>{
  await boot(page,'# 统计\n\n你好 world 123')
  await expect(count(page)).toHaveText('6 字词 · 12 字符')
  await sourceMode(page)
  await source(page).fill('# 统计\n\n你好 world 123\n\nhello... (c)')
  await expect(count(page)).toHaveText('8 字词 · 23 字符')
  await page.keyboard.press('Control+Shift+M')
  await body(page).press('Control+End');await page.keyboard.insertText(' again')
  await expect(count(page)).toHaveText('9 字词 · 28 字符')
  await page.locator('.tab-title').filter({hasText:'公式推导'}).click()
  await expect(count(page)).not.toHaveText('9 字词 · 28 字符')
  await page.locator('.tab-title').filter({hasText:'方案讨论'}).click()
  await expect(count(page)).toHaveText('9 字词 · 28 字符')
})

test('reading preferences preserve initial appearance, survive reload and report failed writes',async({page})=>{
  await boot(page,'# 设置\n\n保留正文')
  await expect(body(page)).toHaveCSS('font-size','16px')
  await expect(page.locator('.pm-scroller > .writing-editor')).toHaveCSS('max-width','860px')
  await settings(page)
  await setting(page,'正文字号').selectOption('20')
  await setting(page,'正文宽度').selectOption('720')
  await setting(page,'主题').selectOption('dark')
  await expect(body(page)).toHaveCSS('font-size','20px')
  await expect(page.locator('.pm-scroller > .writing-editor')).toHaveCSS('max-width','720px')
  await page.reload()
  await expect(body(page)).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme','dark')
  await expect(body(page)).toHaveCSS('font-size','20px')
  await settings(page)
  await expect(setting(page,'正文宽度')).toHaveValue('720')
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw Error('synthetic storage failure')}})
  await setting(page,'正文字号').selectOption('18')
  await expect(page.getByRole('dialog',{name:'阅读设置'}).getByRole('alert')).toContainText('保存失败')
  await expect(body(page)).toHaveCSS('font-size','18px')
  await page.getByRole('button',{name:'关闭阅读设置',exact:true}).click()
  await sourceMode(page)
  await expect(source(page)).toHaveCSS('font-size','18px')
  await expect(source(page)).toHaveValue('# 设置\n\n保留正文')
})

async function expectContrast(locator){
  await expect(locator).toBeVisible()
  const ratios=await locator.evaluate(element=>{
    const luminance=color=>{const channels=color.match(/[\d.]+/g).slice(0,3).map(value=>{const c=Number(value)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4});return .2126*channels[0]+.7152*channels[1]+.0722*channels[2]}
    const background=node=>{for(let at=node;at;at=at.parentElement){const color=getComputedStyle(at).backgroundColor;if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent')return color}return 'rgb(255,255,255)'}
    return [...element.querySelectorAll('.cm-line, .cm-line span')].filter(node=>node.textContent.trim()).map(node=>{const a=luminance(getComputedStyle(node).color),b=luminance(background(node));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})
  })
  expect(ratios.length).toBeGreaterThan(0)
  expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5)
}

test('dark code/math are readable, system changes are live and print retains default text styling',async({page},testInfo)=>{
  await boot(page,'# 深色\n\n```js\nconst answer = "hello"; // comment\n```\n\n$$\n\\frac{x^2}{2}+1\n$$\n\n行内 $x^2$。')
  await settings(page)
  await setting(page,'主题').selectOption('dark')
  await setting(page,'正文字号').selectOption('20')
  await page.getByRole('button',{name:'关闭阅读设置',exact:true}).click()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme','dark')
  await expectContrast(page.locator('.milkdown-code-block .cm-editor'))
  await page.locator('.writing-math-block .writing-math-preview').click()
  await expectContrast(page.locator('.writing-block-code .cm-editor'))
  await page.screenshot({path:testInfo.outputPath('dark-reading.png')})
  await page.getByRole('button',{name:'完成公式编辑'}).click()
  await settings(page);await setting(page,'主题').selectOption('system')
  await page.emulateMedia({colorScheme:'light'});await expect(page.locator('.app-shell')).toHaveAttribute('data-theme','light')
  await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('.app-shell')).toHaveAttribute('data-theme','dark')
  await page.emulateMedia({media:'print'})
  await expect(body(page)).toHaveCSS('font-size','16px')
  await expect(page.locator('.pm-scroller > .writing-editor')).toHaveCSS('max-width','860px')
  await expect(page.getByRole('dialog',{name:'阅读设置'})).toBeHidden()
})

test('narrow window keeps the floating name, count and settings usable and separates find/settings',async({page},testInfo)=>{
  await page.setViewportSize({width:560,height:720})
  await boot(page,'# 窄窗口\n\n合成正文')
  await expect(count(page)).toBeVisible()
  await page.keyboard.press('Control+f')
  await expect(page.getByRole('dialog',{name:'当前文档查找替换'})).toBeVisible()
  await settings(page)
  await expect(page.getByRole('dialog',{name:'当前文档查找替换'})).toHaveCount(0)
  await setting(page,'正文字号').selectOption('20');await setting(page,'正文宽度').selectOption('1080')
  for(const locator of [count(page),page.getByRole('textbox',{name:'当前页面名称'}),page.getByRole('dialog',{name:'阅读设置'})]){
    const box=await locator.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(560);expect(box.y+box.height).toBeLessThanOrEqual(720)
  }
  await page.screenshot({path:testInfo.outputPath('narrow-reading.png')})
  await page.keyboard.press('Control+f')
  await expect(page.getByRole('dialog',{name:'阅读设置'})).toHaveCount(0)
  await expect(page.getByRole('dialog',{name:'当前文档查找替换'})).toBeVisible()
})
