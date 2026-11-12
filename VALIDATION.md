# Windows 桌面验证记录

## frowd 0.4.5 页面管理：最终本地成品验证

基于 `d6106e1`，在公司 Windows Fro-at-evomap 的独立 `feat/page-navigation` worktree 实现，运行代码固定为 `84f3efdbae297ea00781d88cdb01c8245c9f52c6`；后续仅README/VALIDATION文档收尾，不改变运行代码、依赖或受测out。版本为0.4.5，锁定依赖不变；新增标签右键目标操作、原子批量收起/展开及 Ctrl+Tab / Ctrl+Shift+Tab。规则见 `docs/page-shelf.md`。

| 检查 | 实际结果 | 本轮证据 |
| --- | --- | --- |
| 单元 | **74/74**，0失败/跳过；新增4项批量布局存储回归 | `output/page-navigation/unit-final.log` |
| 最终构建 | **通过** | `output/page-navigation/build-final.log` |
| 完整开发桌面 | **74/74**，含原63项及11项页面管理回归 | `output/page-navigation/desktop-final.log` |
| 菜单和展开入口外观 | **截图已查看**，菜单按目标显示并在窗口内，展开按钮位于列表标题旁 | `output/page-navigation/screenshots/tab-context-menu.png`、`expand-all-entry.png` |
| 独立静态审核 | **PASS**，d6106e1..84f3efd；无blocker/high/medium/low具体发现 | 父线程回传独立Codex审核，gpt-6.1-sol/xhigh/auto-review；审核者未执行测试/运行应用，父线程另核对实际diff/受测树/截图 |
| NSIS x64 | **通过**，`--publish never`，未执行安装器 | `output/page-navigation/nsis-final.log` |
| 完整成品桌面 | **74/74**，PACKAGED_EXE指向本轮win-unpacked；只在公司运行 | `output/page-navigation/packaged-desktop-final.log` |
| 成品身份/构建一致性/退出 | **0.4.5/frowd**，182个包内out文件逐字节相同；打包前后out哈希未变；隔离profile正常窗口关闭退出0 | `packaged-inspection.json`、`out-before-package.json`、`pe-and-review-inspection.json`（位于本轮output/page-navigation） |

安装器为 `release/0.4.5/frowd-Setup-0.4.5-x64.exe`，**130438174字节**，SHA256 `61B1B15D843B9D04D95E5ED88339F5595E1400B018BCB411B38917D4D022C41E`；安装器PE ProductName=frowd、ProductVersion=0.4.5。实际运行的是同次构建的 `release/0.4.5/win-unpacked/Frowang Markdown.exe`，不是执行安装器。当前包仍未签名、无生产更新源，默认停用在线更新；未公开发布。

新增回归包含：非当前草稿保存/文件另存、重命名与取消移除/撤销、非当前脏文件取消不写原件、立即编辑与undo、搜索下全部展开不读取其他正文且零截图捕获、当前页/顺序/重启、批量真实SQLite拒写后的整体回滚与重试、空桌面/单页/循环与跳过、源码选区/滚动/undo、表格普通Tab、公式未完成编辑、组合事件等待和忙碌重复键不回放、溢出标签可见及尚未送达的外部选择确认。完整组继续覆盖旧打开事件/阅读恢复竞态、真实IME菜单命令、单页450ms动画与恢复零捕获等既有约定。

首轮新增组9/10，发现重复聚焦会关闭恢复后的公式编辑；修复宿主的失焦前视图记忆和单次聚焦后通过，编辑内核没有改动。新增Ctrl+Tab组合输入检查使用受控composition事件和IPC门控；不能扩大为所有设备和输入法的真机保证。没有重跑56项浏览器编辑内核全套，没有执行实际安装/升级、公开发布或更新源配置。所有测试为隔离 `FROWANG_USER_DATA` 和合成样本。

## frowd 0.4.4 区分编辑与Ctrl打开

运行改动提交`b364b21`。用户确认采用普通点击编辑、Ctrl＋左键打开；当前正文/源码均可编辑，本轮没有新增只读模式。浮层地址单击进入编辑，并提供明确的“打开网页”/“打开位置”按钮。原文件定位、文件夹进入及相对路径规则保持，见`docs/document-links.md`。

| 检查 | 实际结果 | 本机证据 |
| --- | --- | --- |
| 新手势在旧构建复现 | 0.4.3普通点击错误触发浏览器；新断言先失败 | 本轮Playwright输出 |
| 单元 | **70/70**，无跳过 | `output/ctrl-links-unit.log` |
| 构建与完整开发桌面 | **通过，63/63** | `output/ctrl-links-build.log`、`ctrl-links-desktop.log` |
| 共享编辑器原行为 | **56/56** | `output/ctrl-links-editor.log` |
| NSIS构建与成品相关回归 | **通过，29/29** | `output/ctrl-links-installer.log`、`ctrl-links-packaged.log` |
| 原生Ctrl点击与浮层外观 | **通过**：资源管理器选中临时文件、进入目录；测试新窗口清理，截图已查看 | `output/playwright/ctrl-native-links/result.json`、`link-actions.png` |
| 成品版本/资源/正常退出 | **0.4.4/frowd**，关键代码与受测out、图标与源图一致 | `output/joint-0.4.4/inspection.json` |
| 独立增量审核 | **PASS**，无blocker/high/medium/low | 原Paseo reviewer，范围`be8bcca..b364b21` |

8项链接场景覆盖普通点击后输入/undo、Ctrl单次打开、浮层地址编辑和两个显式按钮、本地地址确认、切换/另存归属、Shift与Ctrl拖动不打开。测试曾发现编辑撤销后的表格选择处理会消耗click；Ctrl pointerdown仅阻止兼容mousedown，不执行打开，click统一执行一次。普通点击仍保留编辑事件传播。

安装器`release/0.4.4/frowd-Setup-0.4.4-x64.exe`为 **130,453,441字节**。main/preload/存储及依赖未改，继续包含0.4.3的本地链接编辑修复。整体测试包含此前收起、恢复、删除前保存行为。未运行用户安装器，未重复真实NSIS升级链或启动默认浏览器；只读调查Typora以本机资源与官方说明为依据，未把隔离启动失败当作实机交互通过。

## frowd 0.4.3 网页打开与本地文件定位

功能提交`4bb27f7`，审核回修`c444d5c`，基于0.4.2的`1408971`。普通点击正文/表格链接或浮层地址：HTTP(S)交默认浏览器，普通本机文件只在资源管理器中显示并尽可能选中，目录才进入。相对链接取所属Markdown的最新位置；草稿缺位置、目标缺失或打开失败明确提示。规则与测试入口见`docs/document-links.md`。

