import { isPersistentResource } from '@frowang/editor/resources'

export const MAX_IMAGE_BYTES=10*1024*1024,MAX_ATTACHMENT_BYTES=25*1024*1024,MAX_IMPORT_BYTES=50*1024*1024
export function relativeImage(reference){
 if(typeof reference!=='string'||!reference||reference.length>4096)return false
 try{
  const path=decodeURIComponent(reference.split(/[?#]/)[0]).replaceAll('\\','/')
  return Boolean(path)&&!/^\/|:|[\0-\x1f\x7f]/.test(path)&&!path.split('/').includes('..')
 }catch{return false}
}
export async function resourcePacket(files,kind='auto'){
 if(!['auto','image','attachment'].includes(kind))throw Error('未知资源类型。')
 if(!files.length||files.length>8)throw Error('每批最多 8 个资源。')
 let total=0
 const metadata=Array.from(files,file=>{
  const image=kind==='image'||kind==='auto'&&(/^image\//i.test(file.type)||/\.(png|jpe?g|gif|webp|svg)$/i.test(file.name))
  if(!Number.isSafeInteger(file.size)||file.size<0||file.size>(image?MAX_IMAGE_BYTES:MAX_ATTACHMENT_BYTES))throw Error(image?'图片最多 10 MiB。':'附件最多 25 MiB。')
  total+=file.size
  return {name:[...file.name].slice(0,120).join(''),size:file.size,image}
 })
 if(total>MAX_IMPORT_BYTES)throw Error('每批资源合计最多 50 MiB。')
 const payload=new Uint8Array(total);let offset=0
 for(const file of files){const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size)throw Error('读取期间文件长度变化。');payload.set(bytes,offset);offset+=bytes.length}
 return {metadata,payload}
}
export function resourceMarkdown(resources){
 return resources.map(item=>{
  if(!isPersistentResource(item.reference))throw Error('资源登记返回了无效持久引用。')
  const label=item.name.replace(/[\\`*_[\]<>!~&$]/g,c=>'\\'+c).replace(/[\r\n]/g,' ')
  return (item.image?'!':'')+'['+label+']('+item.reference+')'
 }).join(' ')
}
