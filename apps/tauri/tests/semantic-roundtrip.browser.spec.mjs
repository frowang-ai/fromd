import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'
import {fileURLToPath} from 'node:url'
import {tableBreakMarkdown, inlineBreakBoundaries, flowBreakBoundaries} from '../../../tests/fixtures/writing-table-breaks.mjs'
const pdfModule='/@fs/'+fileURLToPath(new URL('../../../packages/editor/src/markdown/pdfDocument.js',import.meta.url)).replaceAll('\\','/')
async function boot(page,markdown){await page.addInitScript(installMockHost,{markdown});await page.goto('/?testHost=1');await expect(page.locator('.ProseMirror')).toBeVisible()}
const capture=page=>page.locator('.pm-port').evaluate(el=>el.__vueParentComponent.exposed.capture().markdown)
async function printInfo(page,markdown){return page.evaluate(async({pdfModule,markdown})=>{const html=await(await import(pdfModule)).buildPdfDocument({markdown});const doc=new DOMParser().parseFromString(html,'text/html');return{alerts:[...doc.querySelectorAll('.writing-alert')].map(el=>el.dataset.alert),paragraphs:[...doc.querySelectorAll('article > p')].map(el=>el.textContent)}},{pdfModule,markdown})}
async function directRendered(page,markdown){return page.evaluate(async({pdfModule,markdown})=>{const {renderMarkdown}=await import(pdfModule.replace('pdfDocument.js','index.js'));const doc=new DOMParser().parseFromString(renderMarkdown(markdown),'text/html');return [...doc.querySelectorAll('body > p')].map(el=>el.textContent)},{pdfModule,markdown})}
async function saveReload(page){await page.keyboard.press('Control+s');const saved=await capture(page);await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a').savedText)).toBe(saved);await page.addInitScript(installMockHost,{markdown:saved});await page.reload();await expect(page.locator('.ProseMirror')).toBeVisible();return saved}
const bodyStructure = page => page.locator('.pm-port').evaluate(el => el.__vueParentComponent.exposed.capture().pm.state.doc.toJSON().content.slice(0,-1))
async function printBreakStructure(page, markdown) {
 return page.evaluate(async({pdfModule,markdown})=>{
  const html=await(await import(pdfModule)).buildPdfDocument({markdown})
  const doc=new DOMParser().parseFromString(html,'text/html')
  return [...doc.querySelectorAll('article p')].filter(el=>!/^Round \d+$/.test(el.textContent)).map(el=>({text:el.textContent.replace(/\n/g,''),breaks:el.querySelectorAll('br').length}))
 },{pdfModule,markdown})
}
async function twoBreakRoundTrips(page,markdown) {
 await boot(page,markdown+'\n\nRound 0')
 const before=await bodyStructure(page), printed=await printBreakStructure(page,markdown)
 for(let round=1;round<=2;round++){
  await page.locator('.ProseMirror > p').last().evaluate(el=>{
   el.closest('.ProseMirror').focus();const range=document.createRange();range.selectNodeContents(el)
   getSelection().removeAllRanges();getSelection().addRange(range)
  })
  await page.keyboard.insertText(`Round ${round}`)
  const saved=await saveReload(page)
  expect(saved).not.toContain('&#xA;')
  expect(await bodyStructure(page)).toEqual(before)
  expect(await printBreakStructure(page,saved)).toEqual(printed)
 }
}
for(const mark of ['strong','emphasis','strike','link','u','mark','kbd'])test(`review hardbreak inline boundaries round-trip twice: ${mark}`,async({page})=>{
 await twoBreakRoundTrips(page,inlineBreakBoundaries.filter(item=>item.mark===mark).map(item=>item.markdown).join('\n\n'))
})
for(const context of ['paragraph','blockquote','list','footnote'])test(`review hardbreak following HTML and block syntax round-trip twice: ${context}`,async({page})=>{
 const wrap=(source,index)=>context==='blockquote'?'> '+source:context==='list'?'- '+source:context==='footnote'?`[^n${index}]: ${source}`:source
 await twoBreakRoundTrips(page,flowBreakBoundaries.map(({markdown},index)=>wrap(markdown,index)).join('\n\n'))
})
test('review hardbreak typed at a strong paragraph end survives two saves',async({page})=>{
 await boot(page,'**bold**\n\nRound 0')
 await page.locator('.ProseMirror strong').evaluate(el=>{el.closest('.ProseMirror').focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range)})
 await page.keyboard.press('Shift+Enter')
 const before=await bodyStructure(page)
 for(let round=1;round<=2;round++){
  await page.locator('.ProseMirror > p').last().click();await page.keyboard.press('End');await page.keyboard.insertText('x')
  const saved=await saveReload(page)
  expect(saved).not.toContain('&#xA;');expect(await bodyStructure(page)).toEqual(before)
 }
})

