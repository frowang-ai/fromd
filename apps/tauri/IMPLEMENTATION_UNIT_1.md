# Implementation unit 1 evidence

- Worktree: C:/Users/10633/Desktop/code/website/_worktrees/frowd-tauri-v1
- Branch: feat/tauri-blackboard-v1
- Base: d8a855bc9545f79d4171cb397ced6e67bf642c35
- Scope: Tauri 2 desktop shell, frowd SQLite document/layout commands, page workbar, naming, source/rendered session switch, outline, shelve/expand/remove/undo.
- Data authority: apps/tauri/src-tauri/src/lib.rs owns SQLite; the Tauri UI does not use localStorage/sessionStorage and the editor package does not persist documents.
- Existing frowd editor: packages/editor is reused as the editor boundary. The editor package remains Electron-independent.
- Upstream reference: SoloMD v5.0.21, commit 0b30523c70387b046018f857c7bf90bcdc40f54c. A single bounded clone attempt on 2026-11-14 failed at github.com:443; no unverified source was copied. The source/license boundary is recorded in apps/tauri/README.md and THIRD_PARTY_NOTICES.md.
- Input package: frowd-v1-implementation-20261114.zip, 113746 bytes, SHA256 38260E85CAC4B24F22E814AC9E2B23555A1D98284FCF8119F27CADC0EBA8B36D, verified before extraction.
- Design reference screenshot: C:/Users/10633/Desktop/code/frowd-desktop/output/frowd-v1-implementation-20261114/frowd-v1-workspace.png. This is the supplied reference; no runtime screenshot is claimed below.

## Checks performed

- Worktree and branch were created from the requested d8a855b and were clean before edits.
- Root and Tauri JSON manifests parse successfully with PowerShell ConvertFrom-Json.
- git diff --check passes.
- Static contract coverage was added at tests/tauri-contract.test.mjs.
- The available shell has Git 2.56.0, but node, npm, pnpm, rustc, cargo, MSVC cl, and msbuild are not on PATH and were not found at the checked user/system locations. Therefore npm test, npm run tauri:web, cargo check, and a real Tauri launch were not run in this environment.
- No installer, bundle, real userData, clipboard, or user notes were accessed.

## Known gaps for the next unit

- The bounded SoloMD source fetch must be retried only after the parent supplies an official archive or a reachable source. This unit does not claim the fixed SoloMD Tauri files were imported.
- File picker/open/save and file-backed document creation are not exposed by this first Tauri command surface; the path field and remove-without-disk-delete contract are preserved for the next integration.
- Drag ordering, full-text search, images/assets/import, and mobile runtime/build checks remain subsequent units. iOS needs macOS/Xcode; no four-platform completion is claimed.
- Runtime visual capture and schema-3 reopen testing still require the missing Rust/Node toolchain. The Rust service includes schema-3 field migration and transactional layout operations, but this commit does not claim a compiled Windows binary.
