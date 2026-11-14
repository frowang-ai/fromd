# Tauri fusion progress, 2026-11-14

This branch is an implementation in progress. Commit 7327e3f was an unbuilt draft,
not an accepted implementation unit. Its historic claims do not establish runtime behavior.

## Independent document work

- crates/document-store exposes the Rust SQLite service from src-tauri/src/documents.rs.
  The service owns schema3-compatible document fields, transactions, metadata-only
  rename/layout queries, explicit nullable activeId, revisions, capacity checking before
  commit, profile writer locking, file save conflicts, BOM/EOL handling, and fresh-ID undo.
- src/documents/coordinator.mjs owns per-document editor buffers, acknowledged text,
  write coalescing, identity/generation checks, composition waiting, and save/delete/cancel.
  Editor text is captured synchronously at transitions rather than relying on a delayed event.
- Tests live in tests/coordinator.test.mjs, tests/removal.test.mjs and
  src-tauri/src/document_tests.rs. The old tests/tauri-contract.test.mjs source-string
  assertions were removed because they did not verify behavior.

The new modules are not yet an accepted integrated editor/runtime path. The current
App.vue draft is still pending replacement, and real Tauri startup, schema3 restart,
IME, visuals and close/reopen require desktop validation.

## Actual verification

- Node 24.22.0 ran 13 coordinator/removal/exit-order behavior tests: 13 passed.
- An output-only faulty copy with the original bad flush condition failed 5 of the
  first 7 tests. The corrected coordinator passed those same 7 tests.
- rustfmt parsed and formatted the Rust service and eight domain tests.
- cargo test for crates/document-store downloaded official dependencies and entered
  compilation, then exited 101 because the MSVC linker link.exe is missing.
  No Rust test execution or type-check success is claimed.
- cargo fetch for the Windows MSVC Tauri host completed successfully.

## Toolchain correction and blocker

Node/npm were already installed at C:/Users/10633/AppData/Local/Programs/nodejs:
Node 24.22.0, npm/npx 11.19.1. The earlier report of absence was wrong; the sandbox
identity could not discover/read the user installation without normal auto-review escalation.
Existing electron-vite 5.0.0, Playwright 1.63.0 and electron-builder 26.18.0 version
commands run with the absolute node.exe. No old regression suite was run.

Official rustup 1.29.3 installed stable-x86_64-pc-windows-msvc, rustc/cargo 1.100.0:
RUSTUP_HOME=C:/Users/10633/.rustup-frowd-tauri
CARGO_HOME=C:/Users/10633/.cargo-frowd-tauri
No machine PATH was changed. Task-local pnpm is 10.11.0 under output/tooling.

Official Visual Studio Build Tools 2022 17.14.45 downloaded and passed winget hash
verification. Installation returned 1602 / 0x80070642; its log says
"User may have declined UAC prompt". An actual rustc probe confirms "link.exe not found".
The installer and log are preserved in output/toolchain-prep-20261114.
An interactive Windows session must approve UAC for:
vs_BuildTools-17.14.45.exe --quiet --wait --norestart --nocache
--add Microsoft.VisualStudio.Workload.VCTools
--add Microsoft.VisualStudio.Component.VC.Tools.x86.x64
--add Microsoft.VisualStudio.Component.Windows11SDK.26100
No repeated UAC attempt, security policy change or reboot was performed.

WebView2 Runtime 157.0.4341.46 exists. Android SDK/adb/sdkmanager/Java were not found at
the checked normal locations. iOS requires macOS/Xcode and is outside this Windows run.

## Upstream and editor decision

The exact SoloMD archive was received and SHA256 verified:
solomd-source-0b30523-20261114.zip, 96082136 bytes,
20C94BCB967FAE9BF64D3A067D22FA45E3F5679D51BE1164367F53925A84A204.
It was safely extracted under output/upstream-0b30523; package version is 5.0.21.
Selected CM modules/dependencies are prepared with upstream hashes and license.
Forty-eight retained frontend lock resolutions match upstream; Playwright 1.63.0
is the sole additional direct test tool. No background AI/sync/telemetry is initialized.

Final editor integration is paused pending the parent's table interaction finding:
natural drag-selection of part of a visual table cell, explicit cross-cell behavior,
copy fidelity, click/edit, double-click and Ctrl-link must be tested with synthetic data.
A rendered table or a build alone cannot satisfy this acceptance condition.
