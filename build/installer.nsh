; Zaion Affiliate Studio — personalizações do instalador NSIS
!macro customInstall
  ; Registra o protocolo de identificação do app para notificações do Windows (AppUserModelID já definido pelo electron-builder)
!macroend

!macro customUnInstall
  ; Remove a entrada de inicialização automática, se existir. Dados em %APPDATA% são preservados.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.zaion.affiliatestudio"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Zaion Affiliate Studio"
!macroend
