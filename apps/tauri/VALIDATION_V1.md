# Tauri fusion validation — PM EditorPort, 2026-11-15

Status: reviewable editor-integration progress / Draft. Native unit-1 acceptance
is still pending on the local Windows node. Existing history, including the full
CM candidate at 406ab17, is preserved. This route follows the verified table
comparison and reuse of the existing frowd shared PM editor.

## Actual company checks

- Root npm test: 74/74 (shared package changes; not Tauri runtime).
- Tauri Node suite: 46/46, including nine new real-PM/source-history/location checks.
- Actual PM workbench in Edge: 54/54; no unhandled page errors.
- Existing shared-editor browser regressions: 15/15, using
  node node_modules/@playwright/test/cli.js test -c playwright.pm-shared.config.mjs.
  Covers styles, table paste/math, lists/Tab, formulas, source and multi-note history.
  The OS clipboard-writing probe is excluded; synthetic DataTransfer paste is used.
- npm run tauri:web: vue-tsc + Vite production build passed.
- Frontend dist: 179 files / 4,562,201 bytes uncompressed, versus 5,815,493 bytes at
  406ab17. This is not native executable/package size. Large entry chunk warning
  remains (about 2.1 MB raw entry); no native size claim.
- Installed dependency metadata: 268 packages, no unresolved metadata paths.
  Root npm lock fixes shared editor dependencies; app pnpm lock fixes the host.
- Original table-block dependency SHA256 matches the experiment's unpatched source:
  A99D4FCD7F34676544E79FFCCEF61E4CC248D83F1DE5A18484C4C6BDD98B8C63.
- No Rust/native test, build/startup or SQLite restart is claimed. The 13 existing
  native domain/helper tests remain assigned to the local Windows node.
- No UAC/installer/restart, extra agent, real notes/profile, system clipboard
  read/write, public release, merge or new PR. No resource/PDF/mobile feature added.

## Exact evidence and registration

Verified frowd-table-pm-text-first-20261115-035021.zip: 963813 bytes;
SHA256 F3E230A65EA783338D50921EB487E3451CFC300E4470F7F5AB8F1403CD0E9414.
Read RESULT.md, both exact patches, probe_text_first.mjs and the synthetic sample.
The prior 12/12 experiment guided the implementation; it is not counted as the new
integration results above.

writingTableSelectionPolicy wraps the original tableEditingKey plugin at the same
index and key, preserving state and unrelated props/handlers. Ordinary cell
mousedown delegates text selection; TextSelection endpoints retain fixTables while
avoiding rectangular normalization. Explicit CellSelection keeps the original path.
writingTableSelection configures this through editorStateOptionsCtx before initial
EditorView creation and before allPlugins capture. Session creation/restoration and
source replacement reuse the wrapped collection; no ready-time reconfigure patch.

The existing TableNodeView is created through its view extension with only its
public stopEvent wrapped. No node_modules/dependency source is modified. No
columnResizing plugin or replacement table view is introduced.

## Actual interaction and lifecycle coverage

New workbench tests use drawn text Range rectangles only to measure coordinates,
then real Playwright mouse input. They do not assign expected PM selections.

- 14 forward/reverse text selection cases: plain/bold/link portions, cross-cell,
  body/cell both directions, cross-mark and another textblock start. Actual PM
  anchor/head match the measured DOM positions; Markdown remains unchanged.
- Cross-mark replacement plus undo/redo retains remaining rich marks and table.
- Cross-cell replacement preserves unselected boundaries and supports undo/redo.
- Row/column handles, delete/undo and Tab keep the existing table behavior.
- Ordinary link click/double-click and Ctrl-link callbacks remain document-owned.
- Partial rich and cross-cell copy serialization contains only selected portions.
  Synthetic ClipboardEvent/DataTransfer invokes the real serializer without OS access.
- Actual HTML paste inside a text cell keeps rich marks, other cells and undo.
- Text-first remains after switch, shelf restore, source roundtrip and tab reorder.
- Source undo/redo remains per docId; source and body synthetic composition waits
  for completion before actual readonly/inert handoff.
- Existing final-input/history, name IME, freeze, removal/undo, late/read failures,
  search timeout/retry, external read reconciliation, sorting and close tests pass.

Node tests additionally exercise actual PM EditorState/TableMap/tableEditing:
plugin key/state/props/index retention, structural repair under TextSelection,
official merge/split and undo/redo, original paste in text/cell selections, and
bounded source history. These do not establish persisted merged-cell Markdown
roundtrips or every nested/irregular table.

## Fidelity and navigation

Unedited source and mode roundtrip remain byte-for-text exact. After an edit, the
existing PM serializer normalizes table spacing/separator widths in the recorded
synthetic sample; other parser-supported syntax may also canonicalize. Undo to the
original document returns original raw source. The comparison is in task output
pm-port-evidence/normalization.json.

Search/outline map original Markdown AST ranges to actual PM textblocks.
Rendered text selects the exact text. Syntax-only matches select their enclosing
block and retain the exact source range with a View > Source hint. That menu stays
the only source-mode entry; no extra kernel panel or automatic mode switch.

## Integration failures resolved while developing

The first import used one too many parent directories; a package export replaced it.
The first workbench run passed 23/27: source replacement initially grouped with the
previous edit in undo; closeHistory now separates the logical operation.
Unfocused PM navigation needed explicit DOM scrolling in its owned scroller.
Collapse capture encountered unsupported modern color on Crepe's transient drop
indicator; capture excludes only that indicator and tracks the PM scroller.
Formatting assertions now inspect rendered strong marks, not raw Markdown syntax.
A cross-cell test initially counted the existing empty drag-preview table; it now
counts the actual table.children and still verifies unselected content/undo.

The first shared test invocation mixed root/app Playwright instances; the final
root config uses the existing root CLI. Vite's existing harness now has an explicit
entry so it does not crawl the archived upstream HTML in task output.

## Evidence and remaining acceptance

Task output/pm-port-evidence: pm-workbench.png, table-cross-cell.png,
normalization.json. Existing workbench evidence was regenerated with PM under
output/tauri-browser-evidence. All are actual browser UI with synthetic documents
and mock IPC, not native Tauri/SQLite screenshots.

README.md documents isolated checkout/profile and native commands. Local remaining
checks include real Windows IME, OS clipboard, file dialogs/external file conflicts,
schema3 close/reopen, actual Tauri lifecycle and native package size. Android needs
SDK/NDK/JDK and a device/emulator; iOS needs Mac/Xcode. Resources/imports/PDF and
mobile remain later scope. The rejected resize compatibility experiment stays off.
No final native editor, full-table, unit-1 or four-platform acceptance is claimed.

The follow-up stays on feat/tauri-blackboard-v1 and existing Draft PR #13.
Current commit/base, transport result and artifact hashes are in the task output report.