| 检查 | 最终实际结果 | 本机证据 |
| --- | --- | --- |
| 旧行为复现 | 新直接点击用例在0.4.2失败：未调用浏览器接口 | `output/links-before/` |
| `npm test` | **70/70**，无跳过 | `output/links-unit.log` |
| 构建与完整开发桌面 | **通过，63/63** | `output/links-build.log`、`links-desktop.log` |
| 共享编辑器原行为回归 | **56/56** | `output/links-editor.log` |
| NSIS安装器构建 | **通过** | `output/links-installer.log` |
| 成品links+motion+shelf+remove-save | **29/29** | `output/links-packaged.log` |
| Windows原生资源管理器 | **通过**：实际显示并选中临时docx、进入独立目录；只关闭此次新建窗口 | `output/playwright/native-links/result.json` |
| 成品版本/资源/退出 | **0.4.3/frowd**，图标与源图一致、关键代码与最终受测out一致、正常退出 | `output/joint-0.4.3/inspection.json` |
| 独立审核及复审 | 初审1个medium，采纳修复；复审 **PASS**，无新问题 | Paseo reviewer `12ab1059-49cb-4d96-b2cf-2105676fea25`，初审`1408971..4bb27f7`，复审`4bb27f7..c444d5c` |

初始接线验证发现Crepe重建内部容器使监听失效，已改为稳定Vue宿主；已有选区不能代替拖选手势判断，已改为实际位移/Shift判断。保留切换笔记、另存为、浮层复制编辑、拖选和旧浮层归属回归。

审核指出Crepe确认编辑会清空file URL和盘符地址。新增实际用例先复现失败，再处理本地地址提交；同时覆盖Enter与依赖确认图标实际使用的pointerdown。原样确认不发正文事务；修改保留模型地址，DOM href消毒不放宽。最终8项链接桌面用例及对应成品用例全部通过。

安装器`release/0.4.3/frowd-Setup-0.4.3-x64.exe`为 **130,435,216字节**。PR #11以PR #10分支为base，后者合入后再改main；生成安装器不等于合并或安装。桌面自动回归替代最终OS调用以免启动用户默认应用，原生Explorer另用临时样本实际验证；未实际启动默认浏览器、未重复真实NSIS升级链、未覆盖用户安装或读取真实笔记。更新源、签名、依赖及应用安装身份保持原状。

## frowd 0.4.2 恢复页面直接显示

提交 `6187208` 按用户反馈保留450ms收起吸入、取消展开动效。恢复路径移除截图/解码/画布创建及等待，正文读取、会话状态、选区、阅读位置与有效身份检查仍保留。版本同时包含下方0.4.1删除前保存选择。

| 检查 | 实际结果 | 本机证据 |
| --- | --- | --- |
| 旧行为复现 | 新用例先失败：恢复调用1次capture，期望0 | `output/direct-open-before/`；普通展开时正文提前可见的诊断在`output/expand-timing/` |
| `npm test` | **65/65**，无跳过 | `output/direct-open-unit.log` |
| 构建与完整开发桌面 | **通过，55/55** | `output/direct-open-build.log`、`direct-open-desktop.log` |
| NSIS安装器构建 | **通过** | `output/direct-open-installer.log` |
| 成品motion+shelf+remove-save回归 | **21/21** | `output/direct-open-packaged.log` |
| 成品核对 | 实际0.4.2/frowd、图标与源图一致、关键代码与受测out一致、正常退出 | `output/joint-0.4.2/inspection.json` |
| 独立增量审核 | **PASS**，无 blocker/high/medium/low | 原Paseo reviewer `12ab1059-49cb-4d96-b2cf-2105676fea25`，范围`4402c2e..6187208` |

新增真实Electron用例在完成收起后开始计数，确认恢复过程零截图请求、零动效Canvas，同时检查编辑后的正文、存储内容和180px滚动位置。原收起画布/450ms/异常清理/第二实例回归继续通过。只移除展开相关调用与反向模式，没有新缓存或额外渲染器。

候选安装器 `release/0.4.2/frowd-Setup-0.4.2-x64.exe` 为 **130,429,852字节**。安装身份、schema、更新配置及依赖未变；本轮未重复0.4.0真实NSIS升级链或独立编辑内核套件，未覆盖用户安装或读写真实笔记。保留独立HTML历史双向示例并在其说明中明确其展开动画不代表当前产品。

## frowd 0.4.1 删除前保存选择

基于已合入的0.4.0（`2ef08d8`），功能提交 `8b332aa`。有非空白正文的草稿点卡片×时询问“保存为 Markdown / 直接删除 / 取消”，保存进入系统文件选择窗口，成功后才移除。空白草稿、收起、退出和已有磁盘文件的原有语义保留。保存成功但SQLite移除失败时回显新的文件关联及明确错误；具体行为见 [页面收起说明](docs/page-shelf.md)。

| 检查 | 实际结果 | 本机证据 |
| --- | --- | --- |
| 旧行为复现 | 新取消用例先失败：未弹出确认框 | `output/remove-save-before/` |
| `npm test` | **65/65**，无跳过 | `output/remove-save-unit.log` |
| 构建与新增桌面场景 | **通过，7/7** | `output/remove-save-build.log`、`remove-save-focused.log` |
| 完整开发桌面 | **54/54** | `output/remove-save-desktop.log` |
| NSIS安装器构建 | **通过** | `output/remove-save-installer.log` |
| 成品删除保存＋页面列表回归 | **12/12** | `output/remove-save-packaged.log` |
| 独立只读审核 | **PASS**，无 blocker/high/medium/low | Paseo reviewer `12ab1059-49cb-4d96-b2cf-2105676fea25`，审核`2ef08d8..8b332aa` |
| 成品身份与内容核对 | 实际0.4.1、标题frowd、图标与源图一致；关键打包代码与受测out一致，正常退出 | `output/joint-0.4.1/inspection.json` |

`tests/remove-save.desktop.spec.mjs`覆盖取消确认、选择目录/文件名并保存、取消文件选择、直接删除及撤销、真实磁盘写入失败后重试、空白跳过与收起/退出无询问、保存非当前已收起的正确页面、实际SQLite DELETE拒绝后保留页面与文件关联。旧删除回归仅对新的草稿问题显式选择丢弃，原文件确认与数据断言继续保留。

候选安装器 `release/0.4.1/frowd-Setup-0.4.1-x64.exe` 为 **130,430,359字节**。安装身份、图标、编辑内核、存储schema和更新配置未改，依赖未升级。本轮未重复0.4.0真实NSIS升级链或独立编辑内核套件，没有覆盖用户安装或读写真实笔记；正式更新源和签名仍未配置。源码PR/审核状态以本轮PR为准。

## frowd 0.4.0 联合交付

本轮按用户授权将名称/图标 PR #9 与页面收起/动效 PR #8 整合。PR #9先合入 `0fb28c5`；任务分支普通merge为 `ba6b220`，唯一冲突为本文件的历史记录，双方均保留。联合版本候选 `88f9915` 升为0.4.0，依赖版本未变，`package.name=frowang-markdown`、`appId=com.frowang.markdown`、内部 `Frowang Markdown.exe` 保持兼容，显示名与图标为frowd；收起450ms/展开400ms。

