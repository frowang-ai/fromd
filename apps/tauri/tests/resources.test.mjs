import test from 'node:test'
import assert from 'node:assert/strict'
import {resourcePacket,resourceMarkdown,relativeImage,MAX_IMPORT_BYTES,MAX_IMAGE_BYTES} from '../src/documents/resources.mjs'
import {DocumentCoordinator} from '../src/documents/coordinator.mjs'
const reference='.frowd-assets/'+'a'.repeat(64)+'.png'
const item={reference,name:'合成[图]\\标',image:true}
test('persistent markup escapes labels once and never accepts temporary/absolute references',()=>{
 assert.ok(resourceMarkdown([{...item,name:'$x$'}]).includes('\\$x\\$'))
 assert.equal(resourceMarkdown([item]),'![合成\\[图\\]\\\\标]('+reference+')')
 for(const reference of ['blob:temporary','/private/image.png','../image.png','https://test/image.png'])assert.throws(()=>resourceMarkdown([{...item,reference}]),/无效/)
 for(const value of ['https://test/image.png','blob:abc','C:\\private\\a.png','/tmp/a','../a','%2e%2e/a','a/%00.png','%ZZ'])assert.equal(relativeImage(value),false,value)
 for(const value of [reference,'./图片/a.png','images\\one.png','images/a%20b.png'])assert.equal(relativeImage(value),true,value)
})

test('binary packet validates all sizes before reading and keeps file boundaries',async()=>{
 const files=[new File([new Uint8Array([1,2,3])],'图.png',{type:'image/png'}),new File(['中文'],'附件.txt')]
 const {metadata,payload}=await resourcePacket(files)
 assert.deepEqual(metadata.map(({size,image})=>({size,image})),[{size:3,image:true},{size:6,image:false}])
 assert.deepEqual([...payload.slice(0,3)],[1,2,3])
 let read=false
 await assert.rejects(resourcePacket([{name:'too.png',size:MAX_IMAGE_BYTES+1,type:'image/png',arrayBuffer:()=>{read=true}}]),/10 MiB/)
 await assert.rejects(resourcePacket(Array(9).fill(files[0])),/8/)
 await assert.rejects(resourcePacket(Array(3).fill({name:'x.bin',size:MAX_IMPORT_BYTES/2,type:''})),/50 MiB/)
 await assert.rejects(resourcePacket([{name:'x.txt',size:2,type:'',arrayBuffer:async()=>new ArrayBuffer(1)}]),/长度/)
 assert.equal(read,false)
})
const gate=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}}
const fixtures=[];test.afterEach(()=>{fixtures.splice(0).forEach(c=>c.dispose())})
async function fixture(timeout=1000){
 const rows=new Map(['a','b'].map(id=>[id,{id,title:id,path:null,markdown:id,revision:0,shelved:false}]))
 let activeId='a';const state={},calls=[]
 const snapshot=()=>({documents:[...rows.values()].map(({markdown,...d})=>({...d})),activeId})
 const port={current:null,frozen:false,ready:async()=>{},waitComposition:async()=>{},capture:()=>port.current?{...port.current}:null,activate:async d=>port.current={...d},clear:()=>port.current=null}
 port.freeze=async()=>{await port.waitComposition();port.frozen=true;return()=>port.frozen=false}
 port.insertResources=async items=>{assert.equal(port.frozen,true);calls.push(port.current.id);port.current.markdown+=' '+resourceMarkdown(items)}
 const api={list:async()=>snapshot(),read:async id=>({...rows.get(id)}),activate:async id=>{activeId=id;return snapshot()},update:async(id,markdown,revision)=>{Object.assign(rows.get(id),{markdown,revision});return snapshot()},rename:async()=>snapshot(),view:async()=>snapshot(),checkpoint:async()=>{},closeReady:async()=>{calls.push('close')},importResources:async()=>({cancelled:false,resources:[item]}),chooseResources:async()=>({cancelled:true})}
 const c=new DocumentCoordinator(api,port,state,{autosaveMs:60000,resourceTimeoutMs:timeout,pickerTimeoutMs:timeout});fixtures.push(c);await c.boot()
 return {c,api,port,state,rows,calls,owner:()=>({id:port.current.id,generation:port.current.generation})}
}
test('resource import waits IME, freezes actual editing and persists last input before queued switch',async()=>{
 const f=await fixture(),ime=gate(),io=gate(),entered=gate()
 f.port.waitComposition=()=>ime.promise;f.api.importResources=async()=>{entered.resolve();await io.promise;return {resources:[item]}}
 const importing=f.c.importResources(f.owner(),[]),switching=f.c.activate('b')
 await new Promise(r=>setTimeout(r,5));assert.equal(f.port.frozen,false);f.port.current.markdown+=' 中文输入';ime.resolve()
 await entered.promise;assert.equal(f.port.frozen,true);assert.equal(f.rows.get('a').markdown,'a 中文输入')
 io.resolve();await importing;await switching
 assert.equal(f.state.activeId,'b');assert.match(f.rows.get('a').markdown,/中文输入 !\[/);assert.equal(f.rows.get('b').markdown,'b');assert.deepEqual(f.calls,['a']);assert.equal(f.port.frozen,false)
})
test('import failure/cancel preserves body and releases freeze; stale owner never invokes host',async()=>{
 const f=await fixture();f.api.importResources=async()=>{throw Error('registration failed')}
 await assert.rejects(f.c.importResources(f.owner(),[]),/registration/);assert.equal(f.port.current.markdown,'a');assert.equal(f.port.frozen,false)
 await f.c.importResources(f.owner());assert.equal(f.port.current.markdown,'a')
 const old=f.owner();await f.c.activate('b');await assert.rejects(f.c.importResources(old,[]),/页面已切换/);assert.equal(f.port.current.markdown,'b')
})
test('timed-out uncancellable import is bounded; late completion cannot insert after switch/close',async()=>{
 const f=await fixture(15),io=gate();let count=0
 f.api.importResources=async()=>{count++;return io.promise}
 await assert.rejects(f.c.importResources(f.owner(),[]),/超时/)
 await f.c.activate('b');await assert.rejects(f.c.importResources(f.owner(),[]),/上次/)
 assert.equal(count,1);assert.equal(f.port.frozen,false);await f.c.close();assert.deepEqual(f.calls,['close'])
 io.resolve({resources:[item]});await new Promise(r=>setTimeout(r,5))
 assert.equal(f.rows.get('a').markdown,'a');assert.equal(f.rows.get('b').markdown,'b');assert.deepEqual(f.calls,['close'])
})

test('failed body backup after registered insertion retains last input for retry instead of switching',async()=>{
 const f=await fixture(),original=f.api.update
 f.port.current.markdown+=' latest text';let updates=0
 f.api.update=async(...args)=>{if(++updates===2)throw Error('backup failed');return original(...args)}
 await assert.rejects(f.c.importResources(f.owner(),[]),/backup failed/)
 assert.equal(f.port.current.id,'a');assert.match(f.port.current.markdown,/latest text !\[/)
 assert.equal(f.rows.get('a').markdown,'a latest text');assert.equal(f.port.frozen,false)
 f.api.update=original;await f.c.activate('b')
 assert.match(f.rows.get('a').markdown,/latest text !\[/);assert.equal(f.rows.get('b').markdown,'b');assert.deepEqual(f.calls,['a'])
})
