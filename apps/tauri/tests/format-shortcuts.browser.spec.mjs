import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'

const body=page=>page.locator('.ProseMirror:visible')
const source=page=>page.getByRole('textbox',{name:'Markdown 源码',exact:true})
const capture=page=>page.locator('.pm-port').evaluate(el=>el.__vueParentComponent.exposed.capture().markdown)
async function boot(page,platform,markdown){
 await page.addInitScript(installMockHost,{markdown})
 await page.goto('/?testHost=1&testPlatform='+platform)
 await expect(body(page)).toBeVisible()
}
async function selection(input,start,end=start){
 await input.evaluate((el,[start,end])=>{el.focus();el.setSelectionRange(start,end)},[start,end])
}
async function selectBodyText(page,start=0,end){
 await expect(body(page)).toHaveAttribute('contenteditable','true')
 await body(page).evaluate((el,[start,end])=>{
  el.focus()
  const text=el.querySelector('p').firstChild
  const range=document.createRange()
  range.setStart(text,start);range.setEnd(text,end??text.length)
  const selection=getSelection()
  selection.removeAllRanges();selection.addRange(range)
 },[start,end])
}

for(const platform of ['windows','macos']){
 const mac=platform==='macos',mod=mac?'Meta':'Control'
 const blocks=[
  [mac?'Meta+Alt+q':'Control+Shift+q','blockquote','> '],
  [mac?'Meta+Alt+c':'Control+Shift+k','.milkdown-code-block','```\n'],
  [mac?'Meta+Alt+b':'Control+Shift+m','.writing-math-block','$$\n'],
  [mac?'Meta+Alt+t':'Control+t','table:visible','| --- | --- | --- |'],
  [mac?'Meta+Alt+o':'Control+Shift+BracketLeft','ol','1. '],
  [mac?'Meta+Alt+u':'Control+Shift+BracketRight','ul','- '],
 ]
 const marks=[
  [mod+'+b','strong','**正文**'],[mod+'+i','em','*正文*'],[mod+'+u','u','<u>正文</u>'],
  [mac?'Control+Backquote':'Control+Shift+Backquote','code','`正文`'],
  [mac?'Control+Shift+Backquote':'Alt+Shift+Digit5','del','~~正文~~'],
 ]
 test(platform+' headings and zoom have distinct shortcuts in both modes',async({page})=>{
  await boot(page,platform,'正文\n')
  await body(page).focus()
  for(const level of [1,2,3,4,5,6]){
   await page.keyboard.press(mod+'+'+level)
   await expect(body(page).locator('h'+level)).toHaveText('正文')
  }
  await page.keyboard.press(mod+'+6');await expect(body(page).locator('p')).toHaveText('正文')
  for(const key of ['=','='])await page.keyboard.press(mod+'+'+key)
  await expect(body(page).locator('h2')).toHaveText('正文')
  await page.keyboard.press(mod+'+-');await expect(body(page).locator('h1')).toHaveText('正文')
  await page.keyboard.press(mod+'+Shift+=');await expect(page.locator('.app-shell')).toHaveAttribute('data-zoom','110')
  await page.keyboard.press(mod+'+0');await expect(body(page).locator('p')).toHaveText('正文')
  await page.keyboard.press(mod+'+Shift+0');await expect(page.locator('.app-shell')).toHaveAttribute('data-zoom','100')
  await page.keyboard.press(mod+'+/')
  await selection(source(page),1)
  await page.keyboard.press(mod+'+3');await expect(source(page)).toHaveValue('### 正文\n')
  await page.keyboard.press(mod+'+-');await expect(source(page)).toHaveValue('## 正文\n')
  await page.keyboard.press(mod+'+2');await expect(source(page)).toHaveValue('正文\n')
  await page.keyboard.press(mod+'+z');await expect(source(page)).toHaveValue('## 正文\n')
  expect(await source(page).evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([4,4])
 })
 test(platform+' mark shortcuts, link and clear format target both editing surfaces',async({page})=>{
  await boot(page,platform,'正文\n')
  for(const [key,tag,formatted] of marks){
   await selectBodyText(page)
   await page.keyboard.press(key);await expect(body(page).locator(tag)).toHaveText('正文')
   await page.keyboard.press(mod+'+Backslash');await expect(body(page).locator(tag)).toHaveCount(0)
   await page.keyboard.press(mod+'+/');await selection(source(page),0,2)
   await page.keyboard.press(key);await expect(source(page)).toHaveValue(formatted+'\n')
   await page.keyboard.press(mod+'+Backslash');await expect(source(page)).toHaveValue('正文\n')
   await page.keyboard.press(mod+'+/')
  }
  await selectBodyText(page)
  await page.keyboard.press(mod+'+k')
  await expect(page.locator('.milkdown-link-edit input')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press(mod+'+/');await selection(source(page),0,2)
  await page.keyboard.press(mod+'+k');await expect(source(page)).toHaveValue('[正文]()\n')
  await page.keyboard.insertText('https://example.com')
  await expect(source(page)).toHaveValue('[正文](https://example.com)\n')
 })
 test(platform+' block and image shortcuts reuse editor operations',async({page})=>{
  await boot(page,platform,'正文\n')
  for(const [key,selector,markup] of blocks){
   await expect(body(page)).toHaveAttribute('contenteditable','true')
   await body(page).focus();await page.keyboard.press(key)
   await expect(body(page).locator(selector).first()).toBeVisible()
   await page.keyboard.press(mod+'+/');await expect(source(page)).toBeVisible()
   await source(page).fill('正文\n');await selection(source(page),1)
   await page.keyboard.press(key);await expect.poll(()=>source(page).inputValue()).toContain(markup)
   await page.keyboard.press(mod+'+z');await expect(source(page)).toHaveValue('正文\n')
   await page.keyboard.press(mod+'+/')
  }
  const imageKey=mac?'Control+Meta+i':'Control+Shift+i'
  const pickerCalls=()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.calls.filter(c=>c.command==='choose_resources'))
  await expect(body(page)).toHaveAttribute('contenteditable','true')
  await body(page).focus();await page.keyboard.press(imageKey)
  await expect.poll(pickerCalls).toHaveLength(1)
  await page.keyboard.press(mod+'+/');await selection(source(page),1)
  await page.keyboard.press(imageKey)
  await expect.poll(pickerCalls).toHaveLength(2)
  expect((await pickerCalls()).map(call=>call.args.kind)).toEqual(['image','image'])
 })
}

test('shortcuts respect YAML, composition and the embedded code editor',async({page})=>{
 const prefix='---  \r\nname: literal\r\n---\r\n\r\n'
 await boot(page,'windows',prefix+'正文\n\n```js\nlet x = 1\n```\n')
 const code=body(page).locator('.milkdown-code-block .cm-content')
 await code.focus()
 const before=await capture(page)
 await page.keyboard.press('Control+Shift+i')
 await page.keyboard.press('Control+1')
 expect(await capture(page)).toBe(before)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.choose_resources||0)).toBe(0)
 await page.keyboard.press('Control+/')
 const input=source(page),text=await input.inputValue(),at=text.indexOf('正文')
 await selection(input,8,at+1)
 await page.keyboard.press('Control+1')
 await expect(input).toHaveValue(text)
 await selection(input,at)
 await input.dispatchEvent('compositionstart',{bubbles:true})
 await input.dispatchEvent('keydown',{key:'1',ctrlKey:true,isComposing:true,bubbles:true,cancelable:true})
 await input.dispatchEvent('compositionend',{bubbles:true})
 await expect(input).toHaveValue(text)
 await page.keyboard.press('Control+1')
 expect(await capture(page)).toBe(prefix+'# 正文\n\n```js\nlet x = 1\n```\n')
 await page.keyboard.press('Control+z')
 expect(await capture(page)).toBe(before)
})

