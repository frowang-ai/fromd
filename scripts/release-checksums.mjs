import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {readdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'

// One release manifest for the files in this archive, using the exact asset names.
export async function releaseChecksums(directory){
 const root=resolve(directory)
 const names=(await readdir(root,{withFileTypes:true}))
  .filter(entry=>entry.isFile()&&/^fromd(?:_\d+\.\d+\.\d+_(?:x64-setup\.exe|(?:aarch64|x64)\.dmg)|-\d+\.\d+\.\d+-(?:aarch64|x86_64)\.app\.zip)$/.test(entry.name))
  .map(entry=>entry.name).sort()
 if(!names.length)throw Error('No fromd release assets in '+root)
 const lines=[]
 for(const name of names){
  const hash=createHash('sha256');let size=0
  for await(const chunk of createReadStream(join(root,name))){hash.update(chunk);size+=chunk.length}
  if(!size)throw Error('Empty release asset: '+name)
  lines.push(hash.digest('hex')+'  '+name)
 }
 await writeFile(join(root,'SHA256SUMS.txt'),lines.join('\n')+'\n','utf8')
 return names
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(!process.argv[2])throw Error('Usage: node scripts/release-checksums.mjs <artifact-directory>')
 console.log((await releaseChecksums(process.argv[2])).join('\n'))
}
