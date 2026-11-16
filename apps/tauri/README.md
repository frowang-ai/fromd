# frowd — Tauri / ProseMirror client

The current round starts from `feat/tauri-blackboard-v1` at `f648c93` and compares
Electron 0.5 capabilities with the existing Tauri application. It retains the
Rust host, Windows WebView2, SQLite document service and shared
Milkdown 7.22.3 / ProseMirror editor. See [this round's scope](ROUND_ONE_20261116.md)
and [final validation record](VALIDATION_ROUND_ONE.md) for the tested commit,
results and remaining native checks. [VALIDATION_V1.md](VALIDATION_V1.md) preserves
the earlier company/browser evidence.

The platform foundation derives from fixed SoloMD v5.0.21, commit
`0b30523c70387b046018f857c7bf90bcdc40f54c`. `LICENSE.SOLOMD` and
`upstream-reference/modules.json` preserve provenance; `upstream-reference/pm-selection.json`
records the PM experiment and registration boundary. The complete CM candidate
remains historical at `406ab17`. There is one active body editor and no
user-visible kernel switch. `dependency-licenses.json` records the editor graph;
regenerate it with `node apps/tauri/scripts/inventory-editor-licenses.mjs`.

## Client entry points

Run the following from the repository root. The unqualified root
`npm run dev` / `npm run build` still run the retained **Electron** project.
The Tauri app's own Vite commands are invoked through these scripts:

| Command | Purpose |
| --- | --- |
| `npm run tauri:web` | Type-check and build the Tauri frontend; no native window |
| `npm run tauri:dev` | Start the native Tauri/Rust + WebView2 development client |
| `npm run tauri:check` | Check the Rust host |
| `npm run tauri:build` | Build a release executable with `--no-bundle` |
| `npm run test:tauri` | Tauri Node tests |
| `npm run test:tauri:browser` | Browser tests with mock native IPC |
| `npm run test:tauri:native` | Real debug executable / WebView2 / SQLite tests |

The release command creates `apps/tauri/src-tauri/target/release/frowd-tauri.exe`;
it does not install, publish, associate files or enable an updater. App identity
is `com.frowang.frowd.tauri.v1`. Existing Electron installations and real profiles
are not migrated or replaced.

## Preserved workspace and module ownership

The page/outline workbar, title-only shelf, both minus controls, expand-all,
ordered tabs, floating docId-bound name/save dock and narrow drawer remain.
Shelving uses the existing 450 ms collapse motion; restoration displays the page
directly. SQLite remains the authority for local documents, identity and layout.

- `src/App.vue`: workspace, menus, search/reading overlays and save decisions.
- `src/editor/ProseMirrorPort.vue`: one PM view plus one source textarea;
  docId/generation, capture/activate/clear, per-page sessions/history, view
  restoration, neutral source navigation and controlled link callbacks.
- `src/editor/sourceHistory.mjs`: bounded ephemeral source undo scoped to docId.
- `packages/editor/src/MarkdownEditor.vue`: retained math/code/list/link schema,
  text-first tables, source preservation and session behavior. Source replacement
  starts one history group; it does not introduce another body editor.
- `packages/editor/src/writingTableSelection{Policy,}.js`: wraps the same keyed
  table plugin at its existing index. Original props/paste/keys, explicit
  row/column selection and table repair remain; no columnResizing plugin,
  replacement table view or dependency patch is added.
- `src/documents/coordinator.mjs` and `host.mjs`: serial ownership, IME-safe
  readonly/inert freeze, final-input flush, stale acknowledgements, search,
  versioned ordering and normal-close handshake.
- `crates/document-store` and `src-tauri`: SQLite/schema3 authority, file rules,
  resource ownership, rollback/capacity/undo and fixed host APIs.
- `src/reading`: counts, outline adaptation and validated local preferences.

SoloMD localStorage drafts, AI/sync/recipes/telemetry, MCP sidecar and updater do
not initialize. Editor diagnostics are bounded local metadata. Wildcard asset
access remains disabled; images and links use document-scoped host operations.

## Source, search and reading behavior

Unmodified Markdown retains its loaded spelling, comments and fences. After an
edit, the existing PM serializer may normalize table padding, emphasis spelling
and final newlines. Undo back to the unchanged document restores its raw source.
The source textarea keeps per-page undo history; switching back to body applies
its net edit as one group. An authoritative external refresh invalidates old
history. CRLF offsets are mapped to textarea LF coordinates without rewriting the
stored Markdown merely for navigation.

Full-text search uses the existing SQLite drafts and overlays live unsaved editor
text. It is literal, Unicode exact and ASCII case-insensitive, capped at 256 query
characters and 100 matching pages. Each page returns its first body hit or a title
match. It does not scan disks or activate other pages during a query. One tracked
IPC flight coalesces requests; an 8-second timeout rejects further queries until
the uncancellable flight settles. Retry is explicit. Result selection revalidates
the loaded body and editor-neutral location; stale replies cannot replace another
page's content. Tab ordering continues to use layoutRevision and preserve shelved
slots, the current page and editor history.

Ctrl+F/Ctrl+H opens current-document Find/Replace. This round adds the Aa
case-sensitive option to both body and source modes, with query/mode/docId/
generation ownership checks. It does not alter full-text search semantics.
Source hits scroll into view without taking focus from the query input;
background refresh retains the editing caret. Syntax-only hits keep their source
range and can be inspected through View > Source. Exact limits, mark/history
behavior and failures are in [FIND_REPLACE_V1.md](FIND_REPLACE_V1.md).

The original outline now includes ATX, Setext and quoted headings while excluding
fenced code and leading YAML metadata. Duplicate headings have separate positions.
Word/non-whitespace-character counts sit beside the floating name/save state;
code and formula source count toward the totals. Header 阅读, View > 阅读设置… or
Ctrl+, opens font size, width and light/dark/system settings. Defaults retain
16 px, 860 px and light appearance. Settings use application localStorage with
validation and failure feedback; they do not write documents or native schema.
Dark code/formula colors preserve light fallbacks, and reading CSS is screen-only.
See [READING_V1.md](READING_V1.md) for exact counting and persistence boundaries.

## Images, attachments and imports

The pre-existing resource service remains in use. Browser File paste, body drop
and File > Insert image/attachment register immutable objects in the profile's
`resources/objects` directory and bind hashes to docId using additive SQLite tables.
Markdown uses `.frowd-assets/<SHA256>.<extension>`. The `frowd-resource` protocol
checks document ownership, relative roots and decoded raster bytes. Attachments
use reveal-only Ctrl-click, not arbitrary file execution.

Import waits for body/name IME and freezes the actual editor. After registration,
one undoable PM/source batch is inserted and flushed. Imports time out after
15 seconds (native picker: 120 seconds); one uncancellable flight remains tracked
until it settles. Late replies do not insert into another page. If body backup
fails after registration, the visible insertion remains available for save retry.

Save As copies managed resources and document-relative raster images to the same
relative paths beside the target Markdown. This includes inline/reference Markdown
images and, in this round, raw HTML `<img src>` references. HTML tokenization
excludes comments, escaped code and script/style/raw-text contents. Ordinary file
links and remote/absolute images are not copied. Normal same-directory save only
materializes managed references; it does not newly require old external images.
Same-content targets are reused; different-content collisions and resource/
Markdown self-aliases fail without overwriting. The editor buffer/revision/history
is not rewritten by these copies.

Removing pages or undoing insertions retains objects; undo-remove restores
ownership under its fresh docId. Cross-page resource paste explicitly registers
already-owned references before insertion, with the same document/state checks.
Table paste uses the original keyed tableEditing handler and qualifies only the
resources in cells that will actually be inserted. No GC, cloud upload or wildcard
filesystem access runs. See [RESOURCES_V1.md](RESOURCES_V1.md) and
[RESOURCE_DROP_V1.md](RESOURCE_DROP_V1.md) for quotas, formats and failures.

File > 导入 TXT / HTML… creates a pathless draft and leaves its source file
unchanged. HTML conversion is inert, resources are scoped, and a per-page report
shows conversion outcomes. See [FILE_IMPORT_V1.md](FILE_IMPORT_V1.md).

## Local checkout and dependencies

Use an independent worktree and synthetic data. Keep the fixed task base
`f648c93` in the review record; do not reset another working branch or overwrite
its drafts. The root npm lockfile and independent Tauri pnpm lockfile remain
separate. From the repository root:

```powershell
npm ci --ignore-scripts
npx --yes pnpm@10.11.0 --dir apps/tauri install --frozen-lockfile
```

Local native tooling is Rust **1.93.1**, MSVC **14.44**, Windows SDK
**10.0.26100** and WebView2 **157**. Use a VS Developer PowerShell with
`link.exe` on PATH; do not switch to a GNU target or add a Node sidecar.
Use an isolated temporary directory and bounded parallelism for builds/tests:

```powershell
$nativeTemp = Join-Path (Get-Location).Path 'output/native-temp'
New-Item -ItemType Directory -Force -Path $nativeTemp | Out-Null
$env:TEMP = $nativeTemp
$env:TMP = $nativeTemp
$env:CARGO_BUILD_JOBS = '4'
npm test
npm run test:tauri
cargo test --manifest-path apps/tauri/crates/document-store/Cargo.toml --locked
npm run tauri:web
npm run test:tauri:browser
npm run tauri:check
# The real native tests require this debug executable first:
npm --prefix apps/tauri run tauri -- build --debug --no-bundle
npm run test:tauri:native
```

Browser tests use an in-memory native IPC double. That loopback DEV/testHost
injection is unavailable in production. The real native runner instead starts
`target/debug/frowd-tauri.exe` with separate synthetic document and WebView2
profiles; it does not use the browser mock as native evidence.

For manual startup/restart checks, isolate both stores:

```powershell
$taskProfile = Join-Path (Get-Location).Path 'output/native-review-profile'
$taskWebView = Join-Path $taskProfile 'webview2'
New-Item -ItemType Directory -Force -Path $taskProfile,$taskWebView | Out-Null
$env:FROWANG_USER_DATA = $taskProfile
$env:WEBVIEW2_USER_DATA_FOLDER = $taskWebView
npm run tauri:dev
# Close normally, then reuse these same paths for a restart check.
Remove-Item Env:FROWANG_USER_DATA
Remove-Item Env:WEBVIEW2_USER_DATA_FOLDER
```

`FROWANG_USER_DATA` is debug-only. Do not run a release binary as a
profile-isolated lifecycle test. `WEBVIEW2_USER_DATA_FOLDER` must also be set so
reading preferences and browser storage never fall back to a real/default profile.
Only use synthetic documents and files inside the task output directory.

## Evidence and remaining validation

The integrated root Node **74/74**, Tauri Node **85/85**, Rust domain **43/43**,
Tauri browser **162/162**, shared-editor **15/15** and actual debug WebView2
desktop **3/3** checks passed. Native checks cover normal close/restart, visible
cross-page search selection, image output/reopening and reading preference
persistence. Tested sources, build evidence and local artifact information are
recorded in [VALIDATION_ROUND_ONE.md](VALIDATION_ROUND_ONE.md).

Physical Windows IME, OS clipboard, native picker behavior, real-user migration,
installer execution and mobile runtime/builds are not accepted by these checks.
Synthetic composition and clipboard tests only establish their tested automation
paths. Android needs SDK/NDK/JDK and a device/emulator; iOS needs Mac/Xcode.
PDF/Office export remains later implementation. No installer, public release,
online update, automatic user-data migration or all-platform completion is claimed.
