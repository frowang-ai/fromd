import {readFile,stat} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {execFileSync,spawnSync} from 'node:child_process'

export const licenseFiles=['LICENSE','THIRD_PARTY_NOTICES.md','TAURI-THIRD-PARTY-NOTICES.md','LICENSE.SOLOMD','dependency-licenses.json','TAURI-LICENSE-MIT','TAURI-LICENSE-APACHE-2.0']
const fail=message=>{throw Error(message)}
function plistString(xml,key){
 const matches=[...xml.matchAll(new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([^<]*)</string>`,'g'))]
 if(matches.length!==1)fail(`Info.plist must contain one string ${key}`)
 return matches[0][1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'")
}
function thinSlice(bytes){
 if(bytes.length<32)fail('Mach-O header is truncated')
 const magic=bytes.subarray(0,4).toString('hex')
 if(!['cffaedfe','feedfacf'].includes(magic))fail('Expected a 64-bit Mach-O executable slice')
 const uint=offset=>magic==='cffaedfe'?bytes.readUInt32LE(offset):bytes.readUInt32BE(offset)
 const cpu=uint(4),subtype=uint(8),arch=({[0x0100000c]:'aarch64',[0x01000007]:'x86_64'})[cpu]
 if(!arch||uint(12)!==2)fail('Unsupported Mach-O architecture or non-executable file type')
 if(!(arch==='aarch64'?[0,1,2]:[3,8]).includes(subtype&0x00ffffff))fail('Unsupported Mach-O CPU subtype')
 if(uint(20)>bytes.length-32)fail('Mach-O load commands exceed slice bounds')
 return {arch,cpu,subtype}
}
export function machoArchitectures(bytes){
 if(bytes.length<8)fail('Mach-O header is truncated')
 const magic=bytes.subarray(0,4).toString('hex')
 // Only the standard FAT header with 32-bit offsets is parsed (not FAT64).
 if(['cafebabf','bfbafeca'].includes(magic))fail('FAT64 is unsupported; expected standard 32-bit-offset FAT')
 if(!['cafebabe','bebafeca'].includes(magic))return [thinSlice(bytes).arch]
 const uint=offset=>magic==='cafebabe'?bytes.readUInt32BE(offset):bytes.readUInt32LE(offset)
 const count=uint(4),tableEnd=8+count*20
 if(!count||tableEnd>bytes.length)fail('FAT Mach-O architecture table is truncated or empty')
 const slices=[],identities=new Set()
 for(let index=0;index<count;index++){
  const at=8+index*20,cpu=uint(at),subtype=uint(at+4),offset=uint(at+8),size=uint(at+12),alignment=uint(at+16)
  if(offset<tableEnd||size<32||offset+size>bytes.length)fail('FAT Mach-O slice exceeds file bounds')
  if(alignment>31||offset%(2**alignment)!==0)fail('Invalid FAT Mach-O slice alignment')
  const slice=thinSlice(bytes.subarray(offset,offset+size))
  if(slice.cpu!==cpu||slice.subtype!==subtype)fail('FAT Mach-O architecture/subtype does not match slice header')
  const identity=cpu+':'+subtype
  if(identities.has(identity))fail('Duplicate FAT Mach-O architecture/subtype')
  identities.add(identity);slices.push({...slice,offset,end:offset+size})
 }
 slices.sort((a,b)=>a.offset-b.offset)
 for(let i=1;i<slices.length;i++)if(slices[i].offset<slices[i-1].end)fail('FAT Mach-O slices overlap')
 // Preserve slice count even when distinct CPU subtypes share one architecture.
 return slices.map(slice=>slice.arch).sort()
}
export function machoArchitecture(bytes){
 const architectures=machoArchitectures(bytes)
 return architectures.length===1?architectures[0]:'universal'
}
// Verification never re-signs an app. Gatekeeper/notarization is a separate policy check.
export function checkMacosSignature(app,{platform=process.platform,run=spawnSync}={}){
 if(platform!=='darwin')return {status:'not-run',reason:'codesign requires macOS'}
 const result=run('/usr/bin/codesign',['--verify','--deep','--strict','--all-architectures','--verbose=2',resolve(app)],{encoding:'utf8',timeout:120000})
 if(result.error)fail(`codesign verification could not run: ${result.error.message}`)
 if(result.status!==0)fail(`codesign verification failed (exit ${result.status ?? result.signal}): ${(result.stderr||result.stdout||'no diagnostic output').trim()}`)
 return {status:'verified',details:(result.stderr||result.stdout||'').trim()}
}
async function nonempty(path){const s=await stat(path);if(!s.isFile()||!s.size)fail(`Missing or empty artifact: ${path}`);return s.size}
export async function checkMacosArtifact({app,dmg,arch,version='0.5.5',identifier='com.frowang.frowd.tauri.v1',minimumSystemVersion='11.0'},{verifySignature=checkMacosSignature}={}){
 if(arch==='arm64')arch='aarch64'
 if(!['aarch64','x86_64','universal'].includes(arch))fail('arch must be aarch64, arm64, x86_64 or universal')
 const contents=join(resolve(app),'Contents'),plistPath=join(contents,'Info.plist')
 if(process.platform==='darwin')execFileSync('/usr/bin/plutil',['-lint',plistPath],{encoding:'utf8',stdio:['ignore','pipe','pipe']})
 const plist=await readFile(plistPath)
 let xml=plist.toString('utf8')
 if(plist.subarray(0,8).toString()==='bplist00'){
  if(process.platform!=='darwin')fail('Binary Info.plist requires macOS plutil; use XML plist for portable validation')
  xml=execFileSync('/usr/bin/plutil',['-convert','xml1','-o','-',plistPath],{encoding:'utf8'})
 }
 for(const [key,expected]of Object.entries({CFBundleName:'fromd',CFBundleExecutable:'frowd-tauri',CFBundleShortVersionString:version,CFBundleIdentifier:identifier,LSMinimumSystemVersion:minimumSystemVersion})){
  const actual=plistString(xml,key);if(actual!==expected)fail(`${key}: expected ${expected}, got ${actual}`)
 }
 const executable=join(contents,'MacOS','frowd-tauri')
 const architectures=machoArchitectures(await readFile(executable))
 const actualArch=architectures.length===1?architectures[0]:'universal'
 const expected=arch==='universal'?['aarch64','x86_64']:[arch]
 if(architectures.length!==expected.length||!expected.every((value,index)=>architectures[index]===value))fail(`Mach-O architecture: expected exactly ${expected.join(', ')}, got ${architectures.join(', ')}`)
 for(const file of licenseFiles)await nonempty(join(contents,'Resources','licenses',file))
 const dmgBytes=await nonempty(resolve(dmg))
 const signature=verifySignature(resolve(app))
 return {app:resolve(app),dmg:resolve(dmg),version,identifier,minimumSystemVersion,arch:actualArch,architectures,licenses:licenseFiles.length,dmgBytes,signature}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2),options={}
 try{
  for(let i=0;i<args.length;i+=2){if(!['--app','--dmg','--arch','--version'].includes(args[i])||!args[i+1])fail('Usage: --app path.app --dmg path.dmg --arch aarch64|arm64|x86_64|universal [--version 0.5.5]');options[args[i].slice(2)]=args[i+1]}
  if(!options.app||!options.dmg||!options.arch)fail('Required: --app, --dmg, --arch')
  console.log(JSON.stringify(await checkMacosArtifact(options),null,2))
 }catch(error){console.error(error.message);process.exitCode=1}
}
