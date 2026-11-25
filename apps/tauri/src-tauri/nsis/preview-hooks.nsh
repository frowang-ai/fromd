; Preview uses only its own product, binary and bundle identity.
; No legacy migration, registry access or official shortcut cleanup.
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!macro NSIS_HOOK_PREINSTALL
  ; A manually selected /D path must not overlay the stable install either.
  IfFileExists "$INSTDIR\frowd-tauri.exe" 0 preview_directory_ok
    MessageBox MB_OK|MB_ICONSTOP "fromd Preview requires a separate installation folder. Please choose a folder without the stable fromd application." /SD IDOK
    Abort
  preview_directory_ok:
!macroend
