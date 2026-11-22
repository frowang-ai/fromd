import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'

const body=page=>page.locator('.ProseMirror:visible')
const sentence=String.raw`Traits predict outcomes \citep{example2024study,example2025review}.`
const escapeHtml=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
async function boot(page,markdown=''){
 await page.addInitScript(installMockHost,{markdown})
 await page.goto('/?testHost=1')
 await expect(page.locator('.loading-state')).toHaveCount(0)
 await expect(body(page)).toHaveAttribute('contenteditable','true')
}
async function capture(page){return page.locator('.pm-port').evaluate(el=>{
 const c=el.__vueParentComponent.exposed.capture()
 return{markdown:c.markdown,doc:c.pm.state.doc.toJSON(),text:c.pm.state.doc.textContent}
})}
async function paste(target,text,{mode='latex',html=true}={}){
 await target.evaluate((el,{text,mode,html})=>{
  const clipboardData=new DataTransfer()
  clipboardData.setData('text/plain',text)
  if(mode)clipboardData.setData('vscode-editor-data',JSON.stringify({version:1,isFromEmptySelection:false,mode}))
  if(html)clipboardData.setData('text/html',html)
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}))
 },{text,mode,html:html?'<div style="font-family:Consolas;white-space:pre"><span style="color:#123456">'+escapeHtml(text)+'</span></div>':''})
}

for(const html of [true,false])test(`VS Code LaTeX prose with citations stays text (HTML=${html})`,async({page})=>{
 await boot(page);await body(page).locator('p').click()
 await paste(body(page),sentence,{html})
 const after=await capture(page)
 expect(after.doc.content[0].type).toBe('paragraph')
 expect(after.text).toBe(sentence)
 await expect(body(page).locator('.writing-math')).toHaveCount(0)
 await expect(body(page).locator('.milkdown-code-block')).toHaveCount(0)
 await page.keyboard.press('Control+z');expect((await capture(page)).text).toBe('')
 await page.keyboard.press('Control+y');expect((await capture(page)).text).toBe(sentence)
 await page.keyboard.press('Control+/')
 const source=page.getByRole('textbox',{name:'Markdown 源码',exact:true});await expect(source).toBeVisible()
 await source.fill(after.markdown+'\n');await page.keyboard.press('Control+/')
 expect((await capture(page)).text).toBe(sentence)
 await expect(body(page).locator('.writing-math')).toHaveCount(0)
})

test('VS Code LaTeX mode alone never implies math, including plain prose and citation-only selections',async({page})=>{
 await boot(page)
 for(const text of ['Ordinary prose without any commands.',String.raw`\citep{example2024study}`]){
  await body(page).click();await body(page).press('Control+a')
  await paste(body(page),text)
  expect((await capture(page)).text).toBe(text)
  expect((await capture(page)).doc.content[0].type).toBe('paragraph')
  await expect(body(page).locator('.writing-math')).toHaveCount(0)
 }
})

test('VS Code LaTeX prose inserts within a paragraph without losing surrounding text',async({page})=>{
 await boot(page,'Before AFTER')
 await body(page).locator('p').click();await page.keyboard.press('Home')
 for(let i=0;i<7;i++)await page.keyboard.press('ArrowRight')
 await paste(body(page),sentence)
 expect((await capture(page)).text).toBe('Before '+sentence+'AFTER')
 expect((await capture(page)).doc.content).toHaveLength(1)
 await page.keyboard.press('Control+z');expect((await capture(page)).text).toBe('Before AFTER')
})

test('VS Code LaTeX honors explicit inline and display delimiters without swallowing prose',async({page})=>{
 const text=String.raw`A value $x^2$ and \(y+1\) with \citep{example2024study}.

\[
z=3
\]`
 await boot(page);await body(page).locator('p').click();await paste(body(page),text)
 await expect(body(page).locator('.writing-math-inline')).toHaveCount(2)
 await expect(body(page).locator('.writing-math-block')).toHaveCount(1)
 await expect(body(page).locator('.writing-math-block annotation')).toHaveText('z=3')
 expect((await capture(page)).doc.content[0].type).toBe('paragraph')
 expect((await capture(page)).text).toContain(String.raw`\citep{example2024study}`)
})

test('VS Code JavaScript continues to paste as a code block',async({page})=>{
 const text='const answer = 42;'
 await boot(page);await body(page).locator('p').click();await paste(body(page),text,{mode:'javascript'})
 expect((await capture(page)).doc.content[0]).toMatchObject({type:'code_block',attrs:{language:'javascript'}})
 expect((await capture(page)).text).toBe(text)
 await expect(body(page).locator('.writing-math')).toHaveCount(0)
})

test('VS Code LaTeX remains literal when pasted into an existing code block',async({page})=>{
 await boot(page,'```text\nCODE\n```')
 const code=body(page).locator('.cm-content');await code.click();await code.press('Control+End')
 await paste(code,sentence+' $x$')
 await expect(code).toContainText(sentence+' $x$')
 await expect(body(page).locator('.writing-math')).toHaveCount(0)
 expect((await capture(page)).doc.content[0].attrs.language).toBe('text')
})

test('VS Code LaTeX citation paste in a cell preserves the table and adjacent cell',async({page})=>{
 await boot(page,'| Header | Other |\n| --- | --- |\n| Before | untouched |')
 await body(page).locator('td').first().locator('p').click();await page.keyboard.press('End')
 await paste(body(page),sentence)
 await expect(body(page).locator('td').first()).toHaveText('Before'+sentence)
 await expect(body(page).locator('td').nth(1)).toHaveText('untouched')
 await expect(body(page).locator('table.children')).toHaveCount(1)
 expect((await capture(page)).doc.content.filter(node=>node.type==='table')).toHaveLength(1)
 await expect(body(page).locator('.writing-math')).toHaveCount(0)
})
