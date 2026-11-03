; Installer hooks for the Windows bundle.
;
; WHY THIS EXISTS. The sidecar is installed by name (`dvv.exe`, from
; `bundle.externalBin`), and Windows will not overwrite a running executable.
; `dvv` stays resident: agent holders, one per `dvv open`, and one MCP server
; per agent that spawned it. A silent (`/S`) or passive (the updater's
; `installMode`) install therefore copies everything except `dvv.exe`, reports
; success, and leaves the OLD sidecar beside the NEW application. That is the
; worst kind of mismatch: the two halves are a protocol, and the failure
; presents later as a tool that answers wrongly rather than as an install that
; failed.
;
; So the installer stops them first. An agent that was mid-task loses its MCP
; server and reconnects on its next call - which is recoverable - while a stale
; sidecar is not.
;
; `taskkill` names the image, not a path, for the same reason the problem is
; stated that way: the holder may have been started from either install
; location (`%LOCALAPPDATA%\OraxDesk` or `C:\Program Files\OraxDesk`), and both
; must go. The process runs as the same user, so no elevation is involved.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping dvv (the running sidecar is what blocks an upgrade)"
  nsExec::Exec 'taskkill /F /IM dvv.exe'
  Pop $0
!macroend
