Unicode true
!include LogicLib.nsh
!define FROMD_LEGACY_PRODUCT_KEY "Software\fromd-agent-tests\${FROMD_TEST_ID}\old-product"
!define FROMD_LEGACY_UNINSTALL_KEY "Software\fromd-agent-tests\${FROMD_TEST_ID}\old-uninstall"
!define FROMD_PRODUCT_KEY "Software\fromd-agent-tests\${FROMD_TEST_ID}\new-product"
; Open with registration is redirected away from the real Software\Classes.
!define FROMD_CLASSES_KEY "Software\fromd-agent-tests\${FROMD_TEST_ID}\classes"
; Shortcut classification belongs to Tauri's utils.nsh. This isolated registry
; probe deliberately returns no shortcut match, so it cannot touch user links.
!macro IsShortcutTarget SHORTCUT TARGET
  Push 0
!macroend
!include "${FROMD_HOOKS}"
; Declared by Tauri's installer template; the uninstall hook reads it.
Var UpdateMode
Name "fromd isolated rename probe"
OutFile "${FROMD_TEST_ROOT}\probe-rename.exe"
SilentInstall silent
RequestExecutionLevel user
!define TASK_RENAME_ROOT "${FROMD_TEST_ROOT}"
Section
  SetShellVarContext current
  SetRegView 64
  DeleteRegKey HKCU "Software\fromd-agent-tests\${FROMD_TEST_ID}"
  CreateDirectory "${TASK_RENAME_ROOT}\legacy"
  FileOpen $0 "${TASK_RENAME_ROOT}\legacy\frowd-tauri.exe" w
  FileWrite $0 "synthetic executable marker"
  FileClose $0
  WriteRegStr HKCU "${FROMD_LEGACY_PRODUCT_KEY}" "" "${TASK_RENAME_ROOT}\legacy"
  WriteRegStr HKCU "${FROMD_LEGACY_UNINSTALL_KEY}" "MainBinaryName" "frowd-tauri.exe"
  ; Another app already owns .md as default and in Open with.
  WriteRegStr HKCU "${FROMD_CLASSES_KEY}\.md" "" "Other.md"
  WriteRegStr HKCU "${FROMD_CLASSES_KEY}\.md\OpenWithProgids" "Other.md" ""
  StrCpy $INSTDIR "$LOCALAPPDATA\fromd"
  Call FromdRestoreLegacyInstall
  StrCmp $INSTDIR "${TASK_RENAME_ROOT}\legacy" 0 failed
  ; Failed/uncompleted installation has not removed registration.
  ReadRegStr $0 HKCU "${FROMD_LEGACY_UNINSTALL_KEY}" "MainBinaryName"
  StrCmp $0 "frowd-tauri.exe" 0 failed
  !insertmacro NSIS_HOOK_POSTINSTALL
  ReadRegStr $0 HKCU "${FROMD_LEGACY_PRODUCT_KEY}" ""
  StrCmp $0 "" 0 failed
  ReadRegStr $0 HKCU "${FROMD_LEGACY_UNINSTALL_KEY}" "MainBinaryName"
  StrCmp $0 "" 0 failed
  IfFileExists "${TASK_RENAME_ROOT}\legacy\frowd-tauri.exe" +2 0
  Goto failed
  ; Open with: quoted executable, ProgIDs and OpenWithProgids only; no default.
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\fromd.Markdown\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\frowd-tauri.exe" "%1"' 0 failed
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\fromd.Text\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\frowd-tauri.exe" "%1"' 0 failed
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\Applications\frowd-tauri.exe\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\frowd-tauri.exe" "%1"' 0 failed
  ClearErrors
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\.md\OpenWithProgids" "fromd.Markdown"
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\.markdown\OpenWithProgids" "fromd.Markdown"
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\.txt\OpenWithProgids" "fromd.Text"
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\Applications\frowd-tauri.exe\SupportedTypes" ".markdown"
  IfErrors failed
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\.md" ""
  StrCmp $0 "Other.md" 0 failed
  ClearErrors
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\.txt" ""
  IfErrors 0 failed
  ; An update-mode uninstall keeps the registration for the new installer.
  StrCpy $UpdateMode 1
  !insertmacro NSIS_HOOK_POSTUNINSTALL
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\fromd.Markdown\shell\open\command" ""
  StrCmp $0 "" failed
  ; A real uninstall removes only fromd's own values and keys.
  StrCpy $UpdateMode ""
  !insertmacro NSIS_HOOK_POSTUNINSTALL
  ClearErrors
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\.md\OpenWithProgids" "fromd.Markdown"
  IfErrors 0 failed
  ClearErrors
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\.md\OpenWithProgids" "Other.md"
  IfErrors failed
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\.md" ""
  StrCmp $0 "Other.md" 0 failed
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\fromd.Markdown\shell\open\command" ""
  StrCmp $0 "" 0 failed
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\Applications\frowd-tauri.exe" "FriendlyAppName"
  StrCmp $0 "" 0 failed
  ; Registration now owned by another install directory is left alone.
  WriteRegStr HKCU "${FROMD_CLASSES_KEY}\fromd.Text\shell\open\command" "" '"${TASK_RENAME_ROOT}\other\frowd-tauri.exe" "%1"'
  WriteRegStr HKCU "${FROMD_CLASSES_KEY}\.txt\OpenWithProgids" "fromd.Text" ""
  !insertmacro NSIS_HOOK_POSTUNINSTALL
  ClearErrors
  ReadRegStr $0 HKCU "${FROMD_CLASSES_KEY}\.txt\OpenWithProgids" "fromd.Text"
  IfErrors failed
  ; Wrong host (e.g. Electron) must not be adopted.
  WriteRegStr HKCU "${FROMD_LEGACY_PRODUCT_KEY}" "" "${TASK_RENAME_ROOT}\legacy"
  WriteRegStr HKCU "${FROMD_LEGACY_UNINSTALL_KEY}" "MainBinaryName" "other.exe"
  StrCpy $FromdLegacyInstall ""
  StrCpy $INSTDIR "$LOCALAPPDATA\fromd"
  Call FromdRestoreLegacyInstall
  StrCmp $INSTDIR "$LOCALAPPDATA\fromd" 0 failed
  ; A user-selected path must not be overridden.
  WriteRegStr HKCU "${FROMD_LEGACY_UNINSTALL_KEY}" "MainBinaryName" "frowd-tauri.exe"
  StrCpy $INSTDIR "${TASK_RENAME_ROOT}\chosen"
  Call FromdRestoreLegacyInstall
  StrCmp $INSTDIR "${TASK_RENAME_ROOT}\chosen" 0 failed
  ; Existing fromd registration wins over an old frowd entry.
  WriteRegStr HKCU "${FROMD_PRODUCT_KEY}" "" "$LOCALAPPDATA\fromd"
  StrCpy $INSTDIR "$LOCALAPPDATA\fromd"
  Call FromdRestoreLegacyInstall
  StrCmp $INSTDIR "$LOCALAPPDATA\fromd" 0 failed
  DeleteRegKey HKCU "Software\fromd-agent-tests\${FROMD_TEST_ID}"
  FileOpen $0 "${TASK_RENAME_ROOT}\result.txt" w
  FileWrite $0 "PASS: legacy directory adopted; registration retained until postinstall; success cleanup; files retained; other host/custom path/current fromd preserved; Open with quoted/no default/own-only uninstall."
  FileClose $0
  SetErrorLevel 0
  Quit
failed:
  DeleteRegKey HKCU "Software\fromd-agent-tests\${FROMD_TEST_ID}"
  FileOpen $0 "${TASK_RENAME_ROOT}\result.txt" w
  FileWrite $0 "FAIL"
  FileClose $0
  SetErrorLevel 1
SectionEnd
