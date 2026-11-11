# Windows 0.3.0 联合验证记录

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
