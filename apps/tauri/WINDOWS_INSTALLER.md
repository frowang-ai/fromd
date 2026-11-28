# Windows 安装包

Tauri 客户端使用官方 NSIS 流程生成 Windows x64 Setup.exe，产品名为 `fromd`，
当前源码版本 `0.5.6`，应用身份为 `com.frowang.frowd.tauri.v1`。
这是 Tauri 安装入口，不迁移旧 Electron 文档库。安装包未签名，支持用户手动检查更新，
不会公开发布；仅将 fromd 注册到 `.md` / `.markdown` / `.txt` 的系统「打开方式」列表，不设默认打开应用。

0.5.2 将共享配置与 Windows NSIS/macOS APP/DMG 配置拆分。跨平台边界、macOS 构建与验收见 [MACOS_PACKAGING.md](MACOS_PACKAGING.md)。

0.5.1 修复 Windows release 被链接为控制台程序、启动时额外弹出 Terminal 黑窗的问题。
发行应用使用 Windows GUI subsystem，debug 构建仍保留控制台日志。旧 0.5.0 交付及其证据作为历史保留。

## 构建

在仓库根目录、Windows x64 的 VS Developer PowerShell 中运行。需要已安装的
Node、Rust MSVC 工具链、Visual Studio C++ Build Tools 与 Windows SDK。
依赖分别由根 npm 锁和 Tauri pnpm 锁固定：

```powershell
$taskRoot = (Get-Location).Path
$taskTemp = Join-Path $taskRoot 'output/native-temp'
New-Item -ItemType Directory -Force -Path $taskTemp | Out-Null
$env:TEMP = $taskTemp
$env:TMP = $taskTemp
$env:npm_config_cache = Join-Path $taskRoot 'output/npm-cache'
$env:CARGO_HOME = Join-Path $taskRoot 'output/cargo-home'
$env:CARGO_TARGET_DIR = Join-Path $taskRoot 'output/cargo-target'
$env:CARGO_BUILD_JOBS = '2'
npm ci --ignore-scripts
npx --yes pnpm@10.11.0 --dir apps/tauri install --frozen-lockfile --store-dir "$taskRoot/output/pnpm-store"
npm run tauri:installer
& ./apps/tauri/scripts/check-windows-artifact.ps1 -Path output/cargo-target/x86_64-pc-windows-msvc/release/frowd-tauri.exe -ExpectedVersion 0.5.6
```

`tauri:installer` 向后兼容转到 `tauri:installer:win`，执行 Tauri CLI 的 `build --config src-tauri/tauri.windows.conf.json --bundles nsis --target x86_64-pc-windows-msvc -- --locked`，
包含前端类型检查、Vite 构建和原生 release 编译。
默认产物在 `apps/tauri/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/fromd_0.5.6_x64-setup.exe`；
若自定义 `CARGO_TARGET_DIR`，则从该目录查找相同的 target/release 子路径。
`bundle.useLocalToolsDir=true` 将 NSIS 下载缓存留在本项目 target 下，
不要求安装全局 NSIS。首次构建需要下载依赖及 Tauri 官方 NSIS 工具。

构建后的检查直接读取实际 PE 头及版本：release 应用必须为 x64、Subsystem=2（GUI）和指定版本，
失败时返回非零退出码；检查 debug 产物时可传 `-ExpectedSubsystem 3`（控制台）。它不启动被检查的 exe。

`npm run tauri:build` 保留 `--no-bundle`，仍只生成 release 可执行文件。
旧 Electron 工程及 `dist:installer` 命令已退役；Windows 安装包统一使用
`npm run tauri:installer:win` 或兼容别名 `npm run tauri:installer`。
构建命令不运行安装器，也不启动 release 应用。不要用 release 应用验证
`FROWANG_USER_DATA` 隔离：这个覆盖仅在 debug 构建中有效。

## 安装与资料保留

- 按当前用户安装。安装向导提供目录选择，可选用户有写权限的 D/F 盘目录；
  系统保护目录可能需要额外权限，不建议作为按用户安装目标。
- 开始菜单默认位于 `fromd` 文件夹；桌面快捷方式默认不勾选。
  若主动勾选，快捷方式名称为 `fromd.lnk`。旧 `frowd.lnk` 仅在确认指向被覆盖的同一 Tauri 程序时清理；
  不处理指向旧 Electron 或其他目录的快捷方式。
  此默认值适用于交互向导；官方静默/passive 模式仍会创建桌面快捷方式，本轮未提供静默部署流程。
- 应用数据使用 Tauri 独立目录 `%APPDATA%/com.frowang.frowd.tauri.v1`，
  WebView2 的本地存储也归该独立应用身份管理。选择 D/F 盘安装程序不会将资料库搬到该盘。
