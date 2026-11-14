# Tauri fusion validation — 2026-11-15

Status: reviewable progress / Draft, not native unit-1 acceptance.
Branch feat/tauri-blackboard-v1 retains the d8a855b (0.4.6) baseline and all
7327e3f/2ba593e/e046130/f144cdf progress history. No history was rewritten.

## Current checks (company Windows)

- Root npm test: previous bc4ba9f result 74/74, not repeated for this app-only fix.
  These existing Node domain tests do not establish Tauri runtime behavior.
- Tauri Node suite: 37/37 (node --test apps/tauri/tests/*.test.mjs).
- Full Tauri browser suite: 27/27. Actual Vue/CM UI, Edge 157 / Playwright 1.63.0,
  synthetic documents and test-only in-memory native IPC. No unhandled page errors.
- npm run tauri:web: vue-tsc and Vite production build passed.
- Frontend dist: 128 files, 5,815,493 bytes uncompressed. This is not native package size.
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

## Search stability follow-up after bc4ba9f

Four new assertions failed before the fix: Q2 kept before/after Q1 timeout remained
searching=true; a side-effecting read refreshed the current file in the host while
the editor retained old text; a different target's refreshed revision was stale.

The search deadline now ends the latest valid query and drops queued work. The
uncancellable native request retains its single slot, and new queries immediately
show a finite error until it settles. No fake cancellation or accumulating invokes.
Expired results stay discarded; there is no automatic queued restart. After
settlement, the error-only retry button explicitly runs the current query again.
If the native invoke never settles, search remains unavailable with an error;
it does not claim to recover or keep spinning. Empty/oversize query states remain finite.

After read/check_external, target metadata is adopted before checking an old hit.
A refreshed current file first adopts its authoritative body/revision and drops
the old editor session/history; a missing hit is reported only after reconciliation.
A different target's missing hit leaves active owner/input/name/selection and its
shelved state intact. Dirty current-file input follows the domain conflict rules.
A retained hit also uses the refreshed revision, and the next edit saves correctly.

Eight new Node cases cover those orderings, empty/oversize cancellation, current
hit/miss refresh, late owner events, another target and dirty local-file conflicts.
Three new Edge cases use an actual 8-second deadline and a synthetic side-effecting
read host; current external hit/miss refresh also checks real CM undo isolation and
the next saved revision. The mock's revision validation now matches the Store rule.
The initial browser version assertion was corrected to await the actual file save,
rather than observing the pre-save row. Final full Node/browser suites pass.
No Rust or physical external-file lifecycle validation is inferred from the mock.

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

The 27 browser cases also cover byte-preserving mode changes, duplicate outline
headings, close failure/retry, captured final input and per-doc history, floating
rename, synthetic IME ownership, empty desktop/expand-all, file-backed title/removal,
same-title undo, one-way collapse/direct restore and candidate formatting shortcuts.
Mock IPC cannot prove native file writes/dialogs, Rust transactions or restart.

## Actual browser screenshots

Task output/tauri-browser-evidence contains workspace.png, floating-name-scrolled.png,
narrow-workspace.png, collapse-frame.png, full-text-search.png, tab-reorder.png, search-timeout-retry.png and
external-current-search-refresh.png.
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

The parent pushed bc4ba9f and created Draft PR #13 against feat/page-navigation.
This follow-up stays on the same task branch and does not create a new PR.
The current push or verified-bundle transport result is recorded in the task output report.
