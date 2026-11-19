// Test-only in-memory native IPC double. It is never imported by the application.
export function installMockHost(options = {}) {
 const text=options.markdown??'# 合成文稿\n\n这是一段合成中文，只用于验证页面编辑。\n\n## 同名标题\n\n第一节。\n\n| 项目 | 内容 |\n| --- | --- |\n| 样例 | 可视化表格待独立验收 |\n\n## 同名标题\n\n第二节。\n';
 const rows=new Map((options.documents??[
 {id:'a',title:'方案讨论',markdown:text,shelved:false},
 {id:'b',title:'公式推导',markdown:'# 第二篇\n\n数学 $x^2$ 与代码。',shelved:false},
 {id:'c',title:'阅读摘录',markdown:'收起页合成内容',shelved:true}
 ]).map((d,position)=>[d.id,{path:null,revision:0,position,dirty:false,conflict:false,viewState:null,...d,savedText:d.path?d.markdown:'',preview:d.markdown.slice(0,1200)}]));
 let activeId=options.activeId??'a',layoutRevision=0,counter=10,removed=null,callbacks=[];
 const h={rows,externalTexts:new Map(),calls:[],holds:new Set(),gates:new Map(),entered:{},fail:null,saveChoice:'save',openChoice:null,closed:false};
 h.importChoice=null;h.importSources=new Map();h.pendingImport=null;
 h.objects=new Map(options.objects||[]);h.bindings=new Map((options.bindings||[]).map(([id,refs])=>[id,new Set(refs)]));h.resourceChoice=null;
 h.resourceUrl=(id,reference)=>{const object=h.objects.get(reference);return h.bindings.get(id)?.has(reference)&&object?'data:'+object.mime+';base64,'+object.base64:null};
 const snapshot=()=>({documents:[...rows.values()].sort((a,b)=>a.position-b.position).map(({markdown,savedText,...d})=>({...d,dirty:markdown!==savedText})),activeId,layoutRevision,undoRemoval:removed?.doc.title??null});
 h.release=command=>{h.holds.delete(command);h.gates.get(command)?.();h.gates.delete(command)};
 h.onClose=fn=>{callbacks.push(fn);return()=>callbacks=callbacks.filter(c=>c!==fn)};
 h.requestClose=async()=>{for(const fn of callbacks)await fn()};
 h.snapshot=snapshot;
 h.invoke=async(command,args={})=>{
  h.calls.push({command,args:structuredClone(args)});h.entered[command]=(h.entered[command]??0)+1;
  if(h.holds.has(command))await new Promise(resolve=>h.gates.set(command,resolve));
  if(h.fail===command)throw Error('合成写入失败');
  const doc=rows.get(args.id);
  switch(command){
   case 'pdf_images':{
    if(!doc||doc.revision!==args.revision)throw Error('PDF 文稿版本已变化');
    // Typed inline fixture echo only; real byte/decoder limits belong to Rust
    // and the native PDF regression, not this in-memory service double.
    const images={};for(const reference of args.references){const url=/^data:image\/(png|jpeg|gif|webp);base64,/i.test(reference)?reference:h.resourceUrl(args.id,reference);if(!url)throw Error('PDF 图片不可用');images[reference]=url}return images;
   }
   case 'export_pdf':{
    if(!doc||doc.revision!==args.revision)throw Error('PDF 文稿版本已变化');
    return {cancelled:Boolean(h.pdfCancelled)};
   }

   case 'choose_document_import':{
    const choice=h.importChoice;if(!choice)return {cancelled:true};
    const bytes=new Uint8Array(choice.bytes),bom=bytes[0]===239&&bytes[1]===187&&bytes[2]===191;
    if(bytes.length>10*1024*1024)throw Error('导入最多 10 MiB UTF-8 文本。');
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw Error('文件不是 UTF-8 编码。请先以 UTF-8 保存再导入。')}
    if(text.includes('\0'))throw Error('导入内容含 NUL。');
    const source={token:'imported-'+counter++,title:choice.name.replace(/\.(txt|html?)$/i,''),kind:/\.txt$/i.test(choice.name)?'text':'html',content:text.replace(/\r\n?/g,'\n'),bom,eol:text.includes('\r\n')?'\r\n':'\n'};
    h.pendingImport={source,assets:null};return {cancelled:false,source:structuredClone(source)};
   }
   case 'prepare_document_import_resources':{
    const pending=h.pendingImport;if(!pending||pending.source.token!==args.token)throw Error('导入来源已过期');
    pending.assets=null;if(args.references.length>8)throw Error('最多 8 个资源');
    const assets=[];
    for(const ref of args.references){
     const path=decodeURIComponent(ref.reference.split(/[?#]/)[0]);
     if(path.startsWith('/')||path.includes(':')||path.split(/[\\/]/).includes('..'))throw Error('导入资源越界');
     const bytes=h.importSources.get(path);if(!bytes)throw Error('导入资源缺失：'+ref.reference);
     if(ref.image&&!(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71))throw Error('图片只支持真实 PNG/JPEG/GIF/WebP');
     const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(b=>b.toString(16).padStart(2,'0')).join('');
     const ext=ref.image?'png':path.split('.').pop().replace(/[^a-z0-9]/ig,'').slice(0,8)||'bin',reference='.frowd-assets/'+hash+'.'+ext;
     let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
     assets.push({reference,image:ref.image,name:path,base64:btoa(binary),mime:ref.image?'image/png':'application/octet-stream'});
    }
    pending.assets=assets;return structuredClone(assets);
   }
   case 'commit_document_import':{
    if(rows.has(args.token)){if(rows.get(args.token).markdown!==args.markdown)throw Error('导入回执不一致');return snapshot()}
    const pending=h.pendingImport;if(!pending||pending.source.token!==args.token||!pending.assets)throw Error('导入来源未准备');
    const id=args.token;const d={id,title:pending.source.title,path:null,markdown:args.markdown,revision:0,position:rows.size,shelved:false,viewState:null,savedText:'',conflict:false,preview:args.markdown.slice(0,1200),bom:pending.source.bom,eol:pending.source.eol};
    const refs=new Set();for(const asset of pending.assets){h.objects.set(asset.reference,asset);refs.add(asset.reference)}h.bindings.set(id,refs);
    rows.set(id,d);activeId=id;layoutRevision++;h.pendingImport=null;if(h.importLostAck){h.importLostAck=false;throw Error('合成回执丢失')}return snapshot();
   }
   case 'reuse_resources':{
    if(!doc||args.purpose!=='clipboard-paste'||!args.references.length||args.references.length>256)throw Error('资源粘贴授权无效')
    for(const item of args.references){
     if(!/^\.frowd-assets\/[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(item.reference)||!h.objects.has(item.reference)||![...h.bindings.values()].some(set=>set.has(item.reference)))throw Error('资源不在本资料目录登记或不可用，请重新导入图片或附件。')
    }
    if(!h.bindings.has(doc.id))h.bindings.set(doc.id,new Set())
    for(const item of args.references)h.bindings.get(doc.id).add(item.reference)
    return
   }
   case 'import_resources':{
    if(!doc)throw Error('page removed')
    const result=[];let offset=0
    for(const item of args.metadata){
     const bytes=new Uint8Array(args.payload.slice(offset,offset+item.size));offset+=item.size
     const digest=await crypto.subtle.digest('SHA-256',bytes),hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')
     const ext=item.image?'png':(item.name.split('.').pop().replace(/[^a-z0-9]/ig,'').slice(0,8)||'bin')
     const reference='.frowd-assets/'+hash+'.'+ext
     let binary='';for(const b of bytes)binary+=String.fromCharCode(b)
     h.objects.set(reference,{reference,base64:btoa(binary),mime:item.image?'image/png':'application/octet-stream'})
     if(!h.bindings.has(doc.id))h.bindings.set(doc.id,new Set())
     h.bindings.get(doc.id).add(reference)
     result.push({id:hash,reference,name:item.name,mime:item.image?'image/png':'application/octet-stream',size:item.size,image:item.image})
    }
    return {cancelled:false,resources:result}
   }
   case 'choose_resources':{
    if(!h.resourceChoice)return {cancelled:true}
    return h.invoke('import_resources',{id:args.id,...h.resourceChoice})
   }
   case 'search_documents':{
    const fold=t=>t.replace(/[A-Z]/g,c=>c.toLowerCase()),query=args.query.trim(),results=[];
    for(const d of [...rows.values()].sort((a,b)=>a.position-b.position)){
     const index=fold(d.markdown).indexOf(fold(query));
     if(index<0&&!fold(d.title).includes(fold(query)))continue;
     const prefix=d.markdown.slice(0,index),location=index<0?null:{line:prefix.split('\n').length,column:[...prefix.slice(prefix.lastIndexOf('\n')+1)].length,length:[...query].length,needle:query};
     results.push({id:d.id,title:d.title,shelved:d.shelved,revision:d.revision,location,snippet:d.markdown.slice(Math.max(0,index-30),Math.max(0,index)+160)});
     if(results.length===100)break;
    }
    return results;
   }
   case 'reorder_documents':{
    const ordered=[...rows.values()].sort((a,b)=>a.position-b.position),visible=ordered.filter(d=>!d.shelved).map(d=>d.id);
    if(args.layoutRevision!==layoutRevision||args.ids.length!==visible.length||new Set(args.ids).size!==visible.length||args.ids.some(id=>!visible.includes(id)))throw Error('页面布局已变化，请刷新后再排序。');
    let index=0;const next=ordered.map(d=>d.shelved?d.id:args.ids[index++]);next.forEach((id,position)=>rows.get(id).position=position);
    layoutRevision++;return snapshot();
   }
   case 'list_metadata':return snapshot();
   case 'read_document':{
    if(!doc)throw Error('page removed');
    // Synthetic check_external: refresh a clean file on read, retain dirty local edits.
    if(doc.path&&h.externalTexts.has(doc.id)){
     if(doc.markdown!==doc.savedText)doc.conflict=true;
     else {doc.markdown=h.externalTexts.get(doc.id);doc.savedText=doc.markdown;doc.preview=doc.markdown.slice(0,1200);doc.revision++;h.externalTexts.delete(doc.id)}
    }
    return {...doc,dirty:doc.markdown!==doc.savedText};
   }
   case 'create_document':{
    const id='new-'+counter++;rows.set(id,{id,title:args.title,path:null,markdown:args.markdown,revision:0,position:rows.size,shelved:false,viewState:null,savedText:'',conflict:false,preview:''});activeId=id;layoutRevision++;return snapshot();
   }
   case 'update_document':if(!doc)throw Error('page removed');if(args.revision<doc.revision||args.revision>doc.revision+1||args.revision===doc.revision&&args.markdown!==doc.markdown)throw Error('revision conflict');Object.assign(doc,{markdown:args.markdown,revision:args.revision,preview:args.markdown.slice(0,1200)});return snapshot();
   case 'rename_document':if(!doc||doc.path)throw Error('file name locked');doc.title=args.title.trim()||'未命名笔记';return snapshot();
   case 'set_view_state':if(!doc)throw Error('page removed');doc.viewState=args.viewState;return snapshot();
   case 'activate_document':if(!doc)throw Error('page removed');doc.shelved=false;activeId=doc.id;layoutRevision++;return snapshot();
   case 'shelve_document':{
    if(!doc)throw Error('page removed');doc.shelved=true;
    if(activeId===doc.id){const visible=[...rows.values()].filter(d=>!d.shelved);activeId=visible.find(d=>d.position>doc.position)?.id??visible.at(-1)?.id??null}layoutRevision++;return snapshot();
   }
   case 'expand_all':for(const d of rows.values())d.shelved=false;activeId??=[...rows.keys()][0]??null;layoutRevision++;return snapshot();
   case 'shelve_others':for(const d of rows.values())d.shelved=d.id!==args.id;activeId=args.id;layoutRevision++;return snapshot();
   case 'shelve_all':for(const d of rows.values())d.shelved=true;activeId=null;layoutRevision++;return snapshot();
   case 'remove_document':{
    removed={doc:structuredClone(doc),wasActive:activeId===doc.id};rows.delete(doc.id);if(activeId===doc.id)activeId=[...rows.values()].find(d=>!d.shelved)?.id??null;layoutRevision++;return snapshot();
   }
   case 'undo_remove':{
    if(removed){const id='undo-'+counter++;rows.set(id,{...removed.doc,id});h.bindings.set(id,new Set(h.bindings.get(removed.doc.id)||[]));if(!removed.doc.shelved&&(removed.wasActive||!activeId))activeId=id;removed=null;layoutRevision++;}return snapshot();
   }
   case 'save_document':if(h.saveChoice==='cancel')return{cancelled:true};if(h.saveChoice==='fail')throw Error('合成文件保存失败');doc.path??='/synthetic/'+doc.title+'.md';doc.savedText=doc.markdown;return{cancelled:false,snapshot:snapshot()};
   case 'open_document':return{cancelled:true};
   case 'checkpoint':return;
   case 'close_ready':h.closed=true;h.frozenAtClose=document.querySelector('.ProseMirror')?.getAttribute('contenteditable')==='false';return;
   case 'cancel_close':h.closed=false;return;
   case 'open_document_link':return;
   default:throw Error('Unexpected command '+command);
  }
 };
 window.__FROWD_TEST_HOST__=h;
}
