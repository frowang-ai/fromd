# Windows 安装说明

## 下载

**版本 v0.5.5**。下载页：[Releases](https://github.com/frowang-ai/fromd/releases/tag/v0.5.5)，下载安装包 `fromd_0.5.5_x64-setup.exe` 和同页的 `SHA256SUMS.txt`。

## 校验文件

在下载目录打开 PowerShell：

```powershell
Get-FileHash .\fromd_0.5.5_x64-setup.exe -Algorithm SHA256
```

输出的 Hash 应该和 `SHA256SUMS.txt` 里对应的一行一致（大小写不影响）。不一致就不要运行，重新下载。

## SmartScreen 提示

安装包目前**没有代码签名**，第一次运行时 Windows 可能会显示“Windows 已保护你的电脑”。

确认文件来自本仓库且校验一致后，点 **更多信息** → **仍要运行**。

## 安装

- 只为当前用户安装，不需要管理员权限。
- 安装向导可以选择安装目录，D 盘、F 盘等有写权限的目录都可以。数据目录不会跟着搬过去，见下文。
- 开始菜单里的文件夹叫 `fromd`，桌面快捷方式名称为 `fromd.lnk`。
- 桌面快捷方式默认**不勾选**，需要的话在向导里勾上；应用内被动更新可能创建快捷方式。旧 Tauri 版本安装目录可被识别时，覆盖成功后会移除指向同一程序的旧 `frowd` 快捷方式。

## 检查更新

打开「文件 → 检查更新…」，左下角显示检查结果。发现新版本后点「立即更新」，应用会下载同一 Release 的安装包和 `SHA256SUMS.txt`，校验 SHA-256 与安装包格式。

下载期间可以继续编辑。启动安装前会等待正文和名称栏输入法完成，把最新正文、标题及阅读位置保存到 SQLite；保存成功且安装器启动成功后才退出。网络、校验、保存或启动失败时窗口保留，弹窗支持重试。

安装器继续使用现有 Tauri 安装目录（包括自选 D/F 盘目录）；如果安装器取消或被系统拦截，可重新打开原应用。安装启动不等于安装已完成。当前不会后台自动检查或静默安装。

## WebView2

fromd 用系统的 Microsoft Edge WebView2 Runtime 显示界面。

- Windows 11 自带；大部分 Windows 10 也已经通过 Edge 更新装好了。
- 如果没有，安装器会自动联网下载并安装。
- 离线或自动安装失败时，到微软的 [WebView2 下载页](https://developer.microsoft.com/microsoft-edge/webview2/) 下载：
  - **Evergreen Bootstrapper**：约 2 MB，运行时联网下载；
  - **Evergreen Standalone Installer (x64)**：完整离线包，可以拷到没网的电脑上安装。

  装好后再运行 fromd 安装包。

确认是否已安装（有 `pv` 值且不是 `0.0.0.0` 即已安装）：

```powershell
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv
```

如果是只为当前用户安装的，把 `HKLM\SOFTWARE\WOW6432Node` 换成 `HKCU\Software` 再查一次。

## 数据保存在哪里

| 内容 | 位置 |
| --- | --- |
| 草稿、页面、图片和附件 | `%APPDATA%\com.frowang.frowd.tauri.v1` |
| 你保存的 `.md` 文件 | 你自己选择的位置 |

想备份草稿，关闭程序后复制上面这个文件夹即可。

从 **正式版 Tauri 0.5.2 / 0.5.3 / 0.5.4（fromd 或旧名 frowd）** 升级到 **fromd 0.5.5**，数据目录不变：数据库仍为 `drafts.sqlite`，图片和附件仍在 `resources/objects`，阅读设置也沿用。文稿、未命名草稿、收起页面与附件无需导出或搬库。

`0.5.4-preview.1` 的资料目录独立，不会自动迁入正式版。需要保留的预览文稿请先另存为 `.md`，再在正式版打开。

以下更早版本的数据还在原处，不会被读取或删除：

| 旧版本 | 旧数据目录 |
| --- | --- |
| frowd 0.5.0 及更早（Electron，历史名称） | `%APPDATA%\frowang-markdown` |
| frowd lite 0.4.0-alpha.1（历史名称） | `%APPDATA%\com.frowang.markdown.lite` |

## 卸载

在 **设置 → 应用 → 已安装的应用** 里找到 fromd 卸载。发布者显示为 Fro，这不是数字签名。

卸载界面有一个删除应用数据的勾选项，默认不勾：

- **不勾**：保留草稿，重新安装后还能看到；
- **勾选**：同时删除上面的数据目录，未保存成 `.md` 的草稿、粘贴的图片会一起删除，无法恢复。

你自己保存的 `.md` 文件、另存出去的图片和附件不会被删除。
