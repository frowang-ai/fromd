<template>
  <!-- AppKit already supplies the titlebar and menus on macOS. -->
  <header v-if="!platform.nativeMenu" class="app-header" :data-platform="platform.os" :data-native-menu="platform.nativeMenu" @mousedown="drag">
    <div class="brand"><img src="./assets/icon.png" alt="" /><span>{{ distribution.name }}</span><small v-if="distribution.preview">{{ distribution.version }}</small><small v-else-if="previewWindow">开发预览</small></div>
    <slot v-if="!platform.nativeMenu" name="menu" />
    <span class="window-document">{{ title || distribution.name }}</span>
    <slot />
    <div v-if="platform.customControls" class="window-controls">
      <button aria-label="最小化窗口" title="最小化" @click="act(minimizeWindow)">−</button>
      <button :aria-label="maximized ? '还原窗口' : '最大化窗口'" :title="maximized ? '还原' : '最大化'" @click="act(toggleMaximizeWindow)">{{ maximized ? '❐' : '□' }}</button>
      <button class="window-close" aria-label="关闭窗口" title="关闭" @click="act(closeWindow)">×</button>
    </div>
  </header>
</template>
<script setup>
import {onMounted,onBeforeUnmount,ref} from 'vue'
import {distribution} from './distribution.mjs'
import {nativeWindow,previewWindow,minimizeWindow,toggleMaximizeWindow,closeWindow,dragWindow,observeMaximized} from './window.mjs'
const props=defineProps({platform:{type:Object,required:true},title:String})
const emit=defineEmits(['error'])
const maximized=ref(false)
let dispose,disposed=false
async function act(work){if(!nativeWindow)return;try{await work()}catch(error){emit('error',error)}}
function drag(event){
 if(!nativeWindow||!props.platform.customDrag||event.button!==0||event.target.closest('button,input,summary,details,nav'))return
 event.preventDefault();act(event.detail===2?toggleMaximizeWindow:dragWindow)
}
onMounted(()=>{if(nativeWindow&&props.platform.customControls)observeMaximized(value=>maximized.value=value).then(fn=>{if(disposed)fn();else dispose=fn}).catch(error=>emit('error',error))})
onBeforeUnmount(()=>{disposed=true;dispose?.()})
</script>