| 检查 | 实际结果 | 证据（任务工作区） |
| --- | --- | --- |
| `npm test` | **65/65**，无跳过 | `output/joint-0.4.0/unit.log` |
| 联合构建 | **通过** | `output/joint-0.4.0/build.log` |
| 完整开发桌面 | **47/47** | `output/joint-0.4.0/desktop.log` |
| 正式身份NSIS安装器构建 | **通过** | `output/joint-0.4.0/installer.log` |
| 最终打包程序完整桌面 | **47/47** | `output/joint-0.4.0/packaged-desktop.log` |
| 两个隔离NSIS测试包与真实升级链 | **1/1**；安装后自动重开和草稿恢复通过 | `output/joint-0.4.0/nsis-update.log`，`output/update-fixtures/case-4UoJOE/result.json` |
| 成品身份/图标/运行检查 | 版本0.4.0，标题`未命名笔记 — frowd`；原内部名；PNG512×512与源图一致；正常退出 | `output/joint-0.4.0/inspection.json` |
| Windows产品资源 | exe和安装器ProductName=frowd，版本0.4.0，提取图标已视觉确认 | `output/joint-0.4.0/windows-resources.json`及同目录`application-icon.png`、`installer-icon.png` |
| 独立整合审核 | **PASS**，无 blocker/high/medium/low | 原Paseo reviewer `0c5887bc-2e67-4d8e-b82a-7900b31a207f` 对`2f1c3a5..88f9915`只读复核 |

统一安装器：`release/0.4.0/frowd-Setup-0.4.0-x64.exe`，**130,434,143字节**。应用包内main、storage worker、preload、renderer HTML及其入口JS/CSS与受测out逐字节一致。安装器按当前用户安装，保留原应用身份与草稿目录；没有在真实用户安装上执行覆盖安装，也没有读写真实笔记。安装/升级的实际测试使用独立身份及合成profile，不冒称对用户现有机器安装的直接验收。

隔离升级仍采用既有测试版本0.2.900→0.2.901，不是产品版本；测试包专有配置不进入交付包。实际验证了菜单IME取消重启、拒写保护、异步安装失败保留窗口、同窗口重试、自动重开与同入口恢复。正式包不含生产HTTPS更新源、未签名、未公开发布；不会自动发现此本地安装器。编辑内核没有改动，本轮未重复56项独立内核浏览器回归。

一次验证runner在Windows PowerShell5中把原生SQLite warning视作异常，桌面用例尚未执行即中止；unit/build已成功，之后用PowerShell7从desktop继续，未隐藏产品测试失败。检查脚本另外修正了Windows ASAR路径分隔符与构建元数据被打包器裁剪的假设，再按真实窗口标题/版本、PE产品资源、包内icon与代码一致性验收；不涉及产品修复。

下方保留各分支实现阶段的验证与失败记录，其中“尚未合入／没有统一安装器”为当时状态，不覆盖本节联合交付结果。

## 收尖吸入动效接入（当前任务分支）

用户最终确认收起450ms、展开400ms，并授权接入真实编辑器。功能提交 `3dfd80a`，回修 `cd79229`；使用原生自身窗口捕获→临时曲面Canvas，不重建编辑器DOM；一体标签、右上角移除和精简文案沿用用户确认效果。原0.3.0安装器未替换、未合入main，新增可运行解包预览在本工作区 `release/page-shelf-preview/win-unpacked/Frowang Markdown.exe`。

| 检查 | 实际结果 | 本机证据 |
| --- | --- | --- |
| `npm test` | **65/65**，无跳过；本轮后续修改仅renderer与测试，存储/main保持该受测实现 | `output/genie-unit.log` |
| 最终 `npm run build` | **通过** | `output/genie-final-build.log` |
| 最终完整 `npm run test:desktop` | **47/47** | `output/genie-final-desktop.log` |
| 独立解包构建 | **通过**，electron-builder `--dir --publish never`，输出专属目录 | `output/genie-package.log` |
| 解包应用的motion+shelf组 | **13/13**，通过 `PACKAGED_EXE` 启动真实包 | `output/genie-packaged-desktop.log` |
| 独立审核与复核 | 首轮FAIL/medium，已采纳回修；`cd79229`定向复核 **PASS**，无新发现 | 原Paseo reviewer `0c5887bc-2e67-4d8e-b82a-7900b31a207f` |

- `tests/motion.desktop.spec.mjs` 共8项：真实PNG捕获和Canvas有可见绘制内容；收起/展开实际时长；已加载公式/本地图片与编辑内容、滚动位置保留；减少动态效果不捕获；捕获拒绝/挂起、绘制异常后的画布与锁清理；真实second-instance listener开新文件/重开当前文件；resize和迟到通知。
- 动画只移动header下方到固定更新状态上方的页面区域，收起前关闭列表，不把侧边卡片卷入纸页。窗口缩放、实际滚动、可见性/减少动态变化和文档失效会取消动画；捕获失败不影响文档操作。只传应用自身画面，PNG不落盘，像素与编码大小均有界，捕获不阻塞文档队列。
- 审核medium：动画前取得snapshot，动画期间真实第二实例打开，旧回执覆盖较新的UI。两条main真实listener＋SQLite开文件回归先在旧构建均失败，再改为动画/取消后重新读取metadata。回修motion+desktop组16/16、最终全量与打包组均通过。不能用仅重发旧通知的原测试代替这两条真正修改存储的场景。
- 自测还发现恢复阅读位置时排队的scroll事件会取消展开。回修为比较实际scrollTop/Left，当前位置相同不取消；原位置180px、编辑正文和完整双向画布均在最终用例保留断言。
- 首轮motion+shelf10/11的失败来自 `img` 同时匹配真实图片与ProseMirror separator，改为按“本地图片”精确定位。首轮完整桌面43/45另有测试helper未等源码切回正文就调用保存，已补源码隐藏和editorReady等待；保留真实菜单调用与文件断言。旧失败日志在 `output/genie-focused.log` / `genie-desktop-final.log`，不混入最终通过结果。
- 本机示例预览使用 `output/shelf-preview-profile/`，启动脚本优先用解包exe；原示例内容保留，正式用户profile未读写。截图在 `output/playwright/genie-real-*`；中间帧用仅限观察脚本的rAF暂停捕获，不能用暂停截图证明帧率，正式时间断言来自正常运行的桌面测试。

未修改编辑内核源码，本轮不重复56项独立内核浏览器回归或NSIS安装升级；没有生成或发布新的正式安装器。当前交付为源码PR及独立可运行预览包。详细使用与数据边界见 [页面收起说明](docs/page-shelf.md)。

## 页面收起与右上角移除（当前任务分支）

基于 `529bae0`，复用 PR #8 / `prototype/page-shelf`。接入提交 `7fbe088` 将原型中的“收起／恢复／删除”接入真实 Electron、固定 preload IPC 和 SQLite，随后回修键盘删除后的焦点。界面沿用现有背景、字体和标签；页面列表卡片右上角为直接删除/移除按钮。未替换已交付的0.3.0安装器，未合入 main。

| 检查 | 实际结果 | 本机证据 |
| --- | --- | --- |
| 完整 `npm test` | **65/65**，无跳过 | `output/shelf-unit-final.log` |
| `npm run build` | **通过** | `output/shelf-build-final.log` |
| 完整 `npm run test:desktop` | **38/38** | `output/shelf-desktop-final.log` |
| 焦点回修后重新构建 | **通过** | `output/shelf-focus-build.log` |
| 焦点回修后 `tests/shelf.desktop.spec.mjs` | **5/5**，含新增键盘场景 | `output/shelf-focus-desktop.log` |
| 独立审核 | **PASS**；无 blocker/high/medium，唯一 low 已采纳回修 | 原 Paseo reviewer `0c5887bc-2e67-4d8e-b82a-7900b31a207f` |

