import {test} from 'node:test'
import assert from 'node:assert/strict'
import {initializeCloseHandshake} from '../src/documents/closeHandshake.mjs'
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function setup({pending=false,bootFailure=false,closeFailure=false}={}){
 const bootGate=deferred(),bootEntered=deferred(),events=[],errors=[]
 let handler,closes=0,cancels=0,removed=0
 const initialization=initializeCloseHandshake({
  listen:async callback=>{events.push('listen');handler=callback;return()=>removed++},
  acknowledge:async()=>{events.push('ack');return pending},
  boot:async()=>{events.push('boot');bootEntered.resolve();await bootGate.promise;if(bootFailure)throw Error('boot failed');events.push('booted')},
  close:async()=>{closes++;events.push('close');if(closeFailure&&closes===1)throw Error('save failed')},
  cancel:async()=>{cancels++;events.push('cancel')},report:error=>errors.push(error.message)
 })
 return {initialization,bootGate,bootEntered,events,errors,handle:()=>handler(),counts:()=>({closes,cancels,removed})}
}
test('a pre-listener pending request is claimed once and saves only after boot',async()=>{
 const h=setup({pending:true});await h.bootEntered.promise
 const first=h.handle(),duplicate=h.handle();assert.equal(first,duplicate)
 assert.deepEqual(h.events,['listen','ack','boot']);assert.equal(h.counts().closes,0)
 h.bootGate.resolve();await h.initialization;await first
 assert.deepEqual(h.events,['listen','ack','boot','booted','close'])
 assert.equal(h.counts().closes,1);assert.deepEqual(h.errors,[])
})
test('an event racing the acknowledgement reply still waits for boot and closes once',async()=>{
 const ackGate=deferred(),ackEntered=deferred(),bootGate=deferred(),bootEntered=deferred()
 let handler,closed=0
 const initialization=initializeCloseHandshake({
  listen:async fn=>{handler=fn;return()=>{}},acknowledge:()=>{ackEntered.resolve();return ackGate.promise},
  boot:async()=>{bootEntered.resolve();await bootGate.promise},close:async()=>closed++,cancel:async()=>{},report:error=>{throw error}
 })
 await ackEntered.promise;const requested=handler()
 ackGate.resolve(false);await bootEntered.promise;assert.equal(closed,0)
 bootGate.resolve();await initialization;await requested;assert.equal(closed,1)
})
test('startup failure settles the pending close by canceling instead of saving an uninitialized document',async()=>{
 const h=setup({pending:true,bootFailure:true});await h.bootEntered.promise
 const requested=h.handle();h.bootGate.resolve();await h.initialization;await requested
 assert.equal(h.counts().closes,0);assert.equal(h.counts().cancels,1)
 assert.deepEqual(h.errors,['boot failed'])
})
test('save failure cancels close and a later request can retry',async()=>{
 const h=setup({pending:true,closeFailure:true});await h.bootEntered.promise
 const requested=h.handle();h.bootGate.resolve();await h.initialization;await requested
 assert.equal(h.counts().cancels,1);assert.deepEqual(h.errors,['save failed'])
 await h.handle();assert.equal(h.counts().closes,2);assert.equal(h.counts().cancels,1)
})
test('a boot with no pending request stays open and disposal removes the listener',async()=>{
 const h=setup();await h.bootEntered.promise;h.bootGate.resolve();const dispose=await h.initialization
 assert.equal(h.counts().closes,0);await h.handle();assert.equal(h.counts().closes,1)
 dispose();await h.handle();assert.equal(h.counts().closes,1);assert.equal(h.counts().removed,1)
})
