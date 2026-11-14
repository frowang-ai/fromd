# Tauri fusion validation — 2026-11-15

Status: reviewable frontend/host integration progress, not unit 1 acceptance.
The task remains on feat/tauri-blackboard-v1 at the company Windows worktree.
7327e3f and 2ba593e remain in history; no existing user installation is replaced.

## Scope now connected

The actual selected SoloMD v5.0.21 CM live modules run in CodeMirrorPort.vue,
through frowd DocumentCoordinator and the fixed host adapter. The native host calls
the independent Rust Store. The Vue shell has page/outline workbar, title-only
expanded/shelved projections, both minus actions, search-group expand-all, menus,
floating docId-bound names, narrow drawer, remove decisions and close handshake.
Only SQLite is intended to persist documents. The browser double is explicitly
in-memory and test-only; it does not establish native persistence.

The reported handoff race was reproduced before fixing:
- Late input during rename acknowledgement was lost on switch.
- Late input during view-state acknowledgement was lost on switch.
- No real editing freeze existed across activate IPC.
All three new controlled-delay Node tests failed first. The fix now captures/reflushes
after metadata acknowledgements, and holds an EditorPort freeze across transitions.
Both document and name composition must finish before the actual editor becomes
read-only/inert. Close confirmation remains inside the same frozen handoff until
checkpoint and close_ready finish. Failure releases the editor and leaves the page.

## Actual checks

- Root npm test: 74 passed, 0 failed. This preserves existing domain regressions;
  these old Electron modules do not prove Tauri behavior.
- Tauri coordinator/removal/handoff Node tests: 17 passed, 0 failed.
- Browser integration: 18 passed, 0 failed, using installed Microsoft Edge 157,
  Playwright 1.63.0 and fresh temporary browser contexts. No unhandled page errors.
- npm run tauri:web: vue-tsc and Vite production build completed.
  Root and app dependency trees coexist; explicit Tauri global types avoid
  conflicting root/app Trusted Types declarations without disabling type checking.
- Production build excludes __FROWD_TEST_HOST__ and testHost injection code.
  The development browser badge is visible in screenshots so evidence is not
  confused with a native Tauri launch.
- Actual frontend output was about 5.8 MB uncompressed, including local
  fonts/diagram chunks. Large entry/diagram chunk warnings remain; no native
  executable or installer size is claimed.
- Official Tauri CLI info detects Rust 1.100.0, Node 24.22.0 and WebView2
  157.0.4341.46, but no MSVC/Windows SDK installation.
- Rustfmt parses the native host, domain and link modules. Native Rust type-check,
  domain-test execution, binary build, actual Tauri launch and schema3 close/reopen
  are still blocked by link.exe being unavailable. No native tests are marked passed.
- GitHub connectivity was intermittent: an initial read-only ls-remote succeeded;
  a later bounded access to github.com:443 failed after roughly 21 seconds.
  A bundle/evidence handoff is used if the final Git delivery remains unavailable.
- No UAC was retriggered; no Windows/Paseo restart, real userData/notes/clipboard
  reads, user installer execution, public release or security setting change.

The first browser invocation had no downloaded Chromium headless shell. Tests were
switched to the already installed Edge channel, without a browser installation.
One test initially read mock storage before asynchronous selection finished;
it now asserts completion by the selected target tab before inspecting storage.

## What the browser suite verifies

1. Confirmed workbar/menu positions, both minus controls and name-only shelf.
2. Final input on an immediate switch, rendered/source text and per-doc history.
3. Both shelf entry points, empty desktop and ordered expand-all/current-page rules.
4. Floating rename after long-document scrolling; title changes do not edit H1.
5. Synthetic name composition finishes on the old docId before a switch.
6. Real contenteditable=false/inert freeze during delayed layout IPC, then release.
7. Nonempty draft cancel, cancelled/failed save, delete and new-ID undo.
8. Backup failure retains text and selection; retry persists before switching.
9. Close flush/checkpoint/confirmation ordering while the actual editor is frozen.
10. Duplicate-heading positions and current-document outline projection.
11. Narrow drawer and selection dismissal.
12. Byte-for-text Markdown preservation when no edit occurs.
13. Title search includes shelved pages without an implicit activation.
14. File-backed names remain read-only; removal does not invoke file deletion.
15. Real curved collapse frame and direct restoration with no reverse capture.
16. Close backup failure stays open/editable, then succeeds on retry.
17. Retained upstream formatting shortcut uses the same document-owned save path.
18. Failed target read retains the prior page/body pairing and permits retry.

These tests inject a mock IPC service. They do not run Rust, show a native file
dialog, touch physical external files, prove SQLite restart, or exercise every
Windows input method. Native tests under document_tests.rs remain mandatory
after the MSVC prerequisite is unblocked.

## Screenshots (actual browser UI, synthetic documents)

Task output/tauri-browser-evidence contains:
- workspace.png: integrated Vue/CM candidate workbench.
- floating-name-scrolled.png: name input retained in the viewport of a long note.
- narrow-workspace.png: narrow UI after selecting/restoring a shelf item.
- collapse-frame.png: captured actual one-way collapse animation.

The supplied parent HTML prototype is not a runtime screenshot and is not used
as implementation evidence.

## Open acceptance and later work

- MSVC/Windows SDK UAC: the verified official installer and manual entry are under
  output/toolchain-prep-20261114/install-build-tools.cmd. The agent has not rerun it.
- Native schema3 restore, actual Windows launch, save/dialog/close/reopen and native
  package-size validation remain open.
- Candidate table local drag selection, rich-text/cross-cell copy, click/double-click,
  Ctrl-link and IME must pass the parent's separate evaluation. The original
  table event behavior is not represented as resolved; the final kernel is not accepted.
- The resource boundary intentionally has no wildcard asset scope; local images,
  durable draft assets, attachments and imports are later units. The current adapter
  renders embedded raster images only; this is a known functional gap.
- Existing PDF export has not been migrated into this candidate host; print CSS only excludes the name dock and application chrome. The existing Electron implementation remains a reference, not proof of Tauri export.
- Reorder command exists in the native domain but tab drag UI is not yet wired.
  Full-text search, richer import/resource paths and mobile lifecycle validation
  remain in scope for subsequent units.
- Android SDK/NDK/JDK were not found in the previously checked standard locations;
  no Android build/runtime acceptance is claimed. iOS requires Mac/Xcode.
