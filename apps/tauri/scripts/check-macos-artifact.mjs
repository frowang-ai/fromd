import {readFile,stat} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {execFileSync} from 'node:child_process'

export const licenseFiles=['LICENSE','THIRD_PARTY_NOTICES.md','TAURI-THIRD-PARTY-NOTICES.md','LICENSE.SOLOMD','dependency-licenses.json','TAURI-LICENSE-MIT','TAURI-LICENSE-APACHE-2.0']
const fail=message=>{throw Error(message)}
function plistString(xml,key){
 const matches=[...xml.matchAll(new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([^<]*)</string>`,'g'))]
 if(matches.length!==1)fail(`Info.plist must contain one string ${key}`)
 return matches[0][1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'")
}
export function machoArchitecture(bytes){
 if(bytes.length<32)fail('Mach-O header is truncated')
 const magic=bytes.subarray(0,4).toString('hex')
 if(!['cffaedfe','feedfacf'].includes(magic))fail('Expected a thin 64-bit Mach-O executable')
 const uint=offset=>magic==='cffaedfe'?bytes.readUInt32LE(offset):bytes.readUInt32BE(offset)
 const arch=({[0x0100000c]:'aarch64',[0x01000007]:'x86_64'})[uint(4)]
 if(!arch||uint(12)!==2)fail('Unsupported Mach-O architecture or non-executable file type')
 return arch
}
async function nonempty(path){const s=await stat(path);if(!s.isFile()||!s.size)fail(`Missing or empty artifact: ${path}`);return s.size}
export async function checkMacosArtifact({app,dmg,arch,version='0.5.2',identifier='com.frowang.frowd.tauri.v1',minimumSystemVersion='11.0'}){
 if(!['aarch64','x86_64'].includes(arch))fail('arch must be aarch64 or x86_64')
 const contents=join(resolve(app),'Contents'),plistPath=join(contents,'Info.plist')
 const plist=await readFile(plistPath)
 let xml=plist.toString('utf8')
 if(plist.subarray(0,8).toString()==='bplist00'){
  if(process.platform!=='darwin')fail('Binary Info.plist requires macOS plutil; use XML plist for portable validation')
  xml=execFileSync('/usr/bin/plutil',['-convert','xml1','-o','-',plistPath],{encoding:'utf8'})
 }
 for(const [key,expected]of Object.entries({CFBundleShortVersionString:version,CFBundleIdentifier:identifier,LSMinimumSystemVersion:minimumSystemVersion})){
  const actual=plistString(xml,key);if(actual!==expected)fail(`${key}: expected ${expected}, got ${actual}`)
 }
 const executable=join(contents,'MacOS','frowd-tauri')
 const actualArch=machoArchitecture(await readFile(executable))
 if(actualArch!==arch)fail(`Mach-O architecture: expected ${arch}, got ${actualArch}`)
 for(const file of licenseFiles)await nonempty(join(contents,'Resources','licenses',file))
 const dmgBytes=await nonempty(resolve(dmg))
 return {app:resolve(app),dmg:resolve(dmg),version,identifier,minimumSystemVersion,arch:actualArch,licenses:licenseFiles.length,dmgBytes}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2),options={}
 try{
  for(let i=0;i<args.length;i+=2){if(!['--app','--dmg','--arch','--version'].includes(args[i])||!args[i+1])fail('Usage: --app path.app --dmg path.dmg --arch aarch64|x86_64 [--version 0.5.2]');options[args[i].slice(2)]=args[i+1]}
  if(!options.app||!options.dmg||!options.arch)fail('Required: --app, --dmg, --arch')
  console.log(JSON.stringify(await checkMacosArtifact(options),null,2))
 }catch(error){console.error(error.message);process.exitCode=1}
}
