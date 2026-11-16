# Tauri round-one validation — 2026-11-16

Baseline: `feat/tauri-blackboard-v1` at `f648c93`. Integration branch:
`codex/tauri-round-one`. This round extends the existing Rust/SQLite + WebView2
client and shared ProseMirror editor. The root Electron commands remain separate.
Product sources were fixed at `a87c6c5`; `6af77e0` adds the verified native runner
and shared preview isolation. Later documentation does not change the binaries.

## Environment and isolation

Local Windows x64, Node 24.19.0, Rust/Cargo 1.93.1 (`x86_64-pc-windows-msvc`), Visual Studio 2022
Build Tools MSVC 14.44.35207, Windows SDK 10.0.26100.0, installed WebView2 157,
and pnpm 10.11.0. Dependencies were installed from the root npm lock and the
independent Tauri pnpm lock. Native builds use `CARGO_BUILD_JOBS=4` and a task-local
`TEMP`/`TMP` under `output/native-temp`.

Native tests launch the compiled **debug** executable with its production frontend
embedded, not a Vite page or mock native host. Each case creates a disposable
`output/tauri-native-profiles/case-*` directory and supplies both
`FROWANG_USER_DATA=<case>/profile` and
`WEBVIEW2_USER_DATA_FOLDER=<case>/profile/webview2`. The former is debug-only.
Tests assert the isolated SQLite and WebView2 directories exist. CDP connects to a
temporary loopback port on that child process. No real user notes are opened.

Normal-close checks send `WM_CLOSE` to the spawned process's own window and wait
for exit code 0. This exercises renderer flush, Rust IPC, SQLite checkpoint and
the close handshake. Forced cleanup is only used after a failed test.
The runner records the actual WebView2 browser PID through CDP and waits for both
that process and its endpoint to exit before reopening the same profile.

## Actual checks

| Check | Result | Local evidence |
| --- | --- | --- |
| Root Node tests | 74/74 passed | `output/root-unit-final.log` |
| Tauri Node tests | 85/85 passed | `output/tauri-unit-final.log` |
| Rust document/resource tests, locked dependencies | 43/43 passed, none ignored | `output/native-domain-final.log` |
| Case-sensitive toggle through the application UI, body/source and undo | 2/2 passed | `output/tauri-case-ui.log` |
| Complete Tauri browser suite | 162/162 passed | `output/tauri-browser-final.log` |
| Affected shared-editor regressions | 15/15 passed | `output/pm-shared-verified.log` |
| Type-check / frontend production build | Passed (large-chunk warning) | `output/tauri-web-final.log` |
| Embedded-frontend debug native build | Passed | `output/native-debug-final.log` |
| Real debug WebView2 / Rust / SQLite scenarios below | 3/3 passed | `output/native-smoke-verified.log` |
| Windows x64 release no-bundle build | Passed | `output/native-release-final.log` |

The two case-toggle tests are also included in the 162-test browser suite.
Native screenshots are under `output/tauri-native-results`: recovered text/image,
saved image, and persisted dark reading preferences. The recovered light layout
and dark settings screenshot were visually inspected.

## Local executable

`release/tauri-0.5.0/frowd-tauri.exe` is copied byte-for-byte from
`apps/tauri/src-tauri/target/release/frowd-tauri.exe`. Product version: **0.5.0**;
size: **10,370,560 bytes (9.89 MiB)**. SHA-256:
`e7404d683ace0887901c2497808e5704f2461b32a25a23d52f67d32baa3a4129`.
The folder also contains the project/upstream notices and `artifact.json`.
`dumpbin /dependents` was recorded in `output/native-release-dependencies.log`;
the application uses the installed WebView2 runtime. This is an unsigned local
executable, not an installer. Its generated file integrity label is Medium.
It was built and inspected; the lifecycle tests above ran the debug executable.
No release artifact, dependency tree or synthetic profile is committed to Git.

## Native regression coverage

`npm run test:tauri:native` runs `tests/native.desktop.spec.mjs` after a debug
build. It covers:

- New/rename/edit/switch/shelve, full-text search restoring a shelved page and
  visibly selecting its body hit; normal close/restart retains document identity,
  titles, Markdown, the active page and a rendered managed image.
- A browser File paste event passed to the real resource IPC, protocol decoding,
  existing-file `Ctrl+S`, and byte-for-byte PNG output beside the saved Markdown.
  A second empty profile opens the saved synthetic file without old resource
  bindings, checking relative-image resolution from disk.
- Setext outline navigation, statistics, font size/column width/dark theme,
  persisted across a normal restart in the same isolated WebView2 profile.

The existing-file fixture is assigned in disposable SQLite with the app stopped.
This does not exercise the native file picker. Image paste uses a synthetic
`ClipboardEvent` carrying a File; it does not write or read the operating-system
clipboard. Browser suites cover composition ordering, but physical Windows IME
input is not certified by those synthetic events.

## Reproduced defects and environment failures

- On the old baseline, native cross-page search set the PM selection while the
  editor was frozen, leaving focus on the result button and the visible DOM
  selection empty. The browser regression reproduced this before the fix. The
  application now focuses the target after unfreezing and verifying page/session
  identity. The native assertion is retained.
- Rust initially failed to compile one new resource test fixture due to an
  incorrectly placed variable reference. The corrected missing-file and directory
  junction assertions are included in the passing 43-test run.
- Bundled SQLite compilation initially hit MSVC D8050 with the inherited sandbox
  temp directory. Using the task-local native temp directory resolved it.
- The first debug executable inherited a low-integrity label and failed to start
  with access denied. Only this generated executable's integrity label was
  restored to Medium before launching the isolated test. Chromium/WebView2
  sandboxing was not disabled.
- The first integrated native run passed two scenarios but timed out reconnecting
  CDP after the reading scenario's restart. Startup diagnostics and bounded probes
  now accompany explicit WebView2 process/endpoint exit checks. The complete
  three-scenario rerun passed without altering product sources.
- Shared-editor regressions initially reported 13 passes and two timeouts.
  Their trace recorded Vite `EBUSY` while watching native linker files under
  `output/native-temp`. The shared preview now excludes this checkout's generated
  output/release/target/worktree subdirectories. All 15 tests then passed with
  unchanged editing assertions; the first trace/log remains in local output.

## Remaining boundaries

This round does not establish native picker, physical clipboard/drag and drop,
physical IME, installer/uninstaller, signed distribution, update delivery,
existing-user migration or mobile acceptance. Release builds ignore the debug
profile override, so the normal release executable is not launched as an isolated
lifecycle test. Vite still reports its existing large-chunk warning. The local
artifact is not published and has no update source enabled.
