// Test-only in-memory native IPC double. It is never imported by the application.
export function installMockHost(options = {}) {
 const text=options.markdown??'# 合成文稿\n\n这是一段合成中文，只用于验证页面编辑。\n\n## 同名标题\n\n第一节。\n\n| 项目 | 内容 |\n| --- | --- |\n| 样例 | 可视化表格待独立验收 |\n\n## 同名标题\n\n第二节。\n';
 const rows=new Map((options.documents??[
 {id:'a',title:'方案讨论',markdown:text,shelved:false},
 {id:'b',title:'公式推导',markdown:'# 第二篇\n\n数学 $x^2$ 与代码。',shelved:false},
 {id:'c',title:'阅读摘录',markdown:'收起页合成内容',shelved:true}
 ]).map((d,position)=>[d.id,{path:null,revision:0,position,dirty:false,conflict:false,viewState:null,...d,savedText:d.path?d.markdown:'',preview:d.markdown.slice(0,1200)}]));
 let activeId=Object.hasOwn(options,'activeId')?options.activeId:'a',layoutRevision=0,counter=10,removed=null,callbacks=[];
 const h={rows,externalTexts:new Map((options.missingFiles||[]).map(id=>[id,null])),calls:[],holds:new Set(options.holds||[]),gates:new Map(),entered:{},fail:null,saveChoice:'save',openChoice:null,closed:false};
 h.updateResult=options.updateResult??{currentVersion:'0.5.2',version:'0.6.0',platform:'windows'};
 const updateListeners=new Set();
 h.onUpdateProgress=callback=>{updateListeners.add(callback);return()=>updateListeners.delete(callback)};
 h.updateProgress=(downloaded,total)=>{for(const callback of updateListeners)callback({downloaded,total})};
 h.importChoice=null;h.importSources=new Map();h.pendingImport=null;
 h.objects=new Map(options.objects||[]);h.bindings=new Map((options.bindings||[]).map(([id,refs])=>[id,new Set(refs)]));h.resourceChoice=null;
 h.localResources=new Map(options.localResources||[]);
 const localKey=(doc,ref)=>doc?.path?.replace(/[^/]+$/,'')+ref;
 h.resourceUrl=(id,reference)=>{
  const object=h.bindings.get(id)?.has(reference)?h.objects.get(reference):h.localResources.get(localKey(rows.get(id),reference));
  return object?'data:'+object.mime+';base64,'+object.base64:null;
 };
 const snapshot=()=>({documents:[...rows.values()].sort((a,b)=>a.position-b.position).map(({markdown,savedText,...d})=>({...d,dirty:markdown!==savedText})),activeId,layoutRevision,undoRemoval:removed?.doc.title??null});
 h.release=command=>{h.holds.delete(command);h.gates.get(command)?.();h.gates.delete(command)};
 h.closeListenerReady=false;h.closePending=false;h.closeDispatched=false;
 h.onClose=async fn=>{
  h.entered.close_listener=(h.entered.close_listener||0)+1;
  if(h.holds.has('close_listener'))await new Promise(resolve=>h.gates.set('close_listener',resolve));
  callbacks.push(fn);return()=>callbacks=callbacks.filter(c=>c!==fn);
 };
 h.requestClose=async()=>{
  h.closePending=true;
  if(!h.closeListenerReady||h.closeDispatched)return;
  h.closeDispatched=true;for(const fn of callbacks)await fn();
 };
 h.snapshot=snapshot;
 // Synthetic platform open queue: Open With / Dock / second instance push
 // {path} or {error}; window drops are matched by name/size against dropSource,
 // the stand-in for the drag pasteboard / WebView2 File paths. No real disk.
 h.disk=new Map(options.disk||[]);h.pendingOpen=[...(options.pendingOpen||[])];h.dropSource=options.dropSource??null;
 const openListeners=new Set();
 h.onOpenRequest=callback=>{openListeners.add(callback);return()=>openListeners.delete(callback)};
 h.requestOpen=entries=>{h.pendingOpen.push(...entries);for(const callback of openListeners)callback()};
 h.invoke=async(command,args={})=>{
  h.calls.push({command,args:structuredClone(args)});h.entered[command]=(h.entered[command]??0)+1;
  if(h.holds.has(command))await new Promise(resolve=>h.gates.set(command,resolve));
  if(h.fail===command)throw Error('合成写入失败');
  const doc=rows.get(args.id);
  switch(command){
   case 'check_updates':return structuredClone(h.updateResult);
   case 'download_update':h.updateProgress(8,8);h.updateDownloaded=true;return;
   case 'install_update':{
    if(!h.updateDownloaded)throw Error('安装包未下载');
    h.frozenAtUpdate=document.querySelector('.ProseMirror')?.getAttribute('contenteditable')==='false';
    h.installedSnapshot={rows:structuredClone([...rows.values()]),bindings:structuredClone([...h.bindings]),objects:structuredClone([...h.objects])};
    h.closed=true;return;
   }
   case 'open_update_page':h.updatePageOpened=true;return;
   case 'pdf_images':{
    if(!doc||doc.revision!==args.revision)throw Error('PDF 文稿版本已变化');
    // Typed inline fixture echo only; real byte/decoder limits belong to Rust
    // and the native PDF regression, not this in-memory service double.
    const images={};for(const reference of args.references){const url=/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(reference)?reference:h.resourceUrl(args.id,reference);if(!url)throw Error('PDF 图片不可用');images[reference]=url}return images;
   }
   case 'export_pdf':{
    if(!doc||doc.revision!==args.revision)throw Error('PDF 文稿版本已变化');
    return {cancelled:Boolean(h.pdfCancelled)};
   }

   case 'choose_document_import':{
    const choice=h.importChoice;if(!choice)return {cancelled:true};
    const bytes=new Uint8Array(choice.bytes),bom=bytes[0]===239&&bytes[1]===187&&bytes[2]===191;
    if(bytes.length>64*1024*1024)throw Error('导入最多 64 MiB UTF-8 文本。');
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
   case 'copy_document_images':{
    const source=rows.get(args.sourceId);
    if(!doc||!source?.path||source.path!==args.sourcePath)throw Error('来源文稿路径已变化，请重新复制图片。');
    const sameDirectory=doc.path&&localKey(doc,'')===localKey(source,'');
    if(args.images.length>(sameDirectory?256:8))throw Error('图片数量超过上限');
    const metadata=[],payload=[];
    for(const reference of args.images){
     const asset=h.localResources.get(localKey(source,reference));
     if(!asset)throw Error('来源图片不可用');
     if(sameDirectory)continue;
     const bytes=atob(asset.base64);
     metadata.push({name:decodeURIComponent(reference.split('/').pop()),size:bytes.length,image:true});
     for(const byte of bytes)payload.push(byte.charCodeAt(0));
    }
    if(args.legacyReferences.length)await h.invoke('reuse_resources',{id:args.id,references:args.legacyReferences,purpose:'clipboard-paste'});
    if(sameDirectory)return args.images;
    const imported=await h.invoke('import_resources',{id:args.id,metadata,payload});
    return imported.resources.map(asset=>asset.reference);
   }
   case 'import_resources':{
    if(!doc)throw Error('page removed')
    const result=[];let offset=0
    for(const item of args.metadata){
     const bytes=new Uint8Array(args.payload.slice(offset,offset+item.size));offset+=item.size
     const digest=await crypto.subtle.digest('SHA-256',bytes),hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')
     const svg=item.image&&/\.svg$/i.test(item.name)
     if(svg&&new DOMParser().parseFromString(new TextDecoder().decode(bytes),'image/svg+xml').documentElement.namespaceURI!=='http://www.w3.org/2000/svg')throw Error('SVG 图片无效')
     const ext=item.image?(svg?'svg':'png'):(item.name.split('.').pop().replace(/[^a-z0-9]/ig,'').slice(0,8)||'bin')
     const mime=svg?'image/svg+xml':item.image?'image/png':'application/octet-stream'
     const bound=/\.(?:md|markdown)$/i.test(doc.path);
     const encode=name=>encodeURIComponent(name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
     const reference=bound?encode(doc.path.split('/').pop().replace(/\.(?:md|markdown)$/i,''))+'.assets/'+encode(item.name):'.frowd-assets/'+hash+'.'+ext
     let binary='';for(const b of bytes)binary+=String.fromCharCode(b)
     const asset={reference,base64:btoa(binary),mime}
     if(bound)h.localResources.set(localKey(doc,reference),asset)
     else {
      h.objects.set(reference,asset)
      if(!h.bindings.has(doc.id))h.bindings.set(doc.id,new Set())
      h.bindings.get(doc.id).add(reference)
     }
     result.push({id:hash,reference,name:item.name,mime,size:item.size,image:item.image})
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
    if(doc.bodyInDb===false&&h.externalTexts.get(doc.id)===null){doc.conflict=true;throw Error('原文件不可用。')}
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
   case 'update_document':if(!doc)throw Error('page removed');if(args.revision<doc.revision||args.revision>doc.revision+1||args.revision===doc.revision&&args.markdown!==doc.markdown)throw Error('revision conflict');Object.assign(doc,{markdown:args.markdown,revision:args.revision,preview:args.markdown.slice(0,1200),bodyInDb:true});return snapshot();
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
   case 'save_document':if(h.saveChoice==='cancel')return{cancelled:true};if(h.saveChoice==='fail')throw Error('合成文件保存失败');if(args.saveAs&&h.saveAsPath)doc.path=h.saveAsPath;doc.path??='/synthetic/'+doc.title+'.md';doc.savedText=doc.markdown;return{cancelled:false,snapshot:snapshot()};
   case 'sync_document_file':{
    if(!doc||doc.path!==args.expectedPath||doc.revision!==args.expectedRevision)throw Error('文稿路径或版本已变化');
    if(doc.markdown!==doc.savedText){
     if(h.externalTexts.has(doc.id))doc.conflict=true;
     else {doc.savedText=doc.markdown;doc.bodyInDb=new TextEncoder().encode(doc.markdown).length<=256*1024;}
    }
    return snapshot();
   }
   case 'open_document':return{cancelled:true};
   case 'has_pending_open':return h.pendingOpen.length>0;
   case 'claim_dropped_documents':{
    if(!/^[0-9a-f]{32}$/.test(args.token)||!args.files.length)throw Error('拖入描述无效');
    const source=h.dropSource?[...h.dropSource]:null,matched=[];
    if(!source)return {unavailable:true,accepted:0,errors:[]};
    for(const file of args.files){
     const index=source.findIndex(entry=>entry.path.split('/').pop()===file.name&&entry.size===file.size);
     if(index<0)return {unavailable:true,accepted:0,errors:[]};
     matched.push(source.splice(index,1)[0].path);
    }
    h.pendingOpen.push(...matched.map(path=>({path})));return {unavailable:false,accepted:matched.length,errors:[]};
   }
   case 'open_pending_documents':{
    const entries=h.pendingOpen.splice(0),errors=[];let opened=0;
    for(const entry of entries){
     if(entry.error){errors.push(entry.error);continue}
     const existing=[...rows.values()].find(d=>d.path===entry.path);
     if(existing){existing.shelved=false;activeId=existing.id;layoutRevision++;opened++;continue}
     const markdown=h.disk.get(entry.path);
     if(markdown===undefined){errors.push('「'+entry.path.split('/').pop()+'」无法打开：文件不存在。');continue}
     const id='opened-'+counter++;
     rows.set(id,{id,title:entry.path.split('/').pop(),path:entry.path,markdown,savedText:markdown,revision:0,position:Math.max(-1,...[...rows.values()].map(d=>d.position))+1,shelved:false,viewState:null,conflict:false,preview:markdown.slice(0,1200)});
     activeId=id;layoutRevision++;opened++;
    }
    return {snapshot:opened?snapshot():null,opened,errors};
   }
   case 'checkpoint':return;
   case 'ack_close_listener':{
    h.closeListenerReady=true;const pending=h.closePending&&!h.closeDispatched;
    if(pending)h.closeDispatched=true;return pending;
   }
   case 'close_ready':h.closed=true;h.closePending=false;h.closeDispatched=false;h.frozenAtClose=document.querySelector('.ProseMirror')?.getAttribute('contenteditable')==='false';return;
   case 'cancel_close':h.closed=false;h.closePending=false;h.closeDispatched=false;return;
   case 'open_document_link':return;
   default:throw Error('Unexpected command '+command);
  }
 };
 window.__FROWD_TEST_HOST__=h;
}
