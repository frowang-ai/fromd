
import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentCoordinator} from '../src/documents/coordinator.mjs';
function fixture(){
 const rows=[{id:'a',title:'A',shelved:false},{id:'x',title:'X',shelved:true},{id:'b',title:'B',shelved:false},{id:'c',title:'C',shelved:false}].map((d,position)=>({...d,position,markdown:d.id,revision:0}));
 let revision=4,activeId='b';const calls=[];const snapshot=()=>({documents:structuredClone(rows),activeId,layoutRevision:revision});
 const api={list:async()=>snapshot(),read:async id=>({...rows.find(d=>d.id===id)}),
 update:async(id,markdown,r)=>{calls.push('update');Object.assign(rows.find(d=>d.id===id),{markdown,revision:r});return snapshot()},
 reorder:async(ids,expected)=>{calls.push('reorder');if(expected!==revision)throw Error('stale layout');let n=0;const next=rows.map(d=>d.shelved?d.id:ids[n++]);next.forEach((id,position)=>rows.find(d=>d.id===id).position=position);rows.sort((a,b)=>a.position-b.position);revision++;return snapshot()}};
 const port={ready:async()=>{},waitComposition:async()=>{},activate:async d=>port.current={...d,state:{history:'keep'},viewState:{mode:'source',scrollTop:18}},capture:()=>port.current,clear:()=>port.current=null};
 const state={};const c=new DocumentCoordinator(api,port,state,{autosaveMs:60000});
 return {c,state,port,rows,calls,api,stale:()=>revision++};
}
test('reorder flushes last input and preserves shelved slots, current owner, history and selection',async()=>{
 const f=fixture();try{await f.c.boot();const session=f.port.current;session.markdown+=' 最后输入';
 await f.c.reorder(['c','a','b'],4);
 assert.deepEqual(f.rows.map(d=>d.id),['c','x','a','b']);assert.equal(f.state.activeId,'b');assert.equal(f.port.current,session);
 assert.equal(f.rows.find(d=>d.id==='b').markdown,'b 最后输入');assert.deepEqual(f.calls,['update','reorder']);assert.equal(f.state.layoutRevision,5);
 }finally{f.c.dispose()}
});
test('stale native and local drag revisions refresh authority without applying stale order',async()=>{
 const f=fixture();try{await f.c.boot();f.stale();f.port.current.markdown+=' 保留';
 await assert.rejects(f.c.reorder(['c','a','b'],4),/stale/);
 assert.deepEqual(f.state.documents.map(d=>d.id),['a','x','b','c']);assert.equal(f.state.layoutRevision,5);assert.equal(f.port.current.id,'b');
 await assert.rejects(f.c.reorder(['c','a','b'],4),/重新拖动/);
 assert.equal(f.calls.filter(c=>c==='reorder').length,1);
 await f.c.reorder(['c','a','b'],5);assert.deepEqual(f.rows.map(d=>d.id),['c','x','a','b']);
 }finally{f.c.dispose()}
});
test('reorder waits for IME completion and acknowledged backup before the domain command',async()=>{
 const f=fixture();try{await f.c.boot();let release;const gate=new Promise(r=>release=r);f.port.waitComposition=()=>gate;
 const action=f.c.reorder(['c','a','b'],4);await new Promise(r=>setImmediate(r));assert.deepEqual(f.calls,[]);
 f.port.current.markdown+=' 中文';release();await action;assert.deepEqual(f.calls,['update','reorder']);assert.match(f.rows.find(d=>d.id==='b').markdown,/中文$/);
 }finally{f.c.dispose()}
});
