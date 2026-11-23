# 当前文档查找 / 替换

Ctrl+F、Ctrl+H 或“编辑 → 查找 / 替换…”打开临时查找栏；输入框组合输入期间不触发查询，Enter 也不会在组合输入时触发。查找结果产生时固定 docId/generation/mode/query/matchCase 和正文快照；切页、收起恢复、外部刷新、正文变化或模式变化后重新计算，排队期间目标变化会取消替换；不跨页面写入。

正文模式查找编辑器可见文字，Unicode 按字面匹配，ASCII 字母默认按大小写不敏感。面板的 Aa（区分大小写）按钮控制 `matchCase`，开启后只匹配相同大小写；该选项不改变全文搜索。连续普通文本节点可跨粗体/斜体/链接 mark 边界匹配；非文本节点（公式、图片、代码节点等）和文本块边界不会被压平为普通文字。单次替换使用首个命中字符的 mark，未选区 mark、链接 href 和表格结构保留。全部替换以一笔 ProseMirror history 事务执行，单次替换各自一笔，可撤销/重做。

源码模式只对当前 Markdown 原文做精确字面查找/替换，保留 Markdown 语法，并使用相同的 `matchCase` 选项；不会自动切换模式，也不把公式/链接语法当正文节点重写。替换文本作为文字写入，不解释 HTML 或 Markdown 命令。显式查找会将源码命中滚入视口且保留查找框焦点，后台刷新不移动光标。CRLF 原文定位到 textarea 时单独转换 DOM 坐标，不改写原 Markdown。

最多收集 10000 个命中；达到上限时显示 “+” 并禁用全部替换，且正文/source 执行层再次拒绝超限的全部替换，避免把截断结果误报为全部。空查询同步清除计数和旧目标。上一处/下一处按命中列表循环。查找本身不写正文；替换等待 IME、使用真实 readonly/inert 冻结和协调器 flush。持久化失败保留可见内容，正常编辑/保存链可重试。面板在窄屏收缩为一行可换行布局，关闭后焦点回到当前编辑器或源码框。

实施入口：packages/editor/src/MarkdownEditor.vue 负责正文节点范围、mark 保留和 PM history；apps/tauri/src/editor/ProseMirrorPort.vue 负责正文/source 双模式与 docId/generation 归属；apps/tauri/src/documents/coordinator.mjs 负责 IME/freeze/flush/失败重试；apps/tauri/src/App.vue 负责快捷键、计数、方向、替换栏和临时面板。

公司阶段的 find/replace 工作台 5/5、PM 4/4、共享 HTML/公式/表格 3/3 保留为历史证据。本轮正文/源码大小写按钮、替换与撤销已通过实际 UI 回归；完整测试及原生跨页搜索选区验证见 [VALIDATION_ROUND_ONE](VALIDATION_ROUND_ONE.md)。物理输入法及原生查找快捷键仍未单独验收。
