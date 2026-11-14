// Derived from SoloMD v5.0.21 Vite setup; all paths resolve from this file.
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
const path = relative => fileURLToPath(new URL(relative, import.meta.url))
export default defineConfig({
 resolve:{dedupe:['vue']},
 root:path('./src/'),plugins:[vue()],clearScreen:false,
 server:{host:'127.0.0.1',port:1420,strictPort:true,fs:{allow:[path('./'),path('../../packages/editor'),path('../../node_modules')]}},
 build:{outDir:path('./dist/'),emptyOutDir:true,rollupOptions:{input:path('./src/index.html')}}
})
