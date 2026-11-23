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
!macroend
