import {test,expect} from '@playwright/test'
import {installMockHost} from './mock-host.mjs'
import {fileURLToPath} from 'node:url'
const pdfModule='/@fs/'+fileURLToPath(new URL('../../../packages/editor/src/markdown/pdfDocument.js',import.meta.url)).replaceAll('\\','/')
async function boot(page,markdown){await page.addInitScript(installMockHost,{markdown});await page.goto('/?testHost=1');await expect(page.locator('.ProseMirror')).toBeVisible()}
const capture=page=>page.locator('.pm-port').evaluate(el=>el.__vueParentComponent.exposed.capture().markdown)
async function printInfo(page,markdown){return page.evaluate(async({pdfModule,markdown})=>{const html=await(await import(pdfModule)).buildPdfDocument({markdown});const doc=new DOMParser().parseFromString(html,'text/html');return{alerts:[...doc.querySelectorAll('.writing-alert')].map(el=>el.dataset.alert),paragraphs:[...doc.querySelectorAll('article > p')].map(el=>el.textContent)}},{pdfModule,markdown})}
async function saveReload(page){await page.keyboard.press('Control+s');const saved=await capture(page);await expect.poll(()=>page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.get('a').savedText)).toBe(saved);await page.addInitScript(installMockHost,{markdown:saved});await page.reload();await expect(page.locator('.ProseMirror')).toBeVisible();return saved}
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
for(const value of ['', '   '])test(`empty inline formula preserves placeholder across save/reload and PDF paragraph: ${JSON.stringify(value)}`,async({page})=>{
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
