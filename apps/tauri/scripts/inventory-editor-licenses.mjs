// Installed dependency metadata only. No network, profiles or global directories.
import {readFileSync,existsSync,realpathSync,writeFileSync} from 'node:fs'
import {dirname,resolve,relative} from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..'),root=resolve(app,'../..')
const read=file=>JSON.parse(readFileSync(file,'utf8'))
function license(pkg,file){
 if(pkg.license)return pkg.license
 // Some runtime packages omit SPDX metadata but include their MIT license.
 for(const name of ['license','LICENSE','LICENSE.md']){
  const path=resolve(dirname(file),name)
  if(existsSync(path)&&/^(?:The )?MIT License\b/.test(readFileSync(path,'utf8').trim()))return 'MIT'
 }
 return 'unspecified'
}
function locate(name,from){
 for(const base of createRequire(from).resolve.paths(name)||[]){
  const file=resolve(base,name,'package.json')
  if(file.toLowerCase().startsWith(root.toLowerCase())&&existsSync(file))return realpathSync(file)
 }
 return null
}
const seen=new Set(),packages=[],missing=[]
function visit(name,from,kind){
 const file=locate(name,from);if(!file){missing.push({name,kind});return null}
 const pkg=read(file),key=pkg.name+'@'+pkg.version
 if(seen.has(key))return pkg
 seen.add(key);packages.push({name:pkg.name,version:pkg.version,license:license(pkg,file),kind,location:relative(root,dirname(file)).split('\\').join('/')})
 for(const child of Object.keys(pkg.dependencies||{}))visit(child,file,kind)
 return pkg
}
const manifest=resolve(app,'package.json'),pkg=read(manifest),direct={}
for(const [kind,deps]of [['runtime',pkg.dependencies],['build/test',pkg.devDependencies]])
 for(const name of Object.keys(deps||{})){
  const info=visit(name,manifest,kind);if(info)direct[name]={kind,version:info.version,license:info.license||'unspecified'}
 }
writeFileSync(resolve(app,'dependency-licenses.json'),JSON.stringify({
 scope:'Installed PM candidate graph, including linked shared editor and build/test tools; not every package ships. Root npm lock fixes shared dependencies, app pnpm lock fixes the host.',
 platformFoundation:'SoloMD v5.0.21 / 0b30523c70387b046018f857c7bf90bcdc40f54c',
 editor:'frowd shared Milkdown/ProseMirror; text-first strategy based on the verified 20261115 experiment',
 direct,packages:packages.sort((a,b)=>(a.name+a.version).localeCompare(b.name+b.version)),missing
},null,2)+'\n')
console.log(JSON.stringify({packages:packages.length,missing}))