完整38项结果对应 `7fbe088`。最后仅增加删除完成后的焦点恢复和相应测试，再跑受影响的5项桌面场景，不宣称完整39项套件已重新运行。编辑内核源码未改，本轮未重跑独立56项浏览器内核测试或 NSIS 真实升级；本次交付为源码分支和隔离的真实编辑器预览，不是新安装器发布。

- `tests/shelf-storage.test.mjs` 共8项：schema 2→3、全部收起重启恢复、有限预览、文件复用与原件保护、删除/撤销、旧 ID 迟到写入、失败回滚与撤销重试。文件已经重新打开后再撤销，先复现原阻断，再验证旧内容作为独立草稿恢复，不覆盖重新打开的页面。
- `tests/shelf.desktop.spec.mjs` 共5项：真实源码编辑、选区/滚动、全部收起重启和空桌面菜单；缩略预览不调用整篇read；右上角按钮位置与删除/撤销；绑定文件收起不弹确认、移除保留取消/放弃；数据库拒写后保留页面；键盘删除最后一页后 Escape 可关闭列表并返回入口焦点。
- 既有删除测试改用实际页面列表和卡片按钮，不用直接 API 替代 UI。移除前等待正文写入的竞态使用受控真实 IPC 回执，继续保留正文及磁盘原件断言。完整桌面覆盖既有文件/PDF、菜单、IME屏障、迟到读取、第二实例和源码/公式状态。
- 审核 low 先用真实 Enter 删除最后一页复现：卡片消失后焦点落到 BODY，Escape 无效。回修在成功移除且列表仍打开时等待 DOM 更新后聚焦搜索框；失败/取消不强抢焦点。失败 trace 保留在 `output/shelf-focus-before/`，新增行为用例已加入桌面入口。
- 实际 Electron 窗口用 `output/shelf-preview-profile/` 合成样本；截图 `output/playwright/integrated-editor.png` 与 `integrated-page-shelf.png` 已视觉检查。原生浏览器连接曾漂到空白托管页，随后用项目 Playwright 直接连接该预览的 CDP，并核对 `app://editor/index.html` 后截图；未把空白截图作为验收结果。
- 新工作区依赖安装成功，官方 Electron 下载超时；复用来源仓库的同版本归档，经既有安装脚本 checksum 校验后提取为45.2.3。没有修改依赖版本、生产应用或真实笔记。

本轮数据/撤销边界见 [页面收起说明](docs/page-shelf.md)。下文保留0.3和更早版本的历史验证，不作为当前分支重跑证据。


## 0.3.1 frowd 名称与图标（2026-11-11）

从 `529bae0` 独立开发，仅替换用户可见名称与品牌图标。`package.name=frowang-markdown`、`appId=com.frowang.markdown`、`executableName=Frowang Markdown` 保持原值，窗口与快捷方式显示名为 `frowd`；主窗口图标和 Windows PE 图标均来自现有 Frowang PNG。默认无源构建开启资源编辑、保持代码签名关闭，配置生产更新源时显式开启签名并继续强制验证。

| 检查 | 实际结果 |
| --- | --- |
| `npm test` | **57/57**，无失败或跳过 |
| `npm run dist:installer` | **通过**，包含 renderer/main 构建、PNG→Windows 图标转换及 NSIS 打包 |
| `PACKAGED_EXE=<0.3.1/win-unpacked/Frowang Markdown.exe> npx playwright test -c playwright.config.mjs tests/drafts.desktop.spec.mjs` | **14/14**，实际打包程序的草稿命名、标题、切换、保存、退出恢复及既有竞态用例通过 |
| 隔离 profile 成品启动与普通退出 | app.getVersion()=`0.3.1`、app.getName()=`frowang-markdown`、窗口标题=`未命名笔记 — frowd`；userData 使用指定的独立目录，正常退出 |
| 图标与 Windows 资源 | 包内 PNG 与源图逐字节一致、512×512；exe 的 ProductName/FileDescription 为 `frowd`，安装器 ProductName 为 `frowd`；从 exe/安装器提取的图标与原网站标识视觉一致，原生窗口标题栏也已观察 |
| 更新默认状态 | `frowangUpdates=null`，实际 UI/API 为 disabled，原因仍是未配置更新源 |

产物：`release/0.3.1/frowd-Setup-0.3.1-x64.exe`，**130,426,256 字节**。过程证据保存在任务工作区 `output/branding-inspection.json`、`branding-windows-resources.json`、`branding-application-icon.png`、`branding-installer-icon.png` 与打包版 Playwright report；合并日志为 `output/branding-build-and-tests.log`。一次性检查脚本首次在应用已正常退出后再次调用 Playwright process()，导致检查脚本清理报错；改为预先保存进程引用后重新执行，exit 0，不涉及产品修复。

本轮没有在真实用户安装目录上执行覆盖升级，没有重跑完整34项桌面、56项编辑内核或真实NSIS自动更新链。安装路径、注册身份、内部exe与草稿身份不变，快捷方式改名沿用锁定NSIS版本已有的 ShortcutName 迁移；未启用生产更新、未签名、未公开发布。以下0.3.0及更早记录保留为历史证据，不混计为本轮结果。

## Windows 0.3.0 联合验证记录

## 0.3.0 菜单与更新整合

合入基线 `c026d77`（菜单 PR #5），更新候选 `66258ed`；在原 `feat/windows-auto-update` 分支普通 merge，未覆盖另一工作区。应用根版本及默认输出改为 0.3.0，编辑内核版本未改；旧 0.2 产物和历史验证保留。

冲突按双方行为合并：renderer-ready 同时刷新菜单和启动更新检查；原生菜单状态 IPC、受限更新 API、异步安装确认及 SQLite 退出门槛并存；App 保留 `operationPending`／composition 提交帧／目标上下文检查，更新提示使用 `!commandReady` 防止菜单待执行时再抢操作。三个已有测试同步修正（目标标签等待、两组关闭答案队列）保留，不恢复旧 DOM toolbar。

联合 NSIS 用例使用新「+」与真实 MenuItem 回调准备样本、切换源码和打开文件。下载完成后发起实际 Chromium IME 预编辑并调用原生另存菜单，等待期间到达的固定更新 API 请求须取消重启、保持输入可用和焦点；提交后原篇含最终“中”，仍可继续执行 SQLite 拒写／异步安装拒绝／同窗口重试／实际安装和自动重开。自动重开只通过 CDP 观察 UI 和只读固定 API，不由手动启动代替。

构建顺序：固定源码 → `npm test` → `npm run build` → 开发完整桌面 → 两个隔离 NSIS 测试包及真实升级 → 正式无源 0.3.0 NSIS → 正式包完整桌面。同一 `out` 不并发构建／测试。联合日志在 `output/joint-0.3.0/`，测试包在 `release/joint-0.3.0/update-test-0.2.900` 和 `update-test-0.2.901`；`FROWANG_UPDATE_TEST_ARTIFACTS` 指向该共同父目录。生产安装器为 `release/0.3.0/Frowang-Markdown-Setup-0.3.0-x64.exe`，不额外生成 portable 0.3。

