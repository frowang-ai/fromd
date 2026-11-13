# frowd lite（Tauri 原型）

分支 `prototype/tauri-lite`，基于 main `2ef08d8`（0.4.0）。目标是验证同一套编辑器换成 Tauri 外壳后，体积、启动和内存能省多少，以及哪些能力需要额外实现。原型不替换 Electron 版，两者并存。

## 结构

- `apps/tauri/bridge.js`：在 Tauri 里提供与 Electron preload 完全相同的 `window.desktop` 接口，渲染层和编辑内核不感知外壳。
- `apps/tauri/main.js` + `index.html`：先装 bridge，再加载 `apps/desktop/src/renderer/main.js`（原样复用）。
- `vite.tauri.config.mjs`：单独构建到 `out/tauri`。
- `apps/tauri/src-tauri/`：Rust 外壳。
  - `storage.rs`：SQLite schema v3，表结构、触发器、迁移（含 0.1 `session.json` 一次导入）与 `storageWorker.js` 一致，数据库文件可互读。
  - `store.rs`：`documentStore.js` 的逐项移植（外部修改检测、原子保存、BOM/CRLF、收起/移除/撤销、阅读状态校验、10MB/100MiB 上限），附 Rust 单元测试。
  - `main.rs`：固定命令、串行文档队列、原生菜单（只回传命令给渲染层，快捷键仍由渲染层处理以保护输入法）、关闭握手、受限 `document-image` 与 `print` 协议。
  - `webview2.rs`：Tauri 未封装的 WebView2 能力——`PrintToPdf` 导出 PDF、`CapturePreview` 供收起动效截图。

共享代码只有两处小改动：`DocumentPane.vue` 优先使用 `window.desktop.imageUrl`（WebView2 把自定义协议映射为 `http://document-image.localhost`），`pdfDocument.js` 同时接受这个来源。Electron 路径行为不变。

## 与 Electron 版的差异（原型已知限制）

- **更新**：未接入，`updates_state` 固定返回“未启用”。
- **数据目录**：默认 `%APPDATA%\com.frowang.markdown.lite`，与 Electron 版分开；`FROWANG_USER_DATA` 同样可用。没有做从 Electron 数据目录的迁移。
- **单实例 / 二次打开文件**：只处理启动参数里的 `.md`，没有单实例转发。
- **页面进程崩溃**：WebView2 进程失败的“重新载入/退出”对话框未实现。
- **PDF**：WebView2 没有页眉页脚模板；保留页码，页脚不显示 URL，页眉无标题。纸张 A4。
- **动效截图**：超过 2048×1536 的画面不缩放，直接跳过动效（Electron 版会缩放）。
- **测试**：Playwright 桌面用例针对 Electron 启动方式，未移植；原型用 `apps/tauri/scripts/measure.mjs` 通过 WebView2 CDP 做冒烟和测量。

## 构建

需要 Rust（MSVC 工具链）与 Node 22+。

```powershell
npm ci
npm run lite:build    # 先构建前端到 out/tauri，再 cargo release + NSIS
```

产物在 `apps/tauri/src-tauri/target/release/bundle/nsis/`。若本机临时目录删除受限（esbuild / cl.exe 报 Access denied 或 D8050），把 `TMP`、`TEMP` 指向 `apps/tauri/src-tauri/target/tmp` 再构建。

## 测量

2026-11-13，Windows 11 Pro 26200，同一台机器。两边都用隔离的 `FROWANG_USER_DATA` 和生成的样例笔记（标题、行内/块公式、相对路径图片、列表），不碰真实笔记。

```powershell
# 冒烟 + 启动/内存，每轮：冷启动→等 KaTeX→检查图片/桥接/截图→输入标记→强杀→重启验证持久化→无 CDP 空闲 8 秒测内存
node apps/tauri/scripts/measure.mjs "<frowd lite.exe>" tauri 3
node apps/tauri/scripts/measure.mjs "<frowd.exe>" electron 3
```

| 项目 | lite（Tauri 2.12） | Electron 0.4.0 |
| --- | --- | --- |
| NSIS 安装包 | 4,036,457 B（3.85 MiB） | 130,434,143 B（124 MiB） |
| 主程序 / 安装后 | exe 7.1 MB（依赖系统 WebView2） | 安装目录约 411 MiB（0.4.6 实装） |
| 启动到首个公式渲染 | 967 / 1024 / 1068 ms，中位约 1.0 s | 824–991 ms，中位约 0.8 s |
| 空闲进程树私有内存 | 221 / 231 / 266 MB | 289–295 MB |
| 空闲进程树工作集 | 456 / 469 / 505 MB | 约 465–470 MB |

- 体积差距最大，约 1/32。
- 启动 lite 略慢约 0.2 s：WebView2 环境初始化比 Electron 自带 Chromium 慢一些。
- 内存：私有内存低约 20%；工作集基本持平，因为 WebView2 同样是多进程 Chromium，共享页也计入工作集。
- 功能冒烟（每轮）：KaTeX 渲染、相对图片经 `document-image` 协议加载、收起动效截图（约 49 KB PNG）、强杀后草稿恢复，全部通过。

PDF：`pdf-smoke.mjs` 走真实打印路径（隐藏 WebView2 + PrintToPdf）。输出为合法 PDF 1.4，A4，嵌入 KaTeX 字体和图片，页脚页码“1/1”。与 Electron 的差别是 WebView2 会在左上角页眉打印日期，无法用模板去掉。脚本里用 SendKeys 回答保存对话框，在中文输入法下路径会被吞，这次是手动保存的；脚本作为半自动工具保留。

## 已运行的测试

- `npm test`：65/65 通过。
- `cargo test`（`apps/tauri/src-tauri`）：5/5 通过（文件名、BOM+CRLF 往返、外部修改冲突、收起/移除/撤销后重启、过期 revision 与阅读状态校验）。
- 编辑器浏览器回归 `playwright.editor.config.mjs`：54 通过、2 失败（两个网页版 PDF 下载用例）。本机缺 Playwright 1.63 对应的 headless shell，借用已装的 1223 版运行；把 `pdfDocument.js` 恢复成 main 版本后这两个用例同样失败，判断为环境问题，与本分支改动无关。
- 未运行：Electron 桌面 Playwright 用例（本机未下载 Electron 二进制）。

## 未验证 / 风险

- 在本次受沙箱限制的环境里，WebView2 用户数据目录放在工作区以外会报“拒绝访问 (os error 5)”，测量时用 `FROWD_MEASURE_TMP` 指到 `target/tmp`。正常双击启动、使用默认 `%LOCALAPPDATA%` 位置的情况还没有实测。
- 只测了一台机器、一种输入法环境；中文输入法在 WebView2 下的组字行为需要实际试用。
