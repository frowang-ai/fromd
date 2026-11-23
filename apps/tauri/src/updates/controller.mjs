// Update UI owns network/download state; the document coordinator owns the save barrier.
export class UpdateController {
  constructor(api, coordinator, state) {
    this.api=api;this.coordinator=coordinator;this.state=state;this.flight=null;this.disposed=false
    Object.assign(state,{visible:false,phase:'idle',version:null,currentVersion:'',platform:'',downloaded:0,total:0,error:'',retry:'check'})
  }
  get busy(){return ['checking','downloading','installing','opening'].includes(this.state.phase)}
  get blocksClose(){return ['downloading','installing'].includes(this.state.phase)}
  dismiss(){if(!this.busy)this.state.visible=false}
  check(){
    this.state.visible=true
    if(this.flight)return this.flight
    return this.perform('check',async()=>{
      this.state.phase='checking'
      const result=await this.api.check()
      Object.assign(this.state,{...result,phase:result.version?'available':'upToDate'})
    })
  }
  update(){
    if(this.flight)return this.flight
    if(!this.state.version)return this.check()
    return this.perform('update',async()=>{
      if(this.state.platform!=='windows'){
        this.state.phase='opening';await this.api.openPage();this.state.phase='available';return
      }
      this.state.phase='downloading';this.state.downloaded=0;this.state.total=0
      // Listener registration precedes download, and rejection cannot leave a live flight.
      const unlisten=await this.api.onProgress(event=>{
        if(this.disposed||this.state.phase!=='downloading')return
        this.state.downloaded=event.downloaded;this.state.total=event.total
      })
      try{await this.api.download()}finally{unlisten()}
      this.state.phase='installing'
      await this.coordinator.handoffUpdate(()=>this.api.install())
    })
  }
  retry(){return this.state.retry==='update'?this.update():this.check()}
  perform(retry,work){
    this.state.visible=true;this.state.error='';this.state.retry=retry
    const flight=Promise.resolve().then(work).catch(error=>{
      this.state.error=String(error?.message??error);this.state.phase='error'
    }).finally(()=>{if(this.flight===flight)this.flight=null})
    this.flight=flight;return flight
  }
  dispose(){this.disposed=true}
}
