; Tauri deletes every bundled resource file but can leave the empty sidecar
; folder behind; remove it (and then the install folder if it is empty) so the
; uninstall leaves no trace. A sidecar that is still exiting can hold its DLL,
; so schedule those two files for deletion at the next reboot.
!macro NSIS_HOOK_POSTUNINSTALL
  Delete /REBOOTOK "$INSTDIR\waifu2x\vcomp140.dll"
  Delete /REBOOTOK "$INSTDIR\waifu2x\waifu2x-ncnn-vulkan.exe"
  RMDir /REBOOTOK "$INSTDIR\waifu2x"
  RMDir "$INSTDIR"
!macroend
