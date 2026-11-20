# 桌面交互与快速预览

标签右键菜单在点击位置展开，靠近窗口边缘时自动调整位置。侧栏省略号菜单
从按钮下方展开。菜单始终操作点中的页面；Esc、点击外部关闭，Shift+F10
或菜单键可打开菜单，方向键、Home/End、Enter 可操作，Esc 返回原按钮。

侧栏已展开页面的 × 是“关闭页面”，复用保存、直接删除或不保存、取消以及
最近一次移除撤销。关闭关联文件的页面不删除磁盘文件。顶部标签的 − 仍是
收起，右键菜单也保留收起其他页面和收起全部页面。

Windows 顶栏合并名称、菜单和窗口按钮；空白区及名称可拖动，双击可最大化
或还原。关闭按钮请求正常关闭，继续等待正文、名称、阅读位置和 SQLite
确认，不直接销毁窗口。名称、保存状态、字数位于正文上方左侧，占用独立
一行，正文滚动不会遮住它们。

收起和恢复直接更新页面列表与当前页，不截图、不播放动画，也没有动效开关。
操作仍先备份最后正文和名称，成功持久收起后才激活下一页；保存或收起失败时
保留原页并提示错误。侧栏隐藏、窄窗和系统“减少动态效果”设置下行为一致。
旧动效及捕获接口已从 Tauri 路径移除，历史实现和证据保留在 Git 与 output。
html2canvas 包与许可本轮暂留，未将删除依赖扩成安装或升级任务。

正文末尾下方的空白区域可单击建立或复用末尾空段，按点击高度大致留出几行，
随后直接键入或粘贴。本次补段可一次撤销/重做，留白沿用连续回车已有的格式。
只处理文末下方；正文、表格、列表、代码等块内部和源码模式保留原点击语义。

Ctrl+/ 切换正文和源码，支持中文键盘的 Slash 物理键，组合输入期间不切换。
Ctrl+滚轮、Ctrl++ / Ctrl+- 缩放整个页面，Ctrl+0 恢复 100%，范围 50%—200%。
视图菜单提供同一组操作。原生端使用主 WebView 的 `setZoom`，不改变正文
阅读字号、Markdown 或 PDF 排版；连续输入合并为单个在途缩放请求。

## 本轮本机预览

从本工作树运行（仅开发 debug，不生成安装包）：

```powershell
powershell.exe -NoProfile -File output/interactive-preview/start.ps1
powershell.exe -NoProfile -File output/interactive-preview/status.ps1
powershell.exe -NoProfile -File output/interactive-preview/stop.ps1
```

这些本机启动文件位于忽略提交的 `output`，工具位置与缓存只在进程内配置。
`start.ps1 -CheckOnly` 检查脚本语法及 Rust/MSVC；`run.ps1 -CheckOnly` 还会
实际生成和解析临时 Tauri 配置。配置每次继承正式窗口设置，只改开发标题
以及 Vite 启动命令，地址为 `http://127.0.0.1:1420`，使用 strictPort。
端口冲突时停止，不复用或关闭未知服务。

交互窗口使用 `output/interactive-preview/profile`，WebView2 位于其
`webview2` 子目录。日志为同目录 `stdout.log`、`stderr.log`，窗口标题及顶栏
显示“开发预览”。用户试用文稿由用户编辑；自动化使用另外的合成 profile。
`stop.ps1` 只遍历记录的 runner 后代并验证 PID 创建时间和原生路径，先等待
正常关闭；flush 失败或无法识别原生路径时保持运行并报告。

前端 CSS 使用 Vite HMR；Vue 组件修改可能触发组件重建或页面刷新，Rust、
权限及窗口配置修改通常需要原生重启。不能保证所有修改都保留未确认的
输入状态，前端改动无需重新打 release 或安装包。

## 相关验证入口

```powershell
$env:FROWD_BROWSER_PORT='1451'
npm --prefix apps/tauri run test:browser -- desktop-feedback.browser.spec.mjs workspace.browser.spec.mjs reading.browser.spec.mjs pm-source-history.browser.spec.mjs pm-editor.browser.spec.mjs

# 需要本机 debug exe 和可用的开发 Vite；只创建独立合成 profile。
$env:FROWD_NATIVE_EXE=Join-Path $PWD 'output/cargo-target/debug/frowd-tauri.exe'
$env:FROWD_NATIVE_HMR='1'
npm --prefix apps/tauri run test:native -- --grep 'native titlebar|native WebView2 authoring'
```

浏览器用例使用模拟 IPC，不能证明原生窗口按钮或 WebView 缩放生效。原生
用例单独检查窗口最大化/还原、最小化、实际视口缩放、关闭后文稿恢复；
设置 `FROWD_NATIVE_HMR=1` 时，还短暂增删 CSS 变量来验证同一 host PID
热更新，随后恢复样式文件，不改交互预览文稿。
