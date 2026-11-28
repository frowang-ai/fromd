
import {DOMParser as PMParser} from '@milkdown/kit/prose/model'
import {Transform} from '@milkdown/kit/prose/transform'
import {sanitizeHtml} from './markdown/sanitize.js'
import {normalizeWritingPastedMath} from './writingMathCompatibility.js'
import {MAX_DOCUMENT_BYTES,utf8Bytes} from './documentLimits.js'
function checkedText(text){if(utf8Bytes(text)>MAX_DOCUMENT_BYTES||text.includes('\0'))throw Error('导入最多 64 MiB UTF-8 文本。');return text}
const safeLink=url=>!url||url.startsWith('#')||/^(https?:|mailto:|tel:)/i.test(url)
function localReference(url,image){
 if(!url)return false
 if(!image&&safeLink(url))return false
 if(/^[a-z][a-z0-9+.-]*:|^[/\\]/i.test(url))throw Error('导入不读取远程/内嵌/绝对路径图片或文件，请改为源文件目录内的相对资源。')
 return true
}
// Only HTML a.href receives this normalization. Never apply it to TXT, image
// sources or filesystem references; do not let URL's permissive slash/control
// repair turn a local/UNC path into an unintended web address.
function htmlProtocolLink(href){
 if(!/^[\u0000-\u0020\u007f]*\/\//.test(href))return null
 const value=href.replace(/^ +| +$/g,'')
 const authority=/^\/\/([^/?#]+)/.exec(value)?.[1]
 const fail=()=>{throw Error('HTML 协议相对网页链接无效，请使用含有效主机的 https:// 地址。')}
 if(/[\\\u0000-\u001f\u007f]/.test(href)||!authority||value.startsWith('///')||/\s/.test(authority)||authority.endsWith(':'))return fail()
 let parsed
 try{parsed=new URL('https:'+value)}catch{return fail()}
 if(parsed.protocol!=='https:'||!parsed.hostname||/^\.+$/.test(parsed.hostname))return fail()
 return 'https:'+value
}
function references(doc){
 const found=new Map()
 doc.descendants(node=>{
  if(node.type.spec.code||node.marks.some(mark=>mark.type.spec.code))return false
  function add(reference,image){if(localReference(reference,image)){const old=found.get(reference);found.set(reference,{reference,image:image||Boolean(old?.image)})}}
  if(node.type.name==='image')add(node.attrs.src,true)
  for(const mark of node.marks)if(mark.type.name==='link')add(mark.attrs.href,false)
 })
 if(found.size>8)throw Error('HTML 一次最多导入 8 个不同的本地图片/附件。')
 return [...found.values()]
}
// Convert only detached content. No EditorView/state/history or active page API.
export function prepareFileImport(source,{schema,remark,parse,serialize}){
 if(!source||!['html','text'].includes(source.kind)||typeof source.content!=='string')throw Error('导入内容格式无效。')
 checkedText(source.content)
 if(source.kind==='text'){
  // Parse only to reject unresolved semantic resources; never serialize TXT.
  const doc=parse(source.content),refs=references(doc)
  if(refs.length)throw Error('TXT 含本地图片/附件引用；请改用 HTML 导入，或用插入图片/附件添加资源。')
  return {references:[],warnings:[],finish:()=>source.content}
 }
 const inert=document.createElement('template');inert.innerHTML=source.content
 for(const meta of inert.content.querySelectorAll('meta[charset],meta[http-equiv]')){
  const charset=meta.getAttribute('charset')||/charset\s*=\s*([^;\s]+)/i.exec(meta.getAttribute('content')||'')?.[1]
  const declared=charset?.replace(/^["']|["']$/g,'')
  if(declared&&!/^utf-?8$/i.test(declared))throw Error('HTML 声明了非 UTF-8 编码，请先另存为 UTF-8。')
 }
 if(inert.content.querySelector('base[href]'))throw Error('HTML 的 base 定位不受支持，请改为源文件目录内的相对资源后再导入。')
 const warnings=['HTML 已按 Markdown 基础结构导入；样式、字体与网页布局不保留。']
 const commentWalker=document.createTreeWalker(inert.content,128);let comments=0;while(commentWalker.nextNode())comments++
 if(comments)warnings.push('HTML 注释（'+comments+' 项）未导入，原文件保留。')
 const supported=new Set('html head body title meta base link p div span section article main header footer h1 h2 h3 h4 h5 h6 ul ol li blockquote strong b em i s del u mark kbd sub sup pre code br hr a img table thead tbody tfoot tr th td script style iframe object embed form video audio svg'.split(' '))
 const unknown=[...new Set([...inert.content.querySelectorAll('*')].filter(node=>!supported.has(node.tagName.toLowerCase())&&!node.closest('math')).map(node=>node.tagName.toLowerCase()))]
 if(unknown.length)warnings.push('部分 HTML 标签仅保留可转换内容：'+unknown.slice(0,12).join('、')+'。')
 const unsupported=inert.content.querySelectorAll('script,style,iframe,object,embed,form,video,audio,svg')
 if(unsupported.length)warnings.push('已忽略脚本、样式或不支持的嵌入/表单内容（'+unsupported.length+' 项）。')
 unsupported.forEach(node=>node.remove())
 inert.content.querySelectorAll('title,meta,base,link').forEach(node=>node.remove())
 // Validate before sanitizer so blocked images cannot silently disappear. A
 // template's contents are inert and never attached, so this makes no requests.
 for(const img of inert.content.querySelectorAll('img')){
  const src=img.getAttribute('src')||''
  if(!src)throw Error('HTML 图片缺少可用 src；请修复后重新导入。')
  localReference(src,true)
  for(const attr of [...img.attributes])if(!['src','alt','title'].includes(attr.name))img.removeAttribute(attr.name)
 }
 let removedLinks=0,completedProtocols=0
 for(const a of inert.content.querySelectorAll('a[href]')){
  let href=a.getAttribute('href')
  const completed=htmlProtocolLink(href)
  if(completed){href=completed;a.setAttribute('href',href);completedProtocols++}
  if(/^(javascript:|vbscript:|data:|blob:)/i.test(href.trim())){a.removeAttribute('href');removedLinks++;continue}
  localReference(href,false)
 }
 if(completedProtocols)warnings.push('已为 '+completedProtocols+' 个 HTML 协议相对网页链接补全 https:；路径、查询和片段保留。')
 if(removedLinks)warnings.push('已移除 '+removedLinks+' 个不安全链接地址，保留可见文字。')
 const normalized=normalizeWritingPastedMath(sanitizeHtml(inert.innerHTML),remark,document)
 const clean=document.createElement('template');clean.innerHTML=sanitizeHtml(normalized)
 const doc=PMParser.fromSchema(schema).parse(clean.content),refs=references(doc)
 return {references:refs,warnings,finish(resources=[]){
  if(resources.length!==refs.length)throw Error('导入资源校验数量不一致。')
  const mapping=new Map(refs.map((ref,i)=>{
   if(!/^\.frowd-assets\/[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(resources[i].reference)||Boolean(resources[i].image)!==ref.image)throw Error('导入资源登记无效。')
   return [ref.reference,resources[i].reference+(ref.reference.match(/[?#].*$/)?.[0]||'')]
  }))
  const tr=new Transform(doc)
  doc.descendants((node,pos)=>{
   if(node.type.name==='image'&&mapping.has(node.attrs.src))tr.setNodeMarkup(pos,undefined,{...node.attrs,src:mapping.get(node.attrs.src)})
   for(const mark of node.marks)if(mark.type.name==='link'&&mapping.has(mark.attrs.href)){
    tr.removeMark(pos,pos+node.nodeSize,mark);tr.addMark(pos,pos+node.nodeSize,mark.type.create({...mark.attrs,href:mapping.get(mark.attrs.href)}))
   }
  })
  return checkedText(serialize(tr.doc))
 }}
}
