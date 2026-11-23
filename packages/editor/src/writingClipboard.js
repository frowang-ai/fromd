import { DOMParser, DOMSerializer, Slice, Fragment } from '@milkdown/kit/prose/model'
import {Transform} from '@milkdown/kit/prose/transform'
import {tableEditingKey,TableMap} from '@milkdown/kit/prose/tables'
import { logWritingEvent } from './writingDiagnostics.js'

export function describeWritingDocument(doc) {
  const counts = { displayMath: 0, inlineMath: 0, headings: 0, tables: 0 }
  doc.descendants(node => {
    if (node.type.name === 'math_inline') counts.inlineMath++
    if (node.type.name === 'code_block' && String(node.attrs.language).toLowerCase() === 'latex') counts.displayMath++
    if (node.type.name === 'heading') counts.headings++
    if (node.type.name === 'table') counts.tables++
  })
  return counts
}
function richFeatures(doc) {
  const features = {}
  const add = key => { features[key] = (features[key] || 0) + 1 }
  doc.descendants(node => {
    if (['table', 'table_row', 'table_cell', 'table_header', 'image', 'bullet_list', 'ordered_list', 'list_item', 'blockquote'].includes(node.type.name)) add(node.type.name)
    if (['writing_comment_inline', 'writing_comment_block'].includes(node.type.name)) add('html_comment')
    if (node.type.name === 'code_block' && String(node.attrs.language).toLowerCase() !== 'latex') add('code_block')
    for (const mark of node.marks) add(`mark:${mark.type.name}`)
  })
  return features
}

// Milkdown has distinct header/data row schemas. Clipboard parsing promotes the
// first copied row to headers, which cannot be inserted into a data-only row.
// Adapt node kinds (not cell contents/attributes) before the public table handler.
function compatibleTableSlice(view,slice,event){
 const sel=view.state.selection,{$from}=sel
 let depth=$from.depth
 while(depth>0&&$from.node(depth).type.spec.tableRole!=='table')depth--
 if(!depth)return slice
 const target=$from.node(depth),schema=view.state.schema
 if(!schema.nodes.table_header_row||!schema.nodes.table_row)return slice
 let top=$from.index(depth),height=0
 if(sel.$anchorCell&&sel.$headCell){
  const start=sel.$anchorCell.start(-1)
  const rect=TableMap.get(target).rectBetween(sel.$anchorCell.pos-start,sel.$headCell.pos-start)
  top=rect.top;height=rect.bottom-rect.top
 }
 let content=slice.content
 if(content.childCount===1&&content.firstChild.type.spec.tableRole==='table')content=content.firstChild.content
 const rows=[]
 content.forEach(node=>rows.push(node))
 if(!rows.length||!rows.every(node=>node.type.spec.tableRole==='row')){
  if(!sel.$anchorCell)return slice
  const empty=schema.nodes.table_cell.createAndFill()
  const cell=new Transform(empty).replace(0,empty.content.size,slice).doc
  rows.length=0;rows.push(schema.nodes.table_row.create(null,[cell]))
 }
 const html=event.clipboardData?.getData('text/html')
 if(html&&typeof document!=='undefined'){
  const template=document.createElement('template');template.innerHTML=html
  const copied=template.content.querySelector('table[data-pm-slice]')
  // PM's own cell clipboard wraps rows in a table. Milkdown's strict table
  // schema may append an empty data row while parsing a single copied row.
  // Do not turn that schema filler into a second clipboard row.
  if(copied&&/^\d+ \d+ -2(?: |$)/.test(copied.getAttribute('data-pm-slice')||'')){
   const count=copied.rows.length
   const filler=row=>{let empty=true;row.forEach(cell=>{if(cell.childCount!==1||cell.firstChild.type.name!=='paragraph'||cell.firstChild.content.size)empty=false});return empty}
   if(count>0&&count<rows.length&&rows[0].type.name==='table_header_row'&&filler(rows[0])&&Array.from(copied.rows[0].cells).every(cell=>cell.tagName==='TD'))rows.shift()
   if(count>0&&count<rows.length&&rows.slice(count).every(filler))rows.length=count
  }
 }
 const normalized=[]
 for(let index=0;index<Math.max(rows.length,height);index++){
  const header=top+index===0,row=rows[index%rows.length],cells=[]
  const cellType=header?schema.nodes.table_header:schema.nodes.table_cell
  row.forEach(cell=>cells.push(cellType.create(cell.attrs,cell.content,cell.marks)))
  normalized.push((header?schema.nodes.table_header_row:schema.nodes.table_row).create(row.attrs,cells,row.marks))
 }
 return new Slice(Fragment.fromArray(normalized),0,0)
}

