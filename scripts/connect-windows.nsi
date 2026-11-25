Unicode True
Name "Margin Connect"
OutFile "${WORK}/Margin-Connect-Windows.exe"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Margin\Connect"
!include "LogicLib.nsh"
!include "x64.nsh"
!define HOST "dev.margin.connect"
!define ARP "Software\Microsoft\Windows\CurrentVersion\Uninstall\MarginConnect"
!ifdef CERT
  !finalize 'signtool sign /sha1 ${CERT} /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 "%1"' = 0
  !uninstfinalize 'signtool sign /sha1 ${CERT} /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 "%1"' = 0
!endif
AllowSkipFiles off
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles
UninstallText "Disconnect both accounts and remove Margin Connect for Chrome and Edge for this Windows user."

Section
  SetOutPath "$INSTDIR"
  ${If} ${IsNativeARM64}
    File /oname=MarginConnect.exe "${WORK}/arm64.exe"
  ${ElseIf} ${RunningX64}
    File /oname=MarginConnect.exe "${WORK}/amd64.exe"
  ${Else}
    MessageBox MB_OK "Margin Connect requires 64-bit Windows." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  File /oname=host.json "${WORK}/host.json"
  File /r "${WORK}/Licenses"
  Delete "$INSTDIR\removing"
  ClearErrors
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\${HOST}" "" "$INSTDIR\host.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\${HOST}" "" "$INSTDIR\host.json"
  WriteRegStr HKCU "${ARP}" "DisplayName" "Margin Connect"
  WriteRegStr HKCU "${ARP}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  ${If} ${Errors}
    MessageBox MB_OK "Margin Connect could not finish browser registration. Run the installer again." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
SectionEnd

Section "Uninstall"
  ClearErrors
  ExecWait '"$INSTDIR\MarginConnect.exe" --remove-accounts' $0
  IfErrors cleanupFailed
  ${If} $0 == 2
    MessageBox MB_OK "Signed out locally. Confirm disconnection in ChatGPT Settings." /SD IDOK
  ${ElseIf} $0 != 0
    Goto cleanupFailed
  ${EndIf}
  ClearErrors
  Delete "$INSTDIR\MarginConnect.exe"
  IfErrors cleanupFailed
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\${HOST}"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\${HOST}"
  DeleteRegKey HKCU "${ARP}"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\host.json"
  Delete "$INSTDIR\host.lock"
  Delete "$INSTDIR\removing"
  Delete "$INSTDIR\session.lock"
  Delete "$INSTDIR\DeepSeek\session.lock"
  RMDir "$INSTDIR\DeepSeek"
  RMDir /r "$INSTDIR\Licenses"
  RMDir "$INSTDIR"
  Goto done
cleanupFailed:
  MessageBox MB_OK "Close active Margin sessions, check access to saved credentials, then run Uninstall again." /SD IDOK
  SetErrorLevel 1
  Abort
done:
SectionEnd
