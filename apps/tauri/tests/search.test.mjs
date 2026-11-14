
import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentSearch,findText,matchDocument} from '../src/documents/search.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}};
const a={id:'a',title:'草稿',shelved:false},b={id:'b',title:'收起页',shelved:true};
test('literal matches have neutral Chinese/emoji locations and ASCII folding',()=>{
 assert.deepEqual(findText('前行\n😀中文AbC','中文abc'),{line:2,column:1,length:5,needle:'中文abc'});
 assert.equal(findText('字面%_','.*'),null);
 assert.equal(matchDocument(b,'body','收起').location,null);
});
test('search overlays latest unacknowledged body and title, including removing a stale persisted match',async()=>{
 const state={},gate=deferred();let body='old',calls=0;
 const s=new DocumentSearch({search:()=>{calls++;return gate.promise}},state,async()=>({doc:{...a,title:'新名称'},markdown:body,documents:[a,b]}));
 s.request('needle');await tick();body='最新 needle 输入';
 gate.resolve([matchDocument(b,'needle 收起正文','needle')]);await tick();
 assert.equal(calls,1);assert.deepEqual(state.searchResults.map(r=>r.id),['a','b']);
 assert.equal(state.searchResults[0].title,'新名称');assert.match(state.searchResults[0].snippet,/最新/);
 body='无匹配';s.request('needle');await tick();assert.deepEqual(state.searchResults.map(r=>r.id),['b']);s.dispose();
});
test('one outstanding request coalesces queries and ignores late errors/results',async()=>{
 const state={},g=deferred(),calls=[];
 const s=new DocumentSearch({search:q=>{calls.push(q);return q==='old'?g.promise:Promise.resolve([matchDocument(b,'new','new')])}},state,async()=>({doc:null,documents:[b]}));
 s.request('old');await tick();s.request('middle');s.request('new');
 assert.deepEqual(calls,['old']);g.reject(Error('late failure'));await tick();await tick();
 assert.deepEqual(calls,['old','new']);assert.equal(state.searchError,'');assert.equal(state.searchResults[0].id,'b');s.dispose();
});
test('timeout bounds UI and outstanding IPC; expired results never publish',async()=>{
 const state={},g=deferred();let calls=0;
 const s=new DocumentSearch({search:()=>{calls++;return g.promise}},state,async()=>({doc:null,documents:[b]}),{timeoutMs:15});
 s.request('needle');await new Promise(r=>setTimeout(r,30));assert.match(state.searchError,/超时/);assert.equal(state.searching,false);
 s.request('next');assert.equal(calls,1);s.request('');g.resolve([matchDocument(b,'needle','needle')]);await tick();
 assert.deepEqual(state.searchResults,[]);assert.equal(calls,1);s.dispose();
});
test('current search errors clear results and oversize/empty queries issue no IPC',async()=>{
 const state={};let calls=0;const s=new DocumentSearch({search:async()=>{calls++;throw Error('read-only unavailable')}},state,async()=>({doc:null,documents:[]}));
 s.request('a'.repeat(257));assert.equal(calls,0);assert.match(state.searchError,/256/);
 s.request('');assert.equal(state.searchError,'');s.request('valid');await tick();
 assert.match(state.searchError,/unavailable/);assert.deepEqual(state.searchResults,[]);s.dispose();
});
