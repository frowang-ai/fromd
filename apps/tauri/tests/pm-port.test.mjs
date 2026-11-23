import test from 'node:test'
import assert from 'node:assert/strict'
import {sourceHistory,recordSource,travelSource} from '../src/editor/sourceHistory.mjs'
import {sourceOffset,markdownRange} from '../../../packages/editor/src/writingMarkdownLocation.js'
import {Schema} from '@milkdown/kit/prose/model'
test('source undo and redo are immutable per-doc sessions and never cross owners',()=>{
 const a=sourceHistory('A'),b=sourceHistory('B'),edit=recordSource(a,'A 中文',{start:1,end:1})
 assert.equal(a.text,'A');assert.equal(b.text,'B')
 const previous=travelSource(edit,false,{start:4,end:4});assert.equal(previous.history.text,'A')
 assert.equal(travelSource(previous.history,true).history.text,'A 中文')
 assert.equal(travelSource(b,false).history.text,'B')
})
test('source history bounds large repeated edits without changing latest content',()=>{
 let h=sourceHistory('')
 for(let i=0;i<70;i++)h=recordSource(h,'x'.repeat(300000)+i,{start:0,end:0})
 assert.ok(h.past.length<=50);assert.ok(h.past.reduce((n,s)=>n+s.text.length*2,0)<=32*1024*1024)
 assert.ok(h.text.endsWith('69'))
})
test('neutral line/Unicode columns map to source offsets including emoji',()=>{
 assert.equal(sourceOffset('前行\n😀中文',{line:2,column:1}),5)
})
test('Markdown positions distinguish repeated blocks and retain syntax-only block location',()=>{
 const schema=new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'text*'},text:{}}})
 const p=text=>schema.nodes.paragraph.create(null,schema.text(text)),doc=schema.nodes.doc.create(null,[p('重复'),p('重复')])
 const markdown='重复\n\n**重复**',ast={type:'root',children:[{type:'paragraph',position:{start:{offset:0},end:{offset:2}}},{type:'paragraph',position:{start:{offset:4},end:{offset:10}}}]}
 assert.deepEqual(markdownRange(doc,ast,markdown,6,'重复'),{from:5,to:7,exact:true})
 assert.deepEqual(markdownRange(doc,ast,markdown,4,'**'),{from:5,to:7,exact:false})
})
