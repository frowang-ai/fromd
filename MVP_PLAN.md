# MVP v0.2 iteration plan

本轮在0.1.0可靠打开、编辑、保存和恢复的基础上，完成 SQLite 临时草稿、草稿命名和多标签按需加载。产品工作名 Frowang Markdown，产物只在本机生成，不自动发布。

## 本轮完成范围

- SQLite 按篇保存草稿，启动和标签列表只读取 metadata；正文通过受限 `read(id)` 按需加载。
- `contentHash` 与旧 SQLite 迁移；旧 `session.json` 只迁移一次并保留原件，失败事务可重试。
- 临时草稿命名、关闭即删除；已关联文件仍遵循保存／放弃／取消。
- 一个长期 Crepe/context/schema 和一个活跃富文本 DOM；每标签保留会话内正文、history、选区、滚动、源码 textarea、公式和代码块编辑状态。
- 切换和关闭前显式 flush，延迟读取／写入／ready／blur 按文档 ID、generation 和 revision 校验；相对图片重建 nodeView。
- 0.2.0 Windows portable 默认输出 `release/0.2.0/`；本轮验收产物使用独立 `release/0.2.0-verified/`，真实 Electron 与 portable smoke 已验证，命令和结果见 `VALIDATION.md`。

## 保留边界

- undo/redo 不跨应用重启恢复；访问过的正文树、history 和源码 textarea 仍随访问数量增长。按需加载释放未活跃 DOM、KaTeX 和嵌入 CodeMirror，不承诺总内存与笔记数无关。
- 真实 Windows 中文输入法、其他系统／架构、跨进程文件锁、自动更新、签名和公开发布仍不在承诺范围；合成 composition 测试不等于真机 IME 验收。

## 后续范围

- 旧网页全部标签会话迁移、文件树、大纲、查找替换和最近文件。
- 图片粘贴落盘、更多编码、实时外部修改提醒、主题、自定义快捷键、自动更新、正式签名与安装器。

## 交付判据

以 `npm test`、`npm run test:editor`、真实开发／打包 Electron 回归和 portable smoke 的实际结果为准；记录失败原因与未覆盖边界，不用性能单次观察替代行为验收。
