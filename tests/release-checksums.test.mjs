import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {releaseChecksums} from '../scripts/release-checksums.mjs'
const output=fileURLToPath(new URL('../output/native-temp/',import.meta.url))
test('release checksums cover exact renamed Windows/macOS archive names with no stale manifest entries',async()=>{
 await mkdir(output,{recursive:true});const dir=await mkdtemp(join(output,'release-sums-'))
 try{
  const files=['fromd_0.5.2_x64-setup.exe','fromd_0.5.2_aarch64.dmg','fromd_0.5.2_x64.dmg','fromd-0.5.2-aarch64.app.zip','fromd-0.5.2-x86_64.app.zip']
  for(const file of files)await writeFile(join(dir,file),'synthetic-'+file)
  await writeFile(join(dir,'SHA256SUMS.txt'),'stale checksum')
  await writeFile(join(dir,'installer.part'),'partial file')
  assert.deepEqual(await releaseChecksums(dir),files.sort())
  const expected=files.map(file=>createHash('sha256').update('synthetic-'+file).digest('hex')+'  '+file).join('\n')+'\n'
  assert.equal(await readFile(join(dir,'SHA256SUMS.txt'),'utf8'),expected)
  await writeFile(join(dir,files[0]),'');await assert.rejects(releaseChecksums(dir),/Empty release asset/)
 }finally{await rm(dir,{recursive:true,force:true})}
})