- 安装程序在 Windows「已安装的应用」中登记卸载入口，发布者元数据为 `Fro`。
  该字段不是数字签名或可信发布者认证；Windows 仍可能显示未知发布者或 SmartScreen 提示。
- 同一 Tauri 应用重装沿用自己的资料库。改名后的 fromd 保留原应用身份、`drafts.sqlite`、资源协议和阅读设置键。
  安装器在没有 fromd 记录且使用默认目录时，识别旧 frowd 的 Tauri 二进制和注册路径，继承其原安装目录；
  新程序安装成功且目标仍为原目录后才清除对应旧注册和快捷方式，不调用旧卸载器、不删除用户数据。
  已有 fromd 安装或显式指定的自选目录保持原选择。卸载向导的“删除应用数据”默认不勾选，
  不勾选时保留资料；主动勾选会删除该 Tauri 身份的应用数据和 WebView2 存储。
  外部另存的 Markdown、图片与附件不属于卸载清理对象。卸载前自行备份需要保留的资料。
- 安装目录内 `licenses/` 带有应用 MIT 许可证、第三方声明、SoloMD 来源许可证、
  Tauri API 的 MIT/Apache 许可证及编辑依赖清单。
  共 7 份文件，其中 `TAURI-THIRD-PARTY-NOTICES.md` 补充 html2canvas 及其四个间接依赖的原始 LICENSE。
- **「打开方式」注册与卸载清理**：不使用 Tauri 内置 NSIS `fileAssociations`（该宏会无条件覆写 `.ext` 默认值且命令行未给可执行路径加引号），而由 `src-tauri/nsis/installer-hooks.nsh` 在 `HKCU\Software\Classes` 下注册专用 ProgID `fromd.Markdown`、`fromd.Text` 与 `Applications\frowd-tauri.exe`（`DefaultIcon` 及带引号的 `"$INSTDIR\frowd-tauri.exe" "%1"`、`FriendlyAppName`、`SupportedTypes`），并在 `.md`、`.markdown`、`.txt` 的 `OpenWithProgids` 下写入对应 ProgID 空值，随后调用 `SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0)`。全过程绝不修改 `.ext` 默认值、`UserChoice` 或 `HKLM`。覆盖更新（`$UpdateMode == 1`）保留并重写自身注册；真实卸载仅在 `shell\open\command` 仍指向当前 `$INSTDIR\frowd-tauri.exe` 时删除上述自建键与 `OpenWithProgids` 值（仅当 `OpenWithProgids` 为空时清理空键），不影响其他应用或另一目录的同程序安装。
- **启动参数、单实例转交与窗口拖入打开**：启动时解析 `std::env::args_os().skip(1)`（跳过 `-` 选项，兼容相对路径与 `file://` URL）；已运行时由 `tauri-plugin-single-instance` 在争抢 `profile.lock` 之前将第二进程的 `argv` 与工作目录转交给原实例并立即退出，原窗口取消最小化、显示并聚焦后通过协调器串行 flush 并打开文档。debug 构建设置 `FROWANG_USER_DATA` 时自动关闭单实例插件，确保隔离原生测试不会把参数转交给本机其他正在运行的 fromd。窗口保持 `dragDropEnabled: false`：在侧栏、网页标题栏 `.app-header` 或标签栏 `.tabbar`（以及无页面时的空白编辑面板）放下文件时，前端通过 `chrome.webview.postMessageWithAdditionalObjects` 传递 `File` 对象并仅在 IPC 中报告 `name`/`size`；Rust 在主窗口受信任页面来源下通过 `ICoreWebView2WebMessageReceivedEventArgs2::AdditionalObjects` → `ICoreWebView2File::Path`（需 WebView2 Runtime ≥ 1.0.1774.30）读取真实路径并核对一致后入队打开，否则不建草稿并提示改用 `Ctrl+O`。

WebView2 使用 Evergreen Runtime。安装器检查现有 Runtime，已存在时复用；
缺失时通过 Tauri 官方 `downloadBootstrapper` 路线下载微软引导程序并安装，
这一情况需要联网。它不是包含完整 WebView2 的离线安装包；下载或 Runtime 安装失败时应保留
安装器报错，联网后重试或先从微软官方安装 WebView2 Evergreen Runtime。
参见 [Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options)。

## 客户端手动覆盖更新

文件 → 检查更新… 从 `frowang-ai/fromd` 的最新正式 Release 检查版本，
左下角弹窗提供「立即更新」、进度与同窗口重试。下载安装包和同一 Release 的
`SHA256SUMS.txt`，限制 64 MiB、HTTPS 请求及全部重定向白名单，校验 SHA-256
和 PE MZ 头，校验通过后才将独立缓存子目录中的 `.part` 改为 `.exe`。
当前应用版本来自编译包信息，拒绝同版本、降级、预发布和非法 SemVer。

