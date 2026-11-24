# 常见问题

## 从旧版本升级，草稿还在吗？

从 **Tauri 0.5.2（fromd 或旧名 frowd）** 升级到 **fromd 0.5.3** 会沿用原数据库、未命名草稿、收起页面、图片附件和阅读设置，无需搬库。应用数据身份 `com.frowang.frowd.tauri.v1`、数据库 `drafts.sqlite` 和资源目录保持不变。

更早的 **frowd 0.5.0 及以前 Electron 标准版**、**frowd lite 0.4.0-alpha.1 预览版** 使用不同资料目录。fromd 不会自动读取或删除这些旧草稿；请先在旧版将需要的笔记「另存为」`.md`，再在 fromd 打开。旧目录见 [Windows 安装说明](install-windows.md#数据保存在哪里)。

## frowd lite 和标准版还分吗？

不分了。0.5.2 起只有一个 Tauri 客户端，现名 fromd。旧 Electron 标准版和 lite 预览版均已停止维护。

## 如何检查更新？

- Windows：打开「文件 → 检查更新…」。左下角提示新版本后，点击「立即更新」，应用下载并校验 SHA-256，等待输入法完成、保存文稿后启动覆盖安装。
- macOS：打开「fromd → 检查更新…」，点击「前往下载更新」进入 [Release 下载页](https://github.com/frowang-ai/fromd/releases/latest)，下载对应架构 DMG，正常退出应用后替换 app。

检查、下载、保存或安装器启动失败时会保留当前窗口与内容，弹窗内可重试。Windows 的安装器启动成功后应用退出，安装结果以安装器为准。macOS 不会自动退出或静默替换。当前没有后台自动检查；需要 GitHub 通知可点 **Watch → Custom → Releases**。

旧 frowd 0.5.2 安装包还没有「检查更新…」入口时，请先从 [Releases](https://github.com/frowang-ai/fromd/releases/latest) 下载含此功能的新版安装包。

## 草稿没点保存，会丢吗？

编辑内容会持续自动写入本地数据库，正常退出和应用内更新会等待最后输入保存。强制结束进程、断电或磁盘故障仍可能丢失尚未写入的最后输入，不能把自动保存当作独立备份。

草稿只存在这台电脑上。重要内容可保存成 `.md` 文件，或退出应用后备份整个数据目录（[Windows](install-windows.md#数据保存在哪里) / [macOS](install-macos.md#数据保存在哪里)）。

## 打开第二个 fromd 时提示「此数据目录已由另一个应用实例打开」？

同一资料目录一次只能由一个进程打开，避免两个程序同时写草稿。旧 frowd Tauri 和 fromd 共用资料目录，也不能同时打开。请回到已经打开的窗口，用「文件 → 打开」打开其他笔记。

## 双击 `.md` 文件能直接用 fromd 打开吗？

安装器不会自动关联 `.md`。当前正式入口是应用内「文件 → 打开」；不要把手动更改系统默认程序当作已支持的文件打开协议。

## MacBook Air 应该下载 aarch64 还是 x64？

在苹果菜单 →「关于本机」查看：**Apple 芯片（M 系列）选 aarch64**，**Intel 处理器选 x64**。aarch64 也叫 ARM64，x64 也叫 x86_64；不能只按 MacBook Air 这个机型名称判断。下载、校验后，把 `fromd.app` 拖入 `/Applications`，复制完成、推出 DMG，再从「应用程序」打开。

## macOS 提示「无法验证开发者」或「已损坏」怎么办？

待发布的 v0.5.3 对 macOS APP 使用免费 ad-hoc 签名，DMG 容器未签名；没有 Developer ID 签名或苹果公证，不能保证 Gatekeeper 放行。旧 v0.5.2 包仍按未签名、未公证分发。

「无法验证开发者」通常需要在核对官方来源和哈希后，通过系统设置允许这次打开。「已损坏」则先重新下载、核对同一 Release 的 `SHA256SUMS.txt` 并重新安装；仍受阻时，安装说明提供了仅对 `/Applications/fromd.app` 移除 quarantine 的手动步骤及其影响。移除标记不能修复真正损坏或无效签名。详见 [macOS 首次打开说明](install-macos.md#第一次打开)，不要关闭全局 Gatekeeper。

## 支持 Linux 吗？

暂时只提供 Windows 和 macOS 版。

## 已知限制

- 更新由用户手动检查，不会后台自动检查或静默安装。
- 0.5.3 待发布；Windows 安装包未签名，macOS APP 使用 ad-hoc 签名、DMG 未签名，未做 Developer ID 签名或公证，首次打开仍可能被拦截。旧 0.5.2 包的签名状态不变。
- 更早的 Electron/lite 预览版草稿不会自动迁移；现有 Tauri 0.5.2 数据直接沿用。
- 各家中文输入法和 PDF 物理分页尚未在每种机器上逐一实测；反馈时请写明系统及输入法。
