import { defineConfig } from '@playwright/test';
import {fileURLToPath} from 'node:url';
const app=fileURLToPath(new URL('./',import.meta.url));
const port=Number(process.env.FROWD_BROWSER_PORT||1420);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid FROWD_BROWSER_PORT');
const origin=`http://127.0.0.1:${port}`;
export default defineConfig({
 testDir:'./tests',testMatch:'**/*.browser.spec.mjs',timeout:35000,
 workers:1,fullyParallel:false,
 use:{channel:'msedge',baseURL:origin,viewport:{width:1280,height:860},reducedMotion:'reduce',trace:'retain-on-failure'},
 outputDir:'../../output/tauri-browser-results',
 reporter:[['list'],['html',{outputFolder:'../../output/tauri-browser-report',open:'never'}]],
 webServer:{command:'"'+process.execPath+'" node_modules/vite/bin/vite.js --host 127.0.0.1 --port '+port+' --strictPort',cwd:app,url:origin,reuseExistingServer:false,timeout:30000}
});
