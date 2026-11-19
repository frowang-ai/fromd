# Windows 安装包

Tauri 客户端使用官方 NSIS 流程生成 Windows x64 Setup.exe，产品名为 `frowd`，
当前版本 `0.5.0`，应用身份为 `com.frowang.frowd.tauri.v1`。
这是全新安装入口，不迁移旧 Electron 文档库。安装包未签名，没有自动更新服务，
不会公开发布或注册 `.md` 默认打开方式。

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
$env:CARGO_TARGET_DIR = Join-Path $taskRoot 'apps/tauri/src-tauri/target'
$env:CARGO_BUILD_JOBS = '2'
npm ci --ignore-scripts
npx --yes pnpm@10.11.0 --dir apps/tauri install --frozen-lockfile --store-dir "$taskRoot/output/pnpm-store"
npm run tauri:installer
```

`tauri:installer` 执行 Tauri CLI 的 `build --bundles nsis --target x86_64-pc-windows-msvc -- --locked`，
包含前端类型检查、Vite 构建和原生 release 编译。
默认产物在 `apps/tauri/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/frowd_0.5.0_x64-setup.exe`；
若自定义 `CARGO_TARGET_DIR`，则从该目录查找相同的 target/release 子路径。
`bundle.useLocalToolsDir=true` 将 NSIS 下载缓存留在本项目 target 下，
不要求安装全局 NSIS。首次构建需要下载依赖及 Tauri 官方 NSIS 工具。

`npm run tauri:build` 保留 `--no-bundle`，仍只生成 release 可执行文件。
根目录 `npm run dist:installer` 属于旧 Electron 工程，不生成这里的 Tauri 安装包。
构建命令不运行安装器，也不启动 release 应用。不要用 release 应用验证
`FROWANG_USER_DATA` 隔离：这个覆盖仅在 debug 构建中有效。

## 安装与资料保留

- 按当前用户安装。安装向导提供目录选择，可选用户有写权限的 D/F 盘目录；
  系统保护目录可能需要额外权限，不建议作为按用户安装目标。
- 开始菜单默认位于 `frowd (Tauri)` 文件夹；桌面快捷方式默认不勾选。
  若主动勾选，快捷方式名称仍为 `frowd.lnk`。保留旧 Electron 同名桌面快捷方式时请勿勾选，
  可从独立的开始菜单启动 Tauri 客户端。
  此默认值适用于交互向导；官方静默/passive 模式仍会创建桌面快捷方式，本轮未提供静默部署流程。
- 应用数据使用 Tauri 独立目录 `%APPDATA%/com.frowang.frowd.tauri.v1`，
  WebView2 的本地存储也归该独立应用身份管理。选择 D/F 盘安装程序不会将资料库搬到该盘。
- 安装程序在 Windows「已安装的应用」中登记卸载入口，发布者元数据为 `Fro`。
  该字段不是数字签名或可信发布者认证；Windows 仍可能显示未知发布者或 SmartScreen 提示。
- 同一 Tauri 应用重装沿用自己的资料库。卸载向导的“删除应用数据”默认不勾选，
  不勾选时保留资料；主动勾选会删除该 Tauri 身份的应用数据和 WebView2 存储。
  外部另存的 Markdown、图片与附件不属于卸载清理对象。卸载前自行备份需要保留的资料。
- 安装目录内 `licenses/` 带有应用 MIT 许可证、第三方声明、SoloMD 来源许可证、
  Tauri API 的 MIT/Apache 许可证及编辑依赖清单。

WebView2 使用 Evergreen Runtime。安装器检查现有 Runtime，已存在时复用；
缺失时通过 Tauri 官方 `downloadBootstrapper` 路线下载微软引导程序并安装，
这一情况需要联网。它不是包含完整 WebView2 的离线安装包；下载或 Runtime 安装失败时应保留
安装器报错，联网后重试或先从微软官方安装 WebView2 Evergreen Runtime。
参见 [Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options)。

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
   检查文字、分页、图片、公式及上述三种扩展。早期基线包不作为这些新增功能的交付。
5. 备份临时测试资料后重装同一 Tauri 包，核对资料仍在；卸载时保持“删除应用数据”
   不勾选，再安装后核对恢复。若要测试勾选删除，仅对可丢弃测试资料执行，
   同时确认外部 Markdown/附件仍在。

本任务的早期基线包只证明安装包构建路线，最终交付必须吸收指定的渲染和 PDF 提交后重新构建。
当前实际构建、hash 与未验收项记录在任务的 `output/agent-pipeline/03_impl_notes.md`，
本地产物不纳入 Git。
