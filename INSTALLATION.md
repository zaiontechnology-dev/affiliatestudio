# INSTALLATION

## Requisitos
- Windows 10 ou 11, 64 bits · ~600 MB livres · internet para as integrações.
- Não requer privilégios de administrador (instalação por usuário).

## Instalador (recomendado)
1. Execute `Zaion-Affiliate-Studio-Setup-1.0.0-x64.exe`.
2. Sem certificado de assinatura, o **SmartScreen** pode mostrar “O Windows protegeu o computador” → *Mais informações* → *Executar assim mesmo*. Confira antes o SHA-256 em `SHA256SUMS.txt` (`Get-FileHash arquivo.exe`).
3. Escolha a pasta (padrão: `%LOCALAPPDATA%\Programs\Zaion Affiliate Studio`). Atalhos na área de trabalho e no menu Iniciar são criados.

## Versão portátil
Execute `Zaion-Affiliate-Studio-Portable-1.0.0-x64.exe`. Os dados ficam em `ZaionData\` ao lado do executável.
As credenciais são protegidas pela DPAPI e **só abrem no mesmo usuário do Windows** — em outro PC será pedido nova autenticação.

## Pacote ZIP (gerado nesta sessão)
`Zaion-Affiliate-Studio-1.0.0-x64-win.zip`: extraia e execute `Zaion Affiliate Studio\ZaionAffiliateStudio.exe`. Funciona como instalação sem instalador (dados em `%APPDATA%`). Sem atalhos/desinstalador.

## Onde ficam os dados
`%APPDATA%\Zaion Affiliate Studio\` → `zaion-affiliate-studio.db`, `backups\`, `exports\`, `logs\`.
Separados da pasta de instalação: **atualizações e desinstalação preservam os dados**.

## Atualizar
Instale a nova versão por cima (mesmo instalador). O banco é migrado automaticamente; faça um backup manual antes por precaução.

## Desinstalar
*Configurações do Windows → Aplicativos → Zaion Affiliate Studio → Desinstalar*. Os dados em `%APPDATA%` são mantidos; apague a pasta manualmente se desejar.

## Compilar a partir do código
Ver `README.md` (requer Node.js 22.12+).
