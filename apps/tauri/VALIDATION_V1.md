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

## Narrow source-history audit follow-up (00d11e6 baseline)

Only new history cases plus directly related tests were run: 6/6 passed.
The 54/15/46/74 results above remain the preceding unit's results, not reruns.
Production implementation and dependencies are unchanged; the review inference
that cached.pm is older than current source did not reproduce an implicit rollback.

- T0 is "初始T0" + LF; body D gives T1 = "初始T0 正文D" + LF; source S gives
  T2 = "初始T0 正文D 源码S" + LF. With or without a page switch during source T2:
  return to body remains T2 without Undo, then Undo -> T1 and Redo -> T2.
- B independently edits/undoes/redoes B0/B1 without changing A's text or revision.
  Stable pre-Undo checkpoints cover the delayed event/autosave window.
- Two consecutive source edits S1/S2, one source Undo, then switch/return:
  the body Undo/Redo applies only the net S1 batch once. A further explicit body
  Undo can remove earlier D to reach T0; redo traverses T1 then S1, without S2.
- Existing immediate-last-input/source-history contract and both external-read
  refresh/history-invalidation cases also pass.

The new tests use real keyboard/menu actions and read-only EditorPort/mock-row
observations of docId, displayed/source text, revision and update ownership.
They do not inject expected PM selection/history. Original per-page PM history is
preserved intentionally; this is browser/mock IPC evidence, not native acceptance.

## Durable images/attachments follow-up (950247c baseline, 2026-11-15)

Implemented: docId-owned immutable objects and additive resource tables in the same
schema3 database, binary import/native multi-file picker, controlled raster image
protocol, optional shared editor File-paste capability, one-operation rich/source
insertion, reveal-only attachments, and create-only Save As resource materialization.
RESOURCES_V1.md describes limits, retained data, scope and partial-success errors.

Company checks actually run:

| Scope | Result | Boundary |
| --- | --- | --- |
| Tauri Node behaviors | 52/52 | Includes 6 new resource packet/coordinator cases; no native IO |
| Combined workbench/PM/history/resource browser run | 63/63 | Included initial 6 resources; before the later literal-label safeguard |
| Final resource browser run | 8/8 | Adds actual 15-second timeout/late reply and literal source attachment label |
| Existing affected shared-editor browser run | 15/15 | Before literal-label safeguard |
| Existing shared bracket-formula/source/link browser follow-up | 1/1 | After that safeguard; normal link/body formulas preserved |
| Root Node suite required by project convention | 74/74 | Shared/component behavior established separately by browser runs |
| vue-tsc + Vite frontend build | Pass | Last build has existing >500 kB chunk-size warning |
| Cargo locked dependency fetch / rustfmt | Pass | Source/dependency preparation only; not Rust compile/typecheck |
| Rust/native file and lifecycle checks | NOT RUN | 14 new assets tests (27 domain/helper total) pending local MSVC node |

All browser tests use actual installed Edge and synthetic File/DataTransfer/keyboard/
menu input, with a DEV-only in-memory IPC double. No system clipboard or real notes
were used. Mock service rehydration is explicitly not native SQLite restart.

The first resource run was 2/6: real PM insertion rejected image title=null.
Using the schema's required empty string fixed all six. A later source-attachment
case first failed because escaped filename brackets entered legacy bracket-math
normalization. Managed attachment labels now stay literal; ordinary link labels
retain their existing formula interpretation. Failing browser error contexts are
kept in output/resources-v1-evidence/initial-failures. These checks did not inject
expected selections/history or patch installed dependencies.

Final browser evidence: output/resources-v1-evidence/durable-image-mock-reload.png
and source-import-rendered.png. synthetic-import.png is generated by a browser
canvas and copied into tests/fixtures/synthetic-resource.png for isolated native
acceptance. These are actual browser screenshots, not native Tauri captures.

New native tests target actual temp files/SQLite: validated raster formats,
batch/commit rollback and cleanup, quotas counting retained objects, title/shelf/
reopen/undo ownership, schema3 additive/failed migration, canonical/junction bounds,
same/different-content export collision, resource/Markdown-write failure,
accurate file-written/DB-commit-failed reporting, unchanged buffer/revision/BOM/EOL,
target Markdown self-alias and repeated link/image validation. None is claimed
passing until run on the local node. The junction test uses only temporary links.

README provides portable checkout/dependency/native commands and a synthetic
output/native-resources-profile. Native custom-protocol CORS/WebView2 rendering,
file dialogs, real system paste, physical IME, close/reopen persistence and executable
bytes remain pending there. This stage stays Draft; PDF/Office/mobile/resize and
final unit-1/platform acceptance are outside this result.

## Cross-document resource reuse follow-up (fa95f40 baseline)

