
import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentSearch,findText,literalMatchOffsets,matchDocument} from '../src/documents/search.mjs';
import {sourceOffset} from '../../../packages/editor/src/writingMarkdownLocation.js';
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}};
const a={id:'a',title:'草稿',shelved:false},b={id:'b',title:'收起页',shelved:true};
test('literal matches have neutral Chinese/emoji locations and ASCII folding',()=>{
 assert.deepEqual(findText('前行\n😀中文AbC','中文abc'),{line:2,column:1,length:5,needle:'中文abc'});
 assert.equal(findText('字面%_','.*'),null);
 assert.equal(matchDocument(b,'body','收起').location,null);
});
test('chunk boundary, bounded Unicode context and source offsets agree',()=>{
 const prefix = 'A'.repeat(65536-2);
 const query = 'ab😀';
 const text = prefix + 'AB😀' + '界😀'.repeat(100);
 const match = matchDocument(a,text,query);
 assert.deepEqual(match.location,{line:1,column:prefix.length,length:3,needle:query});
 assert.equal(match.snippet,'A'.repeat(60)+[...text.slice(prefix.length)].slice(0,180).join(''));
 const multiline = '😀\n'+'😀'.repeat(65)+'A😀B\n尾';
 const found = matchDocument(a,multiline,'a😀b');
 assert.equal(found.location.column,65);
 assert.equal(found.snippet,'😀'.repeat(60)+'A😀B 尾');
 assert.equal(sourceOffset(multiline,found.location),3+65*2);
 assert.equal(findText('Ä','ä'),null);
});
test('literal iteration preserves UTF-16 offsets and skips overlaps across chunks',()=>{
 const prefix='😀'.repeat(32767)+'X';
 const text=prefix+'AaAaAXaAA';
 assert.deepEqual([...literalMatchOffsets(text,'aaa')],[prefix.length,prefix.length+6]);
 assert.deepEqual([...literalMatchOffsets(text,'aAA',true)],[prefix.length+6]);
 assert.deepEqual([...literalMatchOffsets(text,'')],[]);
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

for(const queuedBeforeTimeout of [true,false])test('kept Q2 terminates when uncancellable Q1 hangs (queuedBeforeTimeout='+queuedBeforeTimeout+')',async()=>{
 const state={},gate=deferred(),calls=[];
 const s=new DocumentSearch({search:q=>{calls.push(q);return q==='Q1'?gate.promise:Promise.resolve([matchDocument(b,'Q2','Q2')])}},state,async()=>({doc:null,documents:[b]}),{timeoutMs:15});
 try {
  s.request('Q1');await tick();
  if(queuedBeforeTimeout)s.request('Q2');
  await new Promise(r=>setTimeout(r,35));
  if(!queuedBeforeTimeout)s.request('Q2');
  assert.equal(state.searching,false);assert.match(state.searchError,/超时|重试/);
  assert.deepEqual(calls,['Q1']);assert.deepEqual(state.searchResults,[]);
  s.request('Q3');assert.equal(state.searching,false);assert.match(state.searchError,/重试/);
  assert.deepEqual(calls,['Q1']);
  gate.resolve([matchDocument(b,'Q1','Q1')]);await tick();await tick();
  assert.equal(state.searching,false);assert.deepEqual(state.searchResults,[]);assert.deepEqual(calls,['Q1']);
  // No queued request silently restarts. Explicit retry becomes usable on settlement.
  s.request('Q2');await tick();assert.deepEqual(calls,['Q1','Q2']);
  assert.equal(state.searching,false);assert.equal(state.searchError,'');assert.equal(state.searchResults[0].id,'b');
 } finally {s.dispose();gate.resolve([])}
});

for(const invalid of ['', 'a'.repeat(257)])test('superseding a queued query with '+(invalid?'oversize':'empty')+' input retains a finite state across timeout',async()=>{
 const state={},gate=deferred();let calls=0;
 const s=new DocumentSearch({search:()=>{calls++;return gate.promise}},state,async()=>({doc:null,documents:[]}),{timeoutMs:15});
 try {
  s.request('Q1');await tick();s.request('Q2');s.request(invalid);
  await new Promise(r=>setTimeout(r,35));assert.equal(state.searching,false);
  if(invalid)assert.match(state.searchError,/256/);else assert.equal(state.searchError,'');
  gate.reject(Error('late error'));await tick();assert.equal(state.searching,false);assert.equal(calls,1);
  if(invalid)assert.match(state.searchError,/256/);else assert.equal(state.searchError,'');
 } finally{s.dispose();gate.resolve([])}
});
