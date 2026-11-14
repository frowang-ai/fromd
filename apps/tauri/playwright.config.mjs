import { defineConfig } from '@playwright/test';
import {fileURLToPath} from 'node:url';
const app=fileURLToPath(new URL('./',import.meta.url));
export default defineConfig({
 testDir:'./tests',testMatch:'**/*.browser.spec.mjs',timeout:35000,
 workers:1,fullyParallel:false,
 use:{channel:'msedge',baseURL:'http://127.0.0.1:1420',viewport:{width:1280,height:860},reducedMotion:'reduce',trace:'retain-on-failure'},
 outputDir:'../../output/tauri-browser-results',
 reporter:[['list'],['html',{outputFolder:'../../output/tauri-browser-report',open:'never'}]],
 webServer:{command:'"'+process.execPath+'" node_modules/vite/bin/vite.js --host 127.0.0.1',cwd:app,url:'http://127.0.0.1:1420',reuseExistingServer:false,timeout:30000}
});
