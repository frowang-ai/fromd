
import test from 'node:test'
import assert from 'node:assert/strict'
import {DocumentCoordinator} from '../src/documents/coordinator.mjs'
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const fixtures=[];test.afterEach(()=>fixtures.splice(0).forEach(c=>c.dispose()))
async function fixture(timeout=1000){
 const rows=new Map(['a','b'].map((id,position)=>[id,{id,title:id,markdown:id,revision:0,path:null,position,shelved:false}]))
 let activeId='a';const state={},events=[]
 const snapshot=()=>({documents:[...rows.values()].map(({markdown,...d})=>({...d})),activeId})
 const port={current:null,frozen:false,ready:async()=>{},waitComposition:async()=>{},capture:()=>port.current&&({...port.current}),activate:async d=>{port.current={...d}},clear:()=>port.current=null}
 port.freeze=async()=>{await port.waitComposition();port.frozen=true;return()=>port.frozen=false}
 port.prepareFileImport=source=>({references:[],warnings:source.kind==='html'?['HTML 基础结构；样式不保留']:[],finish:()=>source.content})
 const api={list:async()=>snapshot(),read:async id=>({...rows.get(id)}),activate:async id=>{activeId=id;return snapshot()},update:async(id,markdown,revision)=>{Object.assign(rows.get(id),{markdown,revision});return snapshot()},view:async()=>snapshot(),checkpoint:async()=>{},closeReady:async()=>events.push('close'),
 chooseImport:async()=>({cancelled:false,source:{token:'new',kind:'text',title:'导入',content:'new text'}}),
 prepareImportResources:async()=>[],commitImport:async(token,markdown)=>{assert.equal(port.frozen,true);const id='new';rows.set(id,{id,title:'导入',markdown,revision:0,path:null,position:rows.size,shelved:false});activeId=id;events.push('commit');return snapshot()}}
 const c=new DocumentCoordinator(api,port,state,{autosaveMs:60000,resourceTimeoutMs:timeout,pickerTimeoutMs:timeout});fixtures.push(c);await c.boot();return{c,api,port,state,rows,events}
}
test('successful import flushes original then creates independent draft with fresh initial session',async()=>{
 const f=await fixture();f.port.current.markdown+=' latest';const generation=f.port.current.generation;await f.c.importFile()
 assert.equal(f.rows.get('a').markdown,'a latest');assert.equal(f.state.activeId,'new');assert.equal(f.port.current.path,null);assert.equal(f.port.current.markdown,'new text');assert.equal(f.port.current.session,null);assert.ok(f.port.current.generation>generation)
})
for(const phase of ['cancel','read','convert','finish','resources','commit'])test('import '+phase+' preserves original identity/body/selection/order without extra page',async()=>{
 const f=await fixture();f.port.current.viewState={selection:{anchor:1,head:1}}
 if(phase==='cancel')f.api.chooseImport=async()=>({cancelled:true})
 if(phase==='read')f.api.chooseImport=async()=>{throw Error('invalid UTF-8')}
 if(phase==='convert')f.port.prepareFileImport=()=>{throw Error('conversion failed')}
 if(phase==='finish')f.port.prepareFileImport=()=>({references:[],warnings:[],finish:()=>{throw Error('final conversion failed')}})
 if(phase==='resources')f.api.prepareImportResources=async()=>{throw Error('missing resource')}
 if(phase==='commit')f.api.commitImport=async()=>{throw Error('transaction rollback')}
 const before={...f.port.current}
 if(phase==='cancel')await f.c.importFile();else await assert.rejects(f.c.importFile())
 assert.equal(f.state.activeId,'a');assert.deepEqual(f.port.current,before);assert.deepEqual([...f.rows.keys()],['a','b']);assert.equal(f.port.frozen,false)
})
test('import waits IME and serializes delayed resource preparation with switch and close',async()=>{
 const f=await fixture(),ime=gate(),io=gate(),entered=gate()
 f.port.waitComposition=()=>ime.promise;f.api.prepareImportResources=async()=>{entered.resolve();await io.promise;return []}
 const importing=f.c.importFile(),switching=f.c.activate('b'),closing=f.c.close()
 await new Promise(r=>setTimeout(r,5));assert.equal(f.port.frozen,false);f.port.current.markdown+=' 中文';ime.resolve()
 await entered.promise;assert.equal(f.port.frozen,true);assert.equal(f.rows.get('a').markdown,'a 中文');io.resolve()
 await importing;await switching;await closing
 assert.equal(f.port.current.id,'b');assert.equal(f.rows.get('new').markdown,'new text');assert.deepEqual(f.events,['commit','close'])
})
test('timed out stage never creates a page, suppresses overlapping IPC and ignores late result',async()=>{
 const f=await fixture(15),io=gate();let calls=0
 f.api.prepareImportResources=async()=>{calls++;return io.promise}
 await assert.rejects(f.c.importFile(),/超时/);await f.c.activate('b');await assert.rejects(f.c.importFile(),/上次/)
 assert.equal(calls,1);io.resolve([]);await new Promise(r=>setTimeout(r,5));assert.equal(f.rows.size,2);assert.equal(f.state.activeId,'b');assert.deepEqual(f.events,[])
})

test('lost final acknowledgement reconciles reserved docId without duplicate creation',async()=>{
 const f=await fixture(),commit=f.api.commitImport;f.api.commitImport=async(...args)=>{await commit(...args);throw Error("lost ack")}
 await f.c.importFile();assert.equal(f.state.activeId,"new");assert.equal(f.rows.size,3);assert.deepEqual(f.events,["commit"]);assert.match(f.state.importReport.text,/已保存.*回执异常/);assert.equal(f.port.current.markdown,"new text")
})
