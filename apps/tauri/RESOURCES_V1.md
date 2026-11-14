# Durable resources — implementation unit (2026-11-15)

## Concrete design

A draft can contain ![合成图](.frowd-assets/<SHA256>.png) or
[附件.txt](.frowd-assets/<SHA256>.txt). The reference is standard relative Markdown,
not a blob URL, absolute profile path, title-derived folder or second document store.
Profile resources/objects holds immutable content-addressed files; additive
resource_objects/resource_bindings tables in the existing SQLite record metadata
and docId ownership. Document schema3 remains readable. Removal keeps objects and
bindings; undo with a fresh docId copies ownership. No automatic GC is introduced.

Images: PNG/JPEG/GIF/WebP decoded and size-checked, at most 10 MiB each, 40 million
pixels, dimensions <= 12000 each, and decoder max_alloc configured to 96 MiB
(a decoder best-effort limit, not a process-memory guarantee). Attachments: at most 25 MiB each. Import:
up to 8 files / 50 MiB per batch. Managed profile objects: up to 512 MiB / 2048
unique files, including retained unreferenced files. These resource limits are
separate from the existing 10 MiB document and 100 MiB document-session limits.

Import is a fixed binary IPC/native picker operation. Shared editor host support
is explicit and optional so existing Electron/default paste remains compatible.
Tauri intercepts File paste before transient upload; image/attachment menu entries
use native selection. The coordinator records the gesture owner, waits for IME,
actually freezes editing, persists final text, imports atomically, inserts into the
same owner in one undoable operation, then flushes. A bounded timeout never applies
a late reply to another page and does not accumulate hung import invocations.

Images are served by a dedicated docId-scoped custom protocol, never wildcard
asset scope or arbitrary renderer paths. Managed references require ownership.
Existing saved-file relative images are limited to canonical descendants of their
owning directory and validated raster bytes. Absolute/network/escaping image
sources are not loaded. Managed attachment clicks reveal the file only.

Save/Save As materializes managed resources. Save As also copies explicitly referenced relative
raster images from the owning directory at the SAME relative destination before
atomically writing Markdown. Existing unrelated ordinary link targets are not
scanned/copied. Same-content destination files are reused; different-content
collisions abort. Up to 256 distinct resources / 512 MiB per export; no recursive disk scan.
Because references do not change, coordinator buffers/revisions/undo need no
rewrite. The profile copy remains available for undo and future exports.

Failure boundaries: validation/import registration failure inserts no Markdown;
newly created unregistered objects are cleaned when safe, otherwise the error
explicitly states retention. Export resource failure leaves Markdown/DB untouched
(new copied resources may remain). Markdown write failure preserves original
Markdown and draft. DB commit failure after successful file write reports that the
file WAS saved and the draft association failed; it never claims no file was written.
A failed subsequent removal keeps the saved file and page; no original file is deleted.

## Verification boundary

Use synthetic PNG/files, File/DataTransfer browser events and isolated directories.
Company Node/browser/build checks establish frontend/IPC ownership behavior only.
New Rust resource/schema/file behavior tests and actual native protocol/restart/
system-paste checks must run on the local Windows node. No real notes/clipboard,
UAC, installer, PDF, Office importer, mobile feature or resize work belongs here.

## Concrete scope and retained data

Only Markdown image destinations (including reference-style syntax) and managed
attachment link destinations are materialized. Ordinary file links, raw HTML img
tags and remote/data image destinations are not copied; relative image escapes
and missing sources fail explicitly on Save As. Normal same-directory Save does
not add existence requirements to unmanaged external images. Export references
cannot alias the target Markdown file. The managed objects are immutable; manual
tampering with a bound object's bytes raises an integrity error.

The native picker checks metadata ownership without calling read/check_external,
so opening the picker cannot silently refresh a clean file/revision behind the editor.
The only new filename interpretation rule is that managed attachment link labels
remain literal through the shared bracket-math compatibility pass. Ordinary links
can still contain intentional formulas. Generated source labels escape Markdown
punctuation and dollar signs.

No automatic resource deletion occurs on body Undo, remove, export failure or timeout.
Objects/bindings may outlive the document and the one-session removal undo record.
An import that registers successfully but whose body backup fails leaves its
insertion visible/dirty for retry; it does not pretend that SQLite saved the body.
The 512 MiB/2048-object cap counts retained/orphan files too. No sophisticated GC
or implicit user-data cleanup is introduced.
