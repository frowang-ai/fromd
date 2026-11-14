<template><div ref="root" class="editor-root" aria-label="Markdown 编辑区"></div></template>
<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { liveEditExtension } from '../upstream/lib/cm-live-render'
import { liveBlocksExtension, liveBlocksTheme, getActiveTableCellSession } from '../upstream/lib/cm-live-blocks'
import { imeCompositionGuard, isImeComposingActive } from '../upstream/lib/cm-ime-guard'
import { dragAwareExtension } from '../upstream/lib/cm-drag-aware'
import { cjkFriendlyEmphasis } from '../upstream/lib/cm-cjk-emphasis'
import { taskListExtension } from '../upstream/lib/cm-task-list'
import { codeLanguages } from '../upstream/lib/code-languages'
import { parseTable, serializeTable } from '../upstream/lib/markdown-table'
import { applyFormat } from '../upstream/lib/md-format'
import { loadRenderDeps } from '../upstream/lib/render-deps'
import 'katex/dist/katex.min.css'

const emit=defineEmits(['change','view-change'])
const root=ref(null)
const modeSlot=new Compartment(), editableSlot=new Compartment()
let view,owner=null,mode='rendered',frozen=false,disposed=false
let readyResolve
const initialized=new Promise(resolve=>{readyResolve=resolve})
const rich=()=>liveEditExtension([...liveBlocksExtension(), liveBlocksTheme, taskListExtension()])
function configuration(){
 return [
  history(),drawSelection(),EditorView.lineWrapping,
  markdown({base:markdownLanguage,codeLanguages,extensions:[cjkFriendlyEmphasis]}),
  syntaxHighlighting(defaultHighlightStyle),
  keymap.of([
   ...[['Mod-b','bold'],['Mod-i','italic'],['Mod-k','link'],['Mod-Shift-x','strike']].map(([key,kind])=>({key,run:v=>{
    if(v.state.readOnly||v.composing)return false
    const selection=v.state.selection.main,edit=applyFormat(v.state.doc.toString(),selection.from,selection.to,kind)
    v.dispatch({changes:{from:edit.from,to:edit.to,insert:edit.insert},selection:{anchor:edit.selFrom,head:edit.selTo},userEvent:'input.format'})
    return true
   }})),
   ...defaultKeymap,...historyKeymap,...searchKeymap
  ]),
  search({top:true}),imeCompositionGuard(),dragAwareExtension(),
  modeSlot.of(mode==='source'?[]:rich()),
  editableSlot.of([EditorView.editable.of(!frozen && Boolean(owner)),EditorState.readOnly.of(frozen || !owner)]),
  EditorView.contentAttributes.of({'aria-label':'Markdown 正文','spellcheck':'false'}),
  EditorView.updateListener.of(update=>{
   if(!owner)return
   if(update.docChanged)emit('change',{...owner,markdown:update.state.doc.toString()})
   if(update.selectionSet||update.viewportChanged)emit('view-change')
  }),
  EditorView.domEventHandlers({
   click(event,v){
    if(!(event.ctrlKey||event.metaKey))return false
    const pos=v.posAtCoords({x:event.clientX,y:event.clientY});if(pos===null)return false
    const line=v.state.doc.lineAt(pos)
    const match=[...line.text.matchAll(/(?<!!)\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].find(m=>pos>=line.from+m.index&&pos<=line.from+m.index+m[0].length)
    if(!match)return false
    event.preventDefault();window.dispatchEvent(new CustomEvent('frowd:open-link',{detail:{...owner,href:match[1]}}));return true
   }
  })
 ]
}
const theme=EditorView.theme({
 '&':{height:'100%',backgroundColor:'transparent',color:'#333b38',fontSize:'16px'},
 '.cm-scroller':{fontFamily:'inherit',lineHeight:'1.85',overflow:'auto'},
 '.cm-content':{maxWidth:'860px',width:'100%',margin:'0 auto',padding:'46px 36px 108px',minHeight:'100%'},
 '.cm-line':{padding:'0'},'&.cm-focused':{outline:'none'},
 '.cm-gutters':{display:'none'},
 '.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{background:'#d4e5db !important'}
})
async function ready(){await initialized;if(disposed)throw Error('编辑器已关闭。')}
function tableCommit(){
 const cell=getActiveTableCellSession(root.value)
 if(!cell)return
 const model=cell.getCurrentModel();if(!model)return
 const current=view.state.doc.sliceString(cell.from,cell.to)
 const text=serializeTable(model)
 cell.cancelCommit()
 if(JSON.stringify(parseTable(current))!==JSON.stringify(model))view.dispatch({changes:{from:cell.from,to:cell.to,insert:text}})
}
async function waitComposition(){
 await ready()
 for(let frame=0;frame<600&&(view.composing||isImeComposingActive());frame++)await new Promise(r=>setTimeout(r,16))
 if(view.composing||isImeComposingActive())throw Error('请先完成输入法组合输入，再重试。')
}
function capture(){
 if(!view||!owner)return null
 tableCommit()
 const selection=view.state.selection.main
 return {...owner,markdown:view.state.doc.toString(),state:view.state,viewState:{
  mode,scrollTop:view.scrollDOM.scrollTop,sourceScrollTop:view.scrollDOM.scrollTop,
  sourceSelection:{start:selection.anchor,end:selection.head}
 }}
}
async function activate(doc){
 await ready();owner=null
 const previous=doc.session?.state
 mode=doc.session?.viewState?.mode||doc.viewState?.mode||'rendered'
 const state=previous?.doc.toString()===doc.markdown?previous:EditorState.create({
  doc:doc.markdown,extensions:[...configuration(),theme],
  // Old PM selection values are never treated as Markdown character positions.
  selection:doc.viewState?.sourceSelection?{anchor:Math.min(doc.markdown.length,doc.viewState.sourceSelection.start),head:Math.min(doc.markdown.length,doc.viewState.sourceSelection.end)}:undefined
 })
 view.setState(state);owner={id:doc.id,generation:doc.generation};view.dispatch({effects:[modeSlot.reconfigure(mode==='source'?[]:rich()),editableSlot.reconfigure([EditorView.editable.of(!frozen && Boolean(owner)),EditorState.readOnly.of(frozen || !owner)])]})
 owner={id:doc.id,generation:doc.generation}
 const saved=doc.session?.viewState||doc.viewState
 requestAnimationFrame(()=>{if(owner?.id===doc.id){view.scrollDOM.scrollTop=saved?.sourceScrollTop??saved?.scrollTop??0}})
}
function setFrozen(value){
 frozen=value
 if(view)view.dispatch({effects:editableSlot.reconfigure([EditorView.editable.of(!value && Boolean(owner)),EditorState.readOnly.of(value || !owner)])})
 if(root.value)root.value.inert=value
}
async function setMode(value){
 await waitComposition();tableCommit();mode=value
 view.dispatch({effects:modeSlot.reconfigure(mode==='source'?[]:rich())});emit('view-change')
}
function reveal(offset){if(!view)return;const position=Math.min(offset,view.state.doc.length);view.dispatch({selection:{anchor:position},effects:EditorView.scrollIntoView(position,{y:'start',yMargin:50})});view.focus()}
function clear(){owner=null;if(view)view.setState(EditorState.create({extensions:[...configuration(),theme]}))}
function focus(){view?.focus()}
defineExpose({ready,waitComposition,capture,activate,setFrozen,setMode,reveal,clear,focus})
onMounted(()=>{
 view=new EditorView({state:EditorState.create({extensions:[...configuration(),theme]}),parent:root.value})
 readyResolve();loadRenderDeps().then(()=>{if(!disposed)window.dispatchEvent(new Event('solomd:cm-relayout'))})
})
onBeforeUnmount(()=>{disposed=true;owner=null;view?.destroy()})
</script>
