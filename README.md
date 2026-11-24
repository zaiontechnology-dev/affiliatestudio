# Zaion Affiliate Studio — Desktop Edition

**Inteligência que transforma ofertas em resultados.**

Central local (Windows 10/11 x64) de automação de marketing de afiliados: encontra produtos reais por APIs oficiais,
classifica com o Zaion Offer Score, gera links comissionados oficiais, cria mensagens com identificação publicitária
e distribui em canais autorizados — sem nuvem, sem VPS, sem mensalidade de infraestrutura.

> Status atual e o que ainda depende de credenciais: **[PROJECT_STATUS.md](PROJECT_STATUS.md)**.

## Recursos
- Garimpo inteligente (Shopee Affiliate Open API) · Catálogo · Favoritos · importação CSV · cadastro manual
- Zaion Offer Score (0–100, pesos editáveis, nível de confiança)
- Zaion Price Radar (histórico real, quedas de preço)
- Gerador de links oficiais com Sub IDs
- Telegram (Bot API) · WhatsApp modo assistido · WhatsApp Cloud API (Groups API, OBA)
- Zaion AutoPilot: campanhas manual/semiautomática/automática, fila persistente, anti-repetição, janelas, limites, recuperação
- Zaion Smart Copy: templates + IA opcional (Ollama/OpenAI/Anthropic) com validação anti-invenção
- Dashboard, Analytics, relatórios CSV, comissões oficiais
- Bandeja do Windows, inicialização automática, backups automáticos, logs e auditoria

## Desenvolvimento
```bash
npm install
npm run dev
npm test && npm run typecheck && npm run lint
```

## Gerar instalador (no Windows)
```bash
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```
Saída em `release/`: `Zaion-Affiliate-Studio-Setup-1.0.0-x64.exe`, `Zaion-Affiliate-Studio-Portable-1.0.0-x64.exe`, `SHA256SUMS.txt`.

## Documentação
[INSTALLATION](INSTALLATION.md) · [USER_GUIDE](USER_GUIDE.md) · [INTEGRATIONS](INTEGRATIONS.md) · [API_CAPABILITIES](API_CAPABILITIES.md) ·
[ARCHITECTURE](ARCHITECTURE.md) · [SECURITY](SECURITY.md) · [TEST_REPORT](TEST_REPORT.md) · [TROUBLESHOOTING](TROUBLESHOOTING.md) ·
[ROADMAP](ROADMAP.md) · [CHANGELOG](CHANGELOG.md) · [CLAUDE.md](CLAUDE.md)

Código proprietário — © 2026 Zaion Technology. Todos os direitos reservados.
