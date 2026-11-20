import {Fragment} from '@milkdown/kit/prose/model'
import {TextSelection} from '@milkdown/kit/prose/state'
import {closeHistory} from '@milkdown/kit/prose/history'

function elementAt(view,pos){
 const node=view.nodeDOM(pos)
 return node?.nodeType===1?node:node?.parentElement
}
function emptyTail(doc,paragraph){
 let tail=[],lastContent=null
 doc.forEach((node,pos)=>{
  if(node.type===paragraph&&node.content.size===0)tail.push({node,pos})
  else{tail=[];lastContent={node,pos}}
 })
 return{tail,lastContent}
}

// Geometry is in client coordinates. DOM CSS zoom changes rect/offsetWidth;
// native WebView zoom already supplies consistent CSS client coordinates.
export function prepareEndBlank(view,point){
 if(!view.editable||view.composing||!Number.isFinite(point.x)||!Number.isFinite(point.y))return null
 const paragraph=view.state.schema.nodes.paragraph,rect=view.dom.getBoundingClientRect()
 if(!paragraph||!rect.width||point.x<rect.left||point.x>rect.right||point.y<rect.top||point.y>innerHeight)return null
 const {tail,lastContent}=emptyTail(view.state.doc,paragraph)
 const lastElement=lastContent?elementAt(view,lastContent.pos):null
 const lastRect=lastElement?.getBoundingClientRect()
 // A hidden/opaque terminal node does not supply a trustworthy visual end.
 if(lastContent&&(!lastRect||lastRect.height<=0))return null
 const boundary=lastRect?.bottom??rect.top
 if(point.y<boundary)return null
 const scale=rect.width/view.dom.offsetWidth
 const reference=tail.length?elementAt(view,tail[0].pos):view.dom.querySelector(':scope > p')
 const style=getComputedStyle(reference||view.dom)
 const font=parseFloat(style.fontSize)||16
 const line=(parseFloat(style.lineHeight)||font*1.9)*scale
 // Matches the existing paragraph .8em margin when a document contains only
 // non-paragraph blocks; an actual paragraph's computed margins take priority.
 const top=reference?parseFloat(style.marginTop)||0:font*.8
 const bottom=reference?parseFloat(style.marginBottom)||0:font*.8
 const lastBottom=lastElement?parseFloat(getComputedStyle(lastElement).marginBottom)||0:0
 const firstTop=tail.length?elementAt(view,tail[0].pos).getBoundingClientRect().top:boundary+Math.max(top,lastBottom)*scale
 let pitch=line+Math.max(top,bottom)*scale
 if(tail.length>1){const measured=elementAt(view,tail[1].pos).getBoundingClientRect().top-firstTop;if(measured>0)pitch=measured}
 const desired=Math.max(0,Math.round((point.y-firstTop-line/2)/pitch))
 // A visible click normally adds a handful of paragraphs, never an unbounded
 // synthetic coordinate. Existing rows remain selectable without extra nodes.
 const index=Math.min(desired,tail.length+31)
 return{doc:view.state.doc,point:{...point},index,tailCount:tail.length}
}

export function placeEndBlank(view,plan){
 if(!plan||view.state.doc!==plan.doc)return false
 const target=prepareEndBlank(view,plan.point)
 if(!target)return false
 const paragraph=view.state.schema.nodes.paragraph,needed=Math.max(0,target.index+1-target.tailCount)
 let tr=view.state.tr
 if(needed)tr.insert(tr.doc.content.size,Fragment.fromArray(Array.from({length:needed},()=>paragraph.create())))
 const {tail}=emptyTail(tr.doc,paragraph),row=tail[target.index]
 if(!row)return false
 tr.setSelection(TextSelection.create(tr.doc,row.pos+1)).setStoredMarks(null).scrollIntoView()
 // One document-changing transaction for the complete click. The following
 // metadata-only history boundary keeps subsequent typing in its normal group.
 view.dispatch(needed?closeHistory(tr):tr)
 if(needed)view.dispatch(closeHistory(view.state.tr))
 view.focus()
 return true
}
