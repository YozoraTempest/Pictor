; The real Electron executable is intentionally not used as the Windows
; shortcut target. The console launcher clears inherited
; ELECTRON_RUN_AS_NODE before entering the GUI, so a desktop or Start Menu
; launch has the same safe GUI semantics as a terminal launch.
!macro customInstall
  ${ifNot} ${isNoDesktopShortcut}
    Delete "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$INSTDIR\bin\pictor.cmd" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}

  Delete "$newStartMenuLink"
  CreateShortCut "$newStartMenuLink" "$INSTDIR\bin\pictor.cmd" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
!macroend
