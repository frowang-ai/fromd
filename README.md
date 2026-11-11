# frowd — Windows 0.3.1

本地 Markdown 编辑器。0.3.0 将标签末尾「+」、原生菜单与 Windows NSIS 安装／应用内更新流程整合在同一版本，保留 SQLite 草稿和多标签按需加载。独立工程，不依赖 Frowang 网站、账号或 localhost 预览服务。

0.3.1 将应用显示名、窗口标题、快捷方式与安装包名统一为小写 `frowd`，图标直接沿用 `web-lunwen/public/icon-512.png` 的 Frowang 标识。`package.name=frowang-markdown`、`appId=com.frowang.markdown` 和 `Frowang Markdown.exe` 内部文件名保持不变，继续使用原草稿目录和安装身份；exe 的显示名称与图标资源更新为 frowd。当前仍是无更新源、未签名的本地安装包，未开启在线更新。

0.3.0 整合基线为已合入菜单的 `c026d77`，合并更新候选 `66258ed`；最终本地产物使用 `release/0.3.0/`，旧 0.2 产物不覆盖。生产更新源和签名凭据尚未配置，安装版默认停用更新、未签名、未公开发布。实际联合验证为单元57/57、开发桌面34/34、真实NSIS联合升级1/1、生产包桌面34/34，详见 `VALIDATION.md`。安装器 `release/0.3.0/Frowang-Markdown-Setup-0.3.0-x64.exe` 为130,386,357字节，已核实实际应用版本0.3.0及包内关键入口与受测out一致。

