import { test, expect, chromium } from '@playwright/test'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { mkdtemp, readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const execute = promisify(execFile)
const root = fileURLToPath(new URL('../../../', import.meta.url))
// FROWANG_USER_DATA is intentionally supported only by the debug application.
const executable = process.env.FROWD_NATIVE_EXE || join(root, 'apps/tauri/src-tauri/target/debug/frowd-tauri.exe')
const evidence = join(root, 'output/tauri-native-profiles')
const body = page => page.getByRole('textbox', { name: 'Markdown 正文', exact: true })
const source = page => page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
const nameInput = page => page.getByRole('textbox', { name: '当前页面名称', exact: true })

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function fixture() {
  await mkdir(evidence, { recursive: true })
  const directory = await mkdtemp(join(evidence, 'case-'))
  return { directory, profile: join(directory, 'profile') }
}

function debugEndpoint(port) {
  return fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })
    .then(response => response.ok).catch(() => false)
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { if (error.code === 'ESRCH') return false; throw error }
}

async function stopFailedChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 15000 }).toBe(true)
}

async function launch(profile, { pdfTarget, updateFeed, executablePath=executable } = {}) {
  const port = await freePort()
  const child = spawn(executablePath, [], {
    windowsHide: true,
    env: {
      ...process.env,
      FROWANG_USER_DATA: profile,
      WEBVIEW2_USER_DATA_FOLDER: join(profile, 'webview2'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
      ...(pdfTarget ? { FROWD_PDF_TEST_TARGET: pdfTarget } : {}),
      ...(updateFeed ? { FROWD_UPDATE_TEST_FEED: updateFeed } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostic = ''
  child.stdout.on('data', bytes => { diagnostic += bytes.toString() })
  child.stderr.on('data', bytes => { diagnostic += bytes.toString() })
  let startupError
  child.on('error', error => { startupError = error })
  let browser
  try {
    await expect.poll(async () => {
      if (startupError) throw startupError
      if (child.exitCode !== null) throw Error(`Native startup exited ${child.exitCode}\n${diagnostic}`)
      return debugEndpoint(port)
    }, { timeout: 60000 }).toBe(true)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const session = await browser.newBrowserCDPSession()
    const processes = await session.send('SystemInfo.getProcessInfo')
    const browserPid = processes.processInfo.find(process => process.type === 'browser')?.id
    await session.detach()
    expect(browserPid).toBeGreaterThan(0)
    const context = browser.contexts()[0]
    const page = context.pages()[0] || await context.waitForEvent('page')
    await expect(page.locator('.loading-state')).toHaveCount(0)
    await expect(page.locator('.ProseMirror:visible, .pm-port > .markdown-source:visible')).toBeVisible()
    expect(await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__ && !window.__FROWD_TEST_HOST__))).toBe(true)
    expect((await stat(join(profile, 'webview2'))).isDirectory()).toBe(true)
    expect((await stat(join(profile, 'drafts.sqlite'))).isFile()).toBe(true)
    return { child, browser, page, port, profile, browserPid }
  } catch (error) {
    await browser?.close().catch(() => {})
    await stopFailedChild(child)
    throw new Error(`Native launch failed: pid=${child.pid}, port=${port}, profile=${profile}\n${diagnostic}\n${error.message}`, { cause: error })
  }
}

async function closeNormally(app) {
  // Send the real window-close event so the renderer flush / SQLite checkpoint
  // handshake runs before the native process exits.
  const exited = once(app.child, 'exit')
  const script = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FrowdClose { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam); }'
$taskProcess = Get-Process -Id ${app.child.pid}
if ($taskProcess.MainWindowHandle -eq 0) { throw 'Native window handle unavailable' }
if (-not [FrowdClose]::PostMessage($taskProcess.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Window close failed' }
`
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
  await expect.poll(() => app.child.exitCode, { timeout: 15000 }).toBe(0)
  await exited
  await app.browser.close()
  // A WebView2 environment can outlive its host briefly. Do not reopen the same
  // profile with new debugging options until that exact browser process exits.
  await expect.poll(() => debugEndpoint(app.port), { timeout: 15000 }).toBe(false)
  await expect.poll(() => processAlive(app.browserPid), { timeout: 15000 }).toBe(false)
}

async function cleanup(app) {
  if (!app) return
  await app.browser.close().catch(() => {})
  await stopFailedChild(app.child)
}

async function setMode(page, mode) {
  if (await source(page).isVisible() === (mode === 'source')) return
  await page.locator('summary').filter({ hasText: '视图' }).click()
  await page.getByRole('button', { name: mode === 'source' ? /^源码/ : /^正文/ }).click()
  await expect(mode === 'source' ? source(page) : body(page)).toBeVisible()
}

async function pasteImage(page) {
  const bytes = await readFile(join(root, 'apps/tauri/tests/fixtures/synthetic-resource.png'))
  await body(page).click()
  await page.keyboard.press('Control+End')
  await body(page).evaluate((element, bytes) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(bytes)], 'native-sample.png', { type: 'image/png' }))
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
  }, Array.from(bytes))
  await expect.poll(() => body(page).locator('img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 0))).toBe(true)
}

function seedFile(profile, id, file, markdown) {
  // Only call with the app closed, against a disposable profile created above.
  const hash = createHash('sha256').update(markdown).digest('hex')
  const db = new DatabaseSync(join(profile, 'drafts.sqlite'))
  try {
    db.prepare('UPDATE documents SET title=?,path=?,markdown=?,contentHash=?,savedHash=?,baseline=?,revision=1 WHERE id=?')
      .run('原生文件.md', file, markdown, hash, hash, hash, id)
  } finally { db.close() }
}

test('native update verifies download, refuses bad hash and spawn, preserves IME draft and resources on restart',async()=>{
 const {profile,directory}=await fixture()
 const installer=process.env.FROWD_TEST_INSTALLER
 if(!installer)throw Error('Set FROWD_TEST_INSTALLER to the compiled harmless updates-installer fixture')
 const bytes=await readFile(installer)
 await mkdir(profile,{recursive:true});await writeFile(join(profile,'.frowd-update-test'),'synthetic update profile')
 let badHash=true,badExe=false,app
 const server=createHttpServer((req,res)=>{
  const payload=badExe?Buffer.from('MZ-not-an-executable'):bytes
  const hash=createHash('sha256').update(payload).digest('hex')
  const name='fromd_99.0.0_x64-setup.exe'
  const origin=`http://127.0.0.1:${server.address().port}`
  if(req.url==='/latest')res.end(JSON.stringify({tag_name:'v99.0.0',draft:false,prerelease:false,assets:[{name,size:payload.length,browser_download_url:origin+'/'+name},{name:'SHA256SUMS.txt',size:100,browser_download_url:origin+'/SHA256SUMS.txt'}]}))
  else if(req.url==='/SHA256SUMS.txt')res.end(`${badHash?'0'.repeat(64):hash}  ${name}\n`)
  else if(req.url==='/'+name)res.end(payload)
  else {res.statusCode=404;res.end()}
 })
 server.listen(0,'127.0.0.1');await once(server,'listening')
 const feed=`http://127.0.0.1:${server.address().port}/latest`
 try{
  app=await launch(profile,{executablePath:process.env.FROWD_LEGACY_NATIVE_EXE||executable});let page=app.page
  await nameInput(page).fill('原生更新草稿');await nameInput(page).press('Enter')
  await pasteImage(page)
  const original={id:await page.locator('.tab.selected').getAttribute('data-tab-id')}
  await page.getByRole('button',{name:/^标签收起/}).click()
  await page.getByRole('button',{name:'新建页面',exact:true}).first().click()
  await expect(body(page)).toBeVisible()
  await page.getByRole('button',{name:'阅读设置',exact:true}).click()
  await page.getByRole('combobox',{name:'正文字号',exact:true}).selectOption('20')
  await page.getByRole('combobox',{name:'主题',exact:true}).selectOption('dark')
  await page.getByRole('button',{name:'关闭阅读设置',exact:true}).click()
  await closeNormally(app);app=null
  app=await launch(profile,{updateFeed:feed});page=app.page
  await expect(page.locator('.brand span')).toHaveText('fromd')
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme','dark')
  const notice=page.getByRole('status',{name:'应用更新',exact:true})
  const check=async()=>{await page.locator('.app-menu summary').filter({hasText:'文件'}).click();await page.getByRole('button',{name:'检查更新…',exact:true}).click();await expect(notice).toContainText('发现新版本 v99.0.0')}
  await check();await notice.getByRole('button',{name:'立即更新'}).click()
  await expect(notice).toContainText('SHA-256 校验失败');expect(app.child.exitCode).toBeNull()
  badHash=false;badExe=true
  // Recheck updates to obtain the intentionally invalid executable's new size.
  await check();await notice.getByRole('button',{name:'立即更新'}).click()
  await expect(notice).toContainText('无法启动更新安装程序');expect(app.child.exitCode).toBeNull()
  await expect(body(page)).toHaveAttribute('contenteditable','true')
  badExe=false;await check()
  await setMode(page,'source')
  await source(page).evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='原生更新最后组合正文';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,inputType:'insertCompositionText',data:el.value}))})
  await notice.getByRole('button',{name:'立即更新'}).click()
  await expect(notice).toContainText('正在保存文稿')
  expect(app.child.exitCode).toBeNull()
  await source(page).evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:el.value})))
  await expect.poll(()=>app.child.exitCode,{timeout:20000}).toBe(0)
  const old=app;await old.browser.close().catch(()=>{});app=null
  await expect.poll(()=>debugEndpoint(old.port),{timeout:15000}).toBe(false)
  await expect.poll(()=>processAlive(old.browserPid),{timeout:15000}).toBe(false)
  await expect.poll(()=>readFile(join(profile,'update-installer-started.txt'),'utf8').catch(()=>''),{timeout:10000}).toBe('/P')
  const db=new DatabaseSync(join(profile,'drafts.sqlite'))
  try{
   const docs=db.prepare('SELECT id,markdown,title,shelved,viewState FROM documents').all()
   expect(docs).toHaveLength(2)
   expect(docs.find(d=>d.id===original.id).shelved).toBe(1)
   expect(docs.find(d=>d.id!==original.id).markdown).toContain('原生更新最后组合正文')
   expect(db.prepare('SELECT COUNT(*) AS n FROM resource_bindings WHERE docId=?').get(original.id).n).toBeGreaterThan(0)
   await writeFile(join(directory,'update-native-evidence.json'),JSON.stringify({native:true,mock:false,legacySeed:Boolean(process.env.FROWD_LEGACY_NATIVE_EXE),installer:'harmless fixture; no binary replacement',docs},null,2))
  }finally{db.close()}
  app=await launch(profile)
  page=app.page
  await expect(page.locator('.brand span')).toHaveText('fromd')
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme','dark')
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('frowd.tauri.reading-preferences.v1')).fontSize)).toBe(20)
  await expect(source(app.page)).toHaveValue('原生更新最后组合正文')
  await app.page.locator(`.page-row[data-page-id="${original.id}"] .page-title`).click()
  const restoredImage=body(app.page).locator('img[data-editor-image-src]')
  await expect(restoredImage).toBeVisible()
  await expect.poll(()=>restoredImage.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true)
  await closeNormally(app);app=null
 }finally{await cleanup(app);await new Promise(resolve=>server.close(resolve))}
})

