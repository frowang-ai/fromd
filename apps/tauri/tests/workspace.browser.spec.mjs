import {test,expect} from '@playwright/test';
import {installMockHost} from './mock-host.mjs';
import {fileURLToPath} from 'node:url';
const errors=new WeakMap();test.beforeEach(async({page})=>{const entries=[];errors.set(page,entries);page.on('pageerror',e=>entries.push(e.message))});test.afterEach(async({page})=>expect(errors.get(page)).toEqual([]));
const evidence=fileURLToPath(new URL('../../../output/tauri-browser-evidence/',import.meta.url));
async function boot(page,options={}){
 await page.addInitScript(installMockHost,options);await page.goto('/?testHost=1');
 await expect(page.locator('.tab.selected')).toContainText('方案讨论');
 await expect(page.locator('.cm-content')).toBeVisible();
 await expect(page.locator('.loading-state')).toHaveCount(0);
}
async function append(page,text){
 await page.locator('.cm-line').last().click();await page.keyboard.press('Control+End');await page.keyboard.insertText(text);await expect(page.locator('.cm-content')).toContainText(text.trim());
}
async function stored(page,id='a'){return page.evaluate(id=>window.__FROWD_TEST_HOST__.rows.get(id),id)}
async function menu(page,title){await page.getByText('视图',{exact:true}).click();await page.locator('.menu-popup button').filter({hasText:title}).first().click()}
async function remove(page,title='方案讨论'){
 await page.getByRole('button',{name:'页面菜单 '+title,exact:true}).click();await page.getByRole('menuitem',{name:'移除页面…'}).click();
}
test('confirmed shell has menus, two minus entries, name-only shelf and ordered expand-all',async({page})=>{
 await boot(page);
 await expect(page.locator('.sidebar-switch button')).toHaveText(['页面','大纲']);
 await expect(page.getByRole('button',{name:'标签收起 方案讨论',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'侧栏收起 方案讨论',exact:true})).toBeVisible();
 await expect(page.locator('.shelved-group img,.shelved-group canvas')).toHaveCount(0);
 const boxes=await page.locator('.page-search,.group-heading .expand-all').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
 expect(boxes[1]).toBeGreaterThan(boxes[0]);
 await page.screenshot({path:evidence+'workspace.png',fullPage:true});
});
test('last input survives immediate page switch, rich/source modes share text and history',async({page})=>{
 await boot(page);await append(page,' 即时最后输入');
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();await expect(page.locator('.tab.selected')).toContainText('公式推导');
 expect((await stored(page)).markdown).toContain('即时最后输入');
 await page.locator('.tab-title').filter({hasText:'方案讨论'}).click();
 await menu(page,'源码');await append(page,' 源码追加');
 await menu(page,'正文');await page.locator('.cm-content').press('Control+z');
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();await expect(page.locator('.tab.selected')).toContainText('公式推导');
 expect((await stored(page)).markdown).not.toContain('源码追加');
 expect((await stored(page)).markdown).toContain('即时最后输入');
});
test('both minus controls shelve without removing; expanding all preserves active page and order',async({page})=>{
 await boot(page);await page.getByRole('button',{name:'侧栏收起 公式推导',exact:true}).click();
 await expect(page.locator('.tab.selected')).toContainText('方案讨论');
 await page.getByRole('button',{name:'标签收起 方案讨论',exact:true}).click();
 await expect(page.locator('.empty-desktop')).toBeVisible();
 await page.getByRole('button',{name:'全部展开',exact:true}).click();
 await expect(page.locator('.tab-title')).toHaveText(['方案讨论','公式推导','阅读摘录']);
 await expect(page.locator('.tab.selected')).toContainText('方案讨论');
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.size)).toBe(3);
});
test('floating rename stays in viewport after scrolling and does not change H1',async({page})=>{
 const markdown='# 正文标题不变\n\n'+Array.from({length:160},(_,i)=>'合成长文第 '+i+' 段\n').join('\n');
 await boot(page,{markdown});await page.locator('.cm-scroller').evaluate(el=>el.scrollTop=1800);
 const input=page.getByRole('textbox',{name:'当前页面名称',exact:true});await expect(input).toBeVisible();
 await input.fill('独立草稿名');await input.press('Enter');
 await expect(page.locator('.tab.selected')).toContainText('独立草稿名');
 await expect.poll(async()=> (await stored(page)).title).toBe('独立草稿名');
 expect((await stored(page)).markdown.startsWith('# 正文标题不变')).toBe(true);
 const box=await input.boundingBox();expect(box.y).toBeLessThan(860);expect(box.y).toBeGreaterThan(700);
 await page.screenshot({path:evidence+'floating-name-scrolled.png',fullPage:true});
});
test('IME name composition completes on old doc before switching and never renames the new one',async({page})=>{
 await boot(page);
 const input=page.getByRole('textbox',{name:'当前页面名称',exact:true});
 await input.dispatchEvent('compositionstart',{data:'pin'});
 await input.evaluate(el=>{el.value='中文合成名称';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'名称'}))});
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();
 await page.waitForTimeout(80);
 await expect(page.locator('.tab.selected')).toContainText('方案讨论');
 expect(await page.locator('.cm-content').getAttribute('contenteditable')).toBe('true');
 await input.dispatchEvent('compositionend',{data:'中文合成名称'});
 await expect(page.locator('.tab.selected')).toContainText('公式推导');
 expect((await stored(page)).title).toBe('中文合成名称');
 expect((await stored(page,'b')).title).toBe('公式推导');
});
test('actual editor is frozen during delayed layout IPC and released afterwards',async({page})=>{
 await boot(page);await append(page,' 等待期间保护');
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.holds.add('activate_document'));
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();
 await expect.poll(()=>page.locator('.cm-content').getAttribute('contenteditable')).toBe('false');
 expect((await stored(page)).markdown).toContain('等待期间保护');
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.release('activate_document'));
 await expect(page.locator('.tab.selected')).toContainText('公式推导');
 await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable','true');
});
test('nonempty draft cancel, cancelled/failed save, delete and fresh-ID undo',async({page})=>{
 await boot(page);await remove(page);
 await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.tab.selected')).toContainText('方案讨论');
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.saveChoice='cancel');
 await remove(page);await page.getByRole('button',{name:'保存为 Markdown',exact:true}).click();
 await expect(page.locator('.tab.selected')).toContainText('方案讨论');
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.saveChoice='fail');
 await remove(page);await page.getByRole('button',{name:'保存为 Markdown',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('合成文件保存失败');
 await remove(page);await page.getByRole('button',{name:'直接删除',exact:true}).click();
 await expect(page.locator('.tab.selected')).toContainText('公式推导');
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect(page.locator('.tab.selected')).toContainText('方案讨论');
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.rows.has('a'))).toBe(false);
});
test('backup error blocks switching, retains editor text and permits retry',async({page})=>{
 await boot(page);await page.evaluate(()=>window.__FROWD_TEST_HOST__.fail='update_document');
 await append(page,' 保留失败正文');await page.locator('.tab-title').filter({hasText:'公式推导'}).click();
 await expect(page.getByRole('alert')).toContainText('合成写入失败');
 await expect(page.locator('.tab.selected')).toContainText('方案讨论');
 await expect(page.locator('.cm-content')).toContainText('保留失败正文');
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.fail=null);
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();await expect(page.locator('.tab.selected')).toContainText('公式推导');
 expect((await stored(page)).markdown).toContain('保留失败正文');
});
test('exit waits for acknowledged text and checkpoint with editor frozen',async({page})=>{
 await boot(page);await append(page,' 正常退出前最后输入');
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.requestClose());
 expect((await stored(page)).markdown).toContain('正常退出前最后输入');
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.closed)).toBe(true);
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.frozenAtClose)).toBe(true);
 const calls=await page.evaluate(()=>window.__FROWD_TEST_HOST__.calls.map(c=>c.command));
 expect(calls.lastIndexOf('close_ready')).toBeGreaterThan(calls.lastIndexOf('checkpoint'));
});
test('outline positions duplicate headings independently and follows the current document',async({page})=>{
 const markdown='# 标题\n\n## 重复\n\n'+Array.from({length:100},(_,i)=>'第 '+i+' 行\n').join('\n')+'\n## 重复\n\n第二段';
 await boot(page,{markdown});await page.getByRole('button',{name:'大纲',exact:true}).click();
 await expect(page.locator('.outline-list button')).toHaveCount(3);
 await page.locator('.outline-list button').last().click();
 await expect.poll(()=>page.locator('.cm-scroller').evaluate(el=>el.scrollTop)).toBeGreaterThan(800);
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();await expect(page.locator('.tab.selected')).toContainText('公式推导');
 await expect(page.locator('.outline-list button')).toHaveText(['第二篇']);
});
test('narrow viewport opens a drawer and closes it after selecting a page',async({page})=>{
 await page.setViewportSize({width:540,height:820});await boot(page);
 await expect(page.locator('.sidebar')).toBeHidden();
 await page.getByRole('button',{name:'显示页面工作栏'}).click();await expect(page.locator('.sidebar.drawer')).toBeVisible();
 await page.locator('.page-title').filter({hasText:'阅读摘录'}).click();
 await expect(page.locator('.sidebar')).toBeHidden();
 await expect(page.locator('.tab.selected')).toContainText('阅读摘录');
 await page.screenshot({path:evidence+'narrow-workspace.png',fullPage:true});
});
test('opening and changing modes without edits preserves original Markdown exactly',async({page})=>{
 const markdown='# 保留原文\n\n__强调__ 和 **另一种写法**\n\n<!-- 未编辑注释 -->\n\n~~~~js\nconst a = 1;\n~~~~\n';
 await boot(page,{markdown});await menu(page,'源码');await menu(page,'正文');
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();await expect(page.locator('.tab.selected')).toContainText('公式推导');
 expect((await stored(page)).markdown).toBe(markdown);
});