本轮一次顺序联合运行结果：

| 检查 | 实际结果与证据 |
| --- | --- |
| `npm test` | **57/57**，`output/joint-0.3.0/unit.log` |
| `npm run build` | **通过**，`output/joint-0.3.0/build.log` |
| 完整开发桌面 | **34/34**，`output/joint-0.3.0/dev-desktop.log` |
| 真实 NSIS 联合升级 | **1/1**，`output/joint-0.3.0/nsis.log`；`output/update-fixtures/case-rRs9jC/result.json` 中 `menuCompositionRestartCancelled`、`asyncLaunchFailureKeptWindow`、`automaticRelaunchRecovered` 均为 true |
| 0.3.0 无源生产包完整桌面 | **34/34**，`output/joint-0.3.0/packaged-desktop.log` |
| 生产包实际启动／入口检查 | app.getVersion()=**0.3.0**；新加号、无旧 toolbar、原生文件／编辑／视图菜单、源码菜单可用，updates.status=disabled；正常退出0。见 `output/joint-0.3.0/production-inspection.json` |

最终 NSIS 为 `release/0.3.0/Frowang-Markdown-Setup-0.3.0-x64.exe`，**130,386,357 字节**。完整解包目录 `release/0.3.0/win-unpacked/` 共 **431,166,203 字节、77 文件**，主入口 `Frowang Markdown.exe` 为 **249,832,448 字节**（须保留同目录资源）。包内 main、storageWorker、preload、renderer HTML 和 `index-BCVpJzmR.js` 主 bundle 均与本轮受测 `out` 直接逐字节一致；无测试 bootstrap，更新元数据为 null。目录计数仅针对本次产物，见 `artifact-sizes.json`。

六篇同类 3278B 样本单次观察：首次安装 10,187.8ms，空 profile 首次启动ready 2,039.1ms，六篇普通安装入口启动ready 757.9ms，升级后重开ready 741.7ms。未清 OS 缓存、包含自动化观察，安装时间与日常启动分开，不承诺所有设备／输入法表现。组合输入覆盖 Chromium CDP 预编辑与真实菜单链，没有把它扩称所有 Windows 输入法已验收；本轮编辑内核未变，未重复独立56项内核套件。

下列菜单、0.2 与独立更新分支记录继续作为历史证据，未覆盖旧产物或旧失败。生产 HTTPS 源和签名凭据仍未提供，最终安装包默认停用更新、未签名、未公开发布。

## 原生菜单与标签入口（2026-11-11）

本次基于 `9be2f8abcab11e74aaa2aaf5bb17a12e4c7d546b`，只调整桌面菜单、标签入口和相关回归，不改变编辑内核、SQLite、依赖或版本。所有样本使用独立 `FROWANG_USER_DATA`。首个候选 `e3a5e88` 在独立审核中发现真实预编辑丢字；下表为采纳该 high 并修复后的重新验证结果，旧候选的31/31不能排除此问题。

| 检查 | 本次结果与证据 |
| --- | --- |
| `npm test` | **22/22**，`output/menu-ime-core-desktop.log` |
| `npm run build` | **通过**，`output/menu-ime-focused.log`；输出供以下开发及打包测试使用 |
| `npx playwright test -c playwright.config.mjs tests/menu.desktop.spec.mjs` | **6/6**，`output/menu-ime-focused.log` |
| `npm run test:desktop` | **34/34**（原28项 + 菜单6项），`output/menu-ime-core-desktop.log` |
| 打包后的同一菜单用例 | **6/6**，`output/menu-ime-packaged-validation.log` |
| `node scripts/smoke-portable.mjs release/menu-preview/Frowang-Markdown-0.2.0-x64.exe` | **通过、exit 0**，真实编辑ready、SQLite创建及原10秒退出期限；同上日志 |

- `tests/menu.desktop.spec.mjs`：加号是普通按钮、一次新建并激活；少量标签紧随末尾，520px窄窗与11标签溢出时仍可点；原生菜单结构与源码勾选；Ctrl+N/O/S/Shift+S调用次数；取消／错误恢复；未ready／忙碌／迟到跨标签命令。新增三项以CDP `Input.imeSetComposition`建立真实浏览器预编辑状态，在同一主进程tick两次调用真正MenuItem后，检查源码仍enabled/focused、预编辑字符和composition未被打断；再用 `Input.insertText`提交，确认新建／源码切换／另存只执行一次，原篇不丢字，取消和失败后命令锁释放。
- 菜单命令通过真正注册的 `MenuItem.click → main → preload → renderer` 进入原有flush业务流程。菜单上下文序号不使用正文revision；用例在菜单保存消息延迟期间继续真实输入、等待自动备份，再放行后验证磁盘为最新正文。原有保存目标竞态、真实fill后不足200ms点击关闭及文件内容断言保留并通过。
- `tests/native-menu.mjs` 只提供实际菜单回调和就绪观察；原生菜单不是DOM按钮。`main[aria-busy=false]`反映当前文档恢复完成且没有正在执行的操作，portable改用此条件取代已移除的nav按钮。
- 打包证据目录 `output/packaged-results/menu.desktop-原生菜单：标签末尾加号、窄窗溢出、真实菜单结构和源码状态/` 含 `native-menu.json`、`menu-tabs-wide.png`、`menu-tabs-narrow.png`。页面截图已视觉检查；没有用DOM截图冒称OS菜单截图。OS原生菜单的鼠标展开、所有真实输入法和设备未逐项验证。
- 本地预览产物 `release/menu-preview/Frowang-Markdown-0.2.0-x64.exe`（115,466,281字节），以及同目录 `win-unpacked/Frowang Markdown.exe`，已从修复后的 `out/` 重新构建。命令为 `npx electron-builder --win portable --x64 --publish never --config.directories.output=release/menu-preview`，无并发build；main、preload、renderer入口及主bundle与受测 `out/` 直接字节比较一致。本次仅重跑打包菜单与portable，未声称打包完整34项也已重跑；旧0.2验收件保留。未签名、未发布。
- 首轮新增spec使用带尾分隔符的Windows项目路径，启动时误解析引号；已仅将该入口改为既有 `resolve(fileURLToPath(...))` 规范。单次隔离probe确认PID11824进入ready并退出；失败任务已终止、定点查询无自有残留，没有操作用户Frowang进程或数据。另一次测试读取尚未创建的另存文件抛ENOENT，已仅对该预期瞬态等待。失败日志保留在 `output/menu-initial-launch-failure.log`、`output/menu-file-wait-failure.log`，启动验证见 `output/menu-launch-probe.log`。

审核回修证据：

