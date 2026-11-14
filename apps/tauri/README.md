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

## Build and verification

From the repository root, npm run tauri:web builds this frontend; npm run tauri:dev
starts the candidate Tauri host; npm run tauri:build creates an unbundled local build.
The root npm lockfile stays dedicated to the existing Electron baseline.
The independent app package uses pnpm 10.11.0 and the selected upstream pnpm lock
resolutions. Do not run npm install inside this app and replace that lockfile.

Typical company Windows shell preparation (process-only):
- Add C:/Users/10633/AppData/Local/Programs/nodejs and
  C:/Users/10633/.cargo-frowd-tauri/bin to the current process PATH.
- Set RUSTUP_HOME=C:/Users/10633/.rustup-frowd-tauri.
- Set CARGO_HOME=C:/Users/10633/.cargo-frowd-tauri.
- For all native runtime checks, set absolute FROWANG_USER_DATA to a fresh synthetic
  directory under this worktree/output. The override is debug-only.
- Development app identifier is com.frowang.frowd.tauri.v1; there is no installer,
  file association registration, automatic migration of real userData or public release.

Checks:
- node --test apps/tauri/tests/*.test.mjs: coordinator and save/removal behaviors.
- npm --prefix apps/tauri run build: vue-tsc and Vite production build.
- node apps/tauri/node_modules/@playwright/test/cli.js test -c apps/tauri/playwright.config.mjs:
  real Vue/CM browser interaction using a test-only in-memory native IPC double.
  It uses existing Microsoft Edge and isolated Playwright profiles. The UI badge and
  screenshot report distinguish it from a native Tauri/SQLite run.
- cargo test --manifest-path apps/tauri/crates/document-store/Cargo.toml --locked:
  synthetic database/file native tests. Requires MSVC link.exe; currently blocked.

The browser host injection requires loopback Vite DEV plus an explicit test query;
production builds remove it. It never uses browser storage as document authority.
See VALIDATION_V1.md for actual results and remaining acceptance requirements.
