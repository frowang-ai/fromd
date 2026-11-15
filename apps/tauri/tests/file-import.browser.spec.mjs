
import {test,expect} from '@playwright/test'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {installMockHost} from './mock-host.mjs'
const png=[...await readFile(new URL('./fixtures/synthetic-resource.png',import.meta.url))]
const evidence=fileURLToPath(new URL('../../../output/file-import-evidence/',import.meta.url))
const body=page=>page.locator('.ProseMirror:visible')
test.beforeEach(async({page})=>{page.__errors=[];page.on('pageerror',e=>page.__errors.push(e.message))})
test.afterEach(async({page})=>expect(page.__errors).toEqual([]))
async function boot(page){
 await page.addInitScript(installMockHost,{documents:[{id:'a',title:'原页',markdown:'# 原页标题\n\n原正文 unchanged',shelved:false},{id:'b',title:'B',markdown:'B独立正文',shelved:false}]})
 await page.goto('/?testHost=1');await expect(page.locator('.loading-state')).toHaveCount(0)
}
async function choice(page,html,name='合成导入.html'){
 await page.evaluate(({html,name,png})=>{const h=window.__FROWD_TEST_HOST__;h.importChoice={name,bytes:[...new TextEncoder().encode(html)]};h.importSources.set('images/图.png',png);h.importSources.set('附件.txt',[65,66,67])},{html,name,png})
}
async function importFile(page){await page.getByText('文件',{exact:true}).click();await page.getByRole('button',{name:'导入 TXT / HTML…',exact:true}).click()}
async function snapshot(page){return page.evaluate(()=>{const h=window.__FROWD_TEST_HOST__,c=document.querySelector('.pm-port').__vueParentComponent.exposed.capture();let tables=0;c.pm.state.doc.descendants(n=>{if(n.type.name==='table')tables++});return {tables,id:c.id,markdown:c.markdown,selection:c.pm.state.selection.toJSON(),rows:[...h.rows.values()].map(r=>({id:r.id,path:r.path,markdown:r.markdown,title:r.title,revision:r.revision,position:r.position})),bindings:[...h.bindings].map(([id,refs])=>[id,[...refs]])}})}
async function mode(page,name){await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:name}).first().click()}
const rich='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=&quot;UTF-8&quot;"><title>网页原题</title><style>body{background:url(https://never.invalid/css)}</style></head><body><h1>正文标题</h1><p>中文 <strong>粗体</strong> <em>斜体</em> <a href="https://example.invalid/info">网页</a> <a href="附件.txt#part">附件</a></p><ul><li>列表甲</li><li>列表乙</li></ul><pre><code>const value = 1 &lt; 2;</code></pre><table><thead><tr><th>项目</th><th>内容</th></tr></thead><tbody><tr><td>数学</td><td>\\(x+1\\)</td></tr></tbody></table><p><img src="images/图.png" alt="合成图"></p><p>尾段</p><!--import comment--><script src="https://never.invalid/script">window.__importExecuted=1</script><p><a href="javascript:alert(1)">保留文字</a></p></body></html>'
test('HTML import creates pathless draft with owned raster/attachment, structural math and explicit partial report',async({page})=>{
 await boot(page);const network=[];page.on('request',r=>{if(r.url().includes('never.invalid'))network.push(r.url())});await choice(page,rich)
 const before=await snapshot(page);await importFile(page)
 await expect.poll(async()=> (await snapshot(page)).id).toMatch(/^imported-/)
 await expect(body(page).locator('h1')).toHaveText('正文标题');await expect(body(page).locator('strong')).toHaveText('粗体');await expect(body(page).locator('em')).toHaveText('斜体')
 await expect(body(page).locator('li')).toHaveCount(2);expect((await snapshot(page)).tables).toBe(1);await expect(body(page).locator('table:visible td')).toHaveCount(2)
 await expect(body(page).locator('img[data-editor-image-src]')).toHaveJSProperty('naturalWidth',240)
 await expect(page.getByRole('status',{name:'导入说明'})).toContainText('布局不保留');await expect(page.getByRole('status',{name:'导入说明'})).toContainText('已忽略');await expect(page.getByRole('status',{name:'导入说明'})).toContainText('不安全链接');await expect(page.getByRole('status',{name:'导入说明'})).toContainText('注释')
 const reportBox=await page.getByRole('status',{name:'导入说明'}).boundingBox(),headingBox=await body(page).locator('h1').boundingBox();expect(headingBox.y).toBeGreaterThanOrEqual(reportBox.y+reportBox.height)
 const after=await snapshot(page),doc=after.rows.find(d=>d.id===after.id)
 expect(doc.path).toBeNull();expect(doc.title).toBe('合成导入');expect(doc.revision).toBe(0);expect(after.markdown).toContain('$x+1$');expect(after.markdown).not.toContain('<script');expect(after.markdown).not.toContain('javascript:');expect(after.markdown).not.toContain('网页原题')
 expect(after.rows.find(d=>d.id==='a')).toEqual(before.rows[0]);expect(network).toEqual([]);expect(await page.evaluate(()=>window.__importExecuted)).toBeUndefined()
 const attached=body(page).locator('a').filter({hasText:'附件'});await expect(attached).toHaveAttribute('href',/^\.frowd-assets\/[a-f0-9]{64}\.txt#part$/)
 expect(after.bindings.find(([id])=>id===after.id)[1]).toHaveLength(2)
 await page.getByRole('textbox',{name:'当前页面名称'}).fill('独立名称');await body(page).locator(':scope>p').last().click();await page.keyboard.press('End');await page.keyboard.insertText('追加');await page.keyboard.press('Control+z')
 await expect.poll(async()=> (await snapshot(page)).markdown).toBe(after.markdown);await expect(body(page).locator('h1')).toHaveText('正文标题')
 await expect(page.getByRole('status',{name:'保存状态'})).toHaveText('已保存')
 await mkdir(evidence,{recursive:true});await writeFile(evidence+'html-import.json',JSON.stringify({before,after,network},null,2));await page.screenshot({path:evidence+'html-import.png'})
 await page.getByText('文件',{exact:true}).click();await page.getByRole('button',{name:/另存为/}).click()
 await expect.poll(()=>page.evaluate(()=>[...window.__FROWD_TEST_HOST__.rows.values()].find(d=>d.id.startsWith('imported-')).path)).not.toBeNull()
})
test('TXT import preserves UTF-8 characters/source and BOM/CRLF flags without associating original file',async({page})=>{
 await boot(page);await choice(page,'\ufeff# 文本标题\r\n\r\n空格  \t中文\r\n','原始文本.txt');await importFile(page)
 await expect.poll(async()=> (await snapshot(page)).id).toMatch(/^imported-/);await mode(page,'源码')
 const text='# 文本标题\n\n空格  \t中文\n';await expect(page.getByRole('textbox',{name:'Markdown 源码',exact:true})).toHaveValue(text)
 const row=await page.evaluate(()=>[...window.__FROWD_TEST_HOST__.rows.values()].find(d=>d.id.startsWith('imported-')))
 expect(row.path).toBeNull();expect(row.title).toBe('原始文本');expect(row.markdown).toBe(text);expect(row.bom).toBe(true);expect(row.eol).toBe('\r\n')
})
for(const failure of ['cancel','utf8','oversize','charset','missing','remote','txt-resource','fake-image','references','commit'])test('file import '+failure+' leaves current text, selection, page order and originals unchanged',async({page})=>{
 await boot(page);await choice(page,failure==='charset'?'<meta charset="gbk"><p>中文</p>':failure==='remote'?'<p>远程图</p><img src="https://never.invalid/image.png">':failure==='missing'?'<p>缺图</p><img src="missing.png">':'<p>新正文</p>')
 if(failure==='txt-resource')await choice(page,'![图](images/图.png)','有资源.txt')
 if(failure==='fake-image'){await choice(page,'<p>伪图片</p><img src="images/图.png">');await page.evaluate(()=>window.__FROWD_TEST_HOST__.importSources.set('images/图.png',[1,2,3]))}
 if(failure==='references')await choice(page,Array.from({length:9},(_,i)=>'<p><a href="file'+i+'.txt">附件'+i+'</a></p>').join(''))
 await body(page).locator('p').click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
 const before=await snapshot(page)
 await page.evaluate(failure=>{const h=window.__FROWD_TEST_HOST__;if(failure==='cancel')h.importChoice=null;if(failure==='utf8')h.importChoice.bytes=[255,254];if(failure==='oversize')h.importChoice.bytes=new Uint8Array(10*1024*1024+1).fill(65);if(failure==='commit')h.fail='commit_document_import'},failure)
 await importFile(page)
 if(failure!=='cancel')await expect(page.getByRole('alert')).toBeVisible()
 else await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.choose_document_import||0)).toBe(1)
 await expect(body(page)).toHaveAttribute('contenteditable','true')
 const after=await snapshot(page);expect(after).toEqual(before);expect(after.rows).toHaveLength(2)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.commit_document_import||0)).toBe(failure==='commit'?1:0)
})
test('HTML import waits composition and close drains held resource preparation before activation',async({page})=>{
 await boot(page);await choice(page,'<p>导入新正文</p><img src="images/图.png">')
 await body(page).locator('p').click();await page.keyboard.press('End');await body(page).dispatchEvent('compositionstart',{data:''})
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('prepare_document_import_resources'));await importFile(page)
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.choose_document_import||0)).toBe(0)
 // Restore only keyboard focus, never inject PM state/history/selection.
 await body(page).locator('p').click();await page.keyboard.press('End');await page.keyboard.insertText('组合完成');await body(page).dispatchEvent('compositionend',{data:'组合完成'})
 await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.entered.prepare_document_import_resources||0)).toBe(1)
 await expect(body(page)).toHaveAttribute('contenteditable','false');expect((await snapshot(page)).id).toBe('a')
 await page.evaluate(()=>{window.__closePromise=window.__FROWD_TEST_HOST__.requestClose()});expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.closed)).toBe(false)
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('prepare_document_import_resources'))
 await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.closed)).toBe(true)
 const after=await snapshot(page);expect(after.id).toMatch(/^imported-/);expect(after.rows.find(d=>d.id==='a').markdown).toContain('组合完成');await expect(body(page).locator('img[data-editor-image-src]')).toHaveJSProperty('naturalWidth',240)
})

test('lost import commit acknowledgement reconciles the reserved ID and retry is idempotent',async({page})=>{
 await boot(page);await choice(page,'<p>回执核对正文</p>')
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.importLostAck=true);await importFile(page)
 await expect.poll(async()=> (await snapshot(page)).id).toMatch(/^imported-/)
 await expect(page.getByRole('status',{name:'导入说明'})).toContainText('导入已保存');const after=await snapshot(page);expect(after.rows).toHaveLength(3)
 await page.evaluate(({id,markdown})=>window.__FROWD_TEST_HOST__.invoke('commit_document_import',{token:id,markdown}),{id:after.id,markdown:after.markdown})
 expect((await snapshot(page)).rows).toHaveLength(3);expect((await snapshot(page)).id).toBe(after.id)
})
