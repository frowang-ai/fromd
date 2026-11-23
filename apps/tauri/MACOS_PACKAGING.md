# macOS 构建与验收（0.5.2）

fromd 的正式产品代码分为三层：

- **跨平台产品内核**：`packages/editor` 维护 Markdown、公式、选区、历史与完整文稿 PDF HTML；`apps/tauri/crates/document-store/src` 维护 SQLite、文档、资源、导入与搜索；`src/documents/coordinator.mjs` 串行协调保存、切页、导出和关闭。Rust 内核拥有自己的 `lib.rs`，不反向引用宿主源码。编辑包仅接收 `linkModifier` / `mathDoneShortcut` 参数，不导入 Tauri。
- **薄平台壳**：`src/platform.mjs` 提供平台描述、快捷键匹配与显示；`WindowChrome.vue` 提供 Windows 自绘窗口栏和 macOS 紧凑工具栏；`src-tauri` 负责 IPC、对话框、协议、原生菜单、退出与分页打印。Windows 使用 WebView2，macOS 使用 WKWebView/AppKit。
- **打包层**：共享 `tauri.conf.json` 保存身份、版本、安全策略与许可证；`tauri.windows.conf.json` 负责 NSIS、ICO 和无边框窗口；`tauri.macos.conf.json` 负责 APP/DMG、ICNS 和系统标题栏。Tauri 自动合并当前系统的配置，也可显式传 `--config`。平台文件中的完整窗口数组由 Node 测试核对共享字段，避免 JSON Merge Patch 导致尺寸或 label 丢失。

## 本机构建

需要 macOS、Xcode Command Line Tools、Node 22.19+、Rust 1.93.1。依赖与两个 Cargo.lock 必须保留；不使用 `cargo update`。

```sh
npm ci --ignore-scripts
npx --yes pnpm@10.11.0 --dir apps/tauri install --frozen-lockfile
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm test
npm run test:tauri
cargo test --manifest-path apps/tauri/crates/document-store/Cargo.toml --locked
cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml --locked
npm run tauri:installer:mac
# 指定架构时，使用 CLI 并把 --locked 留在 Cargo 参数区：
npm --prefix apps/tauri run tauri -- build --config src-tauri/tauri.macos.conf.json --bundles app,dmg --target x86_64-apple-darwin -- --locked
```

默认产物在 `apps/tauri/src-tauri/target/[目标架构/]release/bundle/macos/fromd.app` 和 `bundle/dmg/*.dmg`。设置 `CARGO_TARGET_DIR` 后以该目录为准。产物检查示例：

```sh
node apps/tauri/scripts/check-macos-artifact.mjs --app path/to/fromd.app --dmg path/to/fromd_0.5.2_aarch64.dmg --arch aarch64 --version 0.5.2
ditto -c -k --keepParent path/to/fromd.app fromd-0.5.2-aarch64.app.zip
```

脚本检查 Info.plist 版本/身份/最低 macOS 11.0、64 位 Mach-O 架构、7 份非空许可证及非空 DMG。支持 thin ARM64/x86_64 及大小端标准 FAT/Universal（FAT 头使用 32 位偏移，不含 FAT64；内部 slice 是 64 位 Mach-O），逐 slice 校验 CPU/subtype、可执行头、偏移、长度、对齐和重叠。架构参数严格匹配 slice 集合：`--arch universal` 要求恰好两个 slice，分别为 ARM64 和 x86_64；单一架构参数要求恰好一个匹配 slice，拒绝 Universal；`arm64` 是 `aarch64` 的别名。macOS 上首先执行系统 `plutil -lint`，二进制 plist 再转换为 XML 读取；其他平台可校验 XML plist 中的指定字段。现有 CI 的 Node 测试覆盖合成 Universal 与损坏样本，macOS 任务同时执行真实 plist lint。该检查不运行应用、不挂载或安装 DMG，也不替代签名和实际启动验收。

## CI 产物

`.github/workflows/tauri-build.yml` 仅在手动触发（`workflow_dispatch`，可选 `all` / `macos` / `windows`）时执行，不在 push 或 PR 时自动编译；日常编译与验收均在本地机器完成。手动运行时，macos-latest 分别构建 Apple Silicon 与 Intel 的 APP/DMG；windows-latest 构建 x64 NSIS。每项先运行 Node 和两套 Rust 测试，再用锁文件构建与检查实际产物。

在公开仓库 `frowang-ai/fromd` 的 Actions → Tauri desktop builds → 对应运行 → Artifacts 下载 `fromd-macos-aarch64-0.5.2` 或 `fromd-macos-x86_64-0.5.2`。APP 由 `ditto --keepParent` 压缩，保留 bundle 结构。各平台产物带有 SHA256SUMS.txt；最终 `fromd-release-assets-0.5.2` artifact 合并全平台资产并重新生成统一校验表。流水线仅上传 Actions Artifacts，不创建 GitHub Release；未配置签名、公证或静默自替换。客户端支持手动检查公开 Release。

## 首次打开与数据位置

这是未签名的自用构建。将 DMG 中的 `fromd.app` 拖到 Applications，首次打开如被 Gatekeeper 阻止，核对来源后在系统设置 → 隐私与安全性中允许这一次打开，再按系统确认步骤操作。不需要全局关闭 Gatekeeper。系统可能仍要求签名/公证；实际结果记入验收。

macOS 使用 Tauri 应用身份 `com.frowang.frowd.tauri.v1` 的应用数据目录，不迁移旧 Electron 数据。测试使用 debug 构建及本任务临时 `FROWANG_USER_DATA`，不以真实笔记作为首次验证样本。

## 手动检查更新

