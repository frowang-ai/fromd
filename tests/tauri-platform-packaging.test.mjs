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
function macho(arch){const bytes=Buffer.alloc(32);bytes.writeUInt32LE(0xfeedfacf,0);bytes.writeUInt32LE(arch==='aarch64'?0x0100000c:0x01000007,4);bytes.writeUInt32LE(arch==='aarch64'?0:3,8);bytes.writeUInt32LE(2,12);return bytes}
function universal(little=false){
 const bytes=Buffer.alloc(128),write=(value,offset)=>little?bytes.writeUInt32LE(value,offset):bytes.writeUInt32BE(value,offset)
 write(0xcafebabe,0);write(2,4)
 for(const [index,arch]of ['aarch64','x86_64'].entries()){
  const header=macho(arch),at=8+index*20,offset=64+index*32
  write(header.readUInt32LE(4),at);write(header.readUInt32LE(8),at+4);write(offset,at+8);write(header.length,at+12);write(5,at+16)
  header.copy(bytes,offset)
 }
 return bytes
}
test('Mach-O validates thin and both-endian FAT slices including architecture metadata and bounds',()=>{
 for(const arch of ['aarch64','x86_64'])assert.equal(machoArchitecture(macho(arch)),arch)
 for(const little of [false,true])assert.equal(machoArchitecture(universal(little)),'universal')
 const corrupt=(offset,value)=>{const bytes=universal();bytes.writeUInt32BE(value,offset);return bytes}
 for(const [bytes,reason]of [
  [corrupt(4,100),'table'],[corrupt(16,4096),'bounds'],[corrupt(16,8),'bounds'],
  [corrupt(20,4096),'bounds'],[corrupt(20,64),'overlap'],[corrupt(12,2),'subtype'],
  [corrupt(8,0x01000007),'architecture'],[corrupt(24,33),'alignment'],
 ])assert.throws(()=>machoArchitecture(bytes),new RegExp(reason,'i'))
 const library=universal();library.writeUInt32LE(6,64+12);assert.throws(()=>machoArchitecture(library),/non-executable/)
 const unsupported=macho('aarch64');unsupported.writeUInt32LE(99,8);assert.throws(()=>machoArchitecture(unsupported),/subtype/)
})
const plist=(version='0.5.2',id='com.frowang.frowd.tauri.v1',minimum='11.0')=>`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleIdentifier</key><string>${id}</string><key>LSMinimumSystemVersion</key><string>${minimum}</string></dict></plist>`
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
  assert.equal((await checkMacosArtifact({app,dmg,arch:'arm64'})).arch,'aarch64')
  await assert.rejects(checkMacosArtifact({app,dmg,arch:'universal'}),/architecture/)
  await writeFile(exe,universal())
  assert.equal((await checkMacosArtifact({app,dmg,arch:'universal'})).arch,'universal')
  for(const arch of ['aarch64','arm64','x86_64'])await assert.rejects(checkMacosArtifact({app,dmg,arch}),/architecture/)
  const sameArch=universal();sameArch.writeUInt32BE(0x0100000c,28);sameArch.writeUInt32BE(1,32);macho('aarch64').copy(sameArch,96);sameArch.writeUInt32LE(1,104)
  await writeFile(exe,sameArch)
  for(const arch of ['aarch64','arm64','universal'])await assert.rejects(checkMacosArtifact({app,dmg,arch}),/architecture/)
  await writeFile(exe,universal())
  // Standard FAT stores 32-bit offsets; FAT64 is intentionally unsupported.
  for(const magic of [0xcafebabf,0xbfbafeca]){const bytes=Buffer.alloc(32);bytes.writeUInt32BE(magic,0);assert.throws(()=>machoArchitecture(bytes),/FAT64|Mach-O/)}
  // CI on macOS exercises the real system parser, not a regex approximation.
  if(process.platform==='darwin'){
   await writeFile(info,plist().replace('</plist>',''))
   await assert.rejects(checkMacosArtifact({app,dmg,arch:'universal'}),/plutil|plist|XML/i)
  }
  await writeFile(exe,macho('aarch64'))
  for(const xml of [plist('0.5.1'),plist('0.5.2','wrong.id'),plist('0.5.2','com.frowang.frowd.tauri.v1','10.15')]){await writeFile(info,xml);await assert.rejects(checkMacosArtifact({app,dmg,arch:'aarch64'}),/expected/)}
  await writeFile(info,plist());await writeFile(dmg,'');await assert.rejects(checkMacosArtifact({app,dmg,arch:'aarch64'}),/empty/)
  await writeFile(dmg,'synthetic');await rm(join(contents,'Resources/licenses/LICENSE'));await assert.rejects(checkMacosArtifact({app,dmg,arch:'aarch64'}),/ENOENT/)
  assert.throws(()=>machoArchitecture(Buffer.from('MZ invalid')),/truncated/)
  assert.throws(()=>machoArchitecture(Buffer.alloc(32)),/Mach-O/)
  const library=macho('aarch64');library.writeUInt32LE(6,12);assert.throws(()=>machoArchitecture(library),/non-executable/)
 }finally{await rm(temp,{recursive:true,force:true})}
})