- `output/review-menu.md` 的唯一high已采纳。旧实现先busy再等待composition，使textarea失焦／禁用；原三项菜单测试的人工composition事件未建立浏览器预编辑状态，因此漏检。新增真实CDP三项先在未修复构建全部失败，见 `output/menu-ime-red.log`：new为disabled，source/saveAs为失焦。
- `operationPending`仅排斥命令和标签操作，不使编辑区inert或disabled。等待后按原文档ID、对象、generation、selectionVersion及ready核对，再进入busy/flush；不以锁本身更新的menuRevision否决已接受命令。取消、异常及目标变化的返回路径均在finally释放锁。
- 第一版只拆pending锁仍在最终提交后漏字，见 `output/menu-ime-first-fix-failure.log`。`output/menu-composition-order.json`记录输入处理未结束时已禁用控件；compositionend释放从微任务改到提交后的渲染帧，并在等待结束后复查composing。最终六项在开发及新包均通过，不使用固定sleep或修改编辑内核。
- 首轮红灯在断言已失败后卡住fixture的 `app.close()`，见 `output/menu-ime-red-cleanup-timeout.log`；菜单fixture现只退出自己启动的隔离应用，避免掩盖原断言。原生命周期、真实fill/click及不足200ms关闭断言没有替换；正常退出继续由完整桌面与portable检查。CDP回归不等同于所有真实Windows输入法或OS菜单鼠标展开验收。

下方为既有0.2交付记录，其56项内核回归和28项打包全量结果为历史证据，不计作本次重跑。

本轮以 `8b750c610ee490b89b88cec2550fd734a8939a58`（A/B 已合入）为基线，在 Windows x64、Node22.19.0、Electron45.2.3、Playwright1.63.0 环境验证。所有样本使用隔离 `FROWANG_USER_DATA` 或临时目录，没有读取真实用户草稿。

## 当前验收状态

本轮源码与实际Windows产物均已完成下列验证。旧的26项桌面记录中有一项曾被误改为API写入/关闭，已废弃；最终测试恢复基线真实fill/click、200ms时限及原文件断言，并在开发/打包完整套件通过。独立审核与合入由主agent在本地提交冻结后负责。

| 入口 | 覆盖 | 当前证据 |
| --- | --- | --- |
| `npm test` | 17项既有文件/恢复/故障 + 5项按需存储 | **22/22**，`output/candidate-storage.log` |
| `npm run test:editor` | 公式、列表、粘贴、源码往返、文本格式等56项 | **56/56**，`output/candidate-editor.log` |
| `npm run test:desktop` | 22项原A/B桌面流程 + 6项按需/快速切换/恢复改选 | **28/28**，`output/release-candidate-desktop.log` |
| Windows打包桌面 | 同一桌面套件，以 `PACKAGED_EXE` 启动 | **28/28**，`output/release-packaged-tests.log` |
| `node scripts/smoke-portable.mjs <exe>` | portable自身解压、SQLite初始化与正常退出 | **通过，exit 0**，`output/release-portable-smoke-verified.log` |

桌面测试使用实际窗口、IPC、SQLite、文件读写及PDF，仅替代系统选择/确认对话框的答案，并在指定竞态用例控制真实IPC回执的时机。合成composition事件验证组合输入屏障，不等于真实Windows中文输入法验收。

## 功能与回归入口

- `tests/documents.test.mjs`：BOM/CRLF、原路径保存、另存、冲突/删除/非法编码、最终10MiB限制、100MiB恢复限制、故障降级、旧JSON一次迁移、删除迟到更新、命名/阅读状态独立持久化、退出保护。
- `tests/lazy-storage.test.mjs`：worker和main初始化不加载正文、读取单篇后main不常驻正文、旧SQLite逐行hash迁移/事务回滚、不重复导入旧JSON、首次read/save核对外部文件、关闭后的迟到read拒绝。
- `tests/desktop.spec.mjs`：SQLite迁移、失败退出/重试、真实文件/PDF、renderer崩溃恢复、第二实例相对路径、编辑与本地图片。
- `tests/drafts.desktop.spec.mjs`：草稿命名/空名/关闭/重启、名称成功和失败回执、超长名称的外部另存出口、文件绑定保护、真正不足200ms的编辑后点击关闭、保存目标捕获、旧打开事件选择保护。
- `tests/lazy.desktop.spec.mjs`：metadata列表、单个活跃富文本DOM、挂起read时切换并关闭、会话内undo/redo、未完成公式/Escape原值、代码块反向选区、源码原文/选区/滚动/native undo、重启源码模式、快速富文本转源码不漏输入、不同目录相同Markdown图片、composition屏障。
- `tests/editor.browser.spec.mjs`：既有56项独立编辑内核回归；编辑包仍不依赖Electron。

## 性能观察

探针使用六篇每篇约5,044字节、20小节、20行内公式、20行间公式和20表格的样本。浏览器探针中，旧v-show累计六视图有34,388页面元素、GC后JS heap约34.1MB；共享一视图加六份会话state有5,742元素、约15.7MB。该证据只证明路线可行，不作为正式桌面性能结果，也不是RSS、性能倍率或长期无泄漏证明。

正式实现使用同样六篇样本在 Electron45.2.3 / Chromium156.0.8078.80 下观察（`output/probe_formal_performance.json`）：

| 状态 | 富文本视图数 | 页面元素 | renderer JS heap（GC后，字节） |
| --- | ---: | ---: | ---: |
| 初次显示一篇 | 1 | 5,778 | 10,527,592 |
| 依次访问六篇 | 1 | 5,798 | 13,405,060 |

本次未访问源码模式，textarea数为0；metadata快照为900字节且不含正文。启动到ready单次观察932.7ms，五次首次切换约395–486ms（含自动化点击、IPC、读取及布局，不能与探针同步updateState耗时直接比较）。旧浏览器探针与当前Electron的运行环境不同，不推导内存或速度倍率。

正文树、history及访问过的源码textarea仍随访问数量和编辑历史增长，不能承诺总内存与笔记数无关；本轮不是长时间泄漏测试。

## 本轮排障与限制

- 直接把旧EditorState交给新Crepe会因旧Schema引用已销毁context报错；本实现保留同一Crepe/context/schema，仅重建当前nodeViews并切换独立state/history。
- 相同Markdown的图片节点会复用旧目录URL，切换时先清空旧nodeViews再载入目标state；公式额外保存内部选区、打开状态与Escape原值，普通代码块补内部anchor/head方向。
- 迟到打开事件与当前标签点击存在选择竞态：相同标签点击也必须记录选择意图；composition等待后重新核对selectionVersion。保持原UI回归，不以直接API调用替代flush。
- 快速富文本转源码曾漏最后输入，已用行为回归复现；切换时同步读取编辑器，并按初始序列化内容判断是否保留原始Markdown，迟到事件必须先核对会话身份和模式。
- 待保存viewState被旧metadata/read覆盖成null会令flush报“阅读状态无效”，影响第二实例切换与保存目标；已保留未确认的本地viewState，并通过三项原第二实例回归。
- 恢复期间仅祖先inert不足以保证自动化fill等待；名称/源码原生控件同时禁用。目标ID/generation和存活状态有效、正文/内嵌descriptor/源码选区/滚动都恢复后才ready；旧回调不能作用于新会话，未ready的临时视图也不捕获默认零位置。
- 同一会话已ready时，纯metadata事件不重载正文或恢复选区，避免用户输入过程中再次切到inert。恢复中改选C再返回B的选区/滚动回归通过。
- 源码滚动必须在面板隐藏前捕获；隐藏后的scrollTop不能覆盖已有阅读状态。native undo测试采用单次真实文本插入，避免逐字输入把空格分为另一撤销组。
- 首次0.2.0 portable打包因旧输出中的default_app.asar占用失败；最终使用全新 `release/0.2.0-verified/`，未终止未知进程。旧smoke只等页面URL出现便发Browser.close，退出超时；隔离诊断确认等真实编辑界面ready后原关闭路径可正常退出。正式smoke据此等待真实UIready，保持原10秒退出期限，已验证exit0；产品代码未为此改变。现有独立桌面用例覆盖renderer重载中延迟ready后关闭，不代表所有冷启动早关场景；首次过早CDP关闭的超时日志保留，此边界未被普通ready后关闭成功替代。
- 早先B阶段公式保存的一次未解释失败，本轮通过不能证明已找到那次根因；本轮仅报告当前正式回归证据。
- 没有验证真实Windows输入法、其他系统/架构、跨窗口并发编辑、所有编码和所有外部写入竞态。保存前hash比较不是跨进程文件锁。

