// A clipboard gesture may reuse only canonical, already-managed profile objects.
// These are references in parsed Markdown/PM nodes, never a free-text scan.
const managed=/^(?:\.\/)?\.frowd-assets\/([a-f0-9]{64}\.[a-z0-9]{1,8})(?:[?#].*)?$/
function add(map,value,image){
 if(typeof value!=='string')return
 if(/^(?:blob:|frowd-resource:|https?:\/\/frowd-resource\.localhost(?:[/:]|$))/i.test(value))throw Error('剪贴板含临时图片/展示地址，请复制完整 Markdown 或重新导入资源。')
 if(!/^(?:\.\/)?\.frowd-assets\//.test(value))return
 const match=managed.exec(value)
 if(!match)throw Error('受管资源引用无效，请重新导入图片或附件。')
 const reference='.frowd-assets/'+match[1],previous=map.get(reference)
 map.set(reference,{reference,image:image||Boolean(previous?.image)})
 if(map.size>256)throw Error('一次粘贴最多复用 256 个不同资源。')
}
export function sliceResources(slice){
 const map=new Map()
 slice.content.descendants(node=>{
  if(node.type.spec.code||node.marks.some(mark=>mark.type.spec.code))return false
  if(node.type.name==='image')add(map,node.attrs.src,true)
  for(const mark of node.marks)if(mark.type.name==='link')add(map,mark.attrs.href,false)
 })
 return [...map.values()]
}
function markdownNodes(tree){
 const nodes=[],definitions=new Map()
 function define(node){if(node.type==='definition')definitions.set(node.identifier,node.url);node.children?.forEach(define)}
 define(tree)
 function visit(node){
  if(['code','inlineCode','html'].includes(node.type))return
  if(node.type==='image'||node.type==='link')nodes.push(node)
  if((node.type==='imageReference'||node.type==='linkReference')&&definitions.has(node.identifier))nodes.push({...node,type:node.type==='imageReference'?'image':'link',url:definitions.get(node.identifier)})
  node.children?.forEach(visit)
 }
 visit(tree);return nodes
}
export function markdownResources(tree,{from=0,to=Infinity}={}){
 const map=new Map()
 for(const node of markdownNodes(tree)){
  const start=node.position?.start.offset,end=node.position?.end.offset
  if(start!=null&&end!=null&&(end<=from||start>=to))continue
  add(map,node.url,node.type==='image')
 }
 return [...map.values()]
}
export function markdownPasteResources(before,after,{from,to}){
 const old=new Set(markdownNodes(before).map(node=>node.type+':'+node.url)),map=new Map()
 for(const node of markdownNodes(after)){
  const start=node.position?.start.offset,end=node.position?.end.offset
  const touched=start==null||end==null||start<to&&end>from
  // Adding a reference definition can resolve an earlier label outside the
  // pasted character range. Adopt that new semantic target, not other old refs.
  if(touched||!old.has(node.type+':'+node.url))add(map,node.url,node.type==='image')
 }
 return [...map.values()]
}