test('native titlebar controls, WebView zoom and final-input close preserve the isolated draft', async ({}, info) => {
  const {profile,directory}=await fixture()
  let app
  try {
    app=await launch(profile)
    const page=app.page
    const native=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,{label:'main',...args}),{command,args})
    const initialPid=app.child.pid
    await page.getByRole('button',{name:'最大化窗口',exact:true}).click()
    await expect.poll(()=>native('plugin:window|is_maximized')).toBe(true)
    await page.getByRole('button',{name:'还原窗口',exact:true}).click()
    await expect.poll(()=>native('plugin:window|is_maximized')).toBe(false)
    const windowHandle=(await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${app.child.pid}).MainWindowHandle.ToInt64()`],{windowsHide:true})).stdout.trim()
    expect(Number(windowHandle)).toBeGreaterThan(0)
    await page.getByRole('button',{name:'最小化窗口',exact:true}).click()
    await expect.poll(()=>native('plugin:window|is_minimized')).toBe(true)
    await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',`
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FrowdRestore { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command); }'
[FrowdRestore]::ShowWindow([IntPtr]::new(${windowHandle}),9)
`],{windowsHide:true})
    await expect.poll(()=>native('plugin:window|is_minimized')).toBe(false)
    await body(page).click()
    const initialWidth=await page.evaluate(()=>innerWidth)
    await page.keyboard.press('Control+Shift+=')
    await expect(page.locator('.app-shell')).toHaveAttribute('data-zoom','110')
    await expect.poll(()=>page.evaluate(()=>innerWidth)).toBeLessThan(initialWidth)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0,-100)
    await page.keyboard.up('Control')
    await expect(page.locator('.app-shell')).toHaveAttribute('data-zoom','120')
    await expect.poll(async()=>Math.abs((await page.evaluate(()=>innerWidth))-initialWidth/1.2)).toBeLessThan(2)
    await page.keyboard.press('Control+Shift+0')
    await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(initialWidth)
    await page.keyboard.press('Control+/');await expect(source(page)).toBeVisible()
    await source(page).fill('# 原生标题栏验收\n\n正常关闭前最后输入')
    if(process.env.FROWD_NATIVE_HMR==='1'){
      const stylesheet=join(root,'apps/tauri/src/styles.css'),original=await readFile(stylesheet,'utf8')
      const config=JSON.parse(await readFile(join(root,'apps/tauri/src-tauri/tauri.conf.json'),'utf8'))
      const origin=new URL(process.env.FROWD_NATIVE_DEV_ORIGIN||config.build.devUrl).origin
      const logs=[]
      const observe=message=>{if(message.text().includes('vite'))logs.push(message.text())}
      page.on('console',observe)
      try{
        expect(await page.evaluate(()=>location.origin)).toBe(origin)
        await writeFile(stylesheet,original+'\n:root { --frowd-hmr-probe: native-live; }\n')
        await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--frowd-hmr-probe').trim())).toBe('native-live')
        expect(processAlive(initialPid)).toBe(true)
        expect(app.child.pid).toBe(initialPid)
        await expect(source(page)).toHaveValue('# 原生标题栏验收\n\n正常关闭前最后输入')
      } finally {await writeFile(stylesheet,original);page.off('console',observe)}
      await writeFile(join(directory,'hmr.json'),JSON.stringify({pid:initialPid,logs,origin,native:true,mock:false},null,2))
    }
    await page.screenshot({path:info.outputPath('native-titlebar.png')})
    const exited=once(app.child,'exit')
    await page.getByRole('button',{name:'关闭窗口',exact:true}).click()
    await expect.poll(()=>app.child.exitCode,{timeout:20000}).toBe(0)
    await exited;await app.browser.close().catch(()=>{});app=null
    app=await launch(profile)
    await expect(source(app.page)).toHaveValue('# 原生标题栏验收\n\n正常关闭前最后输入')
    await closeNormally(app);app=null
  } finally {await cleanup(app)}
})

test('native outline navigation selects and scrolls the real heading without changing authoring text',async()=>{
 const {profile,directory}=await fixture()
 let app
 try{
  app=await launch(profile)
  const page=app.page,filler=Array.from({length:32},(_,n)=>'原生合成前文第'+n+'段，供大纲跳转验证。\n').join('\n')
  const markdown='# 原生开始\n\n<br />\n\n'+filler+'\n## 原生精确目标\n\n'+filler
  await nameInput(page).fill('大纲原生');await nameInput(page).press('Enter')
  await setMode(page,'source');await source(page).fill(markdown);await setMode(page,'rendered')
  const before=await page.locator('.pm-port').evaluate(el=>{const c=el.__vueParentComponent.exposed.capture();return{markdown:c.markdown,id:c.id,generation:c.generation}})
  await page.getByRole('button',{name:'大纲',exact:true}).click()
  await page.getByRole('button',{name:'原生精确目标',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>{const n=getSelection()?.anchorNode,e=n?.nodeType===1?n:n?.parentElement;return e?.closest('h2')?.textContent})).toBe('原生精确目标')
  const after=await page.locator('.pm-port').evaluate(el=>{const c=el.__vueParentComponent.exposed.capture(),host=el.querySelector('.pm-scroller'),h=el.querySelector('h2');return{markdown:c.markdown,id:c.id,generation:c.generation,scrollTop:host.scrollTop,heading:h.getBoundingClientRect().toJSON(),viewport:host.getBoundingClientRect().toJSON()}})
  expect(after.markdown).toBe(before.markdown);expect(after.id).toBe(before.id);expect(after.generation).toBe(before.generation)
  expect(after.heading.top).toBeGreaterThanOrEqual(after.viewport.top-1);expect(after.heading.bottom).toBeLessThanOrEqual(after.viewport.bottom+1)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await writeFile(join(directory,'outline-native.json'),JSON.stringify({native:true,mock:false,before,after},null,2))
  await closeNormally(app);app=null
  app=await launch(profile)
  await expect(body(app.page).locator('h2')).toHaveText('原生精确目标')
  await closeNormally(app);app=null
 }finally{await cleanup(app)}
})

test('native end-blank clicks place a real caret at 100/120 percent and survive normal close',async()=>{
 const {profile,directory}=await fixture()
 let app
 try{
  app=await launch(profile)
  const page=app.page,original='# 原生开头\n\n原生末段。\n'
  await nameInput(page).fill('文末空白原生');await nameInput(page).press('Enter')
  await setMode(page,'source');await source(page).fill(original);await setMode(page,'rendered')
  const positions=[]
  for(const zoom of [100,120]){
   await page.keyboard.press('Control+Shift+0');if(zoom===120){await page.keyboard.press('Control+Shift+=');await page.keyboard.press('Control+Shift+=')}
   await expect(page.locator('.app-shell')).toHaveAttribute('data-zoom',String(zoom))
   await body(page).locator('h1').click();await page.keyboard.press('Home')
   await page.locator('.pm-scroller').evaluate(async el=>{el.scrollTop=0;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})
   const point=await body(page).evaluate(el=>{const rect=el.getBoundingClientRect(),last=el.lastElementChild.getBoundingClientRect(),line=parseFloat(getComputedStyle(el).lineHeight),bottom=el.closest('.pm-scroller').getBoundingClientRect().bottom;return{x:rect.left+30,y:Math.min(last.bottom+line*2.5,bottom-20),line,dpr:devicePixelRatio}})
   await page.mouse.click(point.x,point.y)
   const caret=await page.evaluate(()=>{const node=getSelection().anchorNode,element=node.nodeType===1?node:node.parentElement,r=element.closest('p').getBoundingClientRect();return{y:r.top+r.height/2,left:r.left}})
   expect(Math.abs(caret.y-point.y)).toBeLessThan(point.line*1.5)
   await page.keyboard.insertText('原生末尾输入'+zoom)
   positions.push({zoom,point,caret})
  }
  await setMode(page,'source')
  const markdown=await source(page).inputValue()
  expect(markdown).toContain('原生末尾输入100');expect(markdown).toContain('原生末尾输入120');expect(markdown).not.toContain('<br />')
  await source(page).fill(markdown+'\n');await setMode(page,'rendered')
  await writeFile(join(directory,'end-blank-native.json'),JSON.stringify({native:true,mock:false,positions,markdown},null,2))
  await closeNormally(app);app=null
  app=await launch(profile)
  await expect(body(app.page)).toContainText('原生末尾输入100');await expect(body(app.page)).toContainText('原生末尾输入120')
  await expect(body(app.page).locator('h1')).toHaveText('原生开头')
  await closeNormally(app);app=null
 }finally{await cleanup(app)}
})

test('native direct shelf preserves final input and restores after restart without capture or animation',async()=>{
 const {profile,directory}=await fixture()
 let app
 try{
  app=await launch(profile)
  const page=app.page
  const markdown='# 原生直接收起\n\n| 项目 | 内容 |\n| --- | --- |\n| 表格 | 保留内容和页面身份 |\n\n公式 $E=mc^2$。\n\n'+('合成长文段落与列表检查。\n\n'.repeat(80))
  await nameInput(page).fill('直接收起 A');await nameInput(page).press('Enter')
  const a=(await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('list_metadata'))).activeId
  await setMode(page,'source');await source(page).fill(markdown);await setMode(page,'rendered')
  await page.getByRole('button',{name:'新建页面',exact:true}).click()
  await nameInput(page).fill('直接收起 B');await nameInput(page).press('Enter');await body(page).fill('B 独立正文')
  const b=(await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('list_metadata'))).activeId
  await page.locator('[data-tab-id="'+a+'"] .tab-title').click()
  await page.evaluate(()=>{
   const m={click:0,end:0,target:'',visualNodes:0};window.__directShelf=m
   document.addEventListener('click',event=>{if(event.target.closest('.tab-minus'))m.click=performance.now()},true)
   new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&(node.matches('.page-flight,.page-flight-backdrop')||node.querySelector('.page-flight,.page-flight-backdrop')))m.visualNodes++
    if(m.click&&!m.end&&document.querySelector('.tab.selected')?.dataset.tabId===m.target&&!document.querySelector('.tab-minus:disabled'))m.end=performance.now()
   }).observe(document.querySelector('.app-shell'),{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']})
  })
  const observations=[]
  for(const motion of ['no-preference','reduce']){
   await page.emulateMedia({reducedMotion:motion})
   await nameInput(page).fill('直接收起 A');await nameInput(page).press('Enter')
   await body(page).click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 最后输入'+motion)
   await page.evaluate(target=>{const m=window.__directShelf;m.click=0;m.end=0;m.target=target;performance.clearResourceTimings()},b)
   await page.getByRole('button',{name:'标签收起 直接收起 A',exact:true}).click()
   await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id',b)
   await expect(body(page)).toHaveAttribute('contenteditable','true')
   await page.waitForFunction(()=>window.__directShelf.end>0)
   const observation=await page.evaluate(()=>{const m=window.__directShelf;return{visualNodes:m.visualNodes,actualEndMs:m.end-m.click,captures:performance.getEntriesByType('resource').filter(e=>e.name.includes('capture_main_viewport')).length}})
   expect(observation.visualNodes).toBe(0);expect(observation.captures).toBe(0)
   observations.push({motion,...observation})
   const saved=await page.evaluate(id=>window.__TAURI_INTERNALS__.invoke('read_document',{id}),a)
   expect(saved.title).toBe('直接收起 A');expect(saved.markdown).toContain('最后输入'+motion)
   await page.locator('[data-page-id="'+a+'"] .page-title').click()
   await expect(page.locator('.tab.selected')).toHaveAttribute('data-tab-id',a)
  }
  await writeFile(join(directory,'direct-shelf-observations.json'),JSON.stringify({native:true,mock:false,markdownLength:markdown.length,observations},null,2))
  await closeNormally(app);app=null
  app=await launch(profile)
  await expect(body(app.page)).toContainText('最后输入reduce')
  await expect(nameInput(app.page)).toHaveValue('直接收起 A')
  await closeNormally(app);app=null
 }finally{await cleanup(app)}
})

test('native WebView2 authoring, search, managed image and normal-close SQLite recovery', async ({}, info) => {
  const { directory, profile } = await fixture()
  let app
  try {
    app = await launch(profile)
    let page = app.page
    await nameInput(page).fill('原生草稿')
    await nameInput(page).press('Enter')
    await setMode(page, 'source')
    await source(page).fill('# 原生标题\n\n跨页检索文字\n\n第二节\n---\n\n图片在此。')
    await setMode(page, 'rendered')
    await pasteImage(page)
    const before = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_metadata'))
    const originalId = before.activeId
    await page.getByRole('button', { name: '新建页面', exact: true }).click()
    let createdId
    await expect.poll(async () => {
      createdId = (await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_metadata'))).activeId
      return Boolean(createdId && createdId !== originalId)
    }).toBe(true)
    await expect(nameInput(page)).toHaveAttribute('data-doc-id', createdId)
    await expect.poll(() => nameInput(page).evaluate(element => Boolean(element.closest('[inert]')))).toBe(false)
    await expect.poll(() => body(page).evaluate(element => Boolean(element.closest('[inert]')))).toBe(false)
    await expect(body(page)).toHaveAttribute('contenteditable', 'true')
    await nameInput(page).fill('第二页')
    await nameInput(page).press('Enter')
    await body(page).fill('第二页正文')
    await page.getByRole('button', { name: '标签收起 原生草稿', exact: true }).click()
    const query = page.getByRole('searchbox', { name: '搜索全部页面', exact: true })
    await query.fill('跨页检索文字')
    await page.locator('.search-result').filter({ hasText: '原生草稿' }).click()
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('跨页检索文字')
    await query.fill('')
    await expect(body(page).locator('h1')).toHaveText('原生标题')
    await expect.poll(() => body(page).locator('img').evaluateAll(images => images.some(image => image.naturalWidth > 0))).toBe(true)
    await closeNormally(app)
    app = null

    app = await launch(profile)
    page = app.page
    await expect(nameInput(page)).toHaveValue('原生草稿')
    await expect(body(page)).toContainText('跨页检索文字')
    await expect.poll(() => body(page).locator('img').evaluateAll(images => images.some(image => image.naturalWidth > 0))).toBe(true)
    const after = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_metadata'))
    expect(after.activeId).toBe(originalId)
    expect(after.documents.map(document => document.title)).toEqual(['原生草稿', '第二页'])
    await page.screenshot({ path: info.outputPath('native-recovered.png') })
    await writeFile(join(directory, 'result.json'), JSON.stringify({ before, after }, null, 2))
    await closeNormally(app)
    app = null
  } finally { await cleanup(app) }
})

test('native save writes Markdown and its image in the document asset folder', async ({}, info) => {
  const { directory, profile } = await fixture()
  let app
  try {
    app = await launch(profile)
    const initial = await app.page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_metadata'))
    await closeNormally(app)
    app = null
    const file = join(directory, '原生文件.md')
    const markdown = '# 原生文件\n\n保存图片。'
    await writeFile(file, markdown)
    seedFile(profile, initial.activeId, file, markdown)
    app = await launch(profile)
    await pasteImage(app.page)
    await app.page.keyboard.press('Control+s')
    await expect.poll(() => readFile(file, 'utf8')).toContain('.assets/')
    const saved = await readFile(file, 'utf8')
    const reference = saved.match(/!\[[^\]]*\]\(([^\s)]+\.assets\/[^\s)]+)\)/)?.[1]
    expect(reference).toBeTruthy()
    expect(await readFile(resolve(dirname(file), decodeURIComponent(reference)))).toEqual(await readFile(join(root, 'apps/tauri/tests/fixtures/synthetic-resource.png')))
    await expect(app.page.getByRole('status', { name: '保存状态', exact: true })).toHaveText('已保存到文件')
    await app.page.screenshot({ path: info.outputPath('native-saved-image.png') })
    await closeNormally(app)
    app = null
    // Reopen from a fresh profile with no asset binding, so rendering must resolve
    // the saved relative file rather than the old profile's imported object.
    const freshProfile = join(directory, 'profile-from-disk')
    app = await launch(freshProfile)
    const fresh = await app.page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_metadata'))
    await closeNormally(app)
    app = null
    seedFile(freshProfile, fresh.activeId, file, saved)
    app = await launch(freshProfile)
    await expect.poll(() => body(app.page).locator('img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 0))).toBe(true)
    await expect(body(app.page)).toContainText('保存图片。')
    await closeNormally(app)
    app = null
  } finally { await cleanup(app) }
})

test('native reading preferences and Setext outline survive restart in an isolated WebView profile', async ({}, info) => {
  const { profile } = await fixture()
  let app
  try {
    app = await launch(profile)
    let page = app.page
    await setMode(page, 'source')
    await source(page).fill('# 第一节\n\nHello 世界\n\n第二节\n---\n\n结束')
    await setMode(page, 'rendered')
    await page.getByRole('button', { name: '大纲', exact: true }).click()
    await page.getByRole('button', { name: '第二节', exact: true }).click()
    await expect.poll(() => page.evaluate(() => getSelection()?.anchorNode?.parentElement?.closest('h2')?.textContent)).toBe('第二节')
    const count = page.getByRole('status', { name: '字数统计', exact: true })
    await expect(count).toHaveText(/\d+ 字词 · \d+ 字符/)
    const originalCount = await count.textContent()
    await page.getByRole('button', { name: '阅读设置', exact: true }).click()
    await page.getByRole('combobox', { name: '正文字号', exact: true }).selectOption('20')
    await page.getByRole('combobox', { name: '正文宽度', exact: true }).selectOption('720')
    await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('dark')
    await page.getByRole('button', { name: '关闭阅读设置', exact: true }).click()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark')
    await expect(body(page)).toHaveCSS('font-size', '20px')
    await closeNormally(app)
    app = null

    app = await launch(profile)
    page = app.page
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark')
    await expect(body(page)).toHaveCSS('font-size', '20px')
    await expect(page.getByRole('status', { name: '字数统计', exact: true })).toHaveText(originalCount)
    await page.getByRole('button', { name: '阅读设置', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '正文宽度', exact: true })).toHaveValue('720')
    await expect(page.getByRole('combobox', { name: '主题', exact: true })).toHaveValue('dark')
    await page.screenshot({ path: info.outputPath('native-reading-dark.png') })
    await closeNormally(app)
    app = null
  } finally { await cleanup(app) }
})

test('native PDF exports a full Chinese A4 document with math, table, code and authorized raster images', async ({}, info) => {
  test.setTimeout(180000)
  const { directory, profile } = await fixture()
  let app
  try {
    app = await launch(profile)
    const initial = await app.page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_metadata'))
    await closeNormally(app);app = null
    const file = join(directory, '原生文件.md')
    const markdown = '# 中文PDF导出\n\n公式 $E=mc^2$\n\n$$\\int_0^1 x^2 dx = \\frac{1}{3}$$\n\n| 项目 | 数值 |\n| --- | --- |\n| 合成表格 | 42 |\n\n```js\nconst answer = 42;\n```\n\n![文档相对图片](relative.png)\n\n' +
      Array.from({length: 80}, (_, index) => `第${index + 1}段：这是完整正文的多页排版验证。中文内容应当能够提取和复制，表格与公式应使用真实字体。`).join('\n\n') + '\n\n结束标记PDFEND'
    await writeFile(file, markdown)
    await writeFile(join(directory, 'relative.png'), await readFile(join(root, 'apps/tauri/tests/fixtures/synthetic-resource.png')))
    seedFile(profile, initial.activeId, file, markdown)
    const pdf = join(profile, '正式导出.pdf')
    await writeFile(pdf, 'previous target')
    app = await launch(profile, { pdfTarget: pdf })
    const inlineImage = 'data:image/png;base64,' + (await readFile(join(root, 'apps/tauri/tests/fixtures/synthetic-resource.png'))).toString('base64')
    await setMode(app.page, 'source')
    await source(app.page).fill(markdown + `\n\n![原文内嵌图片](${inlineImage})`)
    await setMode(app.page, 'rendered')
    const inline = body(app.page).locator('img[src^="data:image/png;base64,"]')
    await expect.poll(() => inline.evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }))).toEqual({ width: 240, height: 80 })
    await pasteImage(app.page)
    await setMode(app.page, 'source')
    await source(app.page).press('Control+End');await source(app.page).press('Enter');await source(app.page).pressSequentially('FINALINPUT')
    await app.page.getByText('文件', { exact: true }).click()
    await app.page.getByRole('button', { name: '导出 PDF…', exact: true }).click()
    await Promise.race([
      expect.poll(async () => (await readFile(pdf)).subarray(0, 5).toString(), { timeout: 100000 }).toBe('%PDF-'),
      app.page.getByRole('alert').waitFor({ state: 'visible', timeout: 100000 }).then(async () => { throw Error(await app.page.getByRole('alert').innerText()) }),
    ])
    await expect.poll(() => source(app.page).evaluate(element => Boolean(element.closest('[inert]')))).toBe(false)
    const metadata = (await execute('pdfinfo', [pdf], { windowsHide: true })).stdout
    expect(Number(metadata.match(/Pages:\s+(\d+)/)?.[1])).toBeGreaterThanOrEqual(3)
    const paper = metadata.match(/Page size:\s+([\d.]+) x ([\d.]+) pts \(A4\)/)
    expect(paper).toBeTruthy()
    // Chromium rounds the CSS paper dimensions to device pixels before PDF
    // points; installed WebView2 versions can differ by a fraction of a point.
    expect(Math.abs(Number(paper[1]) - 210 * 72 / 25.4)).toBeLessThan(1)
    expect(Math.abs(Number(paper[2]) - 297 * 72 / 25.4)).toBeLessThan(1)
    expect((await stat(pdf)).size).toBeGreaterThan(10000)
    const extracted = info.outputPath('native-pdf-text.txt')
    await execute('pdftotext', ['-enc', 'UTF-8', pdf, extracted], { windowsHide: true })
    const text = (await readFile(extracted, 'utf8')).replace(/\s+/g, '')
    for(const expected of ['中文PDF导出', '合成表格', 'constanswer=42;', '结束标记PDFEND', 'FINALINPUT'])expect(text).toContain(expected)
    expect(text).not.toContain('工作栏')
    const images = (await execute('pdfimages', ['-list', pdf], { windowsHide: true })).stdout
    expect(images.split('\n').filter(line => /^\s*\d+\s+\d+\s+image\b/.test(line)).length).toBeGreaterThanOrEqual(3)
    const fonts = (await execute('pdffonts', [pdf], { windowsHide: true })).stdout
    expect(fonts).toContain('KaTeX')
    await expect.poll(() => app.browser.contexts()[0].pages().length).toBe(1)
    expect((await readdir(profile)).filter(name => name.startsWith('.frowd-pdf-'))).toEqual([])
    const successfulPdf = await readFile(pdf)
    // Exercise the native failure path independently of the shared builder:
    // an invalid raster must fail decoding, revoke the job and retain the PDF.
    const failure = await app.page.evaluate(async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke
      const snapshot = await invoke('list_metadata')
      const doc = snapshot.documents.find(doc => doc.id === snapshot.activeId)
      try {
        await invoke('export_pdf', { id: doc.id, revision: doc.revision,
          html: '<!doctype html><html><body><article class="markdown-body"><img src="data:image/png;base64,broken"></article></body></html>' })
        return 'unexpected success'
      } catch(error) { return String(error) }
    })
    expect(failure).toContain('加载失败')
    expect(await readFile(pdf)).toEqual(successfulPdf)
    await expect.poll(() => app.browser.contexts()[0].pages().length).toBe(1)
    expect((await readdir(profile)).filter(name => name.startsWith('.frowd-pdf-'))).toEqual([])
    await writeFile(join(directory, 'pdf-result.json'), JSON.stringify({ pdf, metadata, images, fonts }, null, 2))
    await closeNormally(app);app = null
  } catch (error) {
    if (app) {
      await app.page.screenshot({ path: info.outputPath('native-pdf-failure.png') }).catch(() => {})
      await writeFile(info.outputPath('native-pdf-ui.txt'), await app.page.locator('body').innerText().catch(() => '')).catch(() => {})
    }
    throw error
  } finally { await cleanup(app) }
})

test('native PDF prints Mermaid flowchart/Sankey, case-folded footnotes and all five alerts', async ({}, info) => {
  test.setTimeout(180000)
  const { directory, profile } = await fixture()
  let app
  try {
    app = await launch(profile)
    const initial = await app.page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_metadata'))
    await closeNormally(app);app = null
    const markdown = await readFile(join(root, 'apps/tauri/tests/fixtures/pdf-extensions.md'), 'utf8')
    const file = join(directory, '原生文件.md')
    await writeFile(file, markdown)
    await writeFile(join(directory, 'synthetic-resource.png'), await readFile(join(root, 'apps/tauri/tests/fixtures/synthetic-resource.png')))
    seedFile(profile, initial.activeId, file, markdown)
    const pdf = join(profile, '扩展组合.pdf')
    await writeFile(pdf, 'previous extension target')
    app = await launch(profile, { pdfTarget: pdf })
    const page = app.page
    await expect(body(page).locator('.writing-mermaid-svg')).toHaveCount(2)
    await expect.poll(() => body(page).locator('.writing-mermaid-svg path').count()).toBeGreaterThan(3)
    await page.getByText('文件', { exact: true }).click()
    await page.getByRole('button', { name: '导出 PDF…', exact: true }).click()
    await Promise.race([
      expect.poll(async () => (await readFile(pdf)).subarray(0, 5).toString(), { timeout: 100000 }).toBe('%PDF-'),
      page.getByRole('alert').waitFor({ state: 'visible', timeout: 100000 }).then(async () => { throw Error(await page.getByRole('alert').innerText()) }),
    ])
    await expect.poll(() => body(page).evaluate(element => Boolean(element.closest('[inert]')))).toBe(false)
    const metadata = (await execute('pdfinfo', [pdf], { windowsHide: true })).stdout
    const pages = Number(metadata.match(/Pages:\s+(\d+)/)?.[1])
    expect(pages).toBeGreaterThanOrEqual(2)
    const extracted = info.outputPath('extensions-pdf-text.txt')
    await execute('pdftotext', ['-enc', 'UTF-8', pdf, extracted], { windowsHide: true })
    const text = (await readFile(extracted, 'utf8')).replace(/\s+/g, '')
    for(const expected of ['原生扩展组合验收', '中文起点', '原生PDF', 'Input', 'Process', 'Output', 'Recycle', 'Loss',
      'NOTE提示内容', 'TIP提示内容', 'IMPORTANT提示内容', 'WARNING提示内容', 'CAUTION提示内容', '中文表格',
      '大小写归一脚注第一段', '这是脚注第二段', '另一条脚注定义', '未引用定义也要进入原生PDF', 'EXTENSIONEND'])expect(text).toContain(expected)
    expect(text.split('大小写归一脚注第一段').length - 1).toBe(1)
    expect(text).not.toMatch(/\[\^case\]/i)
    const fonts = (await execute('pdffonts', [pdf], { windowsHide: true })).stdout
    expect(fonts).toContain('KaTeX')
    const images = (await execute('pdfimages', ['-list', pdf], { windowsHide: true })).stdout
    expect(images).toMatch(/\bimage\b/)
    // Save actual native PDF rasterizations for graph/flow-line visual review.
    await execute('pdftoppm', ['-png', '-scale-to', '1400', pdf, join(directory, 'extensions-page')], { windowsHide: true })
    await writeFile(join(directory, 'extensions-pdf-result.json'), JSON.stringify({ pdf, pages, metadata, fonts, images }, null, 2))

    const successfulPdf = await readFile(pdf)
    await setMode(page, 'source')
    await source(page).fill('# 错误图表\n\n```mermaid\nflowchart LR\nA[\n```\n')
    const createdWorkers = [], context = app.browser.contexts()[0]
    const observeWorker = worker => createdWorkers.push(worker.url())
    context.on('page', observeWorker)
    try {
      await page.getByText('文件', { exact: true }).click()
      await page.getByRole('button', { name: '导出 PDF…', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('Mermaid 图表无法导出')
      await expect.poll(() => source(page).evaluate(element => Boolean(element.closest('[inert]')))).toBe(false)
    } finally { context.off('page', observeWorker) }
    expect(createdWorkers).toEqual([])
    expect(await readFile(pdf)).toEqual(successfulPdf)
    expect(context.pages()).toHaveLength(1)
    expect((await readdir(profile)).filter(name => name.startsWith('.frowd-pdf-'))).toEqual([])
    await closeNormally(app);app = null
  } catch (error) {
    if (app) {
      await app.page.screenshot({ path: info.outputPath('extensions-pdf-failure.png') }).catch(() => {})
      await writeFile(info.outputPath('extensions-pdf-ui.txt'), await app.page.locator('body').innerText().catch(() => '')).catch(() => {})
    }
    throw error
  } finally { await cleanup(app) }
})
