# 基础 UTF-8 TXT / HTML 导入

文件菜单 → 导入 TXT / HTML…，通过固定原生 picker 选择一个 .txt/.html/.htm。
成功创建独立、可命名的 path=null 草稿；文件名去扩展名作为初始页面名，与正文 H1 独立。
原件只读，不把源 TXT/HTML 关联成 Markdown 保存目标。

## 格式与明确边界

- 严格 UTF-8，可含 UTF-8 BOM；拒绝无效编码、NUL、超过 10 MiB 的源文/转换后正文。
  不猜 GBK/UTF-16。HTML 声明其他 charset 或使用 base 定位时明确拒绝。
- 沿既有文本规则，缓冲区统一 LF，记录源 BOM 与检测到的 CRLF/LF，另存为 Markdown 时恢复。
- TXT 按 Markdown 源文导入，保留字符、空格、Tab；不经序列化重写，也不把 TXT 当 HTML 解析。
  TXT 中有实际本地图片/附件 Markdown 引用时明确拒绝，提示改用 HTML 导入或插入资源；
  普通文字/代码示例不登记资源。安全网页链接保留。远程/内嵌图片不读取。
- HTML 在独立 template 内容中使用共享 sanitizer、数学恢复和现有 PM schema 转换，
  不替换当前编辑器来试解析。支持段落、标题、列表、表格、粗斜体、链接、代码及可识别数学。
  网页样式/字体/布局不保留；脚本/样式/嵌入/表单删除、危险链接地址移除（保留文字）、
  HTML 注释不导入、未知标签仅保留可转换内容，均在当前导入页的可关闭说明中明确报告。
  head/title 元信息不作为正文/页面名称。说明独立占行，不覆盖正文；切其他页隐藏。
  不承诺网页或任意 HTML 完整保真。

## 本地资源与事务

HTML 图片和本地附件链接由转换后的实际 image/link 节点收集；代码示例不授予资源权限。协议相对网页链接（合法 `//host/path?query#fragment`）只在 HTML `a[href]` 语境补成显式 `https:` 并报告；不对 TXT、图片、UNC 或文件路径放宽。
最多 8 个不同引用、合计 50 MiB，沿用真实 PNG/JPEG/GIF/WebP 10 MiB、附件 25 MiB、
profile 512 MiB/2048 对象限额。SVG 图片明确失败，可改为附件链接；不自动降级。
只解析源文件 canonical 所属目录内的相对普通文件，拒绝绝对/父级/符号链接越界；
不扫目录、不递归导入相邻 HTML、不下载远程图片/网页。查询/片段信息在持久引用中保留。
附件只通过既有 Ctrl+点击定位接口，不执行。

原生保留一个短期来源上下文（5 分钟 token，最多 10 MiB 文本 + 50 MiB 待提交资源），
新选择/取消清理旧上下文。renderer 不获得任意路径读取、shell、asset ** 权限。
资源准备只读/校验/计算不可变对象引用，不建页面、不写受管文件或数据库。
最终提交复用原资源批次实现：同一 SQLite 事务写新文档、选择/顺序与资源登记/绑定；
容量、资源或 DB 提交失败回滚；新对象文件按已有失败清理规则处理。
若清理文件本身失败，明确报告保留的孤立文件，不假称完全无写入；原件/当前文稿不覆盖。
不增加文档权威、schema 版本或破坏性迁移，旧 schema3 及已实现资源仍由原 Store 管理。
资源成功后使用标准 .frowd-assets/<hash>.<ext> 引用；重启、改名、收起和 SaveAs
沿既有资源模块工作，移除撤销可用，未引用/移除资源不立即 GC。

## 固定入口与交接

1. choose_document_import()：原生 picker + 有界 UTF-8 读取，返回内容/格式/BOM/EOL 与 token。
2. prepare_document_import_resources(token, references)：仅在该来源目录内读/校验引用，
   返回标准受管对象元信息；不接受 renderer 磁盘路径、二次 picker 或网络抓取。
