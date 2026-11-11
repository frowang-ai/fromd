# Windows MVP 0.2 验证记录

## 原生菜单与标签入口（2026-11-11）

本次基于 `9be2f8abcab11e74aaa2aaf5bb17a12e4c7d546b`，只调整桌面菜单、标签入口和相关回归，不改变编辑内核、SQLite、依赖或版本。所有样本使用独立 `FROWANG_USER_DATA`。

| 检查 | 本次结果与证据 |
| --- | --- |
| `npm test` | **22/22**，`output/menu-storage.log` |
| `npm run build` | **通过**，输出供以下开发及打包测试使用 |
| `npx playwright test -c playwright.config.mjs tests/menu.desktop.spec.mjs` | **3/3**，`output/menu-focused.log` |
| `npm run test:desktop` | **31/31**（原28项 + 菜单3项），`output/menu-desktop.log` |
| 打包后的同一菜单用例 | **3/3**，`output/menu-packaged-validation.log` |
| `node scripts/smoke-portable.mjs release/menu-preview/Frowang-Markdown-0.2.0-x64.exe` | **通过、exit 0**，真实编辑ready、SQLite创建及原10秒退出期限；同上日志 |

- `tests/menu.desktop.spec.mjs`：加号是普通按钮、一次新建并激活；少量标签紧随末尾，520px窄窗与11标签溢出时仍可点；原生菜单结构与源码勾选；Ctrl+N/O/S/Shift+S调用次数；取消／错误恢复；未ready／忙碌／迟到跨标签命令及组合输入屏障。
- 菜单命令通过真正注册的 `MenuItem.click → main → preload → renderer` 进入原有flush业务流程。菜单上下文序号不使用正文revision；用例在菜单保存消息延迟期间继续真实输入、等待自动备份，再放行后验证磁盘为最新正文。原有保存目标竞态、真实fill后不足200ms点击关闭及文件内容断言保留并通过。
- `tests/native-menu.mjs` 只提供实际菜单回调和就绪观察；原生菜单不是DOM按钮。`main[aria-busy=false]`反映当前文档恢复完成且没有正在执行的操作，portable改用此条件取代已移除的nav按钮。
- 打包证据目录 `output/packaged-results/menu.desktop-原生菜单：标签末尾加号、窄窗溢出、真实菜单结构和源码状态/` 含 `native-menu.json`、`menu-tabs-wide.png`、`menu-tabs-narrow.png`。页面截图已视觉检查；没有用DOM截图冒称OS菜单截图。OS原生菜单的鼠标展开、所有真实输入法和设备未逐项验证。
- 本地预览产物 `release/menu-preview/Frowang-Markdown-0.2.0-x64.exe`（115,466,066字节），以及同目录 `win-unpacked/Frowang Markdown.exe`。命令为 `npx electron-builder --win portable --x64 --publish never --config.directories.output=release/menu-preview`。本次仅重跑打包菜单与portable，未声称打包完整31项也已重跑；旧0.2验收件保留。未签名、未发布。
- 首轮新增spec使用带尾分隔符的Windows项目路径，启动时误解析引号；已仅将该入口改为既有 `resolve(fileURLToPath(...))` 规范。单次隔离probe确认PID11824进入ready并退出；失败任务已终止、定点查询无自有残留，没有操作用户Frowang进程或数据。另一次测试读取尚未创建的另存文件抛ENOENT，已仅对该预期瞬态等待。失败日志保留在 `output/menu-initial-launch-failure.log`、`output/menu-file-wait-failure.log`，启动验证见 `output/menu-launch-probe.log`。

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