原生应用菜单 fromd → 关于 fromd 下方提供「检查更新…」。最新正式版本来自
`https://api.github.com/repos/frowang-ai/fromd/releases/latest`；左下角轻量弹窗
适配浅色/深色主题，显示检查中、最新版本、可用版本和错误重试。点击「前往下载更新」
只通过受控 opener 打开固定的 `https://github.com/frowang-ai/fromd/releases/latest`。
下载对应架构 DMG，正常退出应用后拖入 Applications 覆盖。当前未签名/公证，
不进行应用内静默替换。资料仍使用 `~/Library/Application Support/com.frowang.frowd.tauri.v1`
中的 `drafts.sqlite` 和 `resources/objects`，覆盖应用不搬动或重建文稿资料。

## 原生行为与 PDF

macOS 用系统装饰标题栏和红黄绿按钮；WebView 缩放不会移动交通灯。原生菜单含系统隐藏/退出、剪切/复制/粘贴/全选及业务命令。菜单 accelerator 由 AppKit 处理，前端不重复执行；标签切换单独使用 `⌃Tab` / `⌃⇧Tab`。查找替换为 `⌥⌘F`，保留系统 `⌘H` 和 `⌘Tab`。链接为 Cmd+Click，普通点击编辑；Windows 维持 Ctrl+Click。

PDF 公共层仍负责版本校验、单任务、资源限制、临时 URL 与原子保存。macOS 使用 `printOperationWithPrintInfo`，A4 595.28×841.89pt、18mm 四边距、自动纵向分页，禁用打印/进度面板。文稿、字体、图片与 KaTeX 就绪探测和 Windows 共用。不会使用只截长矩形的 `createPDFWithConfiguration`。

Tauri 两端均由原生打印设置独占 A4/18mm 页边距，传给打印 worker 的 HTML 使用共享 builder 的 `pageLayout: native`，不输出第二份 CSS `@page`；默认 builder 仍保留 CSS A4/18mm、11pt 和浅色打印契约。Windows WebView2 原生边距原本就是 18mm，不是 0。实际物理边距仍按下方真机清单检查。

AppKit 的异步 delegate 在主线程运行，Tokio 等待结果；启动 modal 操作前开启 `setCanSpawnSeparateThread(true)`，与锁定 Wry 的实现一致。保存目的地使用 `NSURL::from_file_path` 和 `NSPrintJobSavingURL`，不再使用已弃用的 `NSPrintSavePath`。打印超时或调用方取消后，只允许迟到操作写本任务唯一临时 PDF，并保留其 delegate、view/window、operation 与临时目录直到回调结束。若系统永不回调，该会话保持原生打印占用并在进程退出时回收，不冒险释放回调指针或启动相互覆盖的任务。旧目标只在公共层校验 `%PDF-` 后原子替换。

Cmd+Q、菜单退出和 Dock Quit 都先经过 `ExitRequested` → `frowd:close-requested` → 前端 flush/checkpoint → `close_ready` 握手。监听尚未注册时的请求由 Rust 挂起；前端注册后立即调用 `ack_close_listener` 原子领取，并等 `coordinator.boot()` 完成再执行保存。事件与 IPC 补领共用一次派发状态，重复关闭不会重复保存；窗口销毁/重建会清除监听就绪状态并保留尚未处理的关闭/退出意图。保存失败/取消会重置退出意图。普通红叉关闭保存后仅隐藏主窗口，并清除关闭/退出确认；再次红叉或 Cmd+Q 都重新握手。点击 Dock 图标会恢复并聚焦窗口；若窗口意外销毁，则从相同平台配置重建，并从持久化存储恢复。Windows 继续使用原来的保存后关闭窗口行为。

## Mac 真机验收清单

本地 Windows 单测、模拟平台浏览器回归不代表 macOS 原生验收通过。macOS 本机构建（或按需手动触发 CI 编译）、实际打开和以下检查分别记录：

1. 两架构本机构建（或手动触发 CI 编译）、Rust 测试、APP/DMG 产物校验；在对应机器打开，确认图标、版本、标题栏与菜单。
2. 中文输入法最后一段组合输入，立即 Cmd+Q / 菜单退出 / Dock Quit；重开核对正文与名称。模拟写入失败后取消退出，确保窗口保留；恢复写入后再退出。初创或 Dock 重建后立即红叉/Cmd+Q，确认恢复完成后仍能保存并关闭/退出；红叉保存隐藏后点击 Dock 恢复，继续编辑再红叉、再恢复后 Cmd+Q；还要覆盖最小化和异常销毁后的 Dock 重建。
3. 确认 Cmd+N/O/S、Shift+Cmd+S、Cmd+/、Cmd+F、Option+Cmd+F、Cmd+,、缩放各只触发一次；Cmd+H 隐藏、Cmd+Tab 切换应用、Ctrl+Tab 切换页面。50%–200% 缩放下交通灯稳定。
4. 正文/表格链接普通点击编辑，Cmd+Click 打开网页或定位文件；POSIX 绝对路径含冒号、相对路径、受管附件均正常。正文图片在无 Origin 或仅有 Referer 的 WKWebView 请求下显示，其他来源仍拒绝。
5. 用临时长文导出多页 A4 PDF，使用 `pdfinfo` 检查页数/纸张，`pdftotext` 检查中文和末段，检查 18mm 边距、表格跨页、代码换行、图片、KaTeX/图表。确认保存选择器取消、资源失败和打印失败保留旧目标，无隐藏 worker 残留。
6. 验证原生剪贴板、文件选择器、重启恢复以及 DMG 中应用拖入 Applications 的首次运行。签名/公证不在当前交付范围。
