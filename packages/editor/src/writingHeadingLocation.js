// Independent PM adaptation of SoloMD's source-identity -> editor-coordinate
// navigation. Only heading structure participates; body block counts do not.
function headings(doc){
 const found=[]
 doc.descendants((node,pos)=>{if(node.type.name==='heading'){found.push({node,pos});return false}})
 return found
}
export function headingRange(doc,sourceAst,parsedSource,markdown,target){
 if(!Number.isInteger(target.start)||target.start<0||target.start>markdown.length||!parsedSource)return null
 const source=[]
 function visit(node){if(node.type==='heading'&&node.position){source.push(node);return}node.children?.forEach(visit)}
 visit(sourceAst)
 const line=1+[...markdown.slice(0,target.start).matchAll(/\r\n|\r|\n/g)].length
 const index=source.findIndex(node=>node.position.start.line===line&&node.depth===target.level)
 if(index<0)return null
 const expected=headings(parsedSource),actual=headings(doc)
 // The source parser and current model must describe the same heading
 // instances, including duplicates and rich inline content. Never remove a
 // count check and blindly reuse a shifted textblock index.
 if(source.length!==expected.length||actual.length!==expected.length)return null
 if(expected.some(({node},i)=>node.attrs.level!==source[i].depth||node.attrs.level!==actual[i].node.attrs.level||!node.content.eq(actual[i].node.content)))return null
 return{nodePos:actual[index].pos,from:actual[index].pos+1}
}
