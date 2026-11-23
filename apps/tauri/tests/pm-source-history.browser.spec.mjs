import {test,expect} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {installMockHost} from './mock-host.mjs'

const evidence=fileURLToPath(new URL('../../../output/pm-history-ab-20261115/',import.meta.url))
const T0='初始T0\n',T1='初始T0 正文D\n',T2='初始T0 正文D 源码S\n',B0='独立B0\n',B1='独立B0 B输入\n'
const source=page=>page.getByRole('textbox',{name:'Markdown 源码',exact:true})
const body=page=>page.locator('.ProseMirror:visible')
test.beforeEach(async({page})=>{
 page.__historySteps=[];page.__historyErrors=[];page.on('pageerror',e=>page.__historyErrors.push(e.message))
 await page.addInitScript(installMockHost,{documents:[
  {id:'a',title:'页面 A',markdown:T0,shelved:false},
  {id:'b',title:'页面 B',markdown:B0,shelved:false},
 ]})
 await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0)
 await expect(body(page)).toHaveText(T0.trimEnd())
})
test.afterEach(async({page},info)=>{
 await mkdir(evidence,{recursive:true})
 const record={test:info.title,status:info.status,T0,T1,T2,B0,B1,steps:page.__historySteps,errors:page.__historyErrors}
 await writeFile(evidence+info.title.replace(/[^a-zA-Z0-9_-]+/g,'-')+'.json',JSON.stringify(record,null,2))
 await info.attach('history-checkpoints',{body:JSON.stringify(record,null,2),contentType:'application/json'})
 expect(page.__historyErrors).toEqual([])
})
async function mode(page,value){
 await page.getByText('视图',{exact:true}).click()
 await page.locator('.menu-popup button').filter({hasText:value==='source'?'源码':'正文'}).first().click()
 if(value==='source')await expect(source(page)).toBeVisible();else await expect(body(page)).toBeVisible()
}
async function select(page,id){
 await page.locator('.tab-title').filter({hasText:id==='a'?'页面 A':'页面 B'}).click()
 await expect(page.locator('.tab.selected')).toContainText(id==='a'?'页面 A':'页面 B')
}
async function appendBody(page,text){
 // This helper appends to existing text; the editor's lower blank surface now
 // deliberately starts a new paragraph when clicked.
 await body(page).locator('p').last().click();await page.keyboard.press('Control+End');await page.keyboard.insertText(text)
}
async function appendSource(page,text){
 const input=source(page);await input.press('Control+End');await input.press('ArrowLeft');await page.keyboard.insertText(text)
}
async function read(page){
 return page.evaluate(()=>{
  // Read-only observation of the existing EditorPort. Never assign PM state,
  // selection, history or document rows to make a checkpoint pass.
  const captured=document.querySelector('.pm-port').__vueParentComponent.exposed.capture()
  const host=window.__FROWD_TEST_HOST__,snapshot=host.snapshot()
  return {id:captured.id,generation:captured.generation,mode:captured.viewState.mode,markdown:captured.markdown,
   pmText:captured.pm.state.doc.textContent,activeId:snapshot.activeId,
   rows:[...host.rows.values()].map(({id,markdown,revision})=>({id,markdown,revision})),
   updates:host.calls.filter(c=>c.command==='update_document').map(c=>c.args)}
 })
}
async function checkpoint(page,label,id,text,{stable=false}={}){
 await expect.poll(async()=>{const state=await read(page);return state.rows.find(row=>row.id===id)?.markdown}).toBe(text)
 if(stable)await page.waitForTimeout(550) // Cover the delayed editor event + autosave acknowledgement window.
 const current=await read(page)
 expect(current.id).toBe(id);expect(current.activeId).toBe(id);expect(current.markdown).toBe(text)
 expect(current.rows.find(row=>row.id===id).markdown).toBe(text)
 if(current.mode==='source')await expect(source(page)).toHaveValue(text)
 else await expect(body(page)).toHaveText(text.trimEnd())
 for(const row of current.rows){
  const updates=current.updates.filter(change=>change.id===row.id)
  expect(updates.map(change=>change.revision)).toEqual(updates.map((_,index)=>index+1))
  expect(row.revision).toBe(updates.length)
 }
 page.__historySteps.push({label,...current})
 return current
}
async function startT2(page){
 await checkpoint(page,'A:T0','a',T0)
 await appendBody(page,' 正文D');await checkpoint(page,'A:T1 body D','a',T1)
 await mode(page,'source');await expect(source(page)).toHaveValue(T1)
 await appendSource(page,' 源码S');await checkpoint(page,'A:T2 source S','a',T2)
}

