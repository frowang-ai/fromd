import test from 'node:test'
import assert from 'node:assert/strict'
import {sliceResources,markdownResources,markdownPasteResources} from '../../../packages/editor/src/writingResourcePaste.js'
import {Schema,Slice,Fragment} from '@milkdown/kit/prose/model'
import {DocumentCoordinator} from '../src/documents/coordinator.mjs'
const reference='.frowd-assets/'+'a'.repeat(64)+'.png',unknown='.frowd-assets/'+'b'.repeat(64)+'.txt'
const position=(start,end)=>({start:{offset:start},end:{offset:end}})
test('Markdown resource recognition uses AST roles/ranges; code and ordinary text are not assets',()=>{
 const tree={type:'root',children:[
  {type:'code',children:[{type:'image',url:unknown}]},{type:'inlineCode',url:unknown},
  {type:'text',value:'![example]('+unknown+')'},{type:'link',url:unknown,position:position(0,20)},
  {type:'image',url:reference,position:position(30,100)}]}
 assert.deepEqual(markdownResources(tree,{from:30,to:100}),[{reference,image:true}])
 assert.deepEqual(markdownResources({type:'root',children:[{type:'image',url:reference},{type:'link',url:reference}]}),[{reference,image:true}])
 assert.throws(()=>markdownResources({type:'image',url:'blob:temporary'}),/临时/)
 assert.throws(()=>markdownResources({type:'link',url:'.frowd-assets/../../private'}),/无效/)
})
test('actual PM fragments collect image/link references while excluding code marks/blocks',()=>{
 const schema=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},text:{group:'inline'},code_block:{content:'text*',group:'block',code:true},image:{inline:true,group:'inline',attrs:{src:{}}}},marks:{link:{attrs:{href:{}}},code:{code:true}}})
 const {paragraph,code_block,image}=schema.nodes
 const nodes=[paragraph.create(null,[image.create({src:reference}),schema.text('attachment',[schema.marks.link.create({href:unknown})]),schema.text('code example',[schema.marks.code.create(),schema.marks.link.create({href:'.frowd-assets/not-resource'})])]),code_block.create(null,schema.text('example '+unknown))]
 assert.deepEqual(sliceResources(new Slice(Fragment.fromArray(nodes),0,0)),[{reference,image:true},{reference:unknown,image:false}])
})
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const all=[];test.afterEach(()=>{all.splice(0).forEach(f=>f.c.dispose())})
async function fixture(timeout=1000){
 const rows=new Map(['a','b'].map(id=>[id,{id,title:id,markdown:id,path:null,revision:0}]))
 const snapshot=()=>({documents:[...rows.values()].map(({markdown,...d})=>({...d})),activeId:currentId})
 let currentId='b';const state={},calls=[],port={current:null,frozen:false,ready:async()=>{},waitComposition:async()=>{},capture:()=>port.current?{...port.current}:null,activate:async d=>port.current={...d},clear:()=>port.current=null}
 port.freeze=async()=>{await port.waitComposition();port.frozen=true;return()=>port.frozen=false}
 port.prepareResourcePaste=async payload=>({references:payload.references||[{reference,image:true}],text:payload.text||' pasted',before:port.current.markdown,id:port.current.id})
 port.commitResourcePaste=async prepared=>{assert.equal(port.frozen,true);assert.equal(prepared.before,port.current.markdown);assert.equal(prepared.id,port.current.id);port.current.markdown+=prepared.text;calls.push('insert')}
 const api={list:async()=>snapshot(),read:async id=>({...rows.get(id)}),view:async()=>{},update:async(id,markdown,revision)=>{Object.assign(rows.get(id),{markdown,revision});return snapshot()},activate:async id=>{currentId=id;return snapshot()},reuseResources:async(id,references,purpose)=>{calls.push({id,references,purpose})}}
 const c=new DocumentCoordinator(api,port,state,{autosaveMs:60000,resourceTimeoutMs:timeout});const f={rows,c,api,port,state,calls,owner:()=>({id:port.current.id,generation:port.current.generation})};all.push(f);await c.boot();return f
}
test('reference paste waits IME, binds before one frozen insertion, and drains before queued switch',async()=>{
 const f=await fixture(),ime=deferred(),io=deferred(),entered=deferred()
 f.port.waitComposition=()=>ime.promise
 f.api.reuseResources=async(id,references,purpose)=>{assert.equal(purpose,'clipboard-paste');assert.equal(id,'b');assert.equal(f.port.frozen,true);entered.resolve();await io.promise;f.calls.push('bound')}
 const pasting=f.c.pasteResources(f.owner(),{}),switching=f.c.activate('a')
 await new Promise(r=>setTimeout(r,5));assert.equal(f.port.frozen,false)
 f.port.current.markdown+=' 中文';ime.resolve();await entered.promise;assert.equal(f.rows.get('b').markdown,'b 中文')
 io.resolve();await pasting;await switching
 assert.deepEqual(f.calls,['bound','insert']);assert.equal(f.rows.get('b').markdown,'b 中文 pasted');assert.equal(f.rows.get('a').markdown,'a')
})
test('failed binding/prepare or stale gesture leaves text/selection untouched and never inserts',async()=>{
 const f=await fixture();f.port.current.selection={from:0,to:1}
 f.api.reuseResources=async()=>{throw Error('unavailable, reimport')}
 await assert.rejects(f.c.pasteResources(f.owner(),{}),/reimport/)
 assert.equal(f.port.current.markdown,'b');assert.deepEqual(f.port.current.selection,{from:0,to:1});assert.equal(f.port.frozen,false)
 const owner=f.owner();await f.c.activate('a');await assert.rejects(f.c.pasteResources(owner,{}),/页面已切换/);assert.equal(f.calls.length,0)
})
test('plain/code paste issues no resource IPC; failed post-insert backup keeps visible text for retry',async()=>{
 const f=await fixture();await f.c.pasteResources(f.owner(),{references:[],text:' code'})
 assert.deepEqual(f.calls,['insert']);assert.equal(f.rows.get('b').markdown,'b code')
 const original=f.api.update;f.api.update=async()=>{throw Error('backup failed')}
 await assert.rejects(f.c.pasteResources(f.owner(),{text:' image'}),/backup failed/)
 assert.equal(f.port.current.markdown,'b code image');assert.equal(f.rows.get('b').markdown,'b code')
 f.api.update=original;await f.c.activate('a');assert.equal(f.rows.get('b').markdown,'b code image')
})
test('hung reuse occupies one resource flight across import/reuse, and late success never inserts elsewhere',async()=>{
 const f=await fixture(15),io=deferred();let count=0
 f.api.reuseResources=async()=>{count++;await io.promise}
 await assert.rejects(f.c.pasteResources(f.owner(),{}),/超时/)
 await f.c.activate('a');await assert.rejects(f.c.pasteResources(f.owner(),{}),/上次/)
 await assert.rejects(f.c.importResources(f.owner(),[]),/上次/)
 assert.equal(count,1);io.resolve();await new Promise(r=>setTimeout(r,5))
 assert.equal(f.rows.get('a').markdown,'a');assert.equal(f.rows.get('b').markdown,'b');assert.equal(f.calls.length,0)
})

test('source definition paste registers newly resolved references outside its text range only',()=>{
 const old={type:'root',children:[{type:'text',value:'[link][ref]'}]},after={type:'root',children:[{type:'link',url:reference,position:position(0,10)}]}
 assert.deepEqual(markdownPasteResources(old,after,{from:30,to:120}),[{reference,image:false}])
 const refTree={type:'root',children:[{type:'linkReference',identifier:'id',position:position(0,10)},{type:'definition',identifier:'id',url:reference,position:position(30,120)}]}
 assert.deepEqual(markdownPasteResources(old,refTree,{from:30,to:120}),[{reference,image:false}])
 assert.deepEqual(markdownPasteResources(after,after,{from:30,to:120}),[])
 assert.throws(()=>markdownPasteResources(old,{type:'link',url:'blob:temporary',position:position(0,10)},{from:30,to:120}),/临时/)
})