启动安装前等待正文/名称栏 IME 完成，冻结编辑器并刷出最后正文、标题和阅读位置；
Rust 检查 SQLite checkpoint 的 busy/页数结果，成功后直接 spawn 安装程序 `/P`。
只有 spawn 成功才允许退出；任一步失败均保留窗口与文稿并恢复编辑。下载期间仍可编辑，
关闭窗口请求会取消，避免和安装交接竞争。更新期间的关闭按钮暂不可用。

沿用 `%APPDATA%/com.frowang.frowd.tauri.v1` 下实际既有的 **`drafts.sqlite`**
和 `resources/objects`；安装目录与资料目录分离，更新不删除数据库、收起页面或附件。
成功启动后安装包留在应用缓存的 `updates/update-*` 目录，供安装器在旧进程退出后读取；
失败的下载自动删除临时目录。NSIS passive 模式沿用当前用户安装记录，可能创建快捷方式。
安装程序取消/被系统拦截后可重新启动原应用；spawn 成功只表示交接成功，不等于安装完成。

## 用户手工验收

以下由用户在最终组合包上执行，构建成功、静态检查或 debug 自动化均不代替实际安装验收。
使用临时文稿和图片，不用重要资料作为首轮样本。

1. 安装到选定目录（可选 D/F 盘），从开始菜单启动；确认名称、图标、版本和卸载入口。
   有条件时分别验证已有 WebView2 的复用和缺失时的联网安装。
2. 新建页面，编辑并命名，切换源码/正文，收起再从列表恢复；保存为 Markdown，
   正常关闭后重新打开，核对正文、名称、页面状态与阅读设置。
3. 插入图片和附件，另存后检查相对资源；用真实 Explorer 拖入临时文件，
   主动用系统剪贴板粘贴文字/图片，核对内容和保存结果。
4. 最终组合包检查 Mermaid、脚注、提示块在正文与源码间往返；导出 PDF，
   检查文字、分页、图片、公式及上述三种扩展。当前 Mermaid 12.3 的 Sankey CSV 节点名仅支持 ASCII，
   中文说明可写在图表外；语法范围见 [Markdown 扩展说明](MARKDOWN_EXTENSIONS.md)，导出规则见 [PDF 说明](PDF_EXPORT.md)。
5. 用临时资料在旧版本选择「检查更新…」：编辑未命名稿、收起含图页面，在正文/名称栏
   中文组合输入中点击更新，完成输入后确认保存、安装覆盖和重启，逐项核对正文、标题、阅读位置、
   页面顺序、收起状态、图片与附件；校验/网络/磁盘失败应保留可编辑窗口并可重试。
6. 备份临时测试资料后重装同一 Tauri 包，核对资料仍在；卸载时保持“删除应用数据”
   不勾选，再安装后核对恢复。若要测试勾选删除，仅对可丢弃测试资料执行，
   同时确认外部 Markdown/附件仍在。
7. 验证「打开方式」、单实例与窗口拖入打开：安装到含空格路径（或默认路径）后，确认 `.md` / `.markdown` / `.txt` 原有默认打开程序未变，资源管理器右键「打开方式」出现 fromd；测试未启动（含全新空库不额外生成空白页）与已运行（含窗口最小化、正在编辑未保存内容或源码模式）时从资源管理器「打开方式」打开单个/多个/已打开文档，确认不报数据目录占用错误且当前窗口聚焦并切换到目标页；从资源管理器分别拖 `.md` / `.markdown` / `.txt` 到侧栏、网页标题栏 `.app-header`、标签栏 `.tabbar`（显示「松开以打开」并真实关联原文件，按 `Ctrl+S` 写回原路径），测试混合拖入 `.md` + 图片、拖入文件夹/纯图片提示，以及拖 `.md` 到正文和左右留白仍插入附件链接；卸载后确认资源管理器「打开方式」及 `HKCU\Software\Classes` 中 fromd 自建项已清理且其他应用关联完好。

最终组合包由已审核的渲染、PDF 和安装功能源码构建；安装版手工验收仍由用户执行。
0.5.1 修正版交付到 `release/tauri-0.5.1-console-fix/`，构建命令、PE修前/后结果、产物大小与SHA256
记录在 `output/agent-pipeline/05_console_fix_notes.md`。0.5.0 的 `04_final_notes.md` 和更早的
`03_impl_notes.md` 保留历史性质，本地产物不纳入 Git。
