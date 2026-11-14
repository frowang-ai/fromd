# frowd Tauri fusion — draft implementation

The task branch retains frowd 0.4.6 history and derives its Tauri/Vue/CodeMirror
candidate from SoloMD v5.0.21, commit 0b30523c70387b046018f857c7bf90bcdc40f54c.
LICENSE.SOLOMD preserves the upstream MIT license. upstream-reference/modules.json
records original file hashes. src/upstream/lib contains selected actual upstream
CM live rendering, tables/math, IME, Markdown, list and language modules.
The candidate is integrated for evaluation; visual table selection/copy/IME and
native Windows startup are not accepted yet.

## Entry points and ownership

- src/App.vue: approved page/outline workbar, title-only shelf, two minus controls,
  expand-all grouping, menus, viewport title input, narrow drawer and save decisions.
- src/editor/CodeMirrorPort.vue: one live EditorView, per-doc session state/history,
  rendered/source configuration, view capture and actual edit freeze after IME.
  It emits docId/generation changes and has no document persistence of its own.
- src/documents/coordinator.mjs: serial transitions, captured final input, confirmed
  text/revision, coalesced saves, metadata acknowledgements and close handoff.
- src/documents/host.mjs: fixed Tauri command adapter; no filesystem or shell exposure.
- crates/document-store and src-tauri/src/documents.rs: the one SQLite authority;
  stable ids, nullable paths/activeId, schema3, capacity transactions, layout and
  fresh-id undo, conflict-aware UTF-8/BOM/EOL file save.
- src-tauri/src/lib.rs: profile selection, native dialogs, commands and close request
  handshake. Rust closes only after renderer drain and SQLite checkpoint succeed.
- src/pageMotion.js: existing frowd curved collapse geometry with bounded capture,
  reduced-motion/resize/visibility cleanup. No reverse animation on restoration.

No SoloMD tabs/session localStorage store, AI, sync, recipes, telemetry, MCP sidecar
or updater is initialized. Asset wildcard access is disabled. Current image adapter
renders embedded raster data only; document-scoped local resource integration remains
a later unit. File links are revealed; folders are opened; relative links require a
saved owning document. Shell commands are not exposed to the renderer.

## Local checkout and dependencies (Windows PowerShell)

Use a new worktree in your existing private clone; keep existing installations and
user profiles untouched. These commands start in that clone. If receiving a bundle,
first run git bundle verify, then fetch its task branch instead of fetching origin.

```powershell
git fetch origin feat/tauri-blackboard-v1
git worktree add ../frowd-tauri-review -b review/tauri-v1 FETCH_HEAD
Set-Location ../frowd-tauri-review
node --version
npm --version
rustc --version
cargo --version
# Run in a VS Developer PowerShell with C++ build tools + Windows SDK:
where.exe link.exe
# Also confirm Microsoft Edge WebView2 Runtime is installed.
npm ci --ignore-scripts
npx --yes pnpm@10.11.0 --dir apps/tauri install --frozen-lockfile
```

Tested company frontend tools: Node 24.22.0, npm 11.19.1, pnpm 10.11.0.
Rust 1.100.0 MSVC is installed there; native execution moves to the local Windows
node by user instruction. Do not select a GNU target or add a Node sidecar.
The root npm lockfile belongs to the existing Electron baseline. The independent
Tauri app uses pnpm and locked upstream resolutions; do not replace its lock with npm.

## Frontend and native checks

From the new repository root:

```powershell
npm test
npm run test:tauri
npm run test:tauri:browser
npm run tauri:web
cargo test --manifest-path apps/tauri/crates/document-store/Cargo.toml --locked
cargo check --manifest-path apps/tauri/src-tauri/Cargo.toml --locked
```

The browser suite uses installed Microsoft Edge via Playwright and disposable
contexts. Its native IPC is an in-memory test double. It cannot establish Rust,
SQLite or native lifecycle acceptance. The loopback DEV/test-query injection is
removed by production builds; browser storage is never a document authority.

## Isolated native startup, restart and build

```powershell
$taskProfile = Join-Path (Get-Location).Path 'output/native-review-profile'
New-Item -ItemType Directory -Force -Path $taskProfile | Out-Null
$env:FROWANG_USER_DATA = $taskProfile
npm run tauri:dev
# After closing normally, rerun with the SAME taskProfile to check restoration.
npm run tauri:dev
# Creates an unbundled binary; does not install or publish:
npm run tauri:build
Get-Item apps/tauri/src-tauri/target/release/frowd-tauri.exe | Select-Object Length
Remove-Item Env:FROWANG_USER_DATA
```

Use only synthetic text and test files inside output. Never point the override at
an existing user profile. The override is debug-only; do not run the release binary
as a profile-isolated lifecycle test. App identifier is com.frowang.frowd.tauri.v1.
There is no installer, file-association registration or real-data migration.

Local native acceptance checklist (still pending):

- All 13 Rust domain/helper tests pass, including schema3/NULL, failed transactions,
  undo retention, file BOM/EOL/conflict, search and visible-slot reorder/reopen.
- Actual Tauri launch: new/rename/switch/shelve/expand; both minus controls; same-title
  undo prompt; nonempty draft save/delete/cancel; file removal keeps the disk original.
- Late input and Chinese IME survive switch/reorder/normal close; restart restores
  docId/title/body/order/shelf/active page and view state from SQLite.
- Full-text search finds drafts/shelves/latest input and reveals the selected text.
  On the current clean synthetic file, make an external edit then click an old search
  result, with/without the needle remaining. Confirm new body/revision, old-history
  invalidation and successful next save; verify dirty local input remains intact.
  Drag ordering retains shelved slots, current page and history.
- Record native environment, startup errors, screenshots and binary bytes separately
  from browser evidence. Native package size is not the frontend dist size.

## Search and ordering behavior

Search is literal (Chinese/Unicode exact, ASCII letters case insensitive), capped
at 256 query characters and 100 matching pages. Each page shows its first body hit
or a title match. It reads SQLite drafts without disk scans or implicit activation;
the current live editor text supersedes its persisted search hit. A single pending
IPC request coalesces rapid queries, rejects stale replies and reports an 8-second
timeout. Once an uncancellable request times out, queued queries are discarded and
new queries end immediately with a finite error. No extra hanging invokes accumulate.
Late results are discarded; after the old request settles, use the search error
retry button to explicitly run the current query again.

Search locations are editor-neutral line/Unicode-character data, recomputed against
the loaded body before selection. A read that refreshes a clean current file first
adopts its new body/revision and invalidates old editor history, even when the old
hit has disappeared. A different target never replaces the active draft on a miss;
dirty local file input remains protected by the Store conflict rules. These
locations are not added to the document schema.
Tab drag reorders visible slots using layoutRevision; shelved slots and current
page remain in place. Rejected stale drags refresh authoritative metadata.

## Remaining scope

CM/SoloMD is still an editor candidate: visual table partial/cross-cell/rich text
selection, copy and IME require the parent's separate kernel evaluation. No table
acceptance is claimed here. Local images/durable draft assets, attachments/import,
PDF export and mobile lifecycle/build verification remain later implementation.
Android needs SDK/NDK/JDK and a device/emulator; iOS needs Mac/Xcode. No mobile
runtime or four-platform completion is claimed. See VALIDATION_V1.md for evidence.