First-failure browser reproduction used A's actual PM copy serializer and full
source selection, then pasted into pathless B. Both routes persisted references
without B bindings before the fix. Synthetic textarea paste emulates its default
setRangeText/input only when the application leaves that event unhandled; after
the fix the owned paste path handles it. No system clipboard or fabricated B
binding is used.

New behavior: explicit clipboard-paste IPC atomically binds verified same-profile
objects before insertion, without copying files or relaxing image/reveal docId
checks. PM slices and source AST image/link roles determine references. Source
reference-style definitions are resolved; code/plain-string examples are ignored.
Unknown resources fail as a batch with target text/selection intact. Temporary/
per-doc image display URLs cannot enter persistent Markdown.

Company verification for this follow-up:
- 32/32 affected Node cases (reuse/resources/coordinator/handoff), including 7 new
  reuse cases and bounded hang/late-result tests.
- 20/20 resource browser cases (12 new reuse + existing 8 imports).
- 3/3 directly affected existing shared paste/math/link browser cases.
- Final vue-tsc/Vite frontend build passes; existing large-chunk warning remains.
- rustfmt/diff checks pass; no Rust/native behavior execution is claimed.

Browser coverage includes actual source and HTML copy; plain Markdown to body;
cross-doc image/link rendering; Undo/Redo; A removal then B use; B fresh-id removal
undo; unknown mixed batch preserving selection; code examples; blob/display URL
rejection; delayed binding plus queued switch; source IME and close drain;
post-insert backup failure/retry; and source definitions resolving prior labels.

Four new Rust tests (31 total domain/helper tests now) are pending local execution:
object reuse without duplication, source removal/target Save As/fresh-undo/reopen;
unknown/extension/missing/tampered/unbound batch failure; deferred-commit rollback;
and path rejection plus explicit SVG attachment/image-intent policy. These require
actual local MSVC execution, file export, protocol and SQLite restart validation.
Run the targeted tests with:
cargo test --manifest-path apps/tauri/crates/document-store/Cargo.toml --locked clipboard_reuse

No unrelated full Electron/workbench suites were rerun. Native OS clipboard/IME,
file dialogs/protocol and physical restart remain separate local acceptance.

## Shared table paste routing and resource continuation (5e519b0 baseline)

The earlier output diagnostic (3 failed /1 passed) remains unchanged. It showed
the same broken geometry in plain/resource controls and runtime order:
MILKDOWN_CLIPBOARD$ -> MILKDOWN_UPLOAD$ -> selectingCells$, with the first plugin
consuming plain paste. Resource direct replacement invoked none of those handlers.

The fixed route keeps plugin order but invokes the original keyed table handler
first for table paste, after necessary HTML/math and Milkdown row-kind preparation.
Actual runtime traces now show selectingCells$ consuming once for both ordinary
and resource table targets; ordinary body fallback still uses MILKDOWN_CLIPBOARD$.
Resource traces assert actual contenteditable=false and inert=true during handling.

Current directly affected checks:
- 22/22 Node: route4 + table policy5 + resource reuse7 + imports6.
- 31/31 resource browser: new table/paste11 + reuse12 + import8.
- 4/4 shared browser: table/math clipboard compatibility and list/table Tab.
- 5/5 PM browser: cross-cell drag both directions, switch/shelf/source/reorder,
  row/column handles + Tab/delete Undo, and HTML cell paste.
- vue-tsc/Vite frontend build passes; existing large-chunk warning remains.
No unrelated whole-workbench/Electron suite was mechanically rerun.

Healthy geometry assertions go beyond equality between two bad paths:
- Single cell -> 2x3 selection fills all six cells, with six image instances but
  only one resource registration. Two-row source replaces exactly two data rows.
- Text caret inside a cell uses the table handler's rectangle semantics.
- Column selection includes header plus data rows; target cell kinds stay valid,
  and unselected columns remain byte-for-text equal. Header/data marked HTML also
  fills correctly. Prefix/suffix text and unselected rows remain.
- Pasting a cell fragment into ordinary body preserves the old separate-fragment
  behavior and leaves the existing table intact; this is not a split target table.
- Both ordinary and resource operations undo/redo as one owned insertion.
- Ordinary HTML marks/math recovery and literal code remain appropriate.
- Final math-recovered slice resources are bound; a newly recovered unknown image
  rejects the entire batch without changing text/selection or partially binding.
- New File paste uses the same continuation; source reuse, late responses, IME,
  close, removal/fresh-id Undo and failed body-backup retry still pass.

The adapter initially exposed the dedicated Milkdown header/data schema mismatch
via a public-handler RangeError before any document dispatch; the final adapter
removes that failure without swallowing it into generic replacement.

Only shared paste modules, focused tests and documentation change. Rust/SQLite,
native protocol, physical WebView2/IME/clipboard/export/restart remain pending the
local node exactly as before; there is no new native acceptance claim.

## Crop-effective resource qualification (4ea0a3f baseline)

