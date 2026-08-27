!macro NSIS_HOOK_POSTUNINSTALL
  ; Tauri clears its bundle-id AppData directories. 302 Switch keeps its
  ; actual default data under the user's profile, so clear that directory too
  ; only when the user selected "Delete the application data".
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RMDir /r "$PROFILE\.302-cc-switch"
  ${EndIf}
!macroend
