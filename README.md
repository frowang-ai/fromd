# Frowang Markdown — Windows MVP 0.1

本地 Markdown 编辑器，第一轮目标是可靠打开、编辑、保存和恢复文件。独立工程，不依赖 Frowang 网站、账号或 localhost 预览服务。

本机Windows x64初版产物：`release/Frowang-Markdown-0.1.0-x64.exe`（免安装）或 `release/win-unpacked/Frowang Markdown.exe`（同目录文件必须一起保留）。编辑内核56/56、文件层10/10、开发构建桌面5/5、打包程序桌面5/5通过。具体覆盖与限制见 `VALIDATION.md`。源码为独立 Git 仓库，远端为私有的 [frowang-ai/markdown-editor](https://github.com/frowang-ai/markdown-editor)，默认分支 `main`；首个 MVP 基线为 `b575e30`。尚未公开发布。

## 项目记忆

本轮Windows MVP已于2026-11-10经用户确认收束。当前状态、约束和下一轮入口见[模块记忆](../_worktrees/markdown-editor-memory/modules/markdown-editor.md)，调研、审核及排障证据见[阶段归档](../_worktrees/markdown-editor-memory/archive/20261110_markdown_editor_mvp/README.md)。这两份记录位于独立docs任务分支，避免混入工作区docs其他未提交修改；已提交 `74d071e`，并以 `a32fe37` 对齐到文档维护分支 `refactor-docs-20260725`；文档 [PR #7](https://github.com/frowang-ai/docs/pull/7) 待合并。合入后规范路径为 `website/docs/modules/markdown-editor.md`。

`VALIDATION.md`继续维护可执行验证和覆盖范围，`MVP_PLAN.md`维护分轮范围，不用历史归档替代当前代码检查。`release/Frowang-Markdown-0.1.0-source.zip`是memory收尾前的交付快照，本次归档不重打应用或覆盖该快照。

## 开发与构建

下一轮临时草稿、SQLite 和多标签工作的接口及分工见 [实施约定](docs/iteration-02-contract.md)。该文档描述目标行为，实际完成状态以代码、验证结果和各功能 PR 为准。

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

`package:dir` 生成 `release/win-unpacked/Frowang Markdown.exe`，需要保留同目录所有文件。`dist:win` 生成免安装 exe。构建默认不发布、未进行代码签名。便携版表示无需安装，草稿仍保存在用户数据目录，不跟随 exe。

## 第一轮范围

- Vue + Milkdown/ProseMirror 编辑内核，现有公式、列表、文本格式、源码切换与 AI 粘贴恢复。
- 多笔记标签；新建、打开 UTF-8 Markdown、保存回原文件、另存为。
- 保留 UTF-8 BOM 与 CRLF/LF；暂不支持其他编码和超过10MB的文件。
- 保存前比对磁盘内容；外部修改/删除时停止覆盖，支持重新读取或另存当前修改。
- 未保存草稿每次输入停顿约200ms后备份到应用用户目录 `session.json`；重启恢复全部标签和活动标签。会话备份读写统一上限100MiB，达到上限时明确报备份失败并保留旧备份，不再承诺新内容已恢复保护；可保存文件并关闭部分笔记。未收到备份确认的最后一次输入不承诺崩溃恢复。
- 关闭文档询问保存/不保存/取消；关闭标签不删除原文件。退出应用可保留草稿，下次恢复。
- 文档目录内的 PNG/JPEG/GIF/WebP 相对图片可展示；阻止跨目录、外部网络图片和任意文件读取。
- 本机 PDF 导出：使用 Electron 自带 Chromium，不需要单独运行网页预览或 Playwright 浏览器服务。

保存通过同目录临时文件、flush及rename替换，降低写入中断损坏风险。保存前的外部修改检测不等于跨进程文件锁；其他程序在检查与写入极短窗口内再次保存的竞态仍存在。首版没有实时外部修改提醒，保存或重启时才检查。

## 数据与调试

默认数据位置由 Electron `app.getPath('userData')` 决定（Windows 通常在 `%APPDATA%/frowang-markdown`）；可通过开发者环境变量 `FROWANG_USER_DATA` 指定独立测试目录。恢复文件损坏时保留原文件，提示备份不可用，仍可将当前笔记另存为。备份目录不可写时也允许进入应用并保存到其他目录；全部文件已保存后可退出。页面进程崩溃可重载已接收草稿或从主进程退出，不依赖已死亡的页面完成握手。

原网页 `127.0.0.1:5199` 的 localStorage 不会自动转移进 Electron。第一轮请在原网页下载 `.md` 后从桌面版打开；旧网页与原草稿不删除。整份会话迁移、文件树、查找替换、主题设置、自动更新留到后续版本，不在首版冒充已实现。

内容日志沿用浏览器元数据诊断（视图→开发者工具，`window.__writingDebug`）；主进程错误只记录操作类别和错误类型，不记录笔记正文。应用无自动更新、无遥测、无后台模型请求。外部链接只在用户打开时交系统浏览器。

## 模块

- `packages/editor/src/`：可复用的 Vue 编辑器和 Markdown 工具；不依赖 Electron。
- `apps/desktop/src/main/documentStore.js`：文档路径、内容版本、磁盘冲突、原子保存与恢复。
- `apps/desktop/src/main/index.js`：窗口、菜单、对话框、受限 IPC、图片协议与 PDF。
- `apps/desktop/src/preload/index.js`：固定操作API，不向正文暴露 fs 或任意 IPC。
- `apps/desktop/src/renderer/`：简洁多标签应用；文件状态由主进程持有。
- `tests/documents.test.mjs`：临时目录中的文件行为测试。
- `tests/desktop.spec.mjs`：真实 Electron 启动；只替代系统文件选择/确认对话框结果，其余窗口、IPC、磁盘、PDF均实际运行。
- `tests/editor.browser.spec.mjs`：从原独立编辑器迁移的56项行为回归，`tests/browser-harness`仅为浏览器测试宿主，不打包进桌面应用。

包体和性能以实际产物为准。自动测试不能证明所有输入法和设备均无问题，发布状态与实际验证记录见 `VALIDATION.md`。

## 开源来源

自主实现按 MIT 发布。编辑器来源为 `frowang-ai/web-lunwen` 的独立试验分支，抽离基线 `647efc6`。没有包含 Typora 源码、CSS、图标或安装资源。依赖与字体遵循其各自许可，见 `THIRD_PARTY_NOTICES.md`。
