# macOS 安装说明

## 下载

到 [Releases](https://github.com/frowang-ai/fromd/releases/latest) 下载对应芯片的安装包：

| Mac | 下载 |
| --- | --- |
| Apple Silicon（M1–M4） | `fromd_<版本>_aarch64.dmg` |
| Intel | `fromd_<版本>_x64.dmg` |

不确定是哪种：点左上角苹果菜单 → **关于本机**，「芯片」写 Apple M 开头的是 Apple Silicon，「处理器」写 Intel 的是 Intel。

同一页还有 `fromd-<版本>-aarch64.app.zip` 和 `fromd-<版本>-x86_64.app.zip`，内容和 DMG 一样，只是换成了压缩包，二选一即可。

最低系统版本 macOS 11.0。

## 校验文件

在下载目录打开「终端」：

```sh
shasum -a 256 fromd_0.5.2_aarch64.dmg
```

输出应该和 `SHA256SUMS.txt` 里对应的一行一致。不一致就不要打开，重新下载。

## 安装

打开 DMG，把 `fromd.app` 拖进「应用程序」。

用 APP.zip 的话，双击解压，再把 `fromd.app` 拖进「应用程序」。

## 第一次打开

安装包**没有签名，也没有经过苹果公证**，第一次打开时 macOS 可能提示无法验证开发者。

1. 先在「应用程序」里双击 fromd，看到提示后点「完成」或「取消」。
2. 打开 **系统设置 → 隐私与安全性**，往下找到关于 fromd 的提示，点 **仍要打开**。
3. 按提示再确认一次。之后就能正常打开了。

如果系统设置里找不到「仍要打开」，确认下载来源和校验值无误后，可以在终端里只对 fromd 去掉隔离标记：

```sh
xattr -cr /Applications/fromd.app
```

不需要关闭整个 Gatekeeper。

## 检查更新

在原生菜单「fromd → 检查更新…」检查最新正式版。左下角提示新版本后，点击「前往下载更新」打开本仓库的 Release 下载页，选择对应芯片的 DMG。

正常退出应用，让最后正文、名称和阅读位置保存完成，再把新 `fromd.app` 拖进「应用程序」替换旧版。旧应用仍名为 `frowd.app` 时，先退出它，再放入 `fromd.app`；确认新版本里的资料完整后可以移除旧 app，保留下面的数据目录。应用不会自行静默替换，也不会主动退出。两个 app 使用同一资料库，不能同时打开同一资料目录。

## 数据保存在哪里

| 内容 | 位置 |
| --- | --- |
| 草稿、页面、图片和附件 | `~/Library/Application Support/com.frowang.frowd.tauri.v1` |
| 你保存的 `.md` 文件 | 你自己选择的位置 |

从 frowd Tauri 0.5.2 改名升级到 fromd，仍沿用此目录中的 `drafts.sqlite`、`resources/objects` 和阅读设置；替换应用不会重建文稿数据库。

想备份草稿，退出程序后复制这个文件夹即可。在访达里按 `⇧⌘G`，粘贴上面的路径就能打开。

## 快捷键

macOS 上用 `⌘` 代替 Windows 的 `Ctrl`，例外：

- 查找替换是 `⌥⌘F`（`⌘H` 留给系统的隐藏窗口）
- 切换页面是 `⌃Tab` / `⌃⇧Tab`
- 打开链接是 `⌘` + 点击，普通点击是编辑

## 卸载

退出 fromd，把「应用程序」里的 `fromd.app` 移到废纸篓。

这样不会删除草稿。想连草稿一起删，再删除上面的数据文件夹，未保存成 `.md` 的内容会一起删除，无法恢复。
