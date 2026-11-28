; Included by Tauri before its product defines and Modern UI pages.
; The optional fromd.lnk desktop shortcut stays unchecked in the interactive UI.
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

; Stable, explicit legacy registration. Data paths and bundle identity are untouched.
!ifndef FROMD_LEGACY_PRODUCT_KEY
  !define FROMD_LEGACY_PRODUCT_KEY "Software\Fro\frowd"
!endif
!ifndef FROMD_LEGACY_UNINSTALL_KEY
  !define FROMD_LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\frowd"
!endif
!ifndef FROMD_PRODUCT_KEY
  !define FROMD_PRODUCT_KEY "Software\Fro\fromd"
!endif
; "Open with" registration for .md/.markdown/.txt under HKCU. fromd only joins
; Explorer's Open with list: the extension default value and UserChoice are never
; written, so no existing default app is replaced. The test fixture redirects it.
!ifndef FROMD_CLASSES_KEY
  !define FROMD_CLASSES_KEY "Software\Classes"
!endif
!define FROMD_PROGID_MARKDOWN "fromd.Markdown"
!define FROMD_PROGID_TEXT "fromd.Text"
!define FROMD_APPLICATION_KEY "${FROMD_CLASSES_KEY}\Applications\frowd-tauri.exe"
Var FromdLegacyInstall
!define MUI_CUSTOMFUNCTION_GUIINIT FromdRestoreLegacyInstall
Function FromdRestoreLegacyInstall
  Push $0
  Push $1
  ; Existing fromd installs and explicit custom /D locations keep their own path.
  ReadRegStr $0 HKCU "${FROMD_PRODUCT_KEY}" ""
  ${If} $0 == ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\fromd"
    ReadRegStr $0 HKCU "${FROMD_LEGACY_UNINSTALL_KEY}" "MainBinaryName"
    ReadRegStr $1 HKCU "${FROMD_LEGACY_PRODUCT_KEY}" ""
    ${If} $0 == "frowd-tauri.exe"
    ${AndIf} $1 != ""
      IfFileExists "$1\frowd-tauri.exe" 0 fromd_legacy_done
      StrCpy $FromdLegacyInstall $1
      StrCpy $INSTDIR $1
    ${EndIf}
  ${EndIf}
fromd_legacy_done:
  Pop $1
  Pop $0
FunctionEnd

; The executable path is quoted; "%1" is the file Explorer opens.
!macro FROMD_REGISTER_PROGID PROGID DESCRIPTION
  WriteRegStr HKCU "${FROMD_CLASSES_KEY}\${PROGID}" "" "${DESCRIPTION}"
  WriteRegStr HKCU "${FROMD_CLASSES_KEY}\${PROGID}\DefaultIcon" "" '"$INSTDIR\frowd-tauri.exe",0'
  WriteRegStr HKCU "${FROMD_CLASSES_KEY}\${PROGID}\shell\open\command" "" '"$INSTDIR\frowd-tauri.exe" "%1"'
!macroend
!macro FROMD_OPEN_WITH EXT PROGID
  WriteRegStr HKCU "${FROMD_CLASSES_KEY}\.${EXT}\OpenWithProgids" "${PROGID}" ""
  WriteRegStr HKCU "${FROMD_APPLICATION_KEY}\SupportedTypes" ".${EXT}" ""
!macroend
!macro FROMD_NOTIFY_ASSOCIATIONS
  ; SHCNE_ASSOCCHANGED, SHCNF_IDLIST: Explorer refreshes its Open with lists.
  System::Call "shell32::SHChangeNotify(i,i,p,p) (0x08000000, 0x0000, 0, 0)"
