// Ephemeral textarea undo, owned by one document session; never persisted.
// Intercept native undo so a reused textarea cannot restore another page's text.
const LIMIT=32*1024*1024, STEPS=50
export const sourceHistory = text => ({text,past:[],future:[]})
export function recordSource(history,text,selection) {
 if(text===history.text)return history
 let past=[...history.past,{text:history.text,selection}],bytes=0
 past=past.reverse().filter((step,index)=>{bytes+=step.text.length*2;return index<STEPS&&bytes<=LIMIT}).reverse()
 return {text,past,future:[]}
}
export function travelSource(history,redo,selection) {
 const from=redo?history.future:history.past
 if(!from.length)return {history,selection}
 const step=from.at(-1),current={text:history.text,selection}
 return {history:redo?{text:step.text,past:[...history.past,current],future:from.slice(0,-1)}:
  {text:step.text,past:from.slice(0,-1),future:[...history.future,current]},selection:step.selection}
}
