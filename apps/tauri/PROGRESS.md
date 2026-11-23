# Current progress — 2026-11-16

> 历史归档／宿主迁移说明：本文保留对应旧阶段的行为和验证记录，其中的 Electron 工程、构建命令和专属测试文件已在 0.5.2 随宿主退役移除。当前唯一客户端与测试以 `apps/tauri/` 为准，现行入口见 [README](README.md)、[桌面行为](DESKTOP_FEEDBACK.md)；原文旧动效、接口和测试计数不作为现行契约。
The current integration starts from `feat/tauri-blackboard-v1` at `f648c93`.
It compares Electron 0.5 capabilities against the existing Tauri application,
preserving the Tauri/Rust host, WebView2, SQLite document authority, page workbar,
shelve/restore flow and 450 ms collapse motion. There is one shared
Milkdown/ProseMirror body editor plus source mode. The full CodeMirror candidate
is historical at `406ab17`, not the current editor.

Existing Tauri full-text search, Find/Replace, durable images/attachments and
TXT/HTML import are reused. This round adds reading preferences, word/character
counts, Setext outline entries, case-sensitive Find/Replace, HTML image copying
on Save As, and fixes for source coordinates/focus and stale operation ownership.
See [this round's scope](ROUND_ONE_20261116.md) for behavior and boundaries.

Completed integration checks:

- Root Node suite: **74/74**.
- Tauri Node suite: **85/85**.
- Rust document-store/domain suite: **43/43**.
- Complete Tauri browser suite: **162/162**.
- Affected shared-editor regressions: **15/15**.
- Real debug WebView2 desktop scenarios: **3/3**, including normal-close SQLite
  recovery, visible search selection, image save/reopening and reading settings.

Frontend/native build evidence and local artifact details are recorded in
[VALIDATION_ROUND_ONE.md](VALIDATION_ROUND_ONE.md).
Use that record for the final tested commit and results. Historical company
browser/mock-IPC results remain in [VALIDATION_V1.md](VALIDATION_V1.md).

The local Windows toolchain is available: Rust **1.93.1**, MSVC **14.44**,
Windows SDK **10.0.26100**, WebView2 **157**. Run native builds/tests from a VS
Developer PowerShell with `TEMP`/`TMP` pointing to `output/native-temp` and
`CARGO_BUILD_JOBS=4`. The old missing-linker blocker is resolved.

Use the root `tauri:*` scripts for this client; unqualified `npm run dev/build`
still target the retained Electron project. Build a debug no-bundle executable
before `npm run test:tauri:native`. Manual debug runs must isolate both
`FROWANG_USER_DATA` and `WEBVIEW2_USER_DATA_FOLDER`; the former is debug-only.
Do not use a release executable as a profile-isolated lifecycle test.

No real-user migration, installer execution, release publishing, updater or
mobile acceptance is included. Physical Windows IME, OS clipboard and native
picker behavior still require separate validation; synthetic/browser evidence
does not establish them.