// Plan only the original keyed public table handler. Its pinned implementation
// reads state and dispatches one transaction; it needs no DOM or live view APIs.
// The collector cannot dispatch/update/focus the actual EditorView. In particular,
// table clipping/repetition runs here, before resource qualification or binding.
function prepareTablePaste(view,event,slice){
 const state=view.state,selection=state.selection
 if(selection.$from.parent.type.spec.code || selection.$from.marks().some(mark=>mark.type.spec.code))return null
 let cell=false
 for(let depth=selection.$from.depth;depth>0;depth--){
  const role=selection.$from.node(depth).type.spec.tableRole
  if(role==='cell'||role==='header_cell'){cell=true;break}
 }
 if(!cell)return null
 const plugin=state.plugins.find(plugin=>plugin.key===tableEditingKey.key)
 if(!plugin?.props.handlePaste)return null
 let transaction
 const collector=Object.freeze({state,dispatch(tr){
  if(transaction)throw Error('表格粘贴产生了多次提交，请重新粘贴。')
  transaction=tr
 }})
 const handled=Boolean(plugin.props.handlePaste.call(plugin,collector,snapshotPasteEvent(event),slice))
 if(!handled){
  if(transaction)throw Error('表格粘贴准备未完成，请重新粘贴。')
  return {handler:plugin.props.handlePaste,handled:false}
 }
 // The public handler selects exactly the inserted cells after its own geometry
 // decisions. Inspect those cells, not its full source slice or unrelated target
 // resources (even intermediate steps may carry existing split/spanned cells).
 if(!transaction||!transaction.before.eq(state.doc)||typeof transaction.selection.forEachCell!=='function')
  throw Error('表格粘贴准备无效，请重新粘贴。')
 const cells=[]
 transaction.selection.forEachCell(node=>cells.push(node))
 return {state,handler:plugin.props.handlePaste,handled:true,transaction,
  resourceSlice:new Slice(Fragment.fromArray(cells),0,0)}
}
export function snapshotPasteEvent(event){
 const values=new Map(['text/plain','text/html','vscode-editor-data','text/uri-list'].map(type=>[type,event.clipboardData?.getData(type)||'']))
 // Text aliases are not consistently included in DataTransfer.types.
 for(const type of ['text/plain','text/html','vscode-editor-data','Text'])if(!values.has(type))values.set(type,event.clipboardData?.getData(type)||'')
 return {type:'paste',timeStamp:event.timeStamp,target:event.target,defaultPrevented:false,
  preventDefault(){this.defaultPrevented=true},stopPropagation(){},
  clipboardData:{types:Array.from(event.clipboardData?.types||[]),items:[],files:[],getData:type=>values.get(type)||''}}
}

function isVscodeLatex(data) {
  try { return JSON.parse(data.getData('vscode-editor-data') || 'null')?.mode === 'latex' }
  catch { return false }
}

