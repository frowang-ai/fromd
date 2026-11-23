
import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentCoordinator } from '../src/documents/coordinator.mjs';
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:()=>resolve()}};
const all=[];test.afterEach(()=>{all.forEach(f=>f.c.dispose());all.length=0});
function fixture(){
 const docs=new Map(['a','b'].map(id=>[id,{id,title:id,path:null,markdown:id,revision:0,shelved:false}]));
 let activeId='a';const state={};const snapshot=()=>({documents:[...docs.values()].map(({markdown,...d})=>({...d})),activeId});
 const port={current:null,frozen:false,ready:async()=>{},waitComposition:async()=>{},capture:()=>({...port.current,viewState:{mode:'rendered',scrollTop:0}}),activate:async d=>port.current={...d},clear:()=>port.current=null,freeze:async()=>{await port.waitComposition();port.frozen=true;return ()=>port.frozen=false}};
 const api={list:async()=>snapshot(),read:async id=>({...docs.get(id)}),update:async(id,markdown,revision)=>{Object.assign(docs.get(id),{markdown,revision});return snapshot()},rename:async(id,title)=>{docs.get(id).title=title;return snapshot()},view:async()=>snapshot(),activate:async id=>{activeId=id;return snapshot()}};
 const c=new DocumentCoordinator(api,port,state,{autosaveMs:60000});const f={c,api,port,docs,state};all.push(f);return f;
}
test('input while rename acknowledgement waits is committed before a switch',async()=>{
 const f=fixture();await f.c.boot();const entered=gate(),release=gate();const rename=f.api.rename;
 f.api.rename=async(...args)=>{entered.resolve();await release.promise;return rename(...args)};
 f.c.nameChanged('a','新名称');const switching=f.c.activate('b');await entered.promise;
 f.port.current.markdown+=' during rename';release.resolve();await switching;
 assert.equal(f.docs.get('a').markdown,'a during rename');
});
test('input while view-state acknowledgement waits is committed before a switch',async()=>{
 const f=fixture();await f.c.boot();const entered=gate(),release=gate();let first=true;
 f.api.view=async()=>{if(first){first=false;entered.resolve();await release.promise}};
 const switching=f.c.activate('b');await entered.promise;f.port.current.markdown+=' during view';release.resolve();await switching;
 assert.equal(f.docs.get('a').markdown,'a during view');
});
test('transition acquires a real editing freeze after IME and holds it across activation IPC',async()=>{
 const f=fixture();await f.c.boot();const ime=gate(),entered=gate(),release=gate();f.port.waitComposition=()=>ime.promise;
 f.api.activate=async id=>{try{assert.equal(f.port.frozen,true)}finally{entered.resolve()}await release.promise;return {documents:[...f.docs.values()],activeId:id}};
 const switching=f.c.activate('b');switching.catch(()=>{});await new Promise(r=>setTimeout(r,5));assert.equal(f.port.frozen,false);
 f.port.current.markdown+=' 中文完成';ime.resolve();await entered.promise;const frozen=f.port.frozen;release.resolve();await switching;
 assert.equal(frozen,true);assert.equal(f.port.frozen,false);assert.equal(f.docs.get('a').markdown,'a 中文完成');
});