test('PM source history A/B 1 no page switch: T2 -> Undo T1 -> Redo T2',async({page})=>{
 await startT2(page);const saved=await read(page)
 await mode(page,'rendered')
 const unchanged=await checkpoint(page,'A:rendered T2 before Undo','a',T2,{stable:true})
 expect(unchanged.rows).toEqual(saved.rows)
 await body(page).press('Control+z');await checkpoint(page,'A:Undo -> T1 keeps D','a',T1)
 await body(page).press('Control+y');await checkpoint(page,'A:Redo -> T2','a',T2)
 await page.screenshot({path:evidence+'no-switch-redo-T2.png'})
})

test('PM source history A/B 2 switch during source T2: B history stays independent',async({page})=>{
 await startT2(page);const beforeB=await read(page)
 await select(page,'b');await checkpoint(page,'B:B0','b',B0)
 await appendBody(page,' B输入');await checkpoint(page,'B:B1 independent input','b',B1)
 await body(page).press('Control+z');await checkpoint(page,'B:Undo -> B0','b',B0)
 await select(page,'a')
 await expect(source(page)).toBeVisible()
 const restored=await checkpoint(page,'A:restored source T2','a',T2,{stable:true})
 expect(restored.rows.find(row=>row.id==='a')).toEqual(beforeB.rows.find(row=>row.id==='a'))
 await mode(page,'rendered')
 const rendered=await checkpoint(page,'A:rendered T2 before Undo','a',T2,{stable:true})
 expect(rendered.rows.find(row=>row.id==='a')).toEqual(beforeB.rows.find(row=>row.id==='a'))
 await body(page).press('Control+z');await checkpoint(page,'A:Undo -> T1 keeps D','a',T1)
 await body(page).press('Control+y');const aRedo=await checkpoint(page,'A:Redo -> T2','a',T2)
 await select(page,'b');await checkpoint(page,'B:restored B0','b',B0)
 await body(page).press('Control+y');await checkpoint(page,'B:Redo -> B1 only B','b',B1)
 await select(page,'a');const final=await checkpoint(page,'A:still T2 after B redo','a',T2,{stable:true})
 expect(final.rows.find(row=>row.id==='a')).toEqual(aRedo.rows.find(row=>row.id==='a'))
 await page.screenshot({path:evidence+'switch-redo-T2.png'})
})

test('PM source history A/B 3 source Undo before switch commits one net source batch',async({page})=>{
 const S1='初始T0 正文D 源码S1\n',S2='初始T0 正文D 源码S1 源码S2\n'
 await appendBody(page,' 正文D');await checkpoint(page,'A:T1 body D','a',T1)
 await mode(page,'source')
 await appendSource(page,' 源码S1');await expect(source(page)).toHaveValue(S1)
 await appendSource(page,' 源码S2');await expect(source(page)).toHaveValue(S2)
 await source(page).press('Control+z');await checkpoint(page,'A:source Undo removes S2 only','a',S1)
 await select(page,'b');await checkpoint(page,'B:unmodified B0','b',B0)
 await select(page,'a');await checkpoint(page,'A:restored source S1 only','a',S1,{stable:true})
 await mode(page,'rendered');await checkpoint(page,'A:rendered S1 before Undo','a',S1,{stable:true})
 await body(page).press('Control+z');await checkpoint(page,'A:Undo net source batch -> T1','a',T1)
 await body(page).press('Control+y');await checkpoint(page,'A:Redo net source batch -> S1 only','a',S1)
 await body(page).press('Control+z');await checkpoint(page,'A:Undo source once again -> T1','a',T1)
 await body(page).press('Control+z');await checkpoint(page,'A:second Undo -> T0 (explicitly undo D)','a',T0)
 await body(page).press('Control+y');await checkpoint(page,'A:Redo body D -> T1','a',T1)
 await body(page).press('Control+y');const final=await checkpoint(page,'A:Redo source batch once -> S1 only','a',S1,{stable:true})
 expect(final.markdown).not.toContain('源码S2');expect(final.rows.find(row=>row.id==='b').markdown).toBe(B0)
})
