import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {checkMacosArtifact,licenseFiles,machoArchitecture} from '../apps/tauri/scripts/check-macos-artifact.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
const json=async name=>JSON.parse(await readFile(join(root,name),'utf8'))
test('platform overlays preserve the complete shared main window and 0.5.2 identity',async()=>{
 const base=await json('apps/tauri/src-tauri/tauri.conf.json')
 const win=await json('apps/tauri/src-tauri/tauri.windows.conf.json')
 const mac=await json('apps/tauri/src-tauri/tauri.macos.conf.json')
 assert.equal(base.version,'0.5.2')
 assert.equal((await json('apps/tauri/package.json')).version,base.version)
 assert.match(await readFile(join(root,'apps/tauri/src-tauri/Cargo.toml'),'utf8'),/version = "0\.5\.2"/)
 for(const overlay of [win,mac]){
  assert.equal(overlay.app.windows.length,1)
  const {decorations,...window}=overlay.app.windows[0]
  assert.deepEqual(window,base.app.windows[0])
  assert.equal(overlay.version,undefined)
 }
 assert.equal(win.app.windows[0].decorations,false)
 assert.equal(mac.app.windows[0].decorations,true)
 assert.deepEqual(win.bundle.targets,['nsis'])
 assert.deepEqual(mac.bundle.targets,['app','dmg'])
 assert.equal(base.bundle.createUpdaterArtifacts,false)
 assert.equal(base.bundle.windows,undefined)
 assert.equal(mac.bundle.macOS.minimumSystemVersion,'11.0')
 const icon=await readFile(join(root,'apps/tauri/src-tauri/icons/icon.icns'))
 assert.equal(icon.subarray(0,4).toString(),'icns');assert.equal(icon.readUInt32BE(4),icon.length)
 const blocks=[];for(let i=8;i<icon.length;){blocks.push(icon.subarray(i,i+4).toString());const size=icon.readUInt32BE(i+4);assert.ok(size>8);i+=size;assert.ok(i<=icon.length)}
 for(const size of ['ic07','ic08','ic09','ic10'])assert.ok(blocks.includes(size),`missing icon block ${size}`)
})
function macho(arch){const bytes=Buffer.alloc(32);bytes.writeUInt32LE(0xfeedfacf,0);bytes.writeUInt32LE(arch==='aarch64'?0x0100000c:0x01000007,4);bytes.writeUInt32LE(2,12);return bytes}
const plist=(version='0.5.2',id='com.frowang.frowd.tauri.v1',minimum='11.0')=>`<?xml version="1.0"?><plist><dict><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleIdentifier</key><string>${id}</string><key>LSMinimumSystemVersion</key><string>${minimum}</string></dict></plist>`
test('macOS artifact validator accepts both architectures and rejects malformed delivery',async()=>{
 const tempRoot=join(root,'output/native-temp');await mkdir(tempRoot,{recursive:true})
 const temp=await mkdtemp(join(tempRoot,'mac-artifact-'))
 try{
  const app=join(temp,'frowd.app'),contents=join(app,'Contents'),dmg=join(temp,'frowd.dmg')
  await mkdir(join(contents,'MacOS'),{recursive:true});await mkdir(join(contents,'Resources/licenses'),{recursive:true})
  const info=join(contents,'Info.plist'),exe=join(contents,'MacOS/frowd-tauri')
  await writeFile(info,plist());await writeFile(dmg,'synthetic-dmg')
  for(const file of licenseFiles)await writeFile(join(contents,'Resources/licenses',file),'synthetic license')
  for(const arch of ['aarch64','x86_64']){await writeFile(exe,macho(arch));assert.equal((await checkMacosArtifact({app,dmg,arch})).arch,arch)}
  await assert.rejects(checkMacosArtifact({app,dmg,arch:'aarch64'}),/architecture/)
  await writeFile(exe,macho('aarch64'))
  for(const xml of [plist('0.5.1'),plist('0.5.2','wrong.id'),plist('0.5.2','com.frowang.frowd.tauri.v1','10.15')]){await writeFile(info,xml);await assert.rejects(checkMacosArtifact({app,dmg,arch:'aarch64'}),/expected/)}
  await writeFile(info,plist());await writeFile(dmg,'');await assert.rejects(checkMacosArtifact({app,dmg,arch:'aarch64'}),/empty/)
  await writeFile(dmg,'synthetic');await rm(join(contents,'Resources/licenses/LICENSE'));await assert.rejects(checkMacosArtifact({app,dmg,arch:'aarch64'}),/ENOENT/)
  assert.throws(()=>machoArchitecture(Buffer.from('MZ invalid')),/truncated/)
  assert.throws(()=>machoArchitecture(Buffer.alloc(32)),/Mach-O/)
  const library=macho('aarch64');library.writeUInt32LE(6,12);assert.throws(()=>machoArchitecture(library),/non-executable/)
 }finally{await rm(temp,{recursive:true,force:true})}
})
