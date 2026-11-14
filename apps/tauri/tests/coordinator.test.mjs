
import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentCoordinator } from '../src/documents/coordinator.mjs';

const fixtures=[];test.afterEach(()=>{for(const c of fixtures)c.dispose();fixtures.length=0;});
const deferred = () => {let resolve, reject; const promise = new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}};
function fixture() {
 const rows = new Map(['a','b'].map(id=>[id,{id,title:id,path:null,revision:0,position:id==='a'?0:1,shelved:false,markdown:'# '+id,viewState:null}]));
 let activeId='a'; const calls=[]; let fail=false;
 const snapshot=()=>({documents:[...rows.values()].map(({markdown,...doc})=>({...doc})),activeId});
 const api={
  list:async()=>snapshot(),read:async id=>({...rows.get(id)}),
  update:async(id,markdown,revision)=>{calls.push({id,markdown,revision});if(fail)throw Error('disk full'); Object.assign(rows.get(id),{markdown,revision});return snapshot()},
  rename:async(id,title)=>{rows.get(id).title=title;return snapshot()},
  view:async(id,viewState)=>{rows.get(id).viewState=viewState;return snapshot()},
  activate:async id=>{activeId=id;rows.get(id).shelved=false;return snapshot()},
  shelve:async id=>{rows.get(id).shelved=true;if(activeId===id)activeId=[...rows.values()].find(d=>!d.shelved)?.id??null;return snapshot()},
 };
 const port={current:null,ready:async()=>{},waitComposition:async()=>{},activate:async doc=>{port.current={...doc,markdown:doc.markdown,viewState:doc.viewState??{mode:'rendered',scrollTop:0}}},capture:()=>port.current?{...port.current}:null,clear:()=>port.current=null};
 const state={documents:[],activeId:null};const c=new DocumentCoordinator(api,port,state,{autosaveMs:60000});fixtures.push(c);
 return {c,api,port,state,rows,calls,setFail:value=>fail=value};
}
test('last input is persisted even when no delayed change notification fired',async()=>{
 const {c,port,rows}=fixture();await c.boot();
 port.current.markdown+=' last-keystroke';await c.activate('b');
 assert.match(rows.get('a').markdown,/last-keystroke$/);assert.equal(port.current.id,'b');
 c.dispose();
});
test('a change notification cannot make the latest text look already persisted',async()=>{
 const {c,port,rows}=fixture();await c.boot();port.current.markdown+=' changed';
 c.changed({id:'a',generation:port.current.generation,markdown:port.current.markdown});
 await c.flush();assert.match(rows.get('a').markdown,/changed$/);c.dispose();
});
test('failed backup keeps edits and prevents switching; retry commits them',async()=>{
 const {c,port,state,rows,setFail}=fixture();await c.boot();port.current.markdown+=' unsaved';
 setFail(true);await assert.rejects(c.activate('b'),/disk full/);
 assert.equal(state.activeId,'a');assert.match(port.current.markdown,/unsaved$/);
 setFail(false);await c.activate('b');assert.match(rows.get('a').markdown,/unsaved$/);c.dispose();
});
test('rename for an old page does not change current selection or another title',async()=>{
 const {c,api,state,rows}=fixture();await c.boot();
 const gate=deferred();const rename=api.rename;api.rename=async(...args)=>{await gate.promise;return rename(...args)};
 await c.activate('b');c.nameChanged('a','renamed');const renamePromise=c.flushName('a');
 gate.resolve();await renamePromise;
 assert.equal(state.activeId,'b');assert.equal(rows.get('b').title,'b');assert.equal(rows.get('a').title,'renamed');c.dispose();
});
test('composition blocks page switches and includes the committed characters',async()=>{
 const {c,port,state,rows}=fixture();await c.boot();const gate=deferred();port.waitComposition=()=>gate.promise;
 const action=c.activate('b');await new Promise(r=>setTimeout(r,10));assert.equal(state.activeId,'a');
 port.current.markdown+=' 中文';gate.resolve();await action;assert.match(rows.get('a').markdown,/中文$/);c.dispose();
});
test('changes arriving during an acknowledgement are flushed before switching',async()=>{
 const {c,port,api,rows}=fixture();await c.boot();const gate=deferred();const update=api.update;let first=true;
 api.update=async(...args)=>{if(first){first=false;await gate.promise}return update(...args)};
 port.current.markdown+=' one';const saving=c.flush();await new Promise(r=>setTimeout(r,5));
 port.current.markdown+=' two';c.changed({...port.current});gate.resolve();await saving;await c.activate('b');
 assert.match(rows.get('a').markdown,/one two$/);assert.ok(rows.get('a').revision>=2);c.dispose();
});
test('stale owner events cannot change the active document buffer',async()=>{
 const {c,port,state,rows}=fixture();await c.boot();const old={...port.current};await c.activate('b');
 c.changed({...old,markdown:'WRONG PAGE'});await c.flush();assert.equal(state.markdown,'# b');assert.equal(rows.get('b').markdown,'# b');c.dispose();
});

test('failed target read restores selection without showing the old body under the new docId',async()=>{
 const {c,api,state,port,rows}=fixture();await c.boot();const original=api.read;
 api.read=async id=>{if(id==='b')throw Error('read unavailable');return original(id)};
 await assert.rejects(c.activate('b'),/read unavailable/);
 assert.equal(state.activeId,'a');assert.equal(port.current.id,'a');assert.equal(port.current.markdown,'# a');
 api.read=original;await c.activate('b');assert.equal(port.current.id,'b');assert.equal(rows.get('b').markdown,'# b');
});

for (const empty of [false,true]) test('failed shelved activation preserves backend layout and owner; retry succeeds (empty='+empty+')',async()=>{
 const {c,api,state,port,rows}=fixture();
 rows.get('b').shelved=true;
 if(empty){rows.get('a').shelved=true;api.list=async()=>({documents:[...rows.values()],activeId:null})}
 await c.boot();const original=api.read;
 if(!empty){port.current.markdown+=' final';c.nameChanged('a','owned name')}
 const activate=api.activate;let commits=0;api.activate=async id=>{commits++;return activate(id)};
 api.read=async id=>{if(id==='b')throw Error('unreadable');return original(id)};
 await assert.rejects(c.activate('b'),/unreadable/);
 assert.equal(commits,0);assert.equal(rows.get('b').shelved,true);
 assert.equal(state.activeId,empty?null:'a');assert.equal(port.current?.id??null,empty?null:'a');
 if(!empty){assert.match(port.current.markdown,/final$/);assert.equal(rows.get('a').title,'owned name')}
 assert.equal(state.documents.find(d=>d.id==='b').shelved,true);
 api.read=original;await c.activate('b');assert.equal(state.activeId,'b');assert.equal(rows.get('b').shelved,false);
});
