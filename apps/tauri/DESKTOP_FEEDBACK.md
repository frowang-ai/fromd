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

macOS 保留系统标题栏、交通灯与原生菜单，不再叠加 Web 品牌/文稿标题栏。
「阅读」位于标签栏右侧，页面全收起或标签横向滚动时仍可进入；原生菜单中的
「阅读设置…」及 ⌘, 沿用原入口。名称、保存状态和字数收为正文上方的轻量信息行，
未落盘页面保留带「名称」标签的直接输入框及右键「改名」，无需另存文件；
名称输入的 docId、输入法组合态、自动保存和关闭 flush 流程保持一致。

Mac 屏幕字体优先使用系统字体及苹方回退，侧栏随窗口宽度在 208–248 px 之间
变化，≤760 px 继续使用原有抽屉。侧栏不新增拖拽调宽或布局持久化。
阅读设置沿用现有字号、正文宽度、主题及本地存储；PDF 排版仍独立。
Mac 原生菜单负责已注册快捷键，DOM 保留 Ctrl+Tab 与未注册别名，不重复派发。

收起和恢复直接更新页面列表与当前页，不截图、不播放动画，也没有动效开关。
操作仍先备份最后正文和名称，成功持久收起后才激活下一页；保存或收起失败时
保留原页并提示错误。侧栏隐藏、窄窗和系统“减少动态效果”设置下行为一致。
旧动效及捕获接口已从 Tauri 路径移除，历史实现和证据保留在 Git 与 output。
html2canvas 包与许可本轮暂留，未将删除依赖扩成安装或升级任务。

正文末尾下方的空白区域可单击建立或复用末尾空段，按点击高度大致留出几行，
随后直接键入或粘贴。本次补段可一次撤销/重做，留白沿用连续回车已有的格式。
只处理文末下方；正文、表格、列表、代码等块内部和源码模式保留原点击语义。

选中非空正文后输入 `$` 可将同一段内的纯文本变成行内公式，首尾空白保留在
公式外，光标停在公式后方并立即显示渲染结果。转换范围内必须具有完全一致
的标记；支持保留链接（含 URL）、斜体、加粗、删除线、上下标、下划线与高亮。
混合标记、行内代码、键帽、含 `$` 或换行的文本，以及转换后会紧贴已有公式
的选区均受保护拒绝，避免丢失样式或在重开时合并公式；有空白分隔的公式可转换。

输入 `*` 或 `_` 依次变为斜体、加粗、加粗斜体；反引号变为行内代码，`~`
添加删除线，连续两次 `~` 保持删除线。这些样式仅作用于去掉首尾空白后的
文字，外围空白及其原样式保持不变，完整原选区（包括空白）继续选中。
因此导出、重新解析后，`*` / `_` 仍可继续升级样式。反引号沿用行内代码命令
语义，清除目标文字的富文本标记；部分已有代码的纯文本选区可整体转为代码。
输入左括号 `(`、`[`、`{` 或英文直引号会包住同段选区，保留内部样式与
图片、公式节点，并继续选中中间内容。

正文非空文字或行内节点选区若不能安全包裹（如跨段、格式转换包含图片/公式、
不兼容标记或完整行内代码），会消费按键并保持文档、选区和撤销/重做历史不变，
不会把选区覆盖成单个符号。空选区、只含空白的选区、节点/表格多格选区、
代码块内输入保留默认行为。输入法组合态、只读或带 Ctrl/Meta/Alt 的输入
不由包裹逻辑处理。每次有效变换可单步撤销并恢复原选区。
源码模式使用同一组符号直接在选区两端插入字符，保持中间选中，连按两次 `*`
或 `~` 自然得到双符号；撤销和重做同时恢复源码与选区。

大纲点击直接滚到对应标题，正文和源码各自定位，同名标题按实例区分。
标题结构变化让旧项无法确定时会刷新大纲并请重新选择，不会误报“已定位”。

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

Mac 布局与 Windows 保留路径使用合成文稿及模拟 IPC，可在 Windows 上运行：

```powershell
$env:FROWD_BROWSER_PORT='15741'
npm run test:tauri:browser -- platform.browser.spec.mjs desktop-feedback.browser.spec.mjs reading.browser.spec.mjs rename.browser.spec.mjs workspace.browser.spec.mjs
```

`platform.browser.spec.mjs` 覆盖 Mac 1280×820、1440×900、560×720、360×640，
保留对应截图和深色截图；另保留 Windows 1280×820 截图。证据位于忽略提交的
`output/tauri-browser-results/`。覆盖阅读入口及焦点返回、长标签横向滚动、全部收起、
免落盘改名、合成 IME 和源码/名称关闭备份。浏览器使用平台策略模拟，不能验收
真实 macOS 系统字体、AppKit 菜单事件、交通灯、WKWebView 或物理输入法。
快捷键归属另见 `platform.test.mjs`；原生菜单实机单次派发仍须在 Mac 验收。

```powershell
# 本机 Windows 保留了 1421–1520（含 1452）；使用独立的 14520。
$env:FROWD_BROWSER_PORT='14520'
npm --prefix apps/tauri run test:browser -- selection-wrap.browser.spec.mjs desktop-feedback.browser.spec.mjs workspace.browser.spec.mjs reading.browser.spec.mjs pm-source-history.browser.spec.mjs pm-editor.browser.spec.mjs

# 需要本机 debug exe 和可用的开发 Vite；只创建独立合成 profile。
$env:FROWD_NATIVE_EXE=Join-Path $PWD 'output/cargo-target/debug/frowd-tauri.exe'
$env:FROWD_NATIVE_HMR='1'
npm --prefix apps/tauri run test:native -- --grep 'native titlebar|native WebView2 authoring'
```

选区包裹的模型与历史回归位于 `tests/selection-wrap.test.mjs`，纳入 `npm test`。
`selection-wrap.browser.spec.mjs` 的往返检查将导出的 Markdown 加载到新页面的
新编辑会话，实际重新运行 Milkdown parser；不以源码未改时的模式切换代替重解析。

浏览器用例使用模拟 IPC，不能证明原生窗口按钮或 WebView 缩放生效。原生
用例单独检查窗口最大化/还原、最小化、实际视口缩放、关闭后文稿恢复；
设置 `FROWD_NATIVE_HMR=1` 时，还短暂增删 CSS 变量来验证同一 host PID
热更新，随后恢复样式文件，不改交互预览文稿。
