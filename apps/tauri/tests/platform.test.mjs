import {test} from 'node:test'
import assert from 'node:assert/strict'
import {describePlatform,formatShortcut,matchCommand,usesNativeAccelerator} from '../src/platform.mjs'
import {linkGesture} from '../../../packages/editor/src/writingLinks.js'
const win=describePlatform({platform:'Win32'}),mac=describePlatform({platform:'MacIntel'})
const key=(key,mods={})=>({key,...mods})
test('test platform overrides require the browser harness; native chrome policies differ',()=>{
 assert.equal(describePlatform({platform:'Win32',search:'?testPlatform=macos'}).os,'windows')
 assert.equal(describePlatform({platform:'Win32',browserTestHost:true,search:'?testPlatform=macos'}).os,'macos')
 assert.equal(describePlatform({platform:'MacIntel',nativeWindow:true}).nativeMenu,true)
 assert.equal(describePlatform({platform:'MacIntel',nativeWindow:true}).customControls,false)
 assert.equal(describePlatform({platform:'Win32',nativeWindow:true}).customDrag,true)
 assert.equal(describePlatform({platform:'MacIntel'}).nativeMenu,false)
})
test('platform command matching leaves macOS hide and app switching to the OS',()=>{
 for(const [platform,mods] of [[win,{ctrlKey:true}],[mac,{metaKey:true}]]){
  for(const [char,id] of [['n','new'],['o','open'],['s','save'],['/','source'],['f','find'],[',','reading']])assert.equal(matchCommand(key(char,mods),platform),id)
  for(const [char,code,id] of [['+','Equal','zoomIn'],['_','Minus','zoomOut'],[')','Digit0','zoomReset']]){
   assert.equal(matchCommand(key(char,{...mods,code,shiftKey:true}),platform),id)
  }
  for(const char of ['+','=','-','0'])assert.equal(matchCommand(key(char,mods),platform),null)
  assert.equal(matchCommand(key('+',{...mods,code:'NumpadAdd'}),platform),'zoomIn')
  assert.equal(matchCommand(key('s',{...mods,shiftKey:true}),platform),'saveAs')
  assert.equal(matchCommand(key('n',{...mods,altKey:true}),platform),null)
  assert.equal(matchCommand(key('n',{ctrlKey:true,metaKey:true}),platform),null)
  assert.equal(matchCommand(key('Tab',{ctrlKey:true}),platform),'nextTab')
  assert.equal(matchCommand(key('Tab',{ctrlKey:true,shiftKey:true}),platform),'previousTab')
 }
 assert.equal(matchCommand(key('h',{metaKey:true}),mac),null)
 assert.equal(matchCommand(key('Tab',{metaKey:true}),mac),null)
 assert.equal(matchCommand(key('f',{metaKey:true,altKey:true}),mac),'replace')
 assert.equal(matchCommand(key('h',{ctrlKey:true}),win),'replace')
 assert.equal(matchCommand(key('n',{metaKey:true}),win),null)
 assert.equal(matchCommand(key('n',{ctrlKey:true}),mac),null)
})
test('native accelerators execute once while DOM-only aliases and tab navigation remain available',()=>{
 const nativeMac=describePlatform({platform:'MacIntel',nativeWindow:true})
 assert.equal(usesNativeAccelerator('save',key('s',{metaKey:true}),nativeMac),true)
 assert.equal(usesNativeAccelerator('nextTab',key('Tab',{ctrlKey:true}),nativeMac),false)
 assert.equal(usesNativeAccelerator('zoomIn',key('+',{metaKey:true,shiftKey:true}),nativeMac),true)
 assert.equal(usesNativeAccelerator('zoomIn',key('+',{metaKey:true,code:'NumpadAdd'}),nativeMac),false)
 assert.equal(usesNativeAccelerator('save',key('s',{ctrlKey:true}),win),false)
})
test('shortcut labels and mutually exclusive link gestures',()=>{
 assert.equal(formatShortcut('saveAs',mac),'⇧⌘S')
 assert.equal(formatShortcut('replace',mac),'⌥⌘F')
 assert.equal(formatShortcut('nextTab',mac),'⌃Tab')
 assert.equal(formatShortcut('saveAs',win),'Ctrl+Shift+S')
 assert.equal(formatShortcut('zoomIn',win),'Ctrl+Shift+=')
 assert.equal(formatShortcut('zoomReset',mac),'⇧⌘0')
 assert.equal(linkGesture({metaKey:true},'meta'),true)
 assert.equal(linkGesture({ctrlKey:true},'ctrl'),true)
 assert.equal(linkGesture({ctrlKey:true},'meta'),false)
 assert.equal(linkGesture({ctrlKey:true,metaKey:true},'meta'),false)
 assert.equal(linkGesture({ctrlKey:true,metaKey:true},'ctrl'),false)
})
