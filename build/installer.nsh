!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Snip AI requires 64-bit Windows 10 or Windows 11."
    Quit
  ${EndIf}
!macroend

!macro customInstall
  DetailPrint "Checking bundled Snip AI speech and video engines..."
  ClearErrors
  ExecWait '"$INSTDIR\resources\windows-runtime\python\pythonw.exe" "$INSTDIR\resources\windows-runtime\pipeline\runtime_check.py" --runtime "$INSTDIR\resources\windows-runtime" --output "$LOCALAPPDATA\Snip AI\diagnostics\installer-runtime-check.json"' $0
  ${If} ${Errors}
    StrCpy $0 1
  ${EndIf}
  ${If} $0 != 0
    DetailPrint "Repairing Microsoft Visual C++ runtime from the offline installer..."
    ClearErrors
    ExecShellWait "runas" "$INSTDIR\resources\windows-runtime\prerequisites\VC_redist.x64.exe" "/install /passive /norestart" SW_SHOWNORMAL
    ExecWait '"$INSTDIR\resources\windows-runtime\python\pythonw.exe" "$INSTDIR\resources\windows-runtime\pipeline\runtime_check.py" --runtime "$INSTDIR\resources\windows-runtime" --output "$LOCALAPPDATA\Snip AI\diagnostics\installer-runtime-check.json"' $0
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Snip AI runtime verification did not pass. Restart Windows if Microsoft Runtime requested it, then run setup again. Diagnostic report: $LOCALAPPDATA\Snip AI\diagnostics\installer-runtime-check.json"
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    release_snip_license:
    ClearErrors
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --release-license-on-uninstall' $0
    ${If} ${Errors}
      StrCpy $0 1
    ${EndIf}
    ${If} $0 != 0
      ${If} ${Silent}
        SetErrorLevel 1
        Abort
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Snip AI could not release this computer. Connect to the internet and retry. Cancel keeps Snip AI installed and your key bound to this device." IDRETRY release_snip_license
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
!macroend
