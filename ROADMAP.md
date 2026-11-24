# ROADMAP

| Fase | Conteúdo | Status |
|---|---|---|
| 0 | Diagnóstico e matriz de viabilidade | Concluída no container; **diagnóstico do PC Windows pendente** (`docs/PHASE0_DIAGNOSTICO.md`) |
| 1 | Fundação | Testado |
| 2 | PoC Shopee | Implementado + fixtures · **Dependente de credenciais** |
| 3 | Distribuição (Telegram, WhatsApp) | Telegram implementado (credenciais) · WhatsApp assistido testado · Cloud API dependente de OBA |
| 4 | Automação | Testado |
| 5 | Interface profissional | Implementado |
| 6 | Banco e segurança | Testado |
| 7 | Expansão | Price Radar, Analytics, Smart Copy, IA: implementados · ML/SHEIN/Amazon/AliExpress/Magalu/Temu: **pendentes** |
| 8 | Testes | 81 testes automatizados + E2E no app real · testes no Windows pendentes |
| 9 | Distribuição Windows | `.exe` empacotado + `.zip` · NSIS/portátil **bloqueados no Linux sem Wine** |

## Próximas tarefas (ordem)
1. Publicar código em repositório privado (com autorização) ou copiar para o PC.
2. Build e instalação no Windows; testar bandeja, autostart, suspensão, desinstalação preservando dados.
3. Validar Shopee com credenciais reais; ajustar campos GraphQL se necessário.
4. Validar Telegram com bot/canal próprios.
5. Migrar `safeStorage` para API assíncrona (`encryptStringAsync`/`decryptStringAsync`).
6. Conector AliExpress (Open Platform).
7. Atribuição de conversões por Sub ID (Shopee `utmContent`) → métricas por campanha/grupo.
8. Testes de UI automatizados (Playwright + Electron).
9. Certificado de assinatura de código e atualizações automáticas assinadas.
10. Futuro: SaaS, sincronização em nuvem, mobile, licenciamento (não implementar antes da validação do MVP).
