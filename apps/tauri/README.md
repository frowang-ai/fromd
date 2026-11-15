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
- src/documents/coordinator.mjs and host.mjs: serial ownership, final-input
  flush, stale acknowledgements, bounded search, versioned ordering and close IPC.
- crates/document-store and src-tauri: SQLite authority, schema3, stable
  ids/nullable paths, file rules, rollback/capacity/undo and close handshake.

No SoloMD localStorage drafts, AI/sync/recipes/telemetry, MCP sidecar or updater
initializes. Shared editor diagnostics are bounded local metadata, not a document
store. Wildcard asset access remains disabled. Images render embedded raster data or docId-scoped managed/relative raster resources;
file links use the existing document-scoped native API.

## Source and navigation semantics

Unmodified Markdown stays exactly as loaded, including comments, fences and marker
spelling. Once edited, the existing PM serializer can normalize table padding/
separator widths, emphasis spelling and final newlines. The synthetic before/after
sample is in task output/pm-port-evidence/normalization.json. Undo back to the
unchanged document restores its original raw source.

Source mode keeps the prior rendered PM session/history while the textarea owns
current source; returning to body applies its net edit as one history group, so
Undo removes that source batch while preserving earlier body edits, including
after page switches. Authoritative external refresh still invalidates old history.

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

- All 31 Rust domain/helper tests pass, including schema3/NULL, failed transactions,
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
Markdown roundtrips or every nested/irregular table. Durable images/basic attachments are implemented below and await native acceptance.
Broader import and PDF export and mobile lifecycle/build verification remain later implementation.
Android needs SDK/NDK/JDK and a device/emulator; iOS needs Mac/Xcode. No mobile
runtime or four-platform completion is claimed. See VALIDATION_V1.md for evidence.

## Resources (2026-11-15 follow-up)

RESOURCES_V1.md records the implementation and failure boundaries. Images pasted
as browser File items and File > Insert image/attachment are imported into the
profile's immutable resources/objects directory. Additive tables in the existing
SQLite bind content hashes to docId; the document table remains schema3.
Markdown uses relative .frowd-assets/<SHA256>.<extension> references. A dedicated
frowd-resource protocol validates document ownership/relative root and decoded
raster bytes; renderer paths, wildcard asset scope and shell execution are absent.
Attachment Ctrl-click reveals the file rather than launching it.

src/documents/resources.mjs validates binary packets and literal labels.
coordinator.importResources serializes gestures with switch/remove/save/close,
waits for body/name IME, then really freezes editing. The PM/source port inserts
one undoable batch after successful registration and flushes the owned body.
Imports time out after 15 seconds (native picker: 120 seconds). One uncancellable
flight remains tracked until it settles; retry while hung fails finitely.
Late results never insert. A failed body backup after successful registration
retains the inserted editor content for a subsequent save retry.

src-tauri/src/assets.rs owns validation, quota, registration, image resolution
and create-only export copies; resource_host.rs provides binary IPC/native
selection, controlled image responses and reveal-only attachment access.
Managed attachment labels stay literal filenames, including escaped brackets;
normal link/body math semantics remain unchanged.

Save As copies managed resources plus Markdown-referenced relative raster images
from an existing file's owning directory, to the SAME relative paths beside the
target Markdown. It never rewrites the editor buffer/revision/history. Same-content
files are reused; different-content collisions and resource/Markdown self-aliases
fail without overwriting. Ordinary file-link targets, remote/absolute images and
raw HTML img tags are not copied. Normal saving in the same directory only
materializes managed references and does not newly require old external images.
Removing a page/undoing an insertion retains resources; undo-remove copies ownership
to its fresh docId. No GC or cloud upload runs.

Local native acceptance for this unit remains pending. From repository root in
a Windows MSVC Developer PowerShell:

```powershell
cargo test --manifest-path apps/tauri/crates/document-store/Cargo.toml --locked
cargo check --manifest-path apps/tauri/src-tauri/Cargo.toml --locked
$taskProfile = Join-Path (Get-Location).Path 'output/native-resources-profile'
$sampleDir = Join-Path (Get-Location).Path 'output/native-resource-files'
New-Item -ItemType Directory -Force -Path $taskProfile,$sampleDir | Out-Null
Copy-Item apps/tauri/tests/fixtures/synthetic-resource.png $sampleDir
Set-Content -LiteralPath (Join-Path $sampleDir 'attachment.txt') -Value 'synthetic attachment' -Encoding utf8
$env:FROWANG_USER_DATA = $taskProfile
npm run tauri:dev
# Close normally and start again with the same synthetic taskProfile.
npm run tauri:dev
Remove-Item Env:FROWANG_USER_DATA
```

Use this profile only; no existing notes/migration/installer is needed. Verify:

- Insert the synthetic PNG/attachment into a pathless draft in body and source.
  Check image display, literal attachment label, Undo/Redo, rename, shelf restore
  and normal close/reopen. Resources and references must remain independent of title.
- Save As into two temporary directories. Open the copied Markdown in a new
  isolated profile and confirm its relative raster works. Check identical resource
  reuse, different-content collision refusal and no original-file deletion.
- Run the 18 Rust asset tests (31 total domain/helper tests): batch validation,
  registration/commit rollback, retained quotas/undo ownership, additive schema3
  migration, canonical/junction bounds, raster decoding, export conflict/self-alias,
  BOM/EOL and accurate post-write DB-failure reporting.
- Check the custom protocol/CORS in actual WebView2, native picker cancellation,
  physical Chinese IME and system paste with synthetic content. Browser doubles
  establish none of these native checks.
- Record native binary bytes separately; company frontend dist bytes are not the
  native executable size. PDF/Office/mobile remain outside this unit.

Cross-document clipboard follow-up: actual PM HTML slices and source Markdown
resource references reuse already registered immutable objects via explicit
clipboard-paste IPC before insertion. Copying between pathless pages preserves
image/link ownership, Undo/Redo and remove-undo without duplicate files. Code/
ordinary strings do not grant ownership; unknown or temporary display references
fail without changing the target selection/text. Source reference definitions are
handled too. See RESOURCES_V1.md for the exact source qualification and SVG policy.
For local targeted native checks:
cargo test --manifest-path apps/tauri/crates/document-store/Cargo.toml --locked clipboard_reuse

Shared table paste now routes through the same original keyed tableEditing handler
for ordinary paste and resource continuation. HTML/math and row-kind preparation
precede a side-effect-free call to that public handler: its collected transaction
selects the actual cells after clipping/repetition. Only resources in those cells
are qualified/bound, then that same transaction is committed after state/owner
validation. Discarded cells cannot grant bindings or block an otherwise valid paste.
The actual editor stays readonly/inert through native waits and insertion. No
plugin reorder or vendor clipping/insertCells copy is used.
Focused regression: resource-cell-paste.browser.spec.mjs and paste-route.test.mjs.
Native checks remain pending; see VALIDATION_V1.md for exact company results.

UTF-8 TXT / HTML import is available from File > 导入 TXT / HTML… and creates a
pathless draft without modifying or associating the original source. HTML uses
inert shared conversion and scoped local resources, with an explicit per-page
conversion report. Exact rules, limits, failure boundaries and isolated native
steps are in [FILE_IMPORT_V1.md](FILE_IMPORT_V1.md). Native execution remains pending.

Current-document Find/Replace is available with Ctrl+F/Ctrl+H or Edit > Find / Replace. Exact mode semantics, limits, history, ownership and native handoff are in FIND_REPLACE_V1.md.
