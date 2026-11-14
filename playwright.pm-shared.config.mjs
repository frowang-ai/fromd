// Existing shared-editor regressions affected by initialization/table policy.
// Use synthetic paste events; the OS clipboard-writing probe is excluded.
import {defineConfig} from '@playwright/test'
import base from './playwright.editor.config.mjs'
export default defineConfig({
 ...base,testDir:'./tests',
 grep:/文本样式样例|任务列表|AI 附录表格|单元格|列表 Tab|有序列表缩进|行内公式原位|行间公式多行修改|多笔记标签|源码转换/,
 grepInvert:/完整 reporter/,
 use:{...base.use,channel:'msedge'},
 outputDir:'output/pm-shared-editor-results',
 reporter:[['list'],['html',{outputFolder:'output/pm-shared-editor-report',open:'never'}]],
})
