# 第二轮：临时草稿、SQLite 与多标签

本文是经用户确认的下一轮设计及分工，不表示功能已经完成。基线：`b575e30`（Windows MVP 0.1.0）；私有仓库 `frowang-ai/markdown-editor`，目标分支 `main`。

## 使用行为

用户同时粘贴多篇 Agent 回复阅读、编辑，多数用完即弃，少数保留到次日，不要求长期笔记库。

- 未关联外部文件的草稿可独立命名，标签和窗口标题即时同步；正文和名称自动保留在本机。
- 关闭一个临时草稿标签即清除该草稿；不弹“先保存为文件”确认。关闭最后一篇后新建空白草稿。
- 退出整个应用保留仍打开的草稿；正常退出先完成保存，不逐篇要求保存到外部文件。恢复失败或保存失败必须如实显示，不能虚报已保存。
- 已关联磁盘文件的标签关闭不删除磁盘文件，未保存修改仍有保存/放弃/取消。Ctrl+S 和另存为继续操作普通 UTF-8 Markdown 文件。
- 不设置自动到期删除；不擅自增加回收站、长期历史、文件树、云同步或多桌面窗口。
- 重启恢复标签顺序、活动笔记和已保存的阅读位置；异常终止只承诺已确认持久化的版本。

## 分工与合入顺序

A / SQLite：拥有 main、preload、存储 worker、依赖/构建以及现有 documents/desktop 测试中依赖 session.json 的适配。保持完整旧界面可运行，负责下列公共 API 与关闭/退出主进程行为。

B / 草稿界面：拥有 renderer 中的命名、状态及交互；新桌面行为测试优先使用独立 spec，避免与 A 同时改写原测试。确需变更测试配置时只扩展 testMatch，并在合并后核对。不要自行实现另一套 main/preload；通过主 agent 与 A 协调。

C / 按需加载：在 A、B 稳定的基线上负责 metadata-only 正式列表、按需正文、编辑器实例管理及必要内核状态接口。由于与 B 共享 renderer，正式接入顺序为 A → B → C。

各功能独立 worktree，一个现场一个 writer。主 agent 负责接口、调度、批判性核验审核意见和已授权 Git/PR 合入；产品实现及冲突回修交相应 coder。只有独立只读审核和相关验证完成后才开功能 PR。

## A/B 公共 API 约定

已有方法在 A 阶段保持兼容：`list/newDocument/open/update/activate/save/close/reload/exportPdf/ready/closeReady/cancelClose` 及现有事件。`list()` 暂保留完整旧快照以便独立验收，C 再将正式启动链路迁到 metadata-only。

新增方法（通过受限 preload 暴露，main 继续验证来源）：

- `rename(id, title)` → `{ id, title, backedUp, warning }`。只改未关联文件的草稿名称；前后空白修剪，空名归一为“未命名笔记”，拒绝非字符串及过大输入。不得修改正文 revision。不会返回旧正文覆盖界面。关联文件不通过此接口重命名磁盘文件。
- `listMetadata()` → `{ documents: metadata[], activeId, warning }`，不含任何正文或 savedText。
- `read(id)` → 单篇可供界面使用的文档，包含 markdown、metadata、viewState，不暴露用于磁盘比较的正文副本。
- `setViewState(id, state)` → `{ saved, warning }`。state 使用小型可验证 JSON：`mode: 'rendered'|'source'`、`scrollTop`、可选 `selection: { anchor, head }`、可选 `sourceSelection: { start, end }`；初期由 A 提供持久化入口，C 接入。不得携带无限制对象、DOM 或完整撤销历史。

metadata 至少含 `id/title/path/revision/dirty/conflict`，可携带 `viewState` 和时间信息。`path: null` 是内部草稿。列表顺序就是标签顺序。

`update(id, markdown, revision)` 的既有版本约定保留；更低 revision 不能覆盖更新内容。rename/viewState 独立于正文 revision。关闭已删除 ID 后的迟到更新必须拒绝或返回明确 stale/closed 结果，不得 upsert 使其复活。

B 的名称输入本地即时更新标签，可合并连续输入，Enter/失焦完成，退出、保存或切换前妥善处理待提交名称。不可让异步旧响应覆盖更新名称或新正文。保存提示以写入结果为准。

保存对话框的建议文件名从草稿名称生成，要处理 Windows 文件名不允许的字符，不能把名称直接当路径。实际文件绑定后的标题继续以文件名为准。

如实际依赖证明接口需要调整，先向主 agent 提供理由，由主 agent同步双方，不各自猜接口。

## 存储约束

- SQLite 按篇保存，通过 worker 串行执行短事务；不在渲染线程或 Electron 主循环执行大量同步数据库工作。
- 优先验证现有 Node/Electron 的 `node:sqlite` 能力与打包 worker 路径；确需第三方依赖时说明选择，锁定版本，不做无关依赖升级。
- 创建/保存/关闭更新以事务保证状态一致；数据库成功提交后才能回报自动保存成功。
- 旧 `session.json` 只迁移一次，保留原件；同一迁移事务记录完成状态。失败不留可被误认成功的半成品。后续删除的草稿不因重新读取旧 JSON 而复活。
- 保留磁盘文件 BOM/换行、最终 10 MiB 限制、外部修改检测和另存为；同一外部文件不允许重复标签覆盖。
- `savedText` 的完整复制若可安全替换为内容摘要/必要状态可实施，但不得破坏 dirty、冲突和失败降级语义。
- 数据库不可写时仍应能打开空白编辑环境并另存到外部文件；不可保存的草稿不得显示已备份或在正常退出时静默丢弃。
- 应用关闭与 renderer-ready/崩溃恢复、第二实例排队的现有契约保留。

## 多标签性能与编辑状态

C 先测相同隔离样本的启动、切换和内存基线，再选择实例缓存范围。未访问标签不创建编辑器，不一次把全部正文通过 IPC 传入 renderer。

卸载前保存正文和轻量 viewState；保留会话内撤销/重做和源码模式，不能只序列化 Markdown 后静默丢掉 undo。必要的 ProseMirror EditorState 可保留在内存，与 DOM/editor view 生命周期分离；先用局部 probe 验证实际依赖支持，再接入。公式未完成编辑、切换中迟到事件与释放失败都需针对性核对。不要求跨重启恢复完整撤销历史。

## 验收与交付

- 使用隔离 FROWANG_USER_DATA、临时文件和独立输出；禁止读取或用真实用户笔记测试迁移。旧会话样本由测试生成。
- A：迁移/重复启动/按篇更新/删除后迟到写入/数据库失败、文件冲突等 `npm test`，实际 Electron 构建与桌面旧流程。
- B：新建、粘贴、命名、多篇切换、关闭部分、退出重启；真实文件关闭保存/放弃/取消；名称输入竞态。
- C：相同样本的性能观察，按需加载及释放恢复，光标/源码/公式/列表/撤销相关行为。
- 最终以开发与打包后的真实 Electron 流程验收；用户流程是“多篇 Agent 回复 → 命名阅读 → 关闭部分 → 退出 → 次日重开只恢复剩余内容”。
- 不为小改动重复跑无关全量或增加机械校验设施；发生新失败查明原因，不以重跑变绿代替原因分析。
- 每个功能对实际提交差异独立审核，主 agent 判断意见后决定回修/合入；本轮已授权按 A/B/C 顺序整合，未授权公开发布。
