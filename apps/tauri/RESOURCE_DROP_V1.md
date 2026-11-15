# Resource drop v1

Windows resource drop uses the existing HTML5 `File` path and the same `resourcePacket` → fixed binary IPC → coordinator binding flow as the paste and menu actions. The Tauri window sets `dragDropEnabled: false`; Tauri documents that this is required on Windows when the frontend needs HTML5 drag and drop because the default WebView2 handler is replaced by Tauri's internal drag-drop handler.

Rendered mode uses the public ProseMirror `EditorView.posAtCoords` result captured at the drop gesture. The coordinator freezes the matching document session before validation and passes that position to the final insertion. A changed owner, generation, invalid position, failed resource validation, or late callback leaves the document and selection unchanged. The position is never guessed from a later selection.

Source mode currently rejects file drops with an explicit message because the textarea does not provide a safe coordinate mapping in this unit. The user can switch to rendered mode or use the existing source paste/menu flow. Directory drops, non-file drags, drops outside the editor, and SVG image drops are rejected without opening or executing anything. SVG remains available through the explicit attachment action.

Browser tests use synthetic `File`/`DataTransfer` events only. A real Explorer-to-WebView2 drop, native Tauri event delivery, and Windows shell behavior remain local-machine validation items.