// HTML is ordinarily authoritative. Only use explicit Markdown math from the
// same clipboard when HTML lost formulas and doing so preserves rich features.
export function installWritingClipboard(view, { parse, normalize, editorId, deferPaste, parsePlain = false }) {
  const previous = view.props.handlePaste
  let serial = 0
  function prepareRaw(editorView, event, slice, {authorized=false}={}) {
      const inputSlice=slice;let recovered=false
      const selection=editorView.state.selection
      const literal=Boolean(selection.$from.parent.type.spec.code || selection.$from.marks().some(mark=>mark.type.spec.code))
      const data = event.clipboardData
      if (!data) return {slice,inputSlice,event,recovered,literal}
      const text = data.getData('text/plain'), html = data.getData('text/html')
      const pasteId = `${editorId}-${++serial}`
      const metadata = {
        editorId, pasteId, textLength: text.length, htmlLength: html.length,
        types: [...new Set(Array.from(data.types).map(type => ['text/plain', 'text/html', 'Files', 'vscode-editor-data'].includes(type) ? type : 'other'))],
      }
      let route = html ? 'html' : 'markdown', reason = 'default', normalized = false
      let htmlCounts = describeWritingDocument(slice.content), convertedDisplay = 0, convertedInline = 0
      logWritingEvent('paste-received', { ...metadata, htmlDisplayMath: htmlCounts.displayMath, htmlInlineMath: htmlCounts.inlineMath })
      const result = () => queueMicrotask(() => {
        if (!editorView.isDestroyed) logWritingEvent('paste-result', { editorId, pasteId, route, reason, convertedDisplay, convertedInline, ...describeWritingDocument(editorView.state.doc) })
      })
      try {
        if ((!editorView.editable&&!authorized) || literal) {
          route = 'native'; reason = 'literal-or-special-context'
        } else if (text && isVscodeLatex(data)) {
          // VS Code's language describes the source file, not an equation.
          // Use its source text, not syntax-highlighting HTML or the upstream
          // automatic latex code block (which our schema renders as math).
          const fixed = normalize(text), doc = parse(fixed)
          if (doc) {
            const fragment = DOMSerializer.fromSchema(editorView.state.schema).serializeFragment(doc.content)
            let candidate = DOMParser.fromSchema(editorView.state.schema).parseSlice(fragment)
            editorView.someProp('transformPasted', transform => { candidate = transform(candidate, editorView, false) })
            route = 'vscode-latex-source'; reason = 'source-language-is-not-math'; normalized = fixed !== text
            logWritingEvent('paste-route', { ...metadata, route, reason, normalized })
            return {slice:candidate,inputSlice,event,recovered:true,literal,result}
          }
        } else if (data.getData('vscode-editor-data')) {
          route = 'native'; reason = 'literal-or-special-context'
        } else if (text) {
          const fixed = normalize(text)
          normalized = fixed !== text
          if (html && normalized) {
            const doc = parse(fixed)
            if (doc) {
              const fragment = DOMSerializer.fromSchema(editorView.state.schema).serializeFragment(doc.content)
              let candidate = DOMParser.fromSchema(editorView.state.schema).parseSlice(fragment)
              editorView.someProp('transformPasted', transform => { candidate = transform(candidate, editorView, false) })
              const counts = describeWritingDocument(candidate.content)
              const missingMath = counts.displayMath > htmlCounts.displayMath || counts.inlineMath > htmlCounts.inlineMath
              const before = richFeatures(slice.content), after = richFeatures(candidate.content)
              const preservesRichContent = Object.entries(before).every(([key, count]) => (after[key] || 0) >= count)
              const missingStrong = (after['mark:strong'] || 0) > (before['mark:strong'] || 0)
              const preservesMath = counts.inlineMath >= htmlCounts.inlineMath && counts.displayMath >= htmlCounts.displayMath
              if ((missingMath || missingStrong) && preservesRichContent && preservesMath) {
                route = missingMath ? 'markdown-math-recovery' : 'markdown-format-recovery'
                reason = missingMath ? 'html-lost-explicit-math' : 'html-lost-explicit-strong'
                convertedDisplay = Math.max(0, counts.displayMath - htmlCounts.displayMath)
                convertedInline = Math.max(0, counts.inlineMath - htmlCounts.inlineMath)
                logWritingEvent('paste-route', { ...metadata, route, reason, normalized, convertedDisplay, convertedInline })
                return {slice:candidate,inputSlice,event,recovered:true,literal,result}
              }
              if (missingMath || missingStrong) reason = preservesMath ? 'html-has-additional-rich-content' : 'html-preserves-math'
              else reason = 'html-format-already-preserved'
            }
          }
        }
      } catch (error) {
        route = html ? 'html' : 'markdown'
        reason = 'recovery-error-fallback'
        logWritingEvent('paste-error', { editorId, pasteId, errorType: error instanceof TypeError ? 'TypeError' : 'Error' })
      }
      logWritingEvent('paste-route', { ...metadata, route, reason, normalized })
      if(parsePlain&&!html&&!literal&&!data.getData('vscode-editor-data')&&/(?:\.frowd-assets\/|blob:|frowd-resource[.:])/i.test(text)){
        const doc=parse(text);if(doc)slice=Slice.maxOpen(doc.content)
      }
      return {slice,inputSlice,event,recovered,literal,result}
  }
  function prepare(editorView,event,slice,options){
    const plan=prepareRaw(editorView,event,slice,options)
    if(!plan.literal)plan.slice=compatibleTableSlice(editorView,plan.slice,plan.event)
    // A parsed LaTeX source selection uses the normal table paste path too.
    plan.table=plan.literal||(!plan.recovered&&event.clipboardData?.getData('vscode-editor-data'))?null:prepareTablePaste(editorView,event,plan.slice)
    plan.resourceSlice=plan.table?.resourceSlice??plan.slice
    return plan
  }
  function commit(editorView,plan,{authorized=false}={}){
    const {event,slice}=plan
    const table=plan.table
    if(table?.handled){
      if(editorView.state!==table.state)throw Error('正文或选区已变化，请重新粘贴。')
      editorView.dispatch(table.transaction)
      plan.result?.();return true
    }
    if(plan.recovered){
      editorView.dispatch(editorView.state.tr.replaceSelection(slice).scrollIntoView().setMeta('paste',true).setMeta('uiEvent','paste'))
      plan.result?.();return true
    }
    // Only the explicit owned commit can pass the logical editability gate.
    // The actual view props, owner, readonly DOM and inert lock never change.
    const operationView=authorized?Object.create(editorView):editorView
    if(authorized)Object.defineProperties(operationView,{
      props:{value:{...editorView.props,editable:()=>true}},
      editable:{value:true},
      state:{get:()=>editorView.state},
      dispatch:{value:editorView.dispatch.bind(editorView)},
    })
    let handled=false
    editorView.someProp('handlePaste',handler=>{
      if(handler===handlePaste){handled=Boolean(previous?.(operationView,event,slice));return handled}
      if(table&&handler===table.handler)return false
      handled=Boolean(handler(operationView,event,slice));return handled
    })
    if(!handled){
      const single=slice.openStart===0&&slice.openEnd===0&&slice.content.childCount===1?slice.content.firstChild:null
      const tr=single?editorView.state.tr.replaceSelectionWith(single,plan.literal):editorView.state.tr.replaceSelection(slice)
      editorView.dispatch(tr.scrollIntoView().setMeta('paste',true).setMeta('uiEvent','paste'))
    }
    plan.result?.();return true
  }
  function handlePaste(editorView,event,slice){
    const plan=prepare(editorView,event,slice)
    if(deferPaste?.(editorView,event,plan))return true
    return commit(editorView,plan)
  }
  view.setProps({handlePaste})
  return {prepare,commit}
}
