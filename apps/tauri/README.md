# frowd Tauri fusion — ProseMirror EditorPort candidate

The platform foundation derives from fixed SoloMD v5.0.21, commit
0b30523c70387b046018f857c7bf90bcdc40f54c. The active editor now reuses frowd's existing
Milkdown 7.22.3 / ProseMirror package after the verified text-first table comparison.
The complete CM candidate remains in Git at 406ab17; there is one active body editor
and no user-visible kernel switch. This remains a reviewable candidate, not native
Windows or all-platform acceptance.

LICENSE.SOLOMD and upstream-reference/modules.json preserve platform/CM provenance.
upstream-reference/pm-selection.json records the exact experiment archive/hash and
the production registration boundary. dependency-licenses.json records the installed
PM/shared-editor graph; regenerate with node apps/tauri/scripts/inventory-editor-licenses.mjs.

## Entry points and ownership

- src/App.vue: approved page/outline workbar, title-only shelf, both minus controls,
  expand-all, menus, floating docId-bound names, narrow drawer and save decisions.
- src/editor/ProseMirrorPort.vue: one shared PM view plus one source textarea;
  docId/generation, ready/capture/activate/clear, per-page opaque sessions/history,
  view restoration, source mode, neutral navigation and controlled link callbacks.
  Real readonly/inert freeze waits for body/name composition and releases afterward.
- src/editor/sourceHistory.mjs: bounded ephemeral source undo, intercepting native
  textarea undo so the reused textarea cannot restore another page's content.
- packages/editor/src/MarkdownEditor.vue: retained schema, math/code/list/link and
  source-preservation/session behavior. Source replacement starts a history group.
- packages/editor/src/writingTableSelection{Policy,}.js: wraps the same keyed table
  plugin at the same index during state creation, before allPlugins is saved.
  Original state/props/paste/keys, explicit row/column selection and fixTables remain.
  Existing TableNodeView is wrapped through its public stopEvent; dependencies
  are not patched. No columnResizing plugin or replacement table view is added.
- packages/editor/src/writingMarkdownLocation.js: original Markdown AST/source ranges
  mapped to PM textblocks. No PM search coordinates are added to document storage.
- src/documents/coordinator.mjs and host.mjs: unchanged serial ownership, final-input
  flush, stale acknowledgements, bounded search, versioned ordering and close IPC.
- crates/document-store and src-tauri: unchanged SQLite authority, schema3, stable
  ids/nullable paths, file rules, rollback/capacity/undo and close handshake.

No SoloMD localStorage drafts, AI/sync/recipes/telemetry, MCP sidecar or updater
initializes. Shared editor diagnostics are bounded local metadata, not a document
store. Wildcard asset access remains disabled. Images currently render embedded
raster data only; file links use the existing document-scoped native API.

## Source and navigation semantics

Unmodified Markdown stays exactly as loaded, including comments, fences and marker
spelling. Once edited, the existing PM serializer can normalize table padding/
separator widths, emphasis spelling and final newlines. The synthetic before/after
sample is in task output/pm-port-evidence/normalization.json. Undo back to the
unchanged document restores its original raw source.

Rendered text search uses the source AST and actual PM text range. Syntax-only
matches locate the containing block and retain their exact source range, with a
hint to use View > Source. Source is still entered through that menu. Outline
positions distinguish repeated headings. Existing viewState keys and opaque PM
sessions are reused; stable document identity belongs to the document service.

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

For the affected existing shared-editor regressions (no OS clipboard writes):

```powershell
node node_modules/@playwright/test/cli.js test -c playwright.pm-shared.config.mjs
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

PM remains a candidate until local native lifecycle/IME/clipboard acceptance.
Real browser drag/edit/undo and synthetic clipboard serialization checks do not
establish physical Windows IME or OS clipboard behavior. Existing Crepe has no
columnResizing plugin; the rejected resize compatibility experiment is not enabled.
The Node structural checks cover merge/split and paste, not persisted merged-cell
Markdown roundtrips or every nested/irregular table. Local images/durable draft assets, attachments/import,
PDF export and mobile lifecycle/build verification remain later implementation.
Android needs SDK/NDK/JDK and a device/emulator; iOS needs Mac/Xcode. No mobile
runtime or four-platform completion is claimed. See VALIDATION_V1.md for evidence.
