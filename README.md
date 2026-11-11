# Frowang Markdown — Windows MVP 0.2

本地 Markdown 编辑器，第二轮在可靠打开、编辑、保存和恢复的基础上，加入 SQLite 草稿、草稿命名和多标签按需加载。独立工程，不依赖 Frowang 网站、账号或 localhost 预览服务。

本机Windows x64 0.2.0 验收产物目录：`release/0.2.0-verified/`，便携包为 `Frowang-Markdown-0.2.0-x64.exe`；0.1.0 产物保留在原目录，不覆盖。源码存储22/22、内核56/56、开发桌面28/28通过；打包状态及限制见 `VALIDATION.md`。源码为独立 Git 仓库，远端为私有的 [frowang-ai/markdown-editor](https://github.com/frowang-ai/markdown-editor)，默认分支 `main`；本轮基线为 `8b750c6`。尚未公开发布。

## 项目记忆

Windows MVP 0.1与0.2均已由用户确认收束，当前状态、约束和下一轮入口归[模块记忆](https://github.com/frowang-ai/docs/blob/refactor-docs-20260725/modules/markdown-editor.md)。阶段过程分别见[0.1归档](https://github.com/frowang-ai/docs/blob/refactor-docs-20260725/archive/20261110_markdown_editor_mvp/README.md)和[0.2归档](https://github.com/frowang-ai/docs/blob/refactor-docs-20260725/archive/20261111_markdown_editor_v02/README.md)。文档更新提交 `13545ef` 已随 [docs PR #7](https://github.com/frowang-ai/docs/pull/7) 合入维护分支 `refactor-docs-20260725`（`dc8d4d6`）。

本机可读副本仍在[独立记忆工作区](../_worktrees/markdown-editor-memory/modules/markdown-editor.md)；共享 `website/docs` 中的其他未提交改动保留，未强行同步。规范归属为 `website/docs/modules/markdown-editor.md`，判断最新结论应以该维护分支或已同步的独立工作区为准。

`VALIDATION.md`继续维护可执行验证和覆盖范围，`MVP_PLAN.md`维护分轮范围，不用历史归档替代当前代码检查。`release/Frowang-Markdown-0.1.0-source.zip`是0.1.0交付快照，0.2.0不覆盖它。

## 开发与构建

本轮临时草稿、SQLite和多标签工作的接口及分工见 [实施约定](docs/iteration-02-contract.md)。三个功能PR已合入；本机交付0.2.0产物和验证范围见上方入口及 `VALIDATION.md`，后续按实际试用反馈迭代。

环境：Node 22.19+、Windows x64。首次安装会下载 Electron。

```powershell
npm ci
npm run setup:electron   # 下载锁定的官方 Electron，已完整下载则直接校验复用
npm test
npm run build
npm run test:desktop
npm run test:editor
npm run package:dir
npm run dist:win
```

`package:dir` 默认生成 `release/0.2.0/win-unpacked/Frowang Markdown.exe`，需要保留同目录所有文件。`dist:win` 默认生成 `release/0.2.0/Frowang-Markdown-0.2.0-x64.exe`。本轮为避开旧诊断输出占用，以 `npx electron-builder --win portable --x64 --publish never --config.directories.output=release/0.2.0-verified` 生成单独验收产物；portable检查使用 `node scripts/smoke-portable.mjs release/0.2.0-verified/Frowang-Markdown-0.2.0-x64.exe`。构建默认不发布、未进行代码签名。便携版表示无需安装，草稿仍保存在用户数据目录，不跟随 exe。

## 当前范围（0.1 与 0.2）

- Vue + Milkdown/ProseMirror 编辑内核，现有公式、列表、文本格式、源码切换与 AI 粘贴恢复。
- 多笔记标签；新建、打开 UTF-8 Markdown、保存回原文件、另存为。
- 保留 UTF-8 BOM 与 CRLF/LF；暂不支持其他编码和超过10MB的文件。
- 保存前比对磁盘内容；外部修改/删除时停止覆盖，支持重新读取或另存当前修改。
- SQLite 按篇保存草稿元数据、正文和 `contentHash`；启动只读取元数据，当前标签通过固定 `read(id)` 按需读取正文。外部文件在首次读取或保存时核对，clean 文件跟随磁盘，dirty 文件保留草稿并显示冲突。
- 草稿在输入停顿后自动备份，只有 SQLite 提交确认后才显示已自动保存；正常退出会先 flush。会话备份上限仍为100MiB，单篇最终文件上限10MiB，超限或不可写会明确提示。未确认的最后输入不承诺异常断电恢复。
- 旧 `session.json` 只迁移一次并保留原件；已有 SQLite 数据库事务升级到 schema v2，不再次导入旧 JSON。
- 临时草稿可独立命名；关闭临时草稿直接清除，已关联文件仍提供保存／放弃／取消。应用退出先完成正文、名称和阅读位置的备份。
- 富文本编辑器只保留一套长期 Crepe/schema 和一个活跃 DOM；各标签在会话内保留正文、选区、滚动、公式／代码块编辑状态和 undo/redo。源码模式继续使用按访问保留的 textarea，不承诺跨重启撤销历史。
- 访问过的正文树、撤销历史和源码 textarea 仍随访问过的笔记增长；按需加载主要释放未活跃标签的 DOM、KaTeX 和嵌入 CodeMirror，不承诺总内存与笔记数无关。

- 文档目录内的 PNG/JPEG/GIF/WebP 相对图片可展示；阻止跨目录、外部网络图片和任意文件读取。
- 本机 PDF 导出：使用 Electron 自带 Chromium，不需要单独运行网页预览或 Playwright 浏览器服务。

保存通过同目录临时文件、flush及rename替换，降低写入中断损坏风险。保存前的外部修改检测不等于跨进程文件锁；其他程序在检查与写入极短窗口内再次保存的竞态仍存在。当前没有实时外部修改提醒，在读取该篇或保存时检查。

## 数据与调试

默认数据位置由 Electron `app.getPath('userData')` 决定（Windows 通常在 `%APPDATA%/frowang-markdown`）；可通过开发者环境变量 `FROWANG_USER_DATA` 指定独立测试目录。恢复文件损坏时保留原文件，提示备份不可用，仍可将当前笔记另存为。备份目录不可写时也允许进入应用并保存到其他目录；全部文件已保存后可退出。页面进程崩溃可重载已接收草稿或从主进程退出，不依赖已死亡的页面完成握手。

原网页 `127.0.0.1:5199` 的 localStorage 不会自动转移进 Electron。第一轮请在原网页下载 `.md` 后从桌面版打开；旧网页与原草稿不删除。整份会话迁移、文件树、查找替换、主题设置、自动更新留到后续版本，不在首版冒充已实现。

内容日志沿用浏览器元数据诊断（视图→开发者工具，`window.__writingDebug`）；主进程错误只记录操作类别和错误类型，不记录笔记正文。应用无自动更新、无遥测、无后台模型请求。外部链接只在用户打开时交系统浏览器。

## 模块

- `packages/editor/src/`：可复用的 Vue 编辑器和 Markdown 工具；不依赖 Electron。
- `apps/desktop/src/main/documentStore.js`：文档元数据、按篇正文读取、内容 hash、磁盘冲突、原子保存与恢复。
- `apps/desktop/src/main/storageWorker.js`：SQLite 事务、旧 JSON／旧 SQLite 迁移、元数据初始化和单篇正文读取。
- `apps/desktop/src/main/index.js`：窗口、菜单、对话框、受限 IPC、图片协议与 PDF。
- `apps/desktop/src/preload/index.js`：固定操作 API，不向正文暴露 fs 或任意 IPC。
- `apps/desktop/src/renderer/`：简洁多标签应用；正文按需读取，编辑器实例由共享 session 管理。
- `packages/editor/src/MarkdownEditor.vue`：长期 Crepe/schema、会话 state、公式／代码块嵌入状态和 nodeView 清理。

- `tests/documents.test.mjs`、`tests/lazy-storage.test.mjs`：临时目录中的文件、迁移、故障和按需存储测试。
- `tests/desktop.spec.mjs`、`tests/drafts.desktop.spec.mjs`、`tests/lazy.desktop.spec.mjs`：真实 Electron 启动；只替代系统文件选择/确认对话框结果并控制指定IPC回执时机，其余窗口、IPC、磁盘、SQLite、PDF均实际运行。
- `tests/editor.browser.spec.mjs`：从原独立编辑器迁移的56项行为回归，`tests/browser-harness`仅为浏览器测试宿主，不打包进桌面应用。

包体和性能以实际产物为准。自动测试不能证明所有输入法和设备均无问题，发布状态与实际验证记录见 `VALIDATION.md`。

## 开源来源

自主实现按 MIT 发布。编辑器来源为 `frowang-ai/web-lunwen` 的独立试验分支，抽离基线 `647efc6`。没有包含 Typora 源码、CSS、图标或安装资源。依赖与字体遵循其各自许可，见 `THIRD_PARTY_NOTICES.md`。