test('rendered table shortcut preserves selected prose and enters the first cell',async({page})=>{
 const markdown='alpha bravo\n\nnext paragraph\n'
 await boot(page,'windows',markdown)
 await selectBodyText(page,0,5)
 await page.keyboard.press('Control+t')
 await expect(body(page).locator(':scope > p')).toHaveText(['alpha bravo','next paragraph'])
 await expect(body(page).locator('table:visible')).toHaveCount(1)
 const blocks=await body(page).locator(':scope > p, :scope > :has(table:visible)').evaluateAll(nodes=>
  nodes.map(node=>node.matches('p')?node.textContent:'table'))
 expect(blocks).toEqual(['alpha bravo','table','next paragraph'])
 expect(await body(page).locator('table:visible th').first().evaluate(cell=>cell.contains(getSelection().anchorNode))).toBe(true)
 await page.keyboard.press('Control+z')
 await expect(body(page).locator('table:visible')).toHaveCount(0)
 expect(await capture(page)).toBe(markdown)
 expect(await page.evaluate(()=>getSelection().toString())).toBe('alpha')
})

test('source link shortcut protects existing link syntax and toggles the complete label',async({page})=>{
 const markdown='prefix [hello](https://example.invalid) suffix\n'
 await boot(page,'windows',markdown)
 await page.keyboard.press('Control+/')
 const input=source(page), label=markdown.indexOf('hello'), url=markdown.indexOf('https:')
 for(const [start,end] of [[label+1,label+3],[url+1,url+4],[url+1,url+1],[0,label+5]]){
  await selection(input,start,end)
  await page.keyboard.press('Control+k')
  await expect(input).toHaveValue(markdown)
 }
 await selection(input,label,label+5)
 await page.keyboard.press('Control+k')
 await expect(input).toHaveValue('prefix hello suffix\n')
 await page.keyboard.press('Control+z')
 await expect(input).toHaveValue(markdown)
})

