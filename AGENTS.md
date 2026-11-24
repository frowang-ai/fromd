# frowd 工作约定

- 唯一桌面客户端为 Tauri 0.5.3（Windows + macOS，待发布）。旧 `apps/desktop` Electron 宿主、构建与更新链路已退役；历史只从 Git 和 `VALIDATION.md` 追溯，不恢复为当前入口。
- 三层边界：共享 `packages/editor` + Rust `crates/document-store` + `coordinator.mjs` 产品逻辑；薄前端/原生平台壳；分平台打包与 CI。编辑包不得反向依赖 Tauri，平台手势由 props/参数传入。
- 先读根 README 与 `apps/tauri/README.md`；现行桌面行为见 `DESKTOP_FEEDBACK.md`，打包/人工验收见 `WINDOWS_INSTALLER.md` 和 `MACOS_PACKAGING.md`。带归档说明的阶段记录不是当前契约。
- 新功能保持单一职责。原有 Markdown 未编辑时保留原文；编辑后的序列化、重读、屏幕和 PDF 语义须一致。资源访问保持 docId 归属与受限协议，不增加任意路径/网络权限。
- 修改文件写入、恢复或 IPC 后运行根/Tauri 单元、相关 Rust 与真实桌面检查；编辑行为运行共享编辑器和受影响 Tauri 浏览器回归。正式入口为 `npm test`、`npm run test:tauri`、两套 `cargo test --locked`、`npm run tauri:check` / `tauri:web`、`npm run test:editor` / `test:tauri:browser` / `test:tauri:native`。
- 使用隔离 debug `FROWANG_USER_DATA`、WebView 数据目录和合成文稿；禁止真实笔记作为测试样本。浏览器使用独立端口，不操作其他会话的 1420 预览/profile。
- 每个开发任务使用独立 worktree，保护已有改动。审查实际 diff，按既有授权 commit、push、更新 PR；合并/发布需要相应授权。不得提交用户数据、依赖、`output/` 或 `.pi/`。
- Windows NSIS、macOS APP/DMG 和 Actions 产物不自动公开发布，不启用更新源。云端编译与静态校验不替代原生 GUI、输入法、PDF 物理分页与安装验收。
- 用户本轮已授权吸收 origin/main 历史并彻底退役 Electron；不再为该收口重复请求确认。记忆维护遵循父项目约定，不随小修改更新。
