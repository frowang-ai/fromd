# frowd Tauri v1 implementation boundary

This worktree is the first Windows implementation unit for the confirmed frowd fusion direction.

- apps/tauri/src-tauri/src/lib.rs owns the SQLite-backed document and layout service. It exposes stable docId-first commands, schema 3-compatible metadata, revision checks, transactional shelve/expand/remove/undo/reorder operations, and an in-memory last-removal record.
- apps/tauri/src/App.vue owns the page workbar, expanded/shelved projections, tab minus actions, outline projection, floating title entry, IME-aware flush sequencing, and the shared frowd editor session boundary.
- packages/editor remains the editor boundary. It is reused without Electron imports; Tauri code calls its session API and does not write a second localStorage document authority.
- apps/tauri/src-tauri/tauri.conf.json is the Tauri 2 desktop entry. The first unit keeps bundling disabled so validation can run without producing a user installer.

The upstream SoloMD reference was requested as zhitongblog/solomd tag v5.0.21 at commit 0b30523c70387b046018f857c7bf90bcdc40f54c. The bounded clone attempt on 2026-11-14 failed because this environment could not connect to github.com:443; no unverified source was substituted. The intended source boundary is therefore recorded here and must be rechecked before importing SoloMD-specific files.

The existing frowd editor package is MIT-licensed and remains the only editor implementation used by this unit. No agent, AI, telemetry, sync, updater, or remote service is initialized.
