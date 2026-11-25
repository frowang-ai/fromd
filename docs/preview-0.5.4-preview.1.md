# fromd Preview 0.5.4-preview.1

这是独立安装的试用版，集成 PR #25（Paseo / Markdown 数学粘贴）和 PR #26（引用段落原生光标）。分支 `preview/fromd-0.5.4-preview.1` 与对应 Draft PR **仅供预览分发，不合并 main**；两个修复 PR 继续保持 OPEN，等待实际试用反馈。正式 Latest 仍为 v0.5.3。

## 安装与并存

| 项目 | 正式版 | 预览版 |
| --- | --- | --- |
| 产品 / macOS APP | fromd / fromd.app | fromd Preview / fromd Preview.app |
| Windows 进程 | frowd-tauri.exe | fromd-preview.exe |
| 应用身份 | com.frowang.frowd.tauri.v1 | com.frowang.fromd.preview |
| Windows 默认安装目录 | `%LOCALAPPDATA%\fromd` | `%LOCALAPPDATA%\fromd Preview` |
| Windows 开始菜单 / 快捷方式 | fromd | fromd Preview |
| Windows 产品注册项 | `HKCU\Software\Fro\fromd` | `HKCU\Software\Fro\fromd Preview` |
| Windows 卸载项 | `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\fromd` | `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\fromd Preview` |
| 文稿资料目录后缀 | com.frowang.frowd.tauri.v1 | com.frowang.fromd.preview |

Windows 安装使用单独的 `nsis/preview-hooks.nsh`，不加载正式版 legacy hook，不读取、继承或删除旧 frowd/fromd 的注册项和快捷方式。默认桌面快捷方式不勾选；如果手动选择了含 `frowd-tauri.exe` 的正式安装目录，安装会拒绝继续。NSIS 的运行进程检测使用独立 `fromd-preview.exe`。

macOS M 系列芯片选 aarch64，Intel 选 x64（APP.zip 中写 x86_64）。将 `fromd Preview.app` 拖入 `/Applications`，推出 DMG，再从应用程序打开；它与 `fromd.app` 并存。APP 使用免费 ad-hoc 签名，DMG 未签名、未公证。来源核对、SHA-256 与 Gatekeeper 处理仍参照 [macOS 安装说明](install-macos.md)，操作目标须是 **fromd Preview.app**。

预览版新建自己的 `drafts.sqlite` 和 `resources/objects`，不会自动读取、迁移或删除正式笔记：

- Windows 文稿：`%APPDATA%\com.frowang.fromd.preview`；WebView2 和缓存由 Tauri 使用 `%LOCALAPPDATA%\com.frowang.fromd.preview`。
- macOS 文稿：`~/Library/Application Support/com.frowang.fromd.preview`；缓存为 `~/Library/Caches/com.frowang.fromd.preview`，WKWebView 使用预览 APP 的 bundle identity（WebKit 存储归该身份管理）。
- 原文档仍可由“打开”显式选取并写回；首轮只使用本页提供的合成样本，避免把正式笔记选作测试材料。
- Windows 卸载条目为 fromd Preview，默认保留资料；勾选删除数据也只针对预览身份。macOS 删除 Preview APP 不等于删除其文稿资料。

预览版不提供正式更新入口：Windows 隐去检查更新按钮和更新通知，macOS 原生检查更新菜单禁用。原生 `check_updates`、`download_update`、`install_update`、`open_update_page` 在任何网络、缓存或安装动作前拒绝预览身份；即使将来正式版号更高，也不会下载或启动正式安装器。新预览包需手动获取。

## 版本与构建入口

`apps/tauri/src-tauri/tauri.preview.conf.json` 统一维护产品名、应用身份、二进制名和 `0.5.4-preview.1`。平台窗口覆盖文件仅维护完整窗口数组；由 Tauri 按“共享配置 → 自动平台配置 → 预览配置 → 预览平台窗口”合并。正式配置、Cargo.toml / Cargo.lock 中的原包版本保持 0.5.3；Tauri 的显式 `version` 会覆盖 Cargo 包版本用于应用版本和资源，参见锁定 CLI 的 `config.schema.json`。

macOS 的 `CFBundleShortVersionString` 按 Apple 的数字版本约束写 `0.5.4`，`CFBundleVersion` 写开发阶段构建号 `0.5.4d1`（`Info.preview.plist` 与预览配置）。这是 Apple bundle 元数据的表达；应用版本、Preview 名称、Release tag 和资产名仍为 **0.5.4-preview.1**，不是正式 0.5.4 发布。依据：[CFBundleShortVersionString](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleshortversionstring)、[CFBundleVersion](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion)。Windows PE 的 ProductVersion / FileVersion 字符串保留完整预发布版本。

```sh
# Windows x64
npm run tauri:preview:win
# Mac 当前架构
npm run tauri:preview:mac
# Mac Intel（Apple Silicon 上交叉编译）
npm --prefix apps/tauri run tauri -- build --config src-tauri/tauri.preview.conf.json --config src-tauri/tauri.preview-macos.conf.json --bundles app,dmg --target x86_64-apple-darwin -- --locked
```