test('table explicit breaks preserve spelling, edited source, reload, code and PDF', async ({page}) => {
 const markdown = tableBreakMarkdown + '\n\n### 标题<br>第二行\n\n结束'
 await boot(page, markdown)
 const table = page.locator('.ProseMirror table.children')
 await expect(table.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(22)
 expect(await capture(page)).toBe(markdown)
 await page.locator('.ProseMirror > p').last().click(); await page.keyboard.press('End'); await page.keyboard.insertText('编辑')
 const saved = await saveReload(page)
 await expect(table.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(22)
 await expect(page.locator('.ProseMirror h3 br')).toHaveCount(1)
 const printed = await page.evaluate(async ({pdfModule, saved, original}) => {
  const {buildPdfDocument} = await import(pdfModule)
  const {renderMarkdown} = await import(pdfModule.replace('pdfDocument.js', 'index.js'))
  return await Promise.all([renderMarkdown(saved), buildPdfDocument({markdown:saved}), renderMarkdown(original), buildPdfDocument({markdown:original})].map(async value => {
   const doc = new DOMParser().parseFromString(await value, 'text/html')
   return {breaks:doc.querySelectorAll('table br').length, codes:[...doc.querySelectorAll('table code')].map(el=>el.textContent), headings:doc.querySelectorAll('h3 br').length}
  }))
 }, {pdfModule, saved, original:markdown})
 for (const result of printed) {
  expect(result.breaks).toBe(22); expect(result.headings).toBe(1)
  expect(result.codes).toContain('<TEXT> | --body | --body-file <FILE|->'); expect(result.codes).toContain('<br>')
 }
})

test('table explicit breaks use HTML leading, consecutive and trailing line semantics', async ({page}) => {
 const markdown = '| plain | trailing | leading | double | tail | empty |\n|---|---|---|---|---|---|\n| a | a<br> | <br>b | a<br><br>b | a<br><br> | <br /> |\n\n结束'
 await boot(page, markdown)
 const cells = page.locator('.ProseMirror td')
 const sizes = () => cells.evaluateAll(els=>els.map(el=>el.querySelector('p').getBoundingClientRect().height))
 const before = await sizes()
 expect(before[1]).toBe(before[0]); expect(before[2]).toBeGreaterThan(before[0]); expect(before[3]).toBeGreaterThan(before[2]); expect(before[4]).toBe(before[2])
 expect(await capture(page)).toBe(markdown)
 await page.locator('.ProseMirror > p').last().click(); await page.keyboard.press('End'); await page.keyboard.insertText('编辑')
 await saveReload(page)
 expect(await sizes()).toEqual(before)
 for (const [index, count] of [[0,0],[1,0],[2,1],[3,2],[4,1],[5,0]]) await expect(cells.nth(index).locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(count)
 // Measure print content using a common font and line-height, avoiding theme differences.
 const lineHeights = await page.evaluate(async ({pdfModule, markdown}) => {
  const {buildPdfDocument} = await import(pdfModule)
  const template = document.createElement('template'); template.innerHTML = await buildPdfDocument({markdown})
  const table = template.content.querySelector('table'); const host = document.createElement('div')
  host.style.cssText='position:fixed;left:-10000px'; host.append(table); document.body.append(host)
  const heights = [...table.querySelectorAll('td')].map(td=>{
   td.style.cssText='font:16px/24px sans-serif;padding:0;vertical-align:top'
   const span=document.createElement('div'); span.innerHTML=td.innerHTML; td.replaceChildren(span)
   return span.getBoundingClientRect().height
  })
  host.remove(); return heights
 }, {pdfModule, markdown})
 expect(lineHeights.slice(0,5)).toEqual([24,24,48,72,48])
})

test('table explicit breaks Shift+Enter survives empty tail, undo/redo and source replacement', async ({page}) => {
 await boot(page, '| Header |\n|---|\n| First |')
 const cell = page.locator('.ProseMirror td').first()
 const end = () => cell.locator('p').evaluate(el=>{el.closest('.ProseMirror').focus();const r=document.createRange();r.selectNodeContents(el);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r)})
 await end(); await page.keyboard.press('Shift+Enter')
 const one = await capture(page); expect(one).toContain('First<br><br>')
 await page.keyboard.press('Control+z'); expect(await capture(page)).not.toContain('<br>')
 await page.keyboard.press('Control+y'); expect(await capture(page)).toBe(one)
 await page.keyboard.press('Control+/')
 const source = page.getByRole('textbox', {name:'Markdown 源码',exact:true})
 await source.fill((await source.inputValue())+'\n'); await page.keyboard.press('Control+/')
 await expect(cell.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(1)
 await end(); await page.keyboard.press('Shift+Enter'); await page.keyboard.insertText('Third')
 await expect(cell.locator('p')).toHaveCount(1)
 expect(await capture(page)).toContain('First<br><br>Third')
 await saveReload(page)
 await expect(cell.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(2)
 await expect(cell).toHaveText('FirstThird')
 // Headers use the same safe command and serializer.
 const header=page.locator('.ProseMirror th p').first()
 await header.click(); await page.keyboard.press('End'); await page.keyboard.press('Shift+Enter'); await page.keyboard.insertText('Second')
 expect(await capture(page)).toContain('Header<br>Second')
})

test('table explicit breaks treat hidden trailing comments as invisible without losing them',async({page})=>{
 const markdown='| Base | Single | Double | Marked |\n|---|---|---|---|\n| a | a<br><!--one--> | a<br><br><!--two--> | <u>a<br><br></u><!--marked--> |\n\n结束'
 await boot(page,markdown)
 const cells=page.locator('.ProseMirror td')
 const heights=()=>cells.evaluateAll(els=>els.map(el=>el.querySelector('p').getBoundingClientRect().height))
 const before=await heights()
 expect(before[1]).toBe(before[0]);expect(before[2]).toBe(before[0]*2);expect(before[3]).toBe(before[2])
 await page.locator('.ProseMirror > p').last().click();await page.keyboard.press('End');await page.keyboard.insertText('编辑')
 const saved=await saveReload(page)
 for(const name of ['one','two','marked'])expect(saved).toContain(`<!--${name}-->`)
 expect(await heights()).toEqual(before)
 for(const [index,count] of [[0,0],[1,0],[2,1],[3,1]])await expect(cells.nth(index).locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(count)
})

test('explicit breaks in paragraphs and headings retain trailing empty lines after editing',async({page})=>{
 const markdown='普通a<br><br>b\n\n末尾a<br><br>\n\n<br><br>\n\n### 标题a<br><br>\n\n结束'
 await boot(page,markdown)
 const describe=()=>page.locator('.ProseMirror > p,.ProseMirror > h3').evaluateAll(els=>els.map(el=>({text:el.textContent,breaks:el.querySelectorAll('br:not(.ProseMirror-trailingBreak)').length})))
 const before=await describe()
 expect(before.map(x=>x.breaks)).toEqual([2,1,1,1,0])
 await page.locator('.ProseMirror > p').last().click();await page.keyboard.press('End');await page.keyboard.insertText('编辑')
 await saveReload(page)
 expect((await describe()).slice(0,-1)).toEqual(before.slice(0,-1))
 await page.locator('.ProseMirror > p').last().click();await page.keyboard.press('End');await page.keyboard.press('Shift+Enter')
 await saveReload(page)
 expect((await describe()).at(-1)).toEqual({text:'结束编辑',breaks:1})
})

test('table explicit breaks keep unsafe tags, escaped tags and code inert', async ({page}) => {
 const markdown = '| H |\n|---|\n| a<br onclick="window.brExecuted=true">b \\<br> `<br>` `<TEXT>` </br> |\n\n```html\n<br>\n```\n\n结束'
 await boot(page,markdown)
 await expect(page.locator('.ProseMirror td [onclick]')).toHaveCount(0)
 await expect(page.locator('.ProseMirror td br:not(.ProseMirror-trailingBreak)')).toHaveCount(0)
 await expect(page.locator('.ProseMirror td')).toContainText('<br onclick="window.brExecuted=true">')
 await expect(page.locator('.milkdown-code-block')).toContainText('<br>')
 expect(await page.evaluate(()=>window.brExecuted)).toBeUndefined()
 const safe = await page.evaluate(async({pdfModule,markdown})=>{
  const html=await(await import(pdfModule)).buildPdfDocument({markdown});const doc=new DOMParser().parseFromString(html,'text/html')
  return {unsafe:doc.querySelectorAll('[onclick],script').length,codes:[...doc.querySelectorAll('td code')].map(el=>el.textContent)}
 },{pdfModule,markdown})
 expect(safe.unsafe).toBe(0);expect(safe.codes).toEqual(['<br>','<TEXT>'])
})

test('plain Alert survives unrelated edit, save, reload and PDF with canonical marker',async({page})=>{
 await boot(page,'> [!NOTE]\n> text\n\n另一个段落')
 await page.locator('.ProseMirror > p').click();await page.keyboard.press('End');await page.keyboard.insertText('改动')
 const saved=await saveReload(page)
 expect(saved).toContain('> [!NOTE]');expect(saved).not.toContain('\\[!NOTE]')
 await expect(page.locator('.writing-alert[data-alert="NOTE"]')).toHaveCount(1)
 expect((await printInfo(page,saved)).alerts).toEqual(['NOTE'])
})
test('formatting NOTE removes Alert semantics consistently from body and PDF',async({page})=>{
 await boot(page,'> [!NOTE]\n> text\n\n末段')
 await page.locator('blockquote p').evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const text=walker.nextNode();const range=document.createRange();range.setStart(text,2);range.setEnd(text,6);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);el.closest('.ProseMirror').focus()})
 await page.keyboard.press('*')
 await expect(page.locator('blockquote em')).toHaveText('NOTE')
 await expect(page.locator('.writing-alert')).toHaveCount(0)
 const saved=await saveReload(page)
 expect((await printInfo(page,saved)).alerts).toEqual([])
 await expect(page.locator('.writing-alert')).toHaveCount(0)
})
test('legacy escaped Alert is recognized without interpreting marked or code markers',async({page})=>{
 const markdown='> \\[!NOTE]\n> legacy\n\n> [!*NOTE*]\n> ordinary\n\n\\[!TIP]\n\n`[!CAUTION]`'
 await boot(page,markdown)
 await expect(page.locator('.writing-alert')).toHaveCount(1)
 expect((await printInfo(page,markdown)).alerts).toEqual(['NOTE'])
})
for(const space of [' ', '\u00a0', '\u3000'])test(`unedited whitespace formula exports directly and after editing: ${JSON.stringify(space)}`,async({page})=>{
 const original=`前文 $${space}$ 后文`
 await boot(page,original)
 await expect(page.getByRole('button',{name:'编辑行内公式'})).toContainText('空公式')
 expect(await capture(page)).toBe(original)
 expect(await directRendered(page,original)).toEqual(['前文  后文'])
 expect((await printInfo(page,original)).paragraphs).toEqual(['前文  后文'])
 await page.getByText('文件',{exact:true}).click();await page.getByRole('button',{name:'导出 PDF…',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.export_pdf||0)).toBe(1)
 expect(await page.evaluate(()=>{const html=window.__FROWD_TEST_HOST__.calls.find(call=>call.command==='export_pdf').args.html;const doc=new DOMParser().parseFromString(html,'text/html');return [...doc.querySelectorAll('article > p')].map(el=>el.textContent)})).toEqual(['前文  后文'])
 await page.locator('.ProseMirror').focus();await page.keyboard.press('Control+End');await page.keyboard.insertText('改动')
 const saved=await saveReload(page)
 expect(saved).toContain('$ $');expect(saved).not.toContain('$$')
 await expect(page.getByRole('button',{name:'编辑行内公式'})).toContainText('空公式')
 expect((await printInfo(page,saved)).paragraphs).toEqual(['前文  后文改动'])
})
test('direct sanitized render and PDF preserve escaped dollars, inline code and link destinations',async({page})=>{
 await boot(page,'边界')
 for(const markdown of ['\\$ $','\\$\u3000$','`$\u3000$`']){
  const expected=markdown.startsWith('`')?markdown.slice(1,-1):markdown.slice(1)
  expect(await directRendered(page,markdown)).toEqual([expected])
  expect((await printInfo(page,markdown)).paragraphs).toEqual([expected])
 }
 const href=await page.evaluate(async pdfModule=>{const {buildPdfDocument}=await import(pdfModule);const doc=new DOMParser().parseFromString(await buildPdfDocument({markdown:'[x](http://example.com/$%20$)'}),'text/html');return doc.querySelector('a').getAttribute('href')},pdfModule)
 expect(href).toBe('http://example.com/$%20$')
})
for(const value of ['', '   ', '\u00a0', '\u3000'])test(`empty inline formula preserves placeholder across save/reload and PDF paragraph: ${JSON.stringify(value)}`,async({page})=>{
 await boot(page,'前文 $x$ 后文')
 await page.getByRole('button',{name:'编辑行内公式'}).click()
 const source=page.getByRole('textbox',{name:'行内公式 LaTeX'})
 await source.fill(value);await source.press('Enter')
 await expect(page.getByRole('button',{name:'编辑行内公式'})).toContainText('空公式')
 const saved=await saveReload(page)
 expect(saved).not.toContain('$$')
 await expect(page.getByRole('button',{name:'编辑行内公式'})).toContainText('空公式')
 const printed=await printInfo(page,saved)
 expect(printed.paragraphs).toHaveLength(1);expect(printed.paragraphs[0]).toMatch(/前文\s+后文/);expect(printed.paragraphs[0]).not.toContain('$')
 await page.getByRole('button',{name:'编辑行内公式'}).click();await source.fill('y^2');await source.press('Enter')
 expect(await capture(page)).toContain('$y^2$')
})