## 历史与交付

0.1.0历史交付曾通过文件10/10、内核56/56、开发桌面5/5、打包桌面5/5及portable启动退出；这些历史结果不计作0.2.0验证。旧0.1产物保留在原目录，本轮不覆盖。

0.2.0最终验收产物：

- `release/0.2.0-verified/Frowang-Markdown-0.2.0-x64.exe`：115,468,510字节，portable自身启动/退出已通过。
- `release/0.2.0-verified/win-unpacked/Frowang Markdown.exe`：本轮实际28项打包桌面测试入口，使用时保留同目录资源。

产物从通过上述回归的 `out/` 构建，命令为 `npx electron-builder --win portable --x64 --publish never --config.directories.output=release/0.2.0-verified`。之后仅调整smoke就绪判断和验证文档，未改应用实现或包体。若独立审核导致应用实现回修，应按影响验证并重新打包。

未签名、未公开发布，无自动更新、云同步或遥测。依赖、测试profile、output和release产物不提交。

## Windows NSIS 与更新回归（本轮增量）

以上为已交付 0.2 的历史结果。安装／更新功能独立开发时以 `9be2f8a` 为基线并暂留 0.2.0；当前整合版已统一为 0.3.0，见顶部联合验证。

- `npm test` 的 `tests/updates.test.mjs` 覆盖未配置／开发／portable 不请求更新、HTTPS 与隔离 HTTP 边界、同版本不下载、并发检查节流、手动下载进度、下载失败重试、取消重启和安装前保存门槛。
- `npm run test:desktop` 保留既有 28 项真实 Electron／SQLite／IPC 回归；未改菜单或编辑内核测试。
- `npm run test:update` 单独执行 `tests/updates.desktop.spec.mjs`：两个真实 NSIS 版本、同一测试身份与安装目录；应用内检查→下载故障→重试→稍后普通退出不安装→缓存复用→SQLite 拒写阻止更新→恢复写入→显式重启安装→直接连接自动重开的 UI→同入口再次启动，核对名称／正文／标签／源码选区／BOM／CRLF／原文件和冲突。安装／更新／卸载使用真实 NSIS；只替换系统打开文件对话框答案，更新库及安装器没有 mock。
- `tests/fixtures/update-test-bootstrap.cjs` 只进测试安装包。同步设置专有 profile、缓存和随机 CDP 端口后，导入相同的 `out/main/index.js`。NSIS 的 shell 重开不继承父环境，所以仅用 `FROWANG_USER_DATA` 启动第一版不能证明自动重开仍在同一 profile；本回归显式覆盖这个边界。生产包 main、路径和启动方式不因此改变。

首个候选 `ee17544` 的已执行结果（审核回修前）：

| 检查 | 结果与证据 |
| --- | --- |
| `npm test` | 28/28，`output/updates-unit-final.log`（原22 + 更新6） |
| `npm run build` | 通过，`output/updates-build-bootstrap.log` |
| 开发桌面 | 28/28，`output/updates-desktop.log` |
| 两个实际 NSIS 版本升级 | 1/1，`output/updates-nsis-bootstrap-final.log`；`case-VKHDtU/result.json` 记录 `automaticRelaunchRecovered: true` |
| 正式身份／无更新源安装包 | 构建通过；asar 内 `name=frowang-markdown`、`main=out/main/index.js`、`frowangUpdates=null`，没有测试 bootstrap 或 `app-update.yml` |
| 正式打包桌面 | 最终 28/28，`output/updates-packaged-final.log`；修正下述测试同步缺口后，受影响 lazy 组先 6/6（`output/updates-lazy-synchronized.log`），再跑此完整套件。原首次 27/28 日志仍保留 |

首个候选的正式身份安装器已归档到 `release/review-v1/nsis-candidate/Frowang-Markdown-Setup-0.2.0-x64.exe`（130,351,862 字节），两份原测试安装器也在 `release/review-v1/` 对应子目录；未签名／未发布／更新源未配置。两份测试包的版本仅为构建 override，不能替代正式版本决策。新增 electron-updater 的运行时许可证已用现有 `scripts/licenses.mjs` 更新。

安装版启动观察复用主 agent 的 6 篇合成正文、每篇 3278 UTF-8 字节，首次激活第一篇；同机顺序运行，未清 OS 缓存。首次安装耗时 13,650.6ms（独立于启动）；空 profile 首次启动到 UI 就绪 2,038.9ms；六篇已保存笔记普通启动 910.7ms；升级后同入口启动 876.2ms。计时包含 Playwright 连接与 UI 条件观察，不保证其他机器耗时，也不把 portable 外壳阶段全部归为纯解压。

保留的失败与边界：

- 首轮业务断言通过后，测试在已关闭 Playwright 对象上调用 `app.process()` 导致清理失败；通过缓存启动进程句柄修复。该轮不是完整通过记录。
- 一轮由用户手动关闭测试窗口而中断，不计作产品失败，未据此修改产品逻辑。
- 早期只用环境变量隔离初始实例，NSIS 自动重开未继承该环境，曾进入唯一测试产品名的默认 AppData；随后手动显式 profile 的成功不能证明自动重开恢复。该测试 profile 已移入本工作区 `output/early-test-default-profile`，未读取真实 Frowang profile。最终以仅测试包同步 bootstrap、直接 CDP 观察自动重开 UI 解决，产品 main 无测试注入或正文证据写入。
- 曾尝试在 ESM 产品入口设置固定调试端口；自动重开进程存在且 profile 正确，但主进程无 listener，根因未完全确认。同步 bootstrap 小探针实测设置前／产品入口导入后 `app.isReady=false`、随机端口可连、UI 就绪、退出0，之后真实 NSIS 自动重开直接 UI 验收通过；不把小 probe 等同完整升级。
- 正式打包的 `lazy.desktop.spec.mjs:192` 失败：恢复期间切到 C 再回 B，期望选区／滚动 `[4,9,300]`，实得 `[11,12,0]`。该用例与编辑行为未改；开发套件通过不能解释打包失败。原 trace/report 保存在 `output/packaged-full-failure*`。随后仅对该用例用已验收 0.2 打包基线和本候选各做一次对照，均 1/1 通过（`output/updates-baseline-lazy-control.log`、`output/updates-candidate-lazy-control.log`）；这只能说明当时定向观察未复现，不能单凭重跑解释原失败。
- 后续经授权做一次有界同步 probe：原 `documents:activate` 已完成但扣住 B 的回执；旧 `switchTab` 已返回，实际仍选中 C、可见正文为 C、源码框 disabled／header inert、选区 `[11,12,40]`。释放回执并等 B 选中／恢复就绪，原精确 `[4,9,300]` 成立（`output/probe-lazy-switch.log`）。由此确认旧 helper 能把旧标签的 enabled toolbar／共享 DOM 误当切换完成；只在 helper 增加目标选中和 pane/header 非 inert 等待，未改编辑器、原精确断言或产品包体。随后 lazy 6/6、同一候选完整桌面28/28通过；原失败与两次对照证据继续保留，不将旧运行改记为通过。

