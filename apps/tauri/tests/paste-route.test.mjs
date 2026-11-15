import test from 'node:test'
import assert from 'node:assert/strict'
import {Schema,Slice,Fragment} from '@milkdown/kit/prose/model'
import {EditorState,Plugin,TextSelection} from '@milkdown/kit/prose/state'
import {tableNodes,tableEditing,CellSelection,tableEditingKey} from '@milkdown/kit/prose/tables'
import {installWritingClipboard,snapshotPasteEvent} from '../../../packages/editor/src/writingClipboard.js'
const schema=new Schema({nodes:{doc:{content:'block+'},text:{group:'inline'},paragraph:{content:'inline*',group:'block'},...tableNodes({tableGroup:'block',cellContent:'paragraph+'})}})
const p=t=>schema.nodes.paragraph.create(null,t?schema.text(t):null),cell=t=>schema.nodes.table_cell.create(null,p(t)),row=(...t)=>schema.nodes.table_row.create(null,t.map(cell))
const source=new Slice(Fragment.from(schema.nodes.table.create(null,[row('P','Q')])),0,0)
const event=()=>({clipboardData:{types:['text/plain','text/html'],getData:type=>type==='text/plain'?'P Q':''}})
function fixture(inTable=true){
 const calls=[],table=tableEditing(),later=new Plugin({props:{handlePaste(view,event,slice){calls.push('ordinary');if(!view.props.editable(view.state))return false;view.dispatch(view.state.tr.replaceSelection(slice));return true}}})
 const original=table.props.handlePaste
 table.props.handlePaste=function(...args){assert.equal(this,table);calls.push('table');return original(...args)}
 let state=EditorState.create({schema,doc:schema.nodes.doc.create(null,[p('before'),schema.nodes.table.create(null,[row('A','B'),row('C','D')]),p('after')]),plugins:[later,table]})
 let first;state.doc.descendants((n,pos)=>{if(first==null&&n.type.spec.tableRole==='cell')first=pos})
 state=state.apply(state.tr.setSelection(inTable?CellSelection.create(state.doc,first):TextSelection.create(state.doc,1)))
 const props={editable:()=>true},view={get state(){return state},get editable(){return props.editable(state)},get props(){return props},dispatch:tr=>state=state.apply(tr),setProps:next=>Object.assign(props,next),someProp(name,fn){if(props[name]&&fn(props[name]))return true;for(const plugin of state.plugins)if(plugin.props[name]&&fn(plugin.props[name]))return true;return false}}
 const c=installWritingClipboard(view,{parse:()=>null,normalize:t=>t,editorId:'node'})
 return {view,c,calls,table,later,props}
}
test('keyed table handler precedes earlier greedy clipboard without moving plugins',()=>{
 const f=fixture(),plugins=f.view.state.plugins
 f.view.props.handlePaste(f.view,event(),source)
 assert.deepEqual(f.calls,['table']);assert.equal(f.view.state.plugins[0],f.later);assert.equal(f.view.state.plugins[1],f.table)
 assert.equal(f.view.state.doc.childCount,3);assert.equal(f.view.state.doc.child(1).child(0).textContent,'PB');assert.equal(f.table.key,tableEditingKey.key)
 assert.deepEqual(f.view.state.plugins,plugins)
})
test('table decline falls through once, maintaining previous and plugin order',()=>{
 const f=fixture();f.table.props.handlePaste=function(){f.calls.push('table-false');return false}
 f.view.props.handlePaste(f.view,event(),new Slice(Fragment.from(p('X')),0,0))
 assert.deepEqual(f.calls,['table-false','ordinary'])
})
test('authorized continuation keeps actual view readonly and has no recursive dispatch',()=>{
 const f=fixture(false),gate=f.props.editable
 const saved=snapshotPasteEvent(event()),plan=f.c.prepare(f.view,saved,new Slice(Fragment.from(p('X')),0,0))
 f.props.editable=()=>false;const readonly=f.props.editable
 f.c.commit(f.view,plan,{authorized:true})
 assert.equal(f.view.editable,false);assert.equal(f.props.editable,readonly);assert.notEqual(f.props.editable,gate)
 assert.deepEqual(f.calls,['ordinary']);assert.match(f.view.state.doc.textContent,/X/)
})
test('deferred route does not dispatch; captured event does not read original clipboard later',()=>{
 const f=fixture();let deferred=0
 const c=installWritingClipboard(f.view,{parse:()=>null,normalize:t=>t,editorId:'defer',deferPaste:()=>{deferred++;return true}})
 const e=event(),saved=snapshotPasteEvent(e),before=f.view.state
 e.clipboardData.getData=()=>{throw Error('late clipboard read')}
 assert.equal(c.prepare(f.view,saved,source).event.clipboardData.getData('text/plain'),'P Q')
 f.view.props.handlePaste(f.view,saved,source)
 assert.equal(deferred,1);assert.equal(f.view.state,before);assert.deepEqual(f.calls,[])
})
