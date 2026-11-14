
// Literal search: Chinese/Unicode is exact; ASCII letters are case insensitive.
// Locations use 1-based lines and Unicode-scalar columns, never editor offsets.
export const SEARCH_LIMIT=100;
const fold=text=>text.replace(/[A-Z]/g,c=>c.toLowerCase());
export function findText(text,query){
 const index=fold(text).indexOf(fold(query));if(index<0)return null;
 const prefix=text.slice(0,index),line=prefix.split('\n').length;
 return {line,column:[...prefix.slice(prefix.lastIndexOf('\n')+1)].length,length:[...query].length,needle:query};
}
export function matchDocument(doc,markdown,query){
 const location=findText(markdown,query),titleMatch=fold(doc.title).includes(fold(query));
 if(!location&&!titleMatch)return null;
 const index=fold(markdown).indexOf(fold(query));
 const snippet=location?([...markdown.slice(0,index)].slice(-60).join('')+[...markdown.slice(index)].slice(0,180).join('')).replaceAll('\n',' '):doc.title;
 return {id:doc.id,title:doc.title,shelved:doc.shelved,revision:doc.revision,location,snippet};
}
/** One outstanding native request; only the newest query may publish.
 * A timeout reports failure without issuing unlimited overlapping IPC requests.
 * If a timed-out request finally returns, its results stay discarded.
 */
export class DocumentSearch {
 constructor(api,state,live,{timeoutMs=8000}={}){
  this.api=api;this.state=state;this.live=live;this.timeoutMs=timeoutMs;this.version=0;this.flight=null;this.queued=null;
  Object.assign(state,{searchResults:[],searchError:'',searching:false});
 }
 request(raw){
  const query=raw.trim(),version=++this.version;
  this.queued=null;Object.assign(this.state,{searchResults:[],searchError:'',searching:false});
  if(!query)return;
  if([...query].length>256){this.state.searchError='搜索词最多 256 个字符。';return}
  this.queued={query,version};this.state.searching=true;
  this.pump();
 }
 pump(){
  if(this.flight||!this.queued||this.disposed)return;
  const {query,version}=this.queued;this.queued=null;
  const flight={expired:false};this.flight=flight;
  const current=()=>!this.disposed&&version===this.version;
  const timer=setTimeout(()=>{flight.expired=true;if(current()){this.state.searching=false;this.state.searchError='搜索超时，请稍后重新搜索。'}},this.timeoutMs);
  Promise.resolve().then(()=>this.api.search(query)).then(async results=>{
   if(!current()||flight.expired)return;
   // Capture the latest editor content after IPC, including unacknowledged input.
   const live=await this.live();
   if(!current()||flight.expired)return;
   let merged=results.filter(r=>r.id!==live?.doc?.id);
   if(live?.doc){const hit=matchDocument(live.doc,live.markdown,query);if(hit)merged.push(hit)}
   const positions=new Map((live?.documents??[]).map((d,i)=>[d.id,i]));
   this.state.searchResults=merged.filter(r=>positions.has(r.id)).sort((a,b)=>positions.get(a.id)-positions.get(b.id)).slice(0,SEARCH_LIMIT);
  }).catch(error=>{if(current()&&!flight.expired)this.state.searchError=String(error?.message??error)})
   .finally(()=>{clearTimeout(timer);this.flight=null;if(current())this.state.searching=false;this.pump()});
 }
 dispose(){this.disposed=true;this.version++;this.queued=null}
}
