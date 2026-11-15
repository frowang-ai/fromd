# 当前文档查找 / 替换

Ctrl+F 或 Ctrl+H 打开临时查找栏；输入框组合输入期间不触发查询。查找只绑定当前 docId/generation 和当前模式，切页、收起恢复、外部刷新或正文变化后重新计算；不跨页面写入。

正文模式查找编辑器可见文字，Unicode 按字面匹配，ASCII 字母按大小写不敏感。连续普通文本节点可跨粗体/斜体/链接 mark 边界匹配；非文本节点（公式、图片、代码节点等）和文本块边界不会被压平为普通文字。单次替换使用首个命中字符的 mark，未选区 mark、链接 href 和表格结构保留。全部替换以一笔 ProseMirror history 事务执行，单次替换各自一笔，可撤销/重做。

源码模式只对当前 Markdown 原文做精确字面查找/替换，保留 Markdown 语法；不会自动切换模式，也不把公式/链接语法当正文节点重写。替换文本作为文字写入，不解释 HTML 或 Markdown 命令。

最多收集 10000 个命中；达到上限时显示 “+” 并禁用全部替换，避免把截断结果误报为全部。空查询无命中。查找本身不写正文；替换等待 IME、使用真实 readonly/inert 冻结和协调器 flush。持久化失败保留可见内容，正常编辑/保存链可重试。面板在窄屏收缩为一行可换行布局，关闭后焦点回到当前编辑器或源码框。

实施入口：packages/editor/src/MarkdownEditor.vue 负责正文节点范围、mark 保留和 PM history；apps/tauri/src/editor/ProseMirrorPort.vue 负责正文/source 双模式与 docId/generation 归属；apps/tauri/src/documents/coordinator.mjs 负责 IME/freeze/flush/失败重试；apps/tauri/src/App.vue 负责快捷键、计数、方向、替换栏和临时面板。

公司验证：find/replace 工作台 5/5；既有 PM 回归 4/4；共享 HTML/公式/表格 3/3；前端构建通过。原生 WebView2 快捷键、真实中文 IME 与桌面焦点仍待本机。
