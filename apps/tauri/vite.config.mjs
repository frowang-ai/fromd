// Derived from SoloMD v5.0.21 Vite setup; all paths resolve from this file.
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
const path = relative => fileURLToPath(new URL(relative, import.meta.url))
export default defineConfig(({mode}) => {
 const config=JSON.parse(readFileSync(path(mode==='preview'?'./src-tauri/tauri.preview.conf.json':'./src-tauri/tauri.conf.json'),'utf8'))
 return {
 define:{__FROMD_DISTRIBUTION__:JSON.stringify({name:config.productName,version:config.version,preview:mode==='preview'})},
 resolve:{dedupe:['vue']},
 root:path('./src/'),plugins:[vue()],clearScreen:false,
 server:{host:'127.0.0.1',port:1420,strictPort:true,fs:{allow:[path('./'),path('../../packages/editor'),path('../../node_modules')]}},
 build:{outDir:path('./dist/'),emptyOutDir:true,rollupOptions:{input:path('./src/index.html')}}
 }
})
