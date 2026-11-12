# MVP 工作约定

- 当前工程为 Windows frowd 0.4.0：统一名称与图标、SQLite持久化页面收起/卡片恢复、450ms/400ms收尖动效、原生菜单与NSIS安装。当前运行/配置/验收见README和VALIDATION，数据与交互增量见docs/page-shelf.md；docs/iteration-02-contract.md保留0.2历史约定。
- 进入后先读README的「项目记忆」入口，再按需读当前模块记忆与阶段归档。用户已于2026-11-11确认0.3收束；后续根据新需求/试用反馈确定范围，不将已完成功能重复立项。
- 原网站与浏览器体验目录仍保留；不覆盖其草稿或改写来源工作区。
- 保持文件服务、Electron preload、renderer 与编辑内核的单向边界；编辑包不得依赖 Electron。
- 修改文件写入、恢复或 IPC 后运行 `npm test` 与相关真实桌面测试；编辑行为修改运行对应浏览器回归。
- 验证优先使用隔离 `FROWANG_USER_DATA` 和临时文档，禁止用真实用户笔记作测试样本。
- 打包只生成本地安装/便携产物；不自动公开发布或启用更新。独立远端为私有 frowang-ai/markdown-editor，main 是合入目标。每项功能用 website/_worktrees/ 下独立 worktree；先审核实际提交，再由主 agent 统一 push/PR/合入。不得提交用户数据、依赖或打包产物。
- 每轮确认实际测试结果与已知限制后再扩大功能；不宣称对所有系统和输入法绝对无 bug。
