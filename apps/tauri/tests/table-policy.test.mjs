import test from 'node:test'
import assert from 'node:assert/strict'
import {Schema,Slice,Fragment} from '@milkdown/kit/prose/model'
import {EditorState,Plugin,TextSelection} from '@milkdown/kit/prose/state'
import {history,undo,redo} from '@milkdown/kit/prose/history'
import {tableNodes,tableEditing,CellSelection,TableMap,mergeCells,splitCell,tableEditingKey} from '@milkdown/kit/prose/tables'
import {textFirstTablePlugins} from '../../../packages/editor/src/writingTableSelectionPolicy.js'
const schema=new Schema({nodes:{doc:{content:'block+'},paragraph:{content:'inline*',group:'block'},text:{group:'inline'},...tableNodes({tableGroup:'block',cellContent:'paragraph+'})}})
const paragraph=text=>schema.nodes.paragraph.create(null,text?schema.text(text):null)
const cell=text=>schema.nodes.table_cell.create(null,paragraph(text))
const row=(...texts)=>schema.nodes.table_row.create(null,texts.map(cell))
const table=()=>schema.nodes.table.create(null,[row('A','B'),row('C','D')])
function fixture(){
 const base=tableEditing({allowTableNodeSelection:true}),other=new Plugin({}),plugins=[history(),other,base],wrapped=textFirstTablePlugins(plugins)
 let state=EditorState.create({schema,doc:schema.nodes.doc.create(null,[paragraph('before'),table(),paragraph('after')]),plugins:wrapped})
 const dispatch=tr=>state=state.apply(tr)
 const cells=()=>{const result=[];state.doc.descendants((n,p)=>{if(n.type.spec.tableRole==='cell')result.push(p)});return result}
 return {base,other,plugins,wrapped,dispatch,cells,get state(){return state},get table(){return state.doc.child(1)}}
}
test('table policy preserves keyed index/state and every unrelated prop, including paste/keys',()=>{
 const f=fixture(),wrapped=f.wrapped[2]
 assert.equal(wrapped.key,tableEditingKey.key);assert.equal(f.wrapped[1],f.other);assert.equal(wrapped.spec.state,f.base.spec.state)
 for(const key of Object.keys(f.base.spec.props))if(key!=='handleDOMEvents')assert.equal(wrapped.spec.props[key],f.base.spec.props[key])
 assert.equal(textFirstTablePlugins(f.wrapped),f.wrapped)
})
test('cross-cell TextSelection remains text; structural table repair remains active',()=>{
 const f=fixture(),[a,,c]=f.cells()
 f.dispatch(f.state.tr.setSelection(TextSelection.create(f.state.doc,a+3,c+3)))
 assert.ok(f.state.selection instanceof TextSelection)
 const old=f.table.textContent,cells=f.cells()
 f.dispatch(f.state.tr.delete(cells[1],cells[1]+f.state.doc.nodeAt(cells[1]).nodeSize))
 assert.equal(TableMap.get(f.table).problems,null)
 assert.equal(f.table.childCount,2);assert.equal(f.table.child(0).childCount,2)
 assert.equal(f.table.textContent,old.replace('B',''))
})
test('explicit cell merge/split and undo/redo keep contents under text-first appendTransaction',()=>{
 const f=fixture(),before=f.state.doc.toJSON(),[a,b]=f.cells()
 f.dispatch(f.state.tr.setSelection(CellSelection.create(f.state.doc,a,b)))
 assert.equal(mergeCells(f.state,f.dispatch),true);assert.equal(f.table.firstChild.childCount,1)
 assert.equal(f.table.firstChild.firstChild.attrs.colspan,2);assert.equal(f.table.textContent,'ABCD')
 const merged=f.state.doc.toJSON();assert.equal(undo(f.state,f.dispatch),true);assert.deepEqual(f.state.doc.toJSON(),before)
 assert.equal(redo(f.state,f.dispatch),true);assert.deepEqual(f.state.doc.toJSON(),merged)
 assert.equal(splitCell(f.state,f.dispatch),true);assert.equal(TableMap.get(f.table).problems,null);assert.equal(f.table.firstChild.childCount,2)
})
for(const explicit of [false,true])test('table paste delegates original handler and preserves surrounding blocks (cells='+explicit+')',()=>{
 const f=fixture(),[a]=f.cells()
 f.dispatch(f.state.tr.setSelection(explicit?CellSelection.create(f.state.doc,a):TextSelection.create(f.state.doc,a+2)))
 const view={get state(){return f.state},dispatch:f.dispatch}
 const slice=new Slice(Fragment.from(schema.nodes.table.create(null,[row('P','Q')])),0,0)
 assert.equal(f.wrapped[2].props.handlePaste(view,{},slice),true)
 assert.equal(f.state.doc.firstChild.textContent,'before');assert.equal(f.state.doc.lastChild.textContent,'after')
 assert.equal(f.table.childCount,2);assert.equal(TableMap.get(f.table).problems,null)
 assert.match(f.table.textContent,/P/);assert.ok(f.table.textContent.includes('C'))
})
