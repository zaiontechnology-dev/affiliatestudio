# CHANGELOG

## 1.0.0 — 2026-11-24 (em desenvolvimento, não publicada)
### Adicionado
- Fundação Electron 45 + React 19 + TypeScript + Tailwind 4 + SQLite (`node:sqlite`) com migrations.
- Cofre de credenciais (safeStorage/DPAPI) e redação de segredos.
- Conector Shopee Affiliate Open API (busca, detalhes, link curto, conversões) com interface padronizada de conectores.
- Registro de marketplaces com capacidades explícitas (ML, SHEIN, Amazon, AliExpress, Magalu, Temu como pendentes; CSV/manual).
- Provedores de distribuição: Telegram Bot API, WhatsApp modo assistido, WhatsApp Cloud API (Groups API).
- Zaion Offer Score com pesos editáveis, redistribuição e confiança.
- Zaion Smart Copy (templates, omissão de campos vazios, identificação publicitária obrigatória, pré-visualização WhatsApp/Telegram).
- Zaion AutoPilot: campanhas (manual/semi/auto), fila persistente idempotente, controle de repetição, janelas e limites por destino, retry com backoff, status desconhecido, recuperação após reinício.
- Zaion Price Radar (histórico real, quedas, favoritos), Zaion Analytics, exportação CSV, comissões.
- IA opcional (Ollama/OpenAI/Anthropic) com validação de saída.
- Interface com 28 telas, tema escuro/claro, bandeja, instância única, autostart opcional, prevenção opcional de suspensão.
- Backup diário/semanal/manual com verificação de integridade e SHA-256; restauração segura.
- Identidade visual (logo “Z”, ícones, imagens do instalador).
- 81 testes automatizados; documentação completa.
