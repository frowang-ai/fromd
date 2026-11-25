import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {checkMacosArtifact,licenseFiles} from '../apps/tauri/scripts/check-macos-artifact.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
const read=path=>readFile(join(root,path),'utf8')
const json=async path=>JSON.parse(await read(path))
function merge(base,patch){
 const result={...base}
 for(const [key,value]of Object.entries(patch))result[key]=value&&typeof value==='object'&&!Array.isArray(value)?merge(base?.[key]||{},value):value
 return result
}
test('preview config isolates installer, process, profile and window identities on both platforms',async()=>{
 const dir='apps/tauri/src-tauri/'
 const base=await json(dir+'tauri.conf.json'),preview=await json(dir+'tauri.preview.conf.json')
 for(const os of ['windows','macos']){
  const platform=await json(dir+`tauri.${os}.conf.json`)
  const config=merge(merge(merge(base,platform),preview),await json(dir+`tauri.preview-${os}.conf.json`))
  assert.equal(config.version,'0.5.4-preview.1')
  assert.equal(config.productName,'fromd Preview')
  assert.equal(config.identifier,'com.frowang.fromd.preview')
  assert.notEqual(config.identifier,base.identifier) // Tauri data/cache/WebView identity.
  assert.equal(config.mainBinaryName,'fromd-preview') // NSIS process and executable isolation.
  assert.equal(config.app.windows.length,1)
  assert.deepEqual(config.app.windows[0],{...platform.app.windows[0],title:'fromd Preview'})
  assert.equal(config.bundle.createUpdaterArtifacts,false)
  assert.equal(config.build.beforeBuildCommand,'npm run build:preview')
  if(os==='windows'){
   assert.equal(config.bundle.windows.nsis.startMenuFolder,'fromd Preview')
   assert.equal(config.bundle.windows.nsis.installerHooks,'nsis/preview-hooks.nsh')
   const hook=await read(dir+config.bundle.windows.nsis.installerHooks)
   assert.doesNotMatch(hook,/ReadReg|DeleteReg|Delete\s|RMDir|installer-hooks\.nsh/)
   assert.match(hook,/IfFileExists "\$INSTDIR\\frowd-tauri\.exe"/)
   assert.match(hook,/\bAbort\b/)
  }else{
   assert.equal(config.bundle.macOS.signingIdentity,'-')
   assert.equal(config.bundle.macOS.bundleVersion,'0.5.4d1')
   assert.equal(config.bundle.macOS.infoPlist,'Info.preview.plist')
   const background=await readFile(join(root,dir,config.bundle.macOS.dmg.background))
   assert.equal(background.readUInt32BE(16),660);assert.equal(background.readUInt32BE(20),420)
   assert.match(await read(dir+'dmg/preview-background.svg'),/fromd Preview/)
  }
 }
})
test('preview macOS validator accepts the isolated app and rejects a stable identity or executable',async()=>{
 const output=join(root,'output/native-temp');await mkdir(output,{recursive:true})
 const temp=await mkdtemp(join(output,'preview-app-'))
 try{
  const app=join(temp,'fromd Preview.app'),contents=join(app,'Contents'),dmg=join(temp,'preview.dmg')
  await mkdir(join(contents,'MacOS'),{recursive:true});await mkdir(join(contents,'Resources/licenses'),{recursive:true})
  const fields={CFBundleName:'fromd Preview',CFBundleExecutable:'fromd-preview',CFBundleShortVersionString:'0.5.4',CFBundleVersion:'0.5.4d1',CFBundleIdentifier:'com.frowang.fromd.preview',LSMinimumSystemVersion:'11.0'}
  const plist=()=>`<?xml version="1.0"?><plist version="1.0"><dict>${Object.entries(fields).map(([k,v])=>`<key>${k}</key><string>${v}</string>`).join('')}</dict></plist>`
  await writeFile(join(contents,'Info.plist'),plist())
  const macho=Buffer.alloc(32);macho.writeUInt32LE(0xfeedfacf);macho.writeUInt32LE(0x0100000c,4);macho.writeUInt32LE(2,12)
  await writeFile(join(contents,'MacOS/fromd-preview'),macho);await writeFile(dmg,'synthetic dmg')
  for(const file of licenseFiles)await writeFile(join(contents,'Resources/licenses',file),'synthetic license')
  const options={app,dmg,arch:'aarch64',version:'0.5.4',bundleVersion:'0.5.4d1',identifier:'com.frowang.fromd.preview',name:'fromd Preview',executable:'fromd-preview'}
  const boundary={verifySignature:()=>({status:'not-run',reason:'synthetic fixture'})}
  assert.equal((await checkMacosArtifact(options,boundary)).identifier,options.identifier)
  for(const [key,value]of [['CFBundleIdentifier','com.frowang.frowd.tauri.v1'],['CFBundleExecutable','frowd-tauri'],['CFBundleVersion','0.5.4']]){
   const original=fields[key];fields[key]=value;await writeFile(join(contents,'Info.plist'),plist())
   await assert.rejects(checkMacosArtifact(options,boundary),new RegExp(key));fields[key]=original
  }
 }finally{await rm(temp,{recursive:true,force:true})}
})