Real Edge reproduction used source-mode fixture editing, the existing row handles
to copy a 2x3 source with PM's actual clipboard serializer, and triple-click /
Shift+ArrowDown / column handles to select the target. No Selection/history was
injected and no system clipboard was read or written.

Before the fix: 4 failed / 1 passed. Unknown images in the discarded right column
or second source row rejected the valid 1x1 paste. An entirely discarded resource
set still caused IPC/rejection; a known discarded attachment unnecessarily joined
the target binding. Unknown resources in retained cells already rejected correctly.

The shared clipboard preparation now invokes only the original keyed public table
handler with a frozen, two-field collector (immutable state + transaction capture).
It has no live view/DOM/dispatch/update/focus methods and does not apply the planned
transaction or run appendTransaction. The resulting CellSelection.forEachCell
provides the actual insertion region after the public handler's clipping, spanning
and repetition. Those cells form resourceSlice for BOTH initial defer qualification
and frozen re-preparation. No private clipping/insertion code is copied.

After atomic binding and exact prepared-state/owner validation, commit dispatches
that same transaction once; the table handler is not replayed. A history boundary
marks the planned transaction without advancing the live state first. The real
editor stays readonly/inert through asynchronous binding and actual insertion.
Non-table HTML/math/literal fallback and source Markdown paths remain unchanged.
New imported Files also use the same prepare/commit table path.

Current company results:
- 24/24 Node (route6 + table policy5 + reuse7 + imports6). Added no-live-dispatch/
  DOM/event mutation, exact kept references excluding unrelated target resources,
  one public-handler call, and stale-selection rejection cases.
- 37/37 resource browser (table/paste17 + reuse12 + imports8).
- Final focused crop run 6/6 after adding the held-IPC preparation check: unchanged
  target text/selection and zero target bindings while readonly/inert, then one
  insertion after release.
- 4/4 existing shared table/math/list-paste browser cases.
- 5/5 directly affected PM cases: cross-cell mouse drag both directions, handles/
  Tab/delete Undo, page/shelf/source/reorder lifecycle, ordinary HTML cell paste.
- vue-tsc/Vite frontend build passes; the existing large-chunk warning remains.

Exact crop expectations:
- Source 2x3 -> target 1x1 or 2x1: A11 (and A21 for 2x1) replaces the first
  destination column; only retained PNG is requested. A12's registered attachment
  and A13's unknown PNG are excluded. Header, all other rows/columns and surrounding
  paragraphs remain intact; Undo/Redo each restore one complete operation.
- Unknown A21 is excluded for a 1x1 target. If all resources are outside the
  retained area, reuse IPC is not called and no target binding is added.
- A 2x3 source -> whole-column header/data target retains/repeats A11/A21; placing
  an unknown resource in A21 rejects the batch including the known A11 image,
  leaving the original target text/selection and zero bindings.
- Previous single-cell -> 2x3/whole-column repeat cases, valid image display,
  attachment links, table structure and File insertion still pass.

Run only the directly affected checks from the repository root:
```powershell
node --test apps/tauri/tests/paste-route.test.mjs apps/tauri/tests/table-policy.test.mjs apps/tauri/tests/resource-reuse.test.mjs apps/tauri/tests/resources.test.mjs
node apps/tauri/node_modules/@playwright/test/cli.js test -c apps/tauri/playwright.config.mjs resource-cell-paste.browser.spec.mjs resource-reuse.browser.spec.mjs resources.browser.spec.mjs
npm run tauri:web
```

Rust is unchanged. The existing 31 domain/helper tests, SQLite/object protocol,
native export/restart, WebView2 and physical clipboard/IME remain pending local
execution using README's isolated synthetic profile instructions. Browser mock IPC
and a frontend dist are not native acceptance or a native binary size measurement.

## UTF-8 TXT / HTML import (84a3852 baseline)

Follow-up protocol-relative link fix: HTML `a[href]` `//host` links are validated and normalized to `https:` while images/UNC/TXT remain rejected; browser and Ctrl-click regressions cover this boundary.

Implemented menu/coordinator/EditorPort/native picker-source/resource-stage/atomic
commit flow. See FILE_IMPORT_V1.md for exact source rules, bounded ownership and
limitations. Company: Node34/34 (new import10 + affected24), import browser14/14,
existing resource browser20/20 and shared table/math/HTML/list browser4/4. Final
vue-tsc/Vite build and rustfmt parsing pass, existing chunk warning remains.
Browser native host is a double; no real file picker/SQLite/native restart result
is claimed. Seven new Rust tests (38 total domain/helper) await the local node.
They cover strict UTF-8/BOM/EOL, limits/tokens, controlled local resource ownership,
source-independent reopen/SaveAs, missing/escape/corrupt image rejection, atomic
DB/file rollback/capacity and idempotent confirmation after reopen.
