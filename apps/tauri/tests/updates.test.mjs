import test from 'node:test'
import assert from 'node:assert/strict'
import {UpdateController} from '../src/updates/controller.mjs'
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function fixture(platform='windows'){
 const state={},calls=[]
 const api={check:async()=>({currentVersion:'0.5.2',version:'0.6.0',platform}),download:async()=>calls.push('download'),install:async()=>calls.push('install'),openPage:async()=>calls.push('page'),onProgress:async fn=>{api.progress=fn;return()=>calls.push('unlisten')}}
 const coordinator={handoffUpdate:async install=>{calls.push('save');await install()}}
 return {state,calls,api,controller:new UpdateController(api,coordinator,state)}
}
test('manual check only, newest version and coalesced checks',async()=>{
 const f=fixture(),gate=deferred();f.api.check=()=>gate.promise
 assert.equal(f.state.visible,false)
 const first=f.controller.check(),second=f.controller.check();assert.equal(first,second)
 await Promise.resolve();assert.equal(f.state.phase,'checking')
 gate.resolve({currentVersion:'0.5.2',version:null,platform:'windows'});await first
 assert.equal(f.state.phase,'upToDate');f.controller.dismiss();assert.equal(f.state.visible,false)
})
test('download progress then save handoff, no duplicate installation',async()=>{
 const f=fixture(),gate=deferred();await f.controller.check()
 f.api.download=async()=>{f.calls.push('download');await gate.promise}
 const flight=f.controller.update();assert.equal(flight,f.controller.update())
 await new Promise(r=>setImmediate(r));f.api.progress({downloaded:45,total:100})
 assert.equal(f.state.downloaded,45);assert.equal(f.controller.blocksClose,true)
 f.controller.dismiss();assert.equal(f.state.visible,true)
 gate.resolve();await flight
 assert.deepEqual(f.calls,['download','unlisten','save','install']);assert.equal(f.state.phase,'installing')
})
for(const step of ['check','onProgress','download','install'])test(`${step} failure is retryable in place`,async()=>{
 const f=fixture(),original=f.api[step];f.api[step]=async()=>{throw Error('合成失败')}
 await f.controller.check();if(step!=='check')await f.controller.update()
 assert.equal(f.state.phase,'error');assert.equal(f.state.error,'合成失败');assert.equal(f.controller.blocksClose,false)
 f.api[step]=original;await f.controller.retry();assert.equal(f.state.phase,step==='check'?'available':'installing')
})
test('macOS opens controlled page without save/download/exit',async()=>{
 const f=fixture('macos');await f.controller.check();await f.controller.update()
 assert.deepEqual(f.calls,['page']);assert.equal(f.state.phase,'available')
})