!macroend
!macro FROMD_REGISTER_OPEN_WITH
  !insertmacro FROMD_REGISTER_PROGID "${FROMD_PROGID_MARKDOWN}" "Markdown Document"
  !insertmacro FROMD_REGISTER_PROGID "${FROMD_PROGID_TEXT}" "Text Document"
  WriteRegStr HKCU "${FROMD_APPLICATION_KEY}" "FriendlyAppName" "fromd"
  WriteRegStr HKCU "${FROMD_APPLICATION_KEY}\DefaultIcon" "" '"$INSTDIR\frowd-tauri.exe",0'
  WriteRegStr HKCU "${FROMD_APPLICATION_KEY}\shell\open\command" "" '"$INSTDIR\frowd-tauri.exe" "%1"'
  !insertmacro FROMD_OPEN_WITH "md" "${FROMD_PROGID_MARKDOWN}"
  !insertmacro FROMD_OPEN_WITH "markdown" "${FROMD_PROGID_MARKDOWN}"
  !insertmacro FROMD_OPEN_WITH "txt" "${FROMD_PROGID_TEXT}"
  !insertmacro FROMD_NOTIFY_ASSOCIATIONS
!macroend
; Remove only what this installation wrote: a ProgID/application key whose
; command still targets this $INSTDIR, our OpenWithProgids value names, and an
; OpenWithProgids key only if nothing else is left in it.
!macro FROMD_UNREGISTER_EXT EXT PROGID
  DeleteRegValue HKCU "${FROMD_CLASSES_KEY}\.${EXT}\OpenWithProgids" "${PROGID}"
  DeleteRegKey /ifempty HKCU "${FROMD_CLASSES_KEY}\.${EXT}\OpenWithProgids"
!macroend
!macro FROMD_UNREGISTER_OPEN_WITH
  Push $0
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\${FROMD_PROGID_MARKDOWN}\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\frowd-tauri.exe" "%1"'
    DeleteRegKey HKCU "${FROMD_CLASSES_KEY}\${FROMD_PROGID_MARKDOWN}"
    !insertmacro FROMD_UNREGISTER_EXT "md" "${FROMD_PROGID_MARKDOWN}"
    !insertmacro FROMD_UNREGISTER_EXT "markdown" "${FROMD_PROGID_MARKDOWN}"
  ${EndIf}
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\${FROMD_PROGID_TEXT}\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\frowd-tauri.exe" "%1"'
    DeleteRegKey HKCU "${FROMD_CLASSES_KEY}\${FROMD_PROGID_TEXT}"
    !insertmacro FROMD_UNREGISTER_EXT "txt" "${FROMD_PROGID_TEXT}"
  ${EndIf}
  ReadRegStr $0 HKCU "${FROMD_APPLICATION_KEY}\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\frowd-tauri.exe" "%1"'
    DeleteRegKey HKCU "${FROMD_APPLICATION_KEY}"
  ${EndIf}
  Pop $0
  !insertmacro FROMD_NOTIFY_ASSOCIATIONS
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Only remove old registration after successful installation in that same
  ; confirmed Tauri location. Never invoke the old uninstaller or touch user data.
  ${If} $FromdLegacyInstall != ""
  ${AndIf} $INSTDIR == $FromdLegacyInstall
    DeleteRegKey HKCU "${FROMD_LEGACY_UNINSTALL_KEY}"
    DeleteRegKey HKCU "${FROMD_LEGACY_PRODUCT_KEY}"
    !insertmacro IsShortcutTarget "$DESKTOP\frowd.lnk" "$INSTDIR\frowd-tauri.exe"
    Pop $0
    ${If} $0 == 1
      Delete "$DESKTOP\frowd.lnk"
    ${EndIf}
    !insertmacro IsShortcutTarget "$SMPROGRAMS\frowd (Tauri)\frowd.lnk" "$INSTDIR\frowd-tauri.exe"
    Pop $0
    ${If} $0 == 1
      Delete "$SMPROGRAMS\frowd (Tauri)\frowd.lnk"
      RMDir "$SMPROGRAMS\frowd (Tauri)"
    ${EndIf}
  ${EndIf}
  ; Also rewritten by passive/in-app updates, repairing a moved install.
  !insertmacro FROMD_REGISTER_OPEN_WITH
!macroend

; After files are gone (an aborted uninstall keeps the registration). Updates
; keep it, like Tauri keeps shortcuts; the new installer rewrites it anyway.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    !insertmacro FROMD_UNREGISTER_OPEN_WITH
  ${EndIf}
!macroend
