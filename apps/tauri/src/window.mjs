import {isTauri} from '@tauri-apps/api/core'
import {getCurrentWindow} from '@tauri-apps/api/window'
import {getCurrentWebview} from '@tauri-apps/api/webview'

export const nativeWindow=isTauri()
export const previewWindow=import.meta.env.DEV&&nativeWindow
export function minimizeWindow(){return getCurrentWindow().minimize()}
export function toggleMaximizeWindow(){return getCurrentWindow().toggleMaximize()}
// close() emits CloseRequested; the Rust host still waits for close_ready.
export function closeWindow(){return getCurrentWindow().close()}
export function dragWindow(){return getCurrentWindow().startDragging()}
export async function observeMaximized(callback){
 const window=getCurrentWindow()
 const update=async()=>callback(await window.isMaximized())
 await update()
 return window.onResized(update)
}
export function setPageZoom(percent){
 if(nativeWindow)return getCurrentWebview().setZoom(percent/100)
 // Browser-only IPC tests use layout zoom. The native client exclusively uses
 // WebView zoom, so the two mechanisms can never compound.
 const scale=percent/100
 document.documentElement.style.zoom=String(scale)
 document.documentElement.style.setProperty('--test-page-zoom',String(scale))
 return Promise.resolve()
}