3. commit_document_import(token, markdown)：最终校验并原子创建新草稿/资源。
   token 同时预留稳定新 docId；重复确认相同内容不重复建页，跨重启仍可核对。

Coordinator 等待正文/名称 IME 完成，再真实 readonly/inert 冻结、flush 并串行执行。
选择/资源准备沿一个不可取消 flight 有界等待；超时后迟到结果不会提交页面，未完成前
拒绝叠加请求。最终原子提交不使用会遗弃正在写入的超时；关闭/切页等待其结束。
提交回执异常时，按预留 docId 读取核对已有正文，确认成功后显示“已保存/回执异常已核对”，
不因回执丢失建第二页。成功以新 generation、空初始 history 激活；原页会话/选择独立。
取消、读取/转换/资源/事务失败，当前页、正文、选择和文档顺序保留。

## 实施入口

- src/documents/coordinator.mjs：IME/冻结/串行流程和回执核对。
- src/documents/host.mjs、src-tauri/src/file_import_host.rs：三条固定 IPC / picker / 短期来源。
- packages/editor/src/writingFileImport.js：独立内容转换、引用集合、最终 Markdown；不持久化。
- src-tauri/src/file_import.rs：来源读取、受控引用、稳定 ID 与最终领域提交。
- src-tauri/src/assets.rs：复用资源校验/对象写入；可与新文档合用一个事务。
- src-tauri/src/file_import_tests.rs：7 项原生测试，待本机；当前总计 38 项领域/helper 测试。

## 公司验证与本机节点

公司只运行 Node / Edge 与前端构建，不以 mock IPC 冒充原生：
- Node 34/34：新增导入 10 + 受影响表格/资源 24。
- 导入浏览器 14/14：结构/数学/安全、TXT、取消/编码/超限/缺资源/伪图片/数量、
  提交失败、真实当前页/选择保护、IME/关闭等待、回执丢失核对及重复确认。
- 同轮既有资源浏览器 20/20、共享表格/HTML/公式/列表浏览器 4/4。
- vue-tsc/Vite build、rustfmt 语法解析和 diff --check 通过；大 chunk 警告仍存在。
沿已约定的本机原生节点，8 项新增/总 39 项测试均未在公司执行，原生构建/桌面不宣称通过。

从仓库根目录复用 README 的依赖安装与隔离 profile，执行：
```powershell
node --test apps/tauri/tests/file-import.test.mjs apps/tauri/tests/resources.test.mjs apps/tauri/tests/resource-reuse.test.mjs
node apps/tauri/node_modules/@playwright/test/cli.js test -c apps/tauri/playwright.config.mjs file-import.browser.spec.mjs
npm run tauri:web
cargo test --manifest-path apps/tauri/crates/document-store/Cargo.toml --locked file_import
cargo test --manifest-path apps/tauri/crates/document-store/Cargo.toml --locked
```

本机真实检查（只用 output/native-file-import-source 与隔离 FROWANG_USER_DATA）：
1. 创建含 BOM/CRLF 的 UTF-8 TXT、中文 HTML、合成 PNG 与附件，使用原生菜单/picker 导入；
   检查非 UTF-8、10 MiB 超限、缺资源/损坏图片/越界和取消，原件哈希保持不变。
2. 草稿 path=null，改名不改 H1。图片/附件 Ctrl+点击定位，不启动附件。关闭重开及收起恢复。
3. 删除合成源资源后新草稿仍可显示；SaveAs 到另一个临时目录，确认 Markdown 与资源随行、
   BOM/EOL、无 profile 绝对路径，已有不同内容资源不覆盖。
4. 执行全部 38 项领域测试（包括旧 schema3、资源回滚/重启/访问边界相关用例）；
   在 WebView2 检查真实文件 IO、DB 事务、picker、物理中文 IME 和关闭交接。
不要使用真实笔记、真实 profile 或系统剪贴板作为自动测试资料。不运行安装器/部署。
