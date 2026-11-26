# fromd 开发与构建

fromd 是本地 Markdown 写作与阅读客户端，唯一桌面宿主为 **Tauri**，支持 Windows 与 macOS。正文使用共享 Milkdown/ProseMirror 编辑器，文档、页面布局和资源归属由 Rust/SQLite 持久化。支持源码往返、公式、表格、Mermaid、脚注、GitHub Alerts、查找替换、阅读设置和原生 A4 PDF 导出。

旧 Electron 工程及其构建、更新链路已退役。历史实现、提交和验证证据仍可从 Git 历史及 [VALIDATION.md](../VALIDATION.md) 追溯，不再提供旧宿主运行命令，也不自动迁移旧资料库。

## 架构与代码入口

| 层 | 入口与职责 |
| --- | --- |
| 共享产品内核 | `packages/editor`：Markdown 解析、序列化、编辑及 PDF HTML；`apps/tauri/crates/document-store/src`：文档、SQLite、资源、导入、搜索；`apps/tauri/src/documents/coordinator.mjs`：串行操作与保存协调 |
| 薄平台壳 | `platform.mjs`、`WindowChrome.vue`、Rust IPC/协议与 `menu_macos.rs`、`pdf_macos.rs` / `pdf_windows.rs`；平台参数单向传给编辑器，内核不反向依赖宿主 |
| 打包层 | 共享 Tauri 配置 + Windows NSIS / macOS APP、DMG 覆盖配置；0.5.2 身份与许可资源统一，GitHub Actions 构建安装包、归档 SHA256SUMS.txt；发布 Release 另行执行 |

页面直接收起/恢复，不播放旧 Electron 的 450ms 收起动画。macOS 使用系统标题栏和原生菜单；Windows 使用自绘窗口栏。两端保存、恢复、资源权限和 PDF 公共层保持一致。

## 安装依赖与运行

需要 Node 22.19+、Rust 1.93.1；Windows 使用 MSVC Build Tools/Windows SDK，macOS 使用 Xcode Command Line Tools。

```sh
npm ci --ignore-scripts
npx --yes pnpm@10.11.0 --dir apps/tauri install --frozen-lockfile
npm run dev
```

| 根命令 | 用途 |
| --- | --- |
| `npm run dev` / `npm start` | Tauri 原生开发客户端 |
| `npm run build` / `npm run tauri:web` | 前端类型检查与构建 |
| `npm run tauri:check` | 锁定依赖检查 Rust 宿主 |
| `npm run tauri:build` | 原生 release 可执行文件，no-bundle |
| `npm run tauri:installer:win`（兼容 `tauri:installer`） | Windows x64 NSIS 安装包 |
| `npm run tauri:installer:mac` | 当前 Mac 架构的 APP/DMG |

客户端支持菜单手动检查 GitHub 正式版更新：Windows 下载并校验安装包，保存文稿后启动覆盖安装；macOS 打开 Release 下载页。不会后台自动检查或自动创建公开 Release。安装包与真机清单分别见 [Windows](../apps/tauri/WINDOWS_INSTALLER.md) 和 [macOS](../apps/tauri/MACOS_PACKAGING.md)。不要以 release 构建测试 `FROWANG_USER_DATA` 覆盖：它仅在 debug 生效。

## 验证入口

```sh
npm test
npm run test:tauri
cargo test --manifest-path apps/tauri/crates/document-store/Cargo.toml --locked
cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml --locked
npm run tauri:check
npm run tauri:web
npx playwright test -c playwright.pm-shared.config.mjs
```

`npm run test:editor` 为共享编辑器完整浏览器入口；`npm run test:tauri:browser` 使用模拟 IPC，设置独立 `FROWD_BROWSER_PORT`，如 14522。`npm run test:tauri:native` 使用真实 debug 客户端，需要先构建原生可执行文件和隔离测试目录。不得使用真实笔记测试或复用其他会话的预览/profile。

## 改名兼容与发布校验

显示名、APP/DMG/安装包名使用 `fromd`；为兼容已安装的 Tauri 0.5.2，以下运行标识保持原值：

- `com.frowang.frowd.tauri.v1`、`drafts.sqlite`、`resources/objects` 与 `.frowd-assets`。
- `frowd-tauri` 二进制、`frowd-resource` / `frowd-pdf` 协议、`frowd:*` IPC 事件。
- `frowd.tauri.reading-preferences.v1` 阅读设置键。

更新源固定为公开仓库 `frowang-ai/fromd`，Windows 优先匹配 `fromd_<版本>_x64-setup.exe`，缺少时才匹配同一 Release 的旧 `frowd_<版本>_x64-setup.exe`。CI 在各平台产物和合并的 `fromd-release-assets-0.5.6` artifact 内生成 `SHA256SUMS.txt`；构建不自动发布 Release。

NSIS 改名兼容回归可在 Windows 单独执行，不安装应用，不接触真实安装登记或快捷方式：

```powershell
./apps/tauri/scripts/check-windows-rename.ps1 -NsisCompiler 'path/to/makensis.exe' -OutputRoot './output/nsis-rename-tests'
```

脚本编译并运行合成 NSIS fixture，在唯一临时 HKCU 子键与输出目录中验证旧安装目录继承、成功后清理，以及自选目录/已有 fromd/其他宿主不会被覆盖。原生旧名资料继承与更新回归见 [Tauri 测试说明](../apps/tauri/README.md#manual-application-updates)。

## 当前说明与项目记忆

- [Tauri 客户端入口](../apps/tauri/README.md)
- [桌面页面管理与预览](../apps/tauri/DESKTOP_FEEDBACK.md)
- [Markdown 扩展](../apps/tauri/MARKDOWN_EXTENSIONS.md)、[公式与阅读](../apps/tauri/READING_V1.md)、[PDF 导出](../apps/tauri/PDF_EXPORT.md)
- [Windows 打包](../apps/tauri/WINDOWS_INSTALLER.md)、[macOS 架构/打包/验收](../apps/tauri/MACOS_PACKAGING.md)
- [历史验证归档](../VALIDATION.md)：旧 Electron 及阶段记录，不是当前运行指引

原 `main` 的 PR #14 历史已通过普通 merge 纳入。其共享字数/大纲分析与代码主题已在 Tauri 使用；旧 Electron 搜索/图片/窗口接口由当前 Tauri 实现替代，不并存两套客户端或回退编辑器接口。

## 来源与许可证

自主实现采用 MIT；编辑器原始抽离来源为 `frowang-ai/web-lunwen` 的 `647efc6`，Tauri 平台基础来自 SoloMD v5.0.21。运行时依赖与原始许可见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)、[Tauri 许可说明](../apps/tauri/THIRD_PARTY_NOTICES.md) 和 `apps/tauri/dependency-licenses.json`。没有包含 Typora 源码、资源或样式。
