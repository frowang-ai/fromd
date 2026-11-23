
import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentCoordinator } from '../src/documents/coordinator.mjs';
function fixture({body='正文',path=null}={}){
 let row={id:'a',title:'A',path,revision:0,shelved:false,dirty:!!body};
 let activeId='a';let exists=true;const calls=[];
 const snapshot=()=>({documents:exists?[{...row}]:[],activeId,undoRemoval:exists?null:'A'});
 const api={
 list:async()=>snapshot(),read:async()=>({...row,markdown:body}),
 create:async()=>snapshot(),update:async(id,text,revision)=>{body=text;row.revision=revision;return snapshot()},
 rename:async()=>snapshot(),view:async()=>snapshot(),
 save:async()=>{calls.push('save');row.path='/synthetic/A.md';row.dirty=false;return {cancelled:false,snapshot:snapshot()}},
 remove:async(id,decision)=>{calls.push('remove:'+decision);exists=false;activeId=null;return snapshot()},
 checkpoint:async()=>{calls.push('checkpoint')},
 };
 const port={current:null,ready:async()=>{},waitComposition:async()=>{},activate:async doc=>{port.current={...doc,viewState:{mode:'rendered',scrollTop:0}}},capture:()=>port.current,clear:()=>port.current=null};
 const state={};const c=new DocumentCoordinator(api,port,state);return {c,api,port,state,calls};
}
test('nonempty draft removal offers a decision and cancel preserves it',async()=>{
 const f=fixture();await f.c.boot();let asked=0;
 await f.c.remove('a',async()=>{asked++;return 'cancel'});
 assert.equal(asked,1);assert.equal(f.state.documents.length,1);assert.deepEqual(f.calls,[]);f.c.dispose();
});
test('save-file cancellation keeps a nonempty draft',async()=>{
 const f=fixture();await f.c.boot();f.api.save=async()=>({cancelled:true});
 await f.c.remove('a',async()=> 'save');assert.equal(f.state.documents.length,1);assert.deepEqual(f.calls,[]);f.c.dispose();
});
test('save failure keeps the document and does not remove it',async()=>{
 const f=fixture();await f.c.boot();f.api.save=async()=>{throw Error('write denied')};
 await assert.rejects(f.c.remove('a',async()=> 'save'),/write denied/);
 assert.equal(f.state.documents.length,1);assert.deepEqual(f.calls,[]);f.c.dispose();
});
test('successful save completes before remove and then exposes undo',async()=>{
 const f=fixture();await f.c.boot();await f.c.remove('a',async()=> 'save');
 assert.deepEqual(f.calls,['save','remove:saved']);assert.equal(f.state.activeId,null);assert.equal(f.state.undoRemoval,'A');f.c.dispose();
});
test('whitespace draft can be removed without a save dialog',async()=>{
 const f=fixture({body:'  \n '});await f.c.boot();
 await f.c.remove('a',async()=>{throw Error('must not ask')});
 assert.deepEqual(f.calls,['remove:discard']);f.c.dispose();
});
test('exit drain flushes last input before SQLite checkpoint',async()=>{
 const f=fixture();await f.c.boot();f.port.current.markdown+=' 最后一字';
 const update=f.api.update;f.api.update=async(...args)=>{f.calls.push('update');return update(...args)};
 await f.c.drain();assert.deepEqual(f.calls,['update','checkpoint']);f.c.dispose();
});