历史 0.2.0 验收产物目录：`release/0.2.0-verified/`，便携包为 `Frowang-Markdown-0.2.0-x64.exe`；0.1.0 产物保留在原目录，不覆盖。源码存储22/22、内核56/56、开发桌面28/28通过；打包状态及限制见 `VALIDATION.md`。源码为独立 Git 仓库，远端为私有的 [frowang-ai/markdown-editor](https://github.com/frowang-ai/markdown-editor)，默认分支 `main`；0.2 轮基线为 `8b750c6`。尚未公开发布。

## 项目记忆

Windows 0.1、0.2与0.3均已由用户确认收束。当前状态、约束和后续入口归[模块记忆](https://github.com/frowang-ai/docs/blob/refactor-docs-20260725/modules/markdown-editor.md)；阶段过程分别见[0.1归档](https://github.com/frowang-ai/docs/blob/refactor-docs-20260725/archive/20261110_markdown_editor_mvp/README.md)、[0.2归档](https://github.com/frowang-ai/docs/blob/refactor-docs-20260725/archive/20261111_markdown_editor_v02/README.md)和[0.3归档](https://github.com/frowang-ai/docs/blob/refactor-docs-20260725/archive/20261111_markdown_editor_v03/README.md)。记忆维护在独立docs仓库的 `refactor-docs-20260725` 分支进行，与应用功能发布分开管理。0.3功能交付提交为 `027069d`（验收 `a82252c`），其后的文档收尾不改变安装器。

本机可读副本仍在[独立记忆工作区](../_worktrees/markdown-editor-memory/modules/markdown-editor.md)；共享 `website/docs` 中的其他未提交改动保留，未强行同步。规范归属为 `website/docs/modules/markdown-editor.md`，判断最新结论应以该维护分支或已同步的独立工作区为准。

`VALIDATION.md`继续维护可执行验证和覆盖范围，`MVP_PLAN.md`维护分轮范围，不用历史归档替代当前代码检查。`release/Frowang-Markdown-0.1.0-source.zip`是0.1.0交付快照，0.2.0不覆盖它。

## 开发与构建

0.2 轮临时草稿、SQLite和多标签工作的接口及分工见 [实施约定](docs/iteration-02-contract.md)。当前 0.3 联合版沿用这些数据与退出约定，增加原生菜单、按用户安装和更新启动保护。源码固定后先 `build`，再开发回归、打包和打包回归；不要在同一 `out` 上并发构建与测试。

环境：Node 22.19+、Windows x64。首次安装会下载 Electron。

```powershell
npm ci
npm run setup:electron   # 下载锁定的官方 Electron，已完整下载则直接校验复用
npm test
npm run build
npm run test:desktop
npm run test:editor
npm run package:dir
npm run dist:win         # portable
npm run dist:installer   # 按当前用户安装的 NSIS 安装包
```

`package:dir` 默认生成 `release/0.3.1/win-unpacked/Frowang Markdown.exe`，需要保留同目录所有文件。`dist:installer` 生成 `release/0.3.1/frowd-Setup-0.3.1-x64.exe`。`dist:win` 可生成 `frowd-0.3.1-x64.exe` portable，本轮交付以安装包为准。历史 `release/0.2.0-verified/` 保持原样。构建默认不发布、未进行代码签名。便携版表示无需安装，草稿仍保存在用户数据目录，不跟随 exe。

## Windows 安装与更新

`npm run dist:installer` 使用 electron-builder 26.18.0 生成 `release/0.3.1/frowd-Setup-0.3.1-x64.exe`，按当前用户安装，保留固定的 `com.frowang.markdown` 身份、安装入口及桌面／开始菜单快捷方式。后续直接运行已安装的 exe，无需每次执行 portable 外壳。安装／升级不删除应用数据或外部 `.md`，卸载默认也保留用户数据。portable 构建入口继续保留。

更新由固定的 electron-updater 6.8.9 `NsisUpdater` 处理。安装版启动就绪 30 秒后检查一次，此后至多每 6 小时检查；手动检查至少间隔 10 秒。只用 stable（`latest.yml`），显式拒绝预发布及降级；只接受包含非空 `files` 的现代清单，拒绝需要管理员权限或 web installer 的候选。检查失败会取消旧候选的下载资格，下载前再次核对库中实际候选与已接受的版本、文件信息一致。发现版本后由用户点击下载，下载完成可“稍后”或“重启更新”；普通退出不会自动安装。重启先复用正文／名称／阅读位置 flush，再等待 SQLite 提交；随后仅在安装器的真实 `ChildProcess` 确认启动、更新库也请求退出后放行应用退出。保存或安装器启动失败均保持窗口及草稿，可在同一窗口重试，不要求先 Ctrl+S 保存为外部文件。按用户安装的更新不转交 shell 或提权 fallback；安装器已经启动后的安装失败不承诺自动回滚。应用内不接收任意 URL、token 或 IPC 名称。

默认没有更新源，不会请求更新网络。开发、解包和 portable 入口也停用更新。正式源由构建者配置，源码仓库保持 private，不使用其 GitHub Releases，也不把 GitHub token 打包：

```powershell
# URL 指向你已准备好的 HTTPS 静态目录；这里不预设真实地址。
$env:FROWANG_UPDATE_URL = '<已确认的 HTTPS 更新目录>'
$env:FROWANG_UPDATE_PUBLISHER = '<代码签名证书的发布者名称>'
# 按 electron-builder 的签名方式配置 CSC_LINK / CSC_KEY_PASSWORD 或签名服务。
npm run dist:installer
```

带正式源时构建强制代码签名，使用锁定 builder 支持的 `win.signtoolOptions.publisherName` 和签名验证；未配置凭据的构建不能冒充可发布签名版本。版本元数据、安装器、blockmap 和差量请求均在此 updater 实例的实际请求／重定向边界校验 HTTPS 与无 URL 凭据，测试请求仅限指定 loopback origin，不改变应用其他网络或 TLS。`app-update.yml` 和固定 URL 随包生成。将版本对应的安装器、`.blockmap` 与 `latest.yml` 放入同一 HTTPS 目录，最后替换 `latest.yml`；这是单独的发布动作，本项目命令均 `--publish never`，不会上传或创建 Release。当前版号为 0.3.1；隔离 NSIS 的 0.2.900／0.2.901 仅为构建覆盖测试版本。更新源故障或签名不匹配不能保证更新可用；失败可手动重试。安装器启动后遭系统中断不具备事务回滚保证。

隔离真实升级回归使用两个实际 NSIS 安装包与 loopback 源，命令见 `VALIDATION.md`。HTTP 仅限显式 `FROWANG_UPDATE_TEST_BUILD=1` 的测试构建，构建时还必须指定绝对路径 `FROWANG_UPDATE_TEST_PROFILE`。测试包携带这个固定路径，在同一测试 appId／productName 下初装、升级、自动重开均使用它，并将 updater 缓存放在旁边。原因是 NSIS 经桌面 shell 自动重开时不继承父进程环境变量。仅测试安装包使用同步 CJS 启动入口，在导入完全相同的产品主入口前设置隔离目录和随机 loopback CDP 端口，测试直接连接 NSIS 自动重开的 UI；测试包不创建快捷方式，不可作为用户交付包。正式包不包含测试启动文件或路径字段，产品 main 不含测试证据写入，renderer／更新元数据无法更改该路径。

## 当前范围（0.1–0.3）

- Vue + Milkdown/ProseMirror 编辑内核，现有公式、列表、文本格式、源码切换与 AI 粘贴恢复。
- 多笔记标签；标签末尾的「+」新建并激活笔记，标签过多时可横向滚动，「+」始终留在滚动区外。窗口原生「文件」菜单提供新建、打开、保存、另存为和 PDF 导出，「视图 → 源码模式」切换源码／正文；编辑菜单与 Ctrl+N/O/S、Ctrl+Shift+S 保留。
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

原网页 `127.0.0.1:5199` 的 localStorage 不会自动转移进 Electron。第一轮请在原网页下载 `.md` 后从桌面版打开；旧网页与原草稿不删除。整份会话迁移、文件树、查找替换和主题设置留到后续版本。安装版更新的配置边界见上文。

内容日志沿用浏览器元数据诊断（视图→开发者工具，`window.__writingDebug`）；主进程错误只记录操作类别和错误类型，不记录笔记正文。应用无遥测、无后台模型请求；只有已配置更新源的安装版会按上述周期请求版本元数据，下载需用户点击。外部链接只在用户打开时交系统浏览器。

## 模块

- `packages/editor/src/`：可复用的 Vue 编辑器和 Markdown 工具；不依赖 Electron。
- `apps/desktop/src/main/documentStore.js`：文档元数据、按篇正文读取、内容 hash、磁盘冲突、原子保存与恢复。
- `apps/desktop/src/main/storageWorker.js`：SQLite 事务、旧 JSON／旧 SQLite 迁移、元数据初始化和单篇正文读取。
- `apps/desktop/src/main/updates.js`：更新配置边界、低频检查、手动下载和重启意图；通过既有退出握手确认 SQLite 后安装。
- `apps/desktop/src/renderer/UpdateNotice.vue`：左下角更新状态、进度、重试与稍后入口。
- `apps/desktop/src/main/index.js`：窗口、对话框、受限 IPC、图片协议与 PDF；`applicationMenu.js`维护原生菜单和当前文档可用状态。
- `apps/desktop/src/preload/index.js`：固定操作 API，不向正文暴露 fs 或任意 IPC。
- `apps/desktop/src/renderer/`：简洁多标签应用；正文按需读取，编辑器实例由共享 session 管理。
- `packages/editor/src/MarkdownEditor.vue`：长期 Crepe/schema、会话 state、公式／代码块嵌入状态和 nodeView 清理。

- `tests/documents.test.mjs`、`tests/lazy-storage.test.mjs`：临时目录中的文件、迁移、故障和按需存储测试。
- `tests/desktop.spec.mjs`、`tests/drafts.desktop.spec.mjs`、`tests/lazy.desktop.spec.mjs`：真实 Electron 启动；只替代系统文件选择/确认对话框结果并控制指定IPC回执时机，其余窗口、IPC、磁盘、SQLite、PDF均实际运行。
- `tests/editor.browser.spec.mjs`：从原独立编辑器迁移的56项行为回归，`tests/browser-harness`仅为浏览器测试宿主，不打包进桌面应用。

包体和性能以实际产物为准。自动测试不能证明所有输入法和设备均无问题，发布状态与实际验证记录见 `VALIDATION.md`。

## 开源来源

自主实现按 MIT 发布。编辑器来源为 `frowang-ai/web-lunwen` 的独立试验分支，抽离基线 `647efc6`。没有包含 Typora 源码、CSS、图标或安装资源。依赖与字体遵循其各自许可，见 `THIRD_PARTY_NOTICES.md`。
