# Windows MVP 0.2 验证记录

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

以上为已交付 0.2 的历史结果。安装／更新功能以 `9be2f8a` 为基线，版本号仍保留 0.2.0，由后续整合发布统一决定。

- `npm test` 的 `tests/updates.test.mjs` 覆盖未配置／开发／portable 不请求更新、HTTPS 与隔离 HTTP 边界、同版本不下载、并发检查节流、手动下载进度、下载失败重试、取消重启和安装前保存门槛。
- `npm run test:desktop` 保留既有 28 项真实 Electron／SQLite／IPC 回归；未改菜单或编辑内核测试。
- `npm run test:update` 单独执行 `tests/updates.desktop.spec.mjs`：两个真实 NSIS 版本、同一测试身份与安装目录；应用内检查→下载故障→重试→稍后普通退出不安装→缓存复用→SQLite 拒写阻止更新→恢复写入→显式重启安装→直接连接自动重开的 UI→同入口再次启动，核对名称／正文／标签／源码选区／BOM／CRLF／原文件和冲突。安装／更新／卸载使用真实 NSIS；只替换系统打开文件对话框答案，更新库及安装器没有 mock。
- `tests/fixtures/update-test-bootstrap.cjs` 只进测试安装包。同步设置专有 profile、缓存和随机 CDP 端口后，导入相同的 `out/main/index.js`。NSIS 的 shell 重开不继承父环境，所以仅用 `FROWANG_USER_DATA` 启动第一版不能证明自动重开仍在同一 profile；本回归显式覆盖这个边界。生产包 main、路径和启动方式不因此改变。

本轮已执行结果：

| 检查 | 结果与证据 |
| --- | --- |
| `npm test` | 28/28，`output/updates-unit-final.log`（原22 + 更新6） |
| `npm run build` | 通过，`output/updates-build-bootstrap.log` |
| 开发桌面 | 28/28，`output/updates-desktop.log` |
| 两个实际 NSIS 版本升级 | 1/1，`output/updates-nsis-bootstrap-final.log`；`case-VKHDtU/result.json` 记录 `automaticRelaunchRecovered: true` |
| 正式身份／无更新源安装包 | 构建通过；asar 内 `name=frowang-markdown`、`main=out/main/index.js`、`frowangUpdates=null`，没有测试 bootstrap 或 `app-update.yml` |
| 正式打包桌面 | 最终 28/28，`output/updates-packaged-final.log`；修正下述测试同步缺口后，受影响 lazy 组先 6/6（`output/updates-lazy-synchronized.log`），再跑此完整套件。原首次 27/28 日志仍保留 |

正式身份安装器：`release/nsis-candidate/Frowang-Markdown-Setup-0.2.0-x64.exe`（130,351,862 字节），未签名／未发布／更新源未配置。两份测试包的版本仅为构建 override，不能替代正式版本决策。新增 electron-updater 的运行时许可证已用现有 `scripts/licenses.mjs` 更新。

安装版启动观察复用主 agent 的 6 篇合成正文、每篇 3278 UTF-8 字节，首次激活第一篇；同机顺序运行，未清 OS 缓存。首次安装耗时 13,650.6ms（独立于启动）；空 profile 首次启动到 UI 就绪 2,038.9ms；六篇已保存笔记普通启动 910.7ms；升级后同入口启动 876.2ms。计时包含 Playwright 连接与 UI 条件观察，不保证其他机器耗时，也不把 portable 外壳阶段全部归为纯解压。

保留的失败与边界：

- 首轮业务断言通过后，测试在已关闭 Playwright 对象上调用 `app.process()` 导致清理失败；通过缓存启动进程句柄修复。该轮不是完整通过记录。
- 一轮由用户手动关闭测试窗口而中断，不计作产品失败，未据此修改产品逻辑。
- 早期只用环境变量隔离初始实例，NSIS 自动重开未继承该环境，曾进入唯一测试产品名的默认 AppData；随后手动显式 profile 的成功不能证明自动重开恢复。该测试 profile 已移入本工作区 `output/early-test-default-profile`，未读取真实 Frowang profile。最终以仅测试包同步 bootstrap、直接 CDP 观察自动重开 UI 解决，产品 main 无测试注入或正文证据写入。
- 曾尝试在 ESM 产品入口设置固定调试端口；自动重开进程存在且 profile 正确，但主进程无 listener，根因未完全确认。同步 bootstrap 小探针实测设置前／产品入口导入后 `app.isReady=false`、随机端口可连、UI 就绪、退出0，之后真实 NSIS 自动重开直接 UI 验收通过；不把小 probe 等同完整升级。
- 正式打包的 `lazy.desktop.spec.mjs:192` 失败：恢复期间切到 C 再回 B，期望选区／滚动 `[4,9,300]`，实得 `[11,12,0]`。该用例与编辑行为未改；开发套件通过不能解释打包失败。原 trace/report 保存在 `output/packaged-full-failure*`。随后仅对该用例用已验收 0.2 打包基线和本候选各做一次对照，均 1/1 通过（`output/updates-baseline-lazy-control.log`、`output/updates-candidate-lazy-control.log`）；这只能说明当时定向观察未复现，不能单凭重跑解释原失败。
- 后续经授权做一次有界同步 probe：原 `documents:activate` 已完成但扣住 B 的回执；旧 `switchTab` 已返回，实际仍选中 C、可见正文为 C、源码框 disabled／header inert、选区 `[11,12,40]`。释放回执并等 B 选中／恢复就绪，原精确 `[4,9,300]` 成立（`output/probe-lazy-switch.log`）。由此确认旧 helper 能把旧标签的 enabled toolbar／共享 DOM 误当切换完成；只在 helper 增加目标选中和 pane/header 非 inert 等待，未改编辑器、原精确断言或产品包体。随后 lazy 6/6、同一候选完整桌面28/28通过；原失败与两次对照证据继续保留，不将旧运行改记为通过。

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
