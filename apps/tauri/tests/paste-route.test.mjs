import test from 'node:test'
import assert from 'node:assert/strict'
import {Schema,Slice,Fragment} from '@milkdown/kit/prose/model'
import {EditorState,Plugin,TextSelection} from '@milkdown/kit/prose/state'
import {tableNodes,tableEditing,CellSelection,tableEditingKey} from '@milkdown/kit/prose/tables'
import {sliceResources} from '../../../packages/editor/src/writingResourcePaste.js'
import {installWritingClipboard,snapshotPasteEvent} from '../../../packages/editor/src/writingClipboard.js'
const schema=new Schema({nodes:{doc:{content:'block+'},text:{group:'inline'},paragraph:{content:'inline*',group:'block'},image:{inline:true,group:'inline',attrs:{src:{}}},...tableNodes({tableGroup:'block',cellContent:'paragraph+'})}})
const p=t=>schema.nodes.paragraph.create(null,t?schema.text(t):null),cell=t=>schema.nodes.table_cell.create(null,p(t)),row=(...t)=>schema.nodes.table_row.create(null,t.map(cell))
const source=new Slice(Fragment.from(schema.nodes.table.create(null,[row('P','Q')])),0,0)
const event=()=>({clipboardData:{types:['text/plain','text/html'],getData:type=>type==='text/plain'?'P Q':''}})
function fixture(inTable=true,outsideResource=false){
 const calls=[],table=tableEditing(),later=new Plugin({props:{handlePaste(view,event,slice){calls.push('ordinary');if(!view.props.editable(view.state))return false;view.dispatch(view.state.tr.replaceSelection(slice));return true}}})
 const original=table.props.handlePaste
 table.props.handlePaste=function(...args){assert.equal(this,table);calls.push('table');return original(...args)}
 let state=EditorState.create({schema,doc:schema.nodes.doc.create(null,[p('before'),schema.nodes.table.create(null,[row('A','B'),outsideResource?schema.nodes.table_row.create(null,[cell('C'),schema.nodes.table_cell.create(null,schema.nodes.paragraph.create(null,schema.nodes.image.create({src:'.frowd-assets/'+'c'.repeat(64)+'.png'}))) ]):row('C','D')]),p('after')]),plugins:[later,table]})
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
 assert.equal(deferred,1);assert.equal(f.view.state,before);assert.deepEqual(f.calls,['table','table'])
})

const known='.frowd-assets/'+'a'.repeat(64)+'.png',unknown='.frowd-assets/'+'b'.repeat(64)+'.png'
const image=src=>schema.nodes.image.create({src})
test('table prepare uses public clipping once with no live view, state or DOM mutation',()=>{
 const f=fixture(true,true),state=f.view.state,selection=state.selection
 Object.defineProperty(f.view,'dom',{get(){throw Error('live DOM access')}})
 let actualDispatches=0
 const dispatch=f.view.dispatch;f.view.dispatch=tr=>{actualDispatches++;dispatch(tr)}
 const original=f.table.props.handlePaste
 f.table.props.handlePaste=function(view,event,slice){
  assert.equal(Object.getPrototypeOf(view),Object.prototype)
  assert.equal(Object.isFrozen(view),true);assert.deepEqual(Object.keys(view).sort(),['dispatch','state'])
  // This changes only an in-memory event facade, never the original DOM event.
  event.preventDefault()
  return original.call(this,view,event,slice)
 }
 const richCell=(text,src)=>schema.nodes.table_cell.create(null,schema.nodes.paragraph.create(null,[schema.text(text),image(src)]))
 const slice=new Slice(Fragment.from(schema.nodes.table.create(null,[
  schema.nodes.table_row.create(null,[richCell('kept',known),richCell('cut-right',unknown)]),
  schema.nodes.table_row.create(null,[richCell('cut-below',unknown),cell('cut')])
 ])),0,0)
 const e=event();e.preventDefault=()=>{throw Error('actual event changed')}
 const plan=f.c.prepare(f.view,e,slice)
 assert.equal(f.view.state,state);assert.equal(f.view.state.selection,selection);assert.equal(actualDispatches,0)
 assert.deepEqual(f.calls,['table']);assert.deepEqual(sliceResources(plan.resourceSlice),[{reference:known,image:true}])
 assert.equal(plan.resourceSlice.content.textBetween(0,plan.resourceSlice.content.size),'kept')
 // An unrelated old resource outside the target must not join qualification.
 f.c.commit(f.view,plan,{authorized:true})
 assert.equal(actualDispatches,1);assert.deepEqual(f.calls,['table'])
 assert.equal(f.view.state.doc.child(1).child(0).child(0).textContent,'kept')
 const cells=[];f.view.state.selection.forEachCell(node=>cells.push(node))
 assert.deepEqual(new Slice(Fragment.fromArray(cells),0,0).toJSON(),plan.resourceSlice.toJSON())
})
test('prepared table transaction refuses a changed selection even when the document is equal',()=>{
 const f=fixture(),plan=f.c.prepare(f.view,event(),source),doc=f.view.state.doc
 f.view.dispatch(f.view.state.tr.setSelection(TextSelection.create(doc,1)))
 const current=f.view.state
 assert.throws(()=>f.c.commit(f.view,plan,{authorized:true}),/正文或选区已变化/)
 assert.equal(f.view.state,current);assert.equal(f.view.state.doc,doc);assert.deepEqual(f.calls,['table'])
})
