// Thin host startup handshake. Native pending-close ownership stays in Rust;
// this barrier only defers the claimed request until document startup settles.
export async function initializeCloseHandshake({listen,acknowledge,boot,close,cancel,report}) {
 let disposed=false,flight=null,releaseBoot,unsubscribe
 const bootSettled=new Promise(resolve=>{releaseBoot=resolve})
 const cancelPending=async()=>{try{await cancel()}catch(error){report(error)}}
 const handleClose=()=>{
  if(disposed)return Promise.resolve()
  if(!flight)flight=(async()=>{
   const booted=await bootSettled
   if(disposed)return
   if(!booted){await cancelPending();return}
   try{await close()}catch(error){report(error);await cancelPending()}
  })().finally(()=>{flight=null})
  return flight
 }
 let listenerReady=false
 try{
  unsubscribe=await listen(handleClose)
  const pending=await acknowledge()
  listenerReady=true
  if(pending)void handleClose()
 }catch(error){report(error);await cancelPending()}
 let booted=false
 try{await boot();booted=true}catch(error){report(error)}
 finally{releaseBoot(booted&&listenerReady)}
 return ()=>{disposed=true;unsubscribe?.()}
}
