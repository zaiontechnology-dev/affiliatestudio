# Zaion Affiliate Studio — build completo no Windows 10/11 x64
# Gera: release\Zaion-Affiliate-Studio-Setup-1.0.0-x64.exe, release\Zaion-Affiliate-Studio-Portable-1.0.0-x64.exe e SHA256SUMS.txt
# Pré-requisitos: Node.js 22.12+ (LTS) e Git. Não requer privilégios de administrador.
# Uso (PowerShell, na pasta do projeto):  powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host '== Instalando dependências (npm ci) ==' -ForegroundColor Green
npm ci

Write-Host '== Verificações: tipos, lint e testes ==' -ForegroundColor Green
npm run typecheck
npm run lint
npm test

Write-Host '== Build e empacotamento (NSIS + portátil) ==' -ForegroundColor Green
npm run dist:win

Write-Host '== Checksums ==' -ForegroundColor Green
Get-ChildItem release\*.exe | ForEach-Object {
  $h = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
  "$h  $($_.Name)"
} | Set-Content release\SHA256SUMS.txt -Encoding utf8
Copy-Item docs\RELEASE-NOTES.md release\RELEASE-NOTES.md -Force
Copy-Item USER_GUIDE.md release\USER-GUIDE.md -Force

Get-Content release\SHA256SUMS.txt
Write-Host 'Concluído. Sem certificado de assinatura, o Windows SmartScreen pode exibir um alerta na primeira execução.' -ForegroundColor Yellow
