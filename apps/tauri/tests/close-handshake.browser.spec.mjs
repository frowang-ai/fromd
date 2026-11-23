import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'
for(const phase of ['listener','boot']){
 test(`close during ${phase} startup is replayed once after document restoration`,async({page})=>{
  await page.addInitScript(installMockHost,{holds:phase==='listener'?['close_listener','list_metadata']:['list_metadata']})
  await page.goto('/?testHost=1')
  if(phase==='listener'){
   await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.close_listener||0)).toBe(1)
   await page.evaluate(()=>window.__FROWD_TEST_HOST__.requestClose())
   await page.evaluate(()=>window.__FROWD_TEST_HOST__.requestClose())
   expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.closeListenerReady)).toBe(false)
   await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('close_listener'))
  }
  await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.list_metadata||0)).toBe(1)
  expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.ack_close_listener)).toBe(1)
  // Do not await the close promise here: its save must wait for the boot gate.
  await page.evaluate(()=>{window.__earlyClose=window.__FROWD_TEST_HOST__.requestClose()})
  expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.closed)).toBe(false)
  expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.close_ready||0)).toBe(0)
  await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('list_metadata'))
  await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.closed)).toBe(true)
  const outcome=await page.evaluate(()=>{
   const h=window.__FROWD_TEST_HOST__
   return {calls:h.calls.map(c=>c.command),closes:h.entered.close_ready,frozen:h.frozenAtClose,body:h.rows.get('a').markdown}
  })
  expect(outcome.closes).toBe(1);expect(outcome.frozen).toBe(true)
  expect(outcome.calls.indexOf('close_ready')).toBeGreaterThan(outcome.calls.indexOf('read_document'))
  expect(outcome.body).toContain('合成文稿')
 })
}