test('title search includes shelved pages without switching until a result is chosen',async({page})=>{
 await boot(page);await page.getByRole('searchbox',{name:'搜索页面名称'}).fill('阅读');
 await expect(page.locator('.shelved-row .page-title')).toHaveCount(1);
 await expect(page.locator('.tab.selected')).toContainText('方案讨论');
 await page.locator('.shelved-row .page-title').click();
 await expect(page.locator('.tab.selected')).toContainText('阅读摘录');
 expect((await stored(page,'c')).shelved).toBe(false);
});
test('file-backed title cannot rename disk and remove keeps the file association in undo',async({page})=>{
 const docs=[{id:'a',title:'方案讨论',path:'/synthetic/original.md',markdown:'# 文件正文',shelved:false},{id:'b',title:'公式推导',markdown:'第二页',shelved:false}];
 await boot(page,{documents:docs});await expect(page.locator('.name-dock input')).toHaveCount(0);
 await append(page,' 新修改');await remove(page);
 await expect(page.getByRole('dialog')).toContainText('移除页面不会删除磁盘原件');
 await page.getByRole('button',{name:'不保存',exact:true}).click();
 await expect(page.locator('.tab.selected')).toContainText('公式推导');
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect(page.locator('.tab.selected')).toContainText('方案讨论');
 const docsAfter=await page.evaluate(()=>[...window.__FROWD_TEST_HOST__.rows.values()]);
 expect(docsAfter.find(d=>d.title==='方案讨论').path).toBe('/synthetic/original.md');
});
test('real collapse frame runs once and restored page displays without reverse capture',async({page})=>{
 await boot(page,{markdown:'# 动效合成样例\n\n只验证收起与恢复路径。'});
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.getByRole('button',{name:'标签收起 方案讨论',exact:true}).click();
 await expect(page.locator('.page-flight')).toBeVisible({timeout:2500});
 await page.screenshot({path:evidence+'collapse-frame.png'});
 await expect(page.locator('.tab.selected')).toContainText('公式推导');
 await expect(page.locator('.page-flight')).toHaveCount(0);
 await page.locator('.shelved-row .page-title').filter({hasText:'方案讨论'}).click();
 await expect(page.locator('.tab.selected')).toContainText('方案讨论');
 await expect(page.locator('.page-flight')).toHaveCount(0);
});
test('close backup failure keeps the window open and successful retry commits the input',async({page})=>{
 await boot(page);await page.evaluate(()=>window.__FROWD_TEST_HOST__.fail='update_document');
 await append(page,' 关闭失败仍保留');
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.requestClose());
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.closed)).toBe(false);
 await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable','true');
 await page.evaluate(()=>{window.__FROWD_TEST_HOST__.fail=null;return window.__FROWD_TEST_HOST__.requestClose()});
 expect(await page.evaluate(()=>window.__FROWD_TEST_HOST__.closed)).toBe(true);
 expect((await stored(page)).markdown).toContain('关闭失败仍保留');
});

test('candidate formatting shortcut writes through the same document-owned history',async({page})=>{
 await boot(page,{markdown:'中文段落'});await menu(page,'源码');
 await page.locator('.cm-content').click();await page.keyboard.press('Control+a');await page.keyboard.press('Control+b');
 await expect(page.locator('.cm-content')).toContainText('**中文段落**');
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();await expect(page.locator('.tab.selected')).toContainText('公式推导');
 expect((await stored(page)).markdown).toBe('**中文段落**');
});

test('target read failure leaves old page/body paired and permits retry',async({page})=>{
 await boot(page);await page.evaluate(()=>window.__FROWD_TEST_HOST__.fail='read_document');
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();
 await expect(page.getByRole('alert')).toContainText('合成写入失败');
 await expect(page.locator('.tab.selected')).toContainText('方案讨论');
 await expect(page.locator('.cm-content')).toContainText('合成文稿');
 await page.evaluate(()=>window.__FROWD_TEST_HOST__.fail=null);
 await page.locator('.tab-title').filter({hasText:'公式推导'}).click();
 await expect(page.locator('.tab.selected')).toContainText('公式推导');
 await expect(page.locator('.cm-content')).toContainText('第二篇');
});
