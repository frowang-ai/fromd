// Derived from SoloMD v5.0.21 Vite setup; all paths resolve from this file.
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
const path = relative => fileURLToPath(new URL(relative, import.meta.url))
const KATEX_STUB='\0solomd-katex-stub'
export default defineConfig({
 root:path('./src/'),plugins:[{
  name:'solomd-katex-plugin-stub',apply:'build',enforce:'pre',
  resolveId(source,importer){if(source==='katex'&&importer&&/[\\/]@vscode[\\/]markdown-it-katex[\\/]/.test(importer))return KATEX_STUB},
  load(id){return id===KATEX_STUB?'export default null;':null}
 },vue()],clearScreen:false,
 server:{host:'127.0.0.1',port:1420,strictPort:true,fs:{allow:[path('./')]}},
 build:{outDir:path('./dist/'),emptyOutDir:true,rollupOptions:{input:path('./src/index.html')}}
})
