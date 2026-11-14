# Tauri fusion validation — 2026-11-15

Status: reviewable progress / Draft, not native unit-1 acceptance.
Branch feat/tauri-blackboard-v1 retains the d8a855b (0.4.6) baseline and all
7327e3f/2ba593e/e046130/f144cdf progress history. No history was rewritten.

## Current checks (company Windows)

- Root npm test: 74/74. These are existing Node domain tests, not Tauri runtime.
- npm run test:tauri: 29/29.
- npm run test:tauri:browser: 24/24. Actual Vue/CM UI, Edge 157 / Playwright 1.63.0,
  synthetic documents and test-only in-memory native IPC. No unhandled page errors.
- npm run tauri:web: vue-tsc and Vite production build passed.
- Frontend dist: 128 files, 5,814,496 bytes uncompressed. This is not native package size.
  Large entry/diagram chunk and mixed static/dynamic import warnings remain.
- Production output does not contain the browser host injection identifier or test query.
- Rustfmt completed for changed Rust sources. This is parsing/formatting only.
- 13 Rust domain/helper tests are written; NOT executed or marked passed.
  Native type-check, binary build, actual Tauri launch, SQLite schema3/close/reopen,
  native dialogs and native package size await local Windows execution.
- No company C++/UAC retry was performed. Per the latest user instruction, frontend
  development proceeds and native verification moves to the local node.
- No real notes/profiles/clipboard, user installers, public releases, extra agents,
  security policy changes, Windows/Paseo restart or real-data migration.

## Review fixes, reproduced before implementation

- With an existing active page and with an empty desktop, failed target read changed
  backend activation/shelving. New Node cases failed first (activation committed 2/1
  times instead of zero). Reads now succeed before activation commits.
- Dismissing a removal prompt then removing another same-title page hid undo. The
  new Edge regression failed first. A successful-removal sequence now resets it.
  Save cancellation, cancelled removal and failed removal keep it dismissed.
- Suggested filenames strip .md/.markdown/.txt case insensitively before appending
  .md, retaining Windows sanitation/device-name handling. Its Rust regression is pending.

The earlier f144cdf handoff regressions remain: input arriving while rename/view
acknowledgements wait is recaptured and flushed; transitions wait for IME, acquire
a real contenteditable/readOnly/inert freeze and hold it through final persistence.

## Newly implemented and verified at frontend boundary

Full-text search queries SQLite drafts without disk scans or page activation.
It covers pathless drafts, shelved pages and the latest unacknowledged active text.
Search is literal, ASCII case insensitive, capped at 256 query characters and 100
matching pages, showing the first body occurrence or a title hit per page.
Single-flight coalescing, query invalidation, late/error rejection and an 8-second
timeout bound the frontend behavior. Results retain docId; a loaded-body match is
recomputed before selection, using editor-neutral line/Unicode-character locations.
Those locations do not become document schema or CM-specific storage coordinates.

Actual HTML tab drag/drop uses reorder_documents and layoutRevision. The existing
domain operation substitutes visible slots without moving shelved slots, changing
the active page, or rebuilding the live editor session. Last input is flushed after
IME completion. Stale drags are rejected and authoritative metadata refreshed.
Node and browser cases cover unsaved text/history, shelf slots, stale/retry and IME.
Rust transaction rollback/reopen cases are written but await native execution.

## Existing connected behavior

Actual selected SoloMD v5.0.21 modules run through CodeMirrorPort, DocumentCoordinator,
fixed Tauri IPC and the Rust Store. Vue has page/outline workbar; title-only shelf;
both minus actions; expand-all at the expanded header below search; menu-only source;
viewport docId-bound naming; narrow drawer; save/delete/cancel and close handshake.
SQLite is the only persistence authority. No SoloMD localStorage drafts, AI/sync,
telemetry, MCP sidecar or updater starts. Wildcard asset access remains disabled.

The 24 browser cases also cover byte-preserving mode changes, duplicate outline
headings, close failure/retry, captured final input and per-doc history, floating
rename, synthetic IME ownership, empty desktop/expand-all, file-backed title/removal,
same-title undo, one-way collapse/direct restore and candidate formatting shortcuts.
Mock IPC cannot prove native file writes/dialogs, Rust transactions or restart.

## Actual browser screenshots

Task output/tauri-browser-evidence contains workspace.png, floating-name-scrolled.png,
narrow-workspace.png, collapse-frame.png, full-text-search.png and tab-reorder.png.
All show the actual Vue/CM implementation with synthetic data and the mock-IPC badge;
the parent's HTML prototype is not runtime evidence.

## Native handoff and remaining scope

README.md supplies portable checkout/dependency/tool checks, isolated debug profile,
Rust domain tests, host type-check, native dev/reopen and unbundled build commands.
Company has Node 24.22.0/npm 11.19.1, Rust 1.100.0 MSVC and WebView2 157.0.4341.46;
MSVC linker/SDK are not available here. The user chose local native verification.

CM/SoloMD remains a candidate. Table local/rich-text/cross-cell selection, copy,
click/double-click/Ctrl-link and IME require the parent's separate kernel evaluation.
No final editor or unit-1 acceptance is claimed. Local resources/durable draft
assets, attachments/import and PDF export still need integration. Embedded raster
data is the current image boundary; print CSS merely excludes the name dock/chrome.
Android SDK/NDK/JDK/device and iOS Mac/Xcode validation remain open. No four-platform
completion is claimed.

GitHub's current bounded company access failed to connect to github.com:443 after
21 seconds. A verified prerequisite bundle and concise evidence ZIP are the fallback.
