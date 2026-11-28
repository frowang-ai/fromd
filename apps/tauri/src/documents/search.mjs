
// Literal search: Chinese/Unicode is exact; ASCII letters are case insensitive.
// Locations use 1-based lines and Unicode-scalar columns, never editor offsets.
export const SEARCH_LIMIT=100;
const SEARCH_CHUNK = 64 * 1024;
const fold = text => /[^\x00-\x7f]/.test(text)
  ? text.replace(/[A-Z]/g, char => char.toLowerCase()) : text.toLowerCase();

export function* literalMatchOffsets(text, query, matchCase = false) {
 const needle = matchCase ? query : fold(query);
 if (!needle.length) return;
 const chunkSize = Math.max(SEARCH_CHUNK, needle.length);
 let next = 0;
 while (next <= text.length - needle.length) {
  const start = next;
  next = start + chunkSize;
  // Include enough of the next chunk to complete a match starting here.
  const chunk = text.slice(start, next + needle.length - 1);
  const haystack = matchCase ? chunk : fold(chunk);
  for (let index = haystack.indexOf(needle); index >= 0;
       index = haystack.indexOf(needle, index + needle.length)) {
   const offset = start + index;
   next = Math.max(next, offset + needle.length);
   yield offset;
  }
 }
}

function literalIndex(text, query) {
 return query ? literalMatchOffsets(text, query).next().value ?? -1 : 0;
}

function locationAt(text, index, needle) {
 let line = 1, column = 0;
 for (let offset = 0; offset < index; offset++) {
  if (text.charCodeAt(offset) === 10) {
   line++;
   column = 0;
  } else {
   column++;
   if (offset + 1 < index && text.codePointAt(offset) > 0xffff) offset++;
  }
 }
 return {line, column, length:[...needle].length, needle};
}

export function findText(text,query){
 const index = literalIndex(text, query);
 return index < 0 ? null : locationAt(text, index, query);
}
export function matchDocument(doc,markdown,query){
 const index = literalIndex(markdown, query);
 if (index < 0 && literalIndex(doc.title, query) < 0) return null;
 const location = index < 0 ? null : locationAt(markdown, index, query);
 // Two UTF-16 units per scalar cover the window even when all are surrogate pairs.
 const before = location ? [...markdown.slice(Math.max(0, index - 120), index)].slice(-60).join('') : '';
 const after = location ? [...markdown.slice(index, index + 360)].slice(0, 180).join('') : '';
 const snippet = location ? (before + after).replaceAll('\n', ' ') : doc.title;
 return {id:doc.id,title:doc.title,shelved:doc.shelved,revision:doc.revision,location,snippet};
}
/** One outstanding native request; only the newest query may publish.
 * A timeout reports failure without issuing unlimited overlapping IPC requests.
 * If a timed-out request finally returns, its results stay discarded.
 */
export class DocumentSearch {
 constructor(api,state,live,{timeoutMs=8000}={}){
  this.api=api;this.state=state;this.live=live;this.timeoutMs=timeoutMs;this.version=0;this.flight=null;this.queued=null;this.requested=null;
  Object.assign(state,{searchResults:[],searchError:'',searching:false});
 }
 request(raw){
  if(this.disposed)return;
  const query=raw.trim(),version=++this.version;
  this.queued=null;this.requested=null;Object.assign(this.state,{searchResults:[],searchError:'',searching:false});
  if(!query)return;
  if([...query].length>256){this.state.searchError='搜索词最多 256 个字符。';return}
  this.requested={query,version};
  if(this.flight?.expired){this.state.searchError='上次搜索尚未结束，请等待后重试。';return}
  this.queued={query,version};this.state.searching=true;
  this.pump();
 }
 pump(){
  if(this.flight||!this.queued||this.disposed)return;
  const {query,version}=this.queued;this.queued=null;
  const flight={expired:false};this.flight=flight;
  const current=()=>!this.disposed&&version===this.version;
  const timer=setTimeout(()=>{
   flight.expired=true;
   // invoke cannot be cancelled: keep its slot, but terminate every waiting query.
   // Never silently restart queued work or accumulate a second hung native call.
   this.queued=null;
   if(!this.disposed&&this.requested?.version===this.version){
    this.state.searching=false;this.state.searchError='搜索超时，上次请求尚未结束。请等待后重试。';
   }
  },this.timeoutMs);
  flight.timer=timer;
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
 dispose(){this.disposed=true;this.version++;this.queued=null;this.requested=null;clearTimeout(this.flight?.timer)}
}
