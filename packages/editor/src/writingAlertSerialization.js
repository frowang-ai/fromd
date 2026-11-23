import {alertKind} from './markdown/extensions.js'

// Restore only a blockquote's first unmarked text marker, using AST source
// positions. A global replacement would corrupt code, body text and marked labels.
export function serializeAlertMarkers(markdown, parseMarkdown) {
 const edits=[]
 function visit(node){
  if(node.type==='blockquote'){
   const paragraph=node.children?.[0],text=paragraph?.children?.[0]
   const next=paragraph?.children?.[1]
   if(paragraph?.type==='paragraph'&&text?.type==='text'&&alertKind(text.value)
     && (text.value.includes('\n')||!next||next.type==='break')){
    const kind=alertKind(text.value),start=text.position?.start.offset
    if(start!==undefined){
     const raw=markdown.slice(start).match(/^\\?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\?\]/)?.[0]
     if(raw&&raw.replaceAll('\\','')===`[!${kind}]`)edits.push({start,end:start+raw.length,value:`[!${kind}]`})
    }
   }
  }
  node.children?.forEach(visit)
 }
 visit(parseMarkdown(markdown))
 let result=markdown
 for(const edit of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,edit.start)+edit.value+result.slice(edit.end)
 return result
}