## 审核回修的边界回归

`tests/updates-real.test.mjs` 使用锁定的实际 `NsisUpdater`、`BaseUpdater`、`GenericProvider`、`ElectronHttpExecutor` 和差量下载器；只替代远端响应／网络发送／受控启动回执，不修改依赖代码。首轮 7 项真实依赖红测均复现审核问题（`output/updates-review-red.log`）。

- R1：直接调用 builder 26.18.0 的 `validateConfiguration`，验证正式配置使用 `win.signtoolOptions.publisherName` 并保留强制签名；不构建、不签名，也不声称已有证书。
- R3/R4/R6：先好候选下载失败，再拒绝新候选，重试不会下载被拒内容；无 `files`／空 `files` 的 legacy 清单明确拒绝；稳定版本显式 semver 校验；下载前再次绑定库内实际 entry 和完整清单，拒绝管理员／web installer 候选。
- R5：在单个 updater 的 executor 上，实际创建请求前传 `redirect: manual`，原始 redirect URL 先验证，再允许原处理器或直接 follow。覆盖 metadata、安装器、blockmap、差量范围与差量直接 redirect；拒绝 HTTP 降级、URL 凭据、测试跨 origin 时不发下一请求／不 follow，Promise 正常拒绝。允许的 HTTPS redirect 仍可完成，另一 executor 不受影响；不改变全应用网络或 TLS。
- R2：使用库实际 `quitAndInstall`／安装参数路径，只在该实例 `spawnLog` 与 app adapter `quit` 扩展点确认和暂扣退出。真实 ChildProcess `spawn` 和库 quit 请求都到达后才提供一次性 commit；失败保留 cause／originalCode，禁用不可确认的 shell／提权 fallback，重置安装锁并允许同实例重试。回归覆盖错误／quit／spawn 不同先后、重复请求、迟到进程错误及实际不存在 exe 触发的 native 异步 `ENOENT`。
- 仅测试 NSIS bootstrap 另提供受控的 50ms 异步安装启动拒绝。真实 Electron 回归已验证窗口仍可编辑、版本仍旧，再在同窗口解除拒绝，完成实际下载→保存→安装→自动重开；它不属于生产包，也不替代成功路径的真实安装器。

回修验证：`npm test` **57/57**（`output/updates-r2-unit.log`），构建通过；真实 NSIS **1/1**（`output/updates-r2-nsis.log`，`case-Plzz6N/result.json` 同时记录 `asyncLaunchFailureKeptWindow: true`、`automaticRelaunchRecovered: true`），新生产包打包桌面首轮 **28/28**（`output/updates-r2-packaged-desktop.log`）。新安装器 `release/nsis-candidate/Frowang-Markdown-Setup-0.2.0-x64.exe` 为 **130,386,043 字节**。`output/updates-r2-production-inspection.json` 确认普通 main、无测试 bootstrap／`app-update.yml`、无更新源，且 asar 内 main 与本轮新 `out/main/index.js` 字节一致；没有沿用旧包冒充回修产物。

回修开发套件初次 27/28：旧 `desktop.spec` 在取消未完成时覆盖为放弃答案，第二次 click 目标消失。一次有界 probe 在真实 close handler 开始前延后：旧 tabs/body 断言已经通过时，answers=[]、header inert=true；换答案再放行，首次关闭消费了 `[1]`（`output/probe-close-race.log`）。仅将该用例改为 `[2,1]` 队列、确认消费取消及操作完成后再第二次真实点击；开发该文件 **8/8**（`output/updates-r2-desktop-group-final.log`）。随后整套27/28暴露 `drafts.desktop.spec` 的同类 `[取消→保存→放弃]` 答案覆盖；经授权一次性改为 `[2,0,1]` 队列并确认消费，不增加第二个 probe、不改产品／原标题正文磁盘断言。两次失败现场保存在 `output/updates-r2-dev-first-*` 与 `output/updates-r2-packed-second-*`，不将所有历史失败一概归为此原因。最终目标用例 **1/1**（`output/updates-r2-draft-close-final.log`），同一新候选完整打包套件 **28/28**（`output/updates-r2-final-desktop.log`）；没有重建或用不同产品版本替换本轮成功的 NSIS 包体。

安装器已启动后的安装失败不承诺自动回滚。未配置生产 HTTPS 源／签名凭据的边界保持；本节真实依赖测试不冒充正式签名发布。

在本机 Windows x64 运行真实升级回归前，准备两个版本；每轮选择一个新的测试 profile，两个版本必须使用同一路径：

```powershell
npm run build
$env:FROWANG_UPDATE_TEST_BUILD = '1'
$env:FROWANG_UPDATE_URL = 'http://127.0.0.1:19091/'
$env:FROWANG_UPDATE_TEST_PROFILE = Join-Path (Get-Location) ('output/update-fixtures/run-' + [guid]::NewGuid().ToString('N') + '/profile')
$env:FROWANG_UPDATE_TEST_VERSION = '0.2.900'
npx electron-builder --config electron-builder.config.cjs --win nsis --x64 --publish never
$env:FROWANG_UPDATE_TEST_VERSION = '0.2.901'
npx electron-builder --config electron-builder.config.cjs --win nsis --x64 --publish never
npm run test:update
Remove-Item Env:FROWANG_UPDATE_TEST_BUILD, Env:FROWANG_UPDATE_URL, Env:FROWANG_UPDATE_TEST_PROFILE, Env:FROWANG_UPDATE_TEST_VERSION
```

回归自行启动仅绑定 `127.0.0.1:19091` 的静态源；端口被占时失败，不杀占用者。真实窗口会显示。仅操作唯一测试应用，成功后静默卸载测试安装，保留合成 profile 和 `result.json` 供检查；安装器位于 `release/update-test-0.2.900` 与 `release/update-test-0.2.901`。不能把测试包交给实际用户，或把两个独立身份的新安装计作升级。

生产更新源／签名尚未配置，测试使用未签名的 loopback 安装器，不证明生产 HTTPS、证书链、代码签名发布或所有系统的升级能力。正式构建不填源则停用更新，配置正式源时必须 HTTPS、指定 publisher 并通过代码签名构建；所有命令均 `--publish never`。
