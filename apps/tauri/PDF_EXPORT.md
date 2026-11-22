# Windows / macOS PDF 导出

0.5.2 保留公共导出契约，Windows 使用 WebView2 PrintToPdf，macOS 使用 WKWebView + AppKit `NSPrintOperation` 真正分页。macOS 的 A4 配置、异步回调生命周期与真机验收见 [MACOS_PACKAGING.md](MACOS_PACKAGING.md)。下文原生 WebView2 自动化证据仍专指 Windows；macOS 编译及实际分页需分别通过 CI 与 Mac 验收。

从「文件 → 导出 PDF…」选择保存位置。导出当前页面的完整正文，包括尚未触发延迟保存的最后输入；不包含工作栏、标签或工具条。采用 A4 纵向和 18mm 边距，保留中文、可选择的文本、KaTeX 公式、表格、代码和图片。界面阅读主题不改变打印配色。

同一原生流程也导出 Mermaid 内联矢量图、脚注（含大小写重复引用、多段及未引用定义）和五类提示块。已通过实际 PDF 检查流程图箭头与 Sankey 流带；图表构造错误在创建打印任务前失败，保留旧目标。图表语法范围及当前 Sankey 节点名限制见 [Markdown 扩展说明](MARKDOWN_EXTENSIONS.md)。

导出在现有协调器中串行执行。确认当前输入并保存草稿后，固定页面 ID、标题、正文及 revision；导出期间页面操作等待这次命令完成。没有增加 source 切页的输入法拦截规则。

图片通过 `pdf_images(id, revision, references)` 准备：文件图片只读取该页面已获授权的受管图片或文稿目录内的相对图片；原文中的 PNG/JPEG/GIF/WebP base64 图片临时解码校验，不写入资源库。两者复用资源服务同一栅格校验（真实格式、单图10 MiB、宽高各12000、4000万像素、解码内存96 MiB），并共同计入一次256张、原始字节合计50 MiB的导出限制。内嵌图在解码前也检查base64长度，声明MIME须匹配实际图片格式，不接受SVG。错误不回显图片数据。远程图片、任意绝对路径和越界文件仍会报错。生成 HTML 上限96 MiB。KaTeX 的锁定 WOFF2 字体一并内嵌，无需联网。

共享 `buildPdfDocument` 负责完整文稿的 Markdown 渲染和清洗。Tauri adapter 不复制编辑器 DOM，也不维护另一套 Markdown 渲染器。builder 构造失败时尚未创建原生打印任务。

原生侧使用 Windows 已安装的 WebView2 `ICoreWebView2_7::PrintToPdf`。每次导出生成一个隐藏窗口和随机文档地址，地址只向对应窗口提供当前任务内容，结束即撤销。打印响应使用独立 CSP，关闭页面脚本、WebMessage、host object 和弹窗，并阻止外部资源请求；无需扩大全局 CSP、文件权限或安装包权限。受控内联 SVG 保留给共享 builder 使用。

宿主使用原生 `ExecuteScript` 强制文档布局，并连续核对实际使用的字体与所有图片均已完成加载。检查由宿主轮询，避免关闭页面脚本时页面自身的异步回调停止推进。准备最多 30 秒，打印最多 60 秒，单次脚本响应最多 5 秒。失败会撤销文档访问并销毁隐藏窗口。打印先写入目标目录中的临时目录，确认 WebView2 成功且返回 PDF 后，再以同目录临时文件、flush 和原子替换保存目标。取消选择器不创建打印文件；失败不替换已有目标。

相关实现：`src/documents/pdf.mjs`、`src/documents/coordinator.mjs`、`src-tauri/src/pdf.rs`、`src-tauri/src/pdf_windows.rs`、`src-tauri/src/pdf_macos.rs`。WebView2 接口依据 [PrintToPdf 文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_7)及[脚本设置文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2settings)：关闭页面脚本仍允许宿主原生 `ExecuteScript`。

验证入口为 `npm test`、`npm run test:tauri`、Tauri 浏览器套件中的 `pdf.browser.spec.mjs`、Rust host PDF 原子保存测试及 `npm run test:tauri:native`。原生 PDF 用例需 debug no-bundle 构建，以及 PATH 中的 Poppler `pdfinfo`、`pdftotext`、`pdfimages`、`pdffonts`。它使用临时 profile 和合成文稿，检查多页 A4、中文与最后输入提取、公式字体、受管及相对图片、失败时保留旧目标和窗口/临时文件清理。

仅 debug 测试进程可设置 `FROWD_PDF_TEST_TARGET` 绕过保存选择器，路径必须位于同时指定的 `FROWANG_USER_DATA` 内；release 不编译该分支。自动化生成仍走同一个产品原生命令和 PrintToPdf，未使用浏览器 `page.pdf`。原生保存选择器的实际交互、安装版体验及真实资料操作由用户最终验收，自动化结果不代表这些人工场景已经完成。
