import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'

const preview=process.env.FROWD_BROWSER_MODE==='preview'
test('distribution identity and update controls follow the embedded build mode',async({page})=>{
 await page.addInitScript(installMockHost,{markdown:'合成预览样本 $x_i^2$。'})
 await page.goto('/?testHost=1')
 await expect(page.locator('.ProseMirror:visible')).toBeVisible()
 await expect(page.locator('.brand span')).toHaveText(preview?'fromd Preview':'fromd')
 if(preview)await expect(page.locator('.brand small')).toHaveText('0.5.4-preview.1')
 await page.getByText('文件',{exact:true}).click()
 await expect(page.getByRole('button',{name:'检查更新…',exact:true})).toHaveCount(preview?0:1)
 if(preview){
  expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.calls.filter(c=>['check_updates','download_update','install_update','open_update_page'].includes(c.command)))).toEqual([])
  await expect(page.getByRole('status',{name:'应用更新',exact:true})).toHaveCount(0)
 }
})