预览配置的 `beforeBuildCommand` 固定执行 `build:preview`，将身份编入 renderer；release 包不依赖 debug 环境变量。不要只将正式二进制重命名为预览包。Mac 延续 `TAURI_BUNDLER_DMG_IGNORE_CI=true`、APP 签名验证、DMG 只读挂载与单次 EULA 应答后的清理。

父线程审核后手动触发现有 workflow：

```sh
gh workflow run tauri-build.yml --repo frowang-ai/fromd --ref preview/fromd-0.5.4-preview.1 -f platform=all
```

工作流仅编译、校验并上传 Actions artifacts，不发 tag / GitHub Release。可单独传 `platform=windows` 或 `platform=macos`，全平台汇总 artifact 仅在 `all` 成功后生成。

| Artifact | 内容 |
| --- | --- |
| `fromd-preview-windows-x64-0.5.4-preview.1` | Windows 安装包 + 本平台校验表 |
| `fromd-preview-macos-aarch64-0.5.4-preview.1` | ARM64 APP.zip / DMG + 本平台校验表 |
| `fromd-preview-macos-x86_64-0.5.4-preview.1` | Intel APP.zip / DMG + 本平台校验表 |
| `fromd-preview-release-assets-0.5.4-preview.1` | 下列五个资产 + 统一 SHA256SUMS.txt |

最终文件名（工作流从带空格的原始打包名复制为下载名）：

- `fromd-preview_0.5.4-preview.1_x64-setup.exe`
- `fromd-preview_0.5.4-preview.1_aarch64.dmg`
- `fromd-preview_0.5.4-preview.1_x64.dmg`
- `fromd-preview-0.5.4-preview.1-aarch64.app.zip`
- `fromd-preview-0.5.4-preview.1-x86_64.app.zip`
- `SHA256SUMS.txt`

## 小样本试用与回归

样本：[preview-sample.md](preview-sample.md)。请用临时文稿依次检查：

1. 启动后确认窗口 / 菜单为 fromd Preview，版本为 0.5.4-preview.1，初次启动不显示正式版笔记。正式版图标、安装记录与程序文件仍存在。
2. 打开样本或粘贴样本文字。在长引用中滚动、点击普通文字、输入和撤销；分别在 100% 与 120% 缩放检查可见光标与实际输入位置。
3. **从真实 Paseo 回答中系统复制**带正文、行内/块公式、分式、上下标和引用命令的混合内容再粘贴。检查没有 `parseHtml` / `sourceText` 错误、没有丢掉正文、公式或引用符号。文件粘贴及模拟 ClipboardEvent 不算完成这一项。
4. 点击行内/块公式进入编辑，修改一个下标；切换源码检查 `$...$` / `$$...$$`、`\frac`、`\citep` 与引用段落。编辑名称，收起再打开页面。
5. 正常退出应用（Mac 用 Cmd+Q），重启检查正文、名称、阅读主题和源码；页面缩放沿用现有行为，重启恢复 100%，不持久化缩放。不要仅用 Mac 红叉隐藏作为退出证据。
6. 两应用并存时检查预览无可用正式更新入口；Windows 确认安装与卸载条目均为 Preview，Mac 确认 Preview APP 的 Finder 拖放目标、图标及首次打开结果。

自动检查入口：

```sh
npm test
npm run test:tauri
npm run tauri:web
cargo test --manifest-path apps/tauri/crates/document-store/Cargo.toml --locked
cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml --locked
# 设置 FROWD_BROWSER_PORT=15761、FROWD_BROWSER_MODE=preview 后：
npm run test:tauri:browser -- distribution.browser.spec.mjs quote-caret.browser.spec.mjs markdown-math-paste.browser.spec.mjs vscode-latex-paste.browser.spec.mjs resources.browser.spec.mjs resource-cell-paste.browser.spec.mjs platform.browser.spec.mjs
npm run test:editor -- --grep "公式|数学粘贴|reporter|富文本"
```

Windows 原生回归先以两个预览 `--config` 构建 `--debug --no-bundle`，设置 `FROWD_NATIVE_EXE` 为生成的 **fromd-preview.exe**、`FROWD_DISTRIBUTION=preview`，执行 `npm --prefix apps/tauri run test:native -- --grep "native preview"`。该测试自行新建合成 `FROWANG_USER_DATA` 和独立 WebView2 目录，直接调用四个原生更新 IPC，确认全部拒绝且没有测试源网络请求，再模拟粘贴、切源码、正常退出和重启。不要用 release 二进制跑此测试：release 忽略 FROWANG_USER_DATA。

测试证据和未验事项随 Draft PR 记录。PR25 已知 `resource-reuse` 三项基线失败不算本预览新增回归。CI 构建、自动化、合成剪贴板均不替代三种安装包实际安装、Mac 原生操作、真实 Paseo / 输入法及 Gatekeeper 验收。