test('source block shortcuts protect structured blocks and operate on an entire Setext heading',async({page})=>{
 const markdown='| head | value |\n| --- | --- |\n| a | b |\n\n- item\n\nFirst line\nSecond line\n---\n\nlast paragraph\n'
 await boot(page,'windows',markdown)
 await page.keyboard.press('Control+/')
 const input=source(page)
 for(const [start,end,key] of [
  [markdown.indexOf('head'),undefined,'Control+1'],
  [markdown.indexOf('item'),undefined,'Control+1'],
  [markdown.indexOf('item'),undefined,'Control+Shift+k'],
  [markdown.indexOf('First line'),markdown.indexOf('last paragraph')+3,'Control+Shift+q'],
 ]){
  await selection(input,start,end)
  await page.keyboard.press(key)
  await expect(input).toHaveValue(markdown)
 }
 const second=markdown.indexOf('Second line')
 await selection(input,second+1)
 await page.keyboard.press('Control+3')
 await expect(input).toHaveValue(markdown)
 await page.keyboard.press('Control+1')
 await expect(input).toHaveValue(markdown.replace('Second line\n---','Second line\n==='))
 await page.keyboard.press('Control+1')
 await expect(input).toHaveValue(markdown.replace('Second line\n---','Second line'))
})

test('source marks keep selected spaces and clear nested formatting in one undo step',async({page})=>{
 const nested='bold and italic'
 const markdown='foo foo\n\n***'+nested+'***\n'
 await boot(page,'windows',markdown)
 await page.keyboard.press('Control+/')
 const input=source(page)
 await selection(input,3,4)
 await page.keyboard.press('Control+b')
 await expect(input).toHaveValue(markdown)
 await selection(input,3,7)
 await page.keyboard.press('Control+b')
 const formatted=markdown.replace('foo foo','foo **foo**')
 await expect(input).toHaveValue(formatted)
 expect(await input.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd))).toBe(' **foo')
 const at=formatted.indexOf(nested)
 await selection(input,at,at+nested.length)
 await page.keyboard.press('Control+Backslash')
 await expect(input).toHaveValue(formatted.replace('***'+nested+'***',nested))
 expect(await input.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd))).toBe(nested)
 await page.keyboard.press('Control+z')
 await expect(input).toHaveValue(formatted)
})

test('Windows format menu restores focus and keeps rendered and source selections', async ({page}) => {
 await boot(page,'windows','正文\n')
 const menu=page.locator('.format-menu')
 const choose=async name=>{
  await menu.locator('summary').click()
  await menu.getByRole('button',{name}).click()
 }
 await selectBodyText(page)
 await choose('标题 2 Ctrl+2')
 await expect(body(page).locator('h2')).toHaveText('正文')
 await choose('段落 Ctrl+0')
 await expect(body(page).locator('p')).toHaveText('正文')
 await choose('加粗 Ctrl+B')
 await expect(body(page).locator('strong')).toHaveText('正文')
 await expect(body(page)).toBeFocused()
 expect(await page.evaluate(()=>getSelection().toString())).toBe('正文')
 await page.keyboard.press('Control+/')
 await selection(source(page),2,4)
 await choose('斜体 Ctrl+I')
 await expect(source(page)).toHaveValue('***正文***\n')
 await expect(source(page)).toBeFocused()
 expect(await source(page).evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd))).toBe('正文')
 const search=page.getByRole('searchbox',{name:'搜索全部页面'})
 await search.focus()
 await choose('清除格式 Ctrl+\\')
 await expect(source(page)).toHaveValue('***正文***\n')
 await expect(search).toBeFocused()
})

test('native format events use the last eligible editor surface and leave subeditors alone', async ({page}) => {
 await page.addInitScript(installMockHost,{markdown:'正文\n\n```text\ncode\n```\n'})
 await page.goto('/?testHost=1&testPlatform=macos&testNativeChrome=1')
 await expect(page.locator('.loading-state')).toHaveCount(0)
 const command=id=>page.evaluate(id=>window.__FROWD_TEST_HOST__.menuCommand(id),id)
 await selectBodyText(page)
 await page.keyboard.press('Meta+b')
 await expect(body(page).locator('strong')).toHaveText('正文')
 await command('formatItalic')
 await expect(body(page).locator('strong em, em strong')).toHaveText('正文')
 const before=await capture(page)
 const search=page.getByRole('searchbox',{name:'搜索全部页面'})
 await search.focus()
 await command('formatClear')
 expect(await capture(page)).toBe(before)
 await expect(search).toBeFocused()
 // File > Insert Image is an app command: it opens the picker without an editor focus.
 await command('insertImage')
 await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.choose_resources||0)).toBe(1)
 expect(await capture(page)).toBe(before)
 const code=body(page).locator('.cm-content')
 await code.click()
 await command('formatHeading1')
 expect(await capture(page)).toBe(before)
 await expect(code).toBeFocused()
 await selectBodyText(page)
 await body(page).dispatchEvent('compositionstart',{data:''})
 await command('formatClear')
 expect(await capture(page)).toBe(before)
 await body(page).dispatchEvent('compositionend',{data:''})
 await command('source')
 await selection(source(page),3,5)
 await command('formatUnderline')
 await expect(source(page)).toHaveValue(before.replace('正文','<u>正文</u>'))
})
