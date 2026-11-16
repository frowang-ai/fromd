# Current progress — 2026-11-16

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

Confirmed checks available at documentation handoff:

- Root Node suite: **74/74**.
- Tauri Node suite: **85/85**.
- Rust document-store/domain suite: **43/43**.
- The baseline debug executable launched in actual WebView2 and imported an image
  through native IPC into the isolated profile. This is not a final integrated
  build/restart acceptance claim.

Final frontend/native builds, browser regressions and native desktop checks are
being recorded separately in [VALIDATION_ROUND_ONE.md](VALIDATION_ROUND_ONE.md).
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
