# Arquitetura — Zaion Affiliate Studio

```
┌──────────────────────── Renderer (React, sandbox, sem Node) ────────────────────────┐
│ Shell + 28 telas · componentes UI · Recharts · window.zaion.call(method, args)      │
└───────────────────────────────▲─────────────────────────────────────────────────────┘
                                │ IPC 'zaion:call' (invoke) — origem verificada
┌───────────────────────────────┴──── Preload (contextBridge mínimo) ─────────────────┐
└───────────────────────────────▲─────────────────────────────────────────────────────┘
┌───────────────────────────────┴──── Main process ───────────────────────────────────┐
│ main/index.ts  ciclo de vida, janela, bandeja, CSP, agendador (30 s), backups        │
│ main/api.ts    whitelist de métodos + Zod → Repository / Autopilot / Conectores      │
│                                                                                      │
│ automation/autopilot.ts ─ seleção ─ score ─ dedup ─ revalidação ─ link ─ copy ─ fila │
│        │                                   │                                         │
│ integrations/marketplaces (Shopee, …)      integrations/channels (Telegram, WhatsApp)│
│ intelligence/ai-copy (opcional)            security (SecretStore, redact)            │
│ database (node:sqlite, migrations, Repository)   services (backup, csv)             │
│ core (puro: offer-score, smart-copy, urls, schedule)                                 │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## Fluxo do AutoPilot (por ciclo de 30 s, se ativado)
1. Para cada campanha ativa (não manual) com `next_run_at` vencido: verifica janela/dias/limite diário.
2. `discover`: busca produtos nas integrações oficiais conectadas (até 2 palavras-chave por execução, em rodízio) e grava no catálogo + histórico de preço.
3. `rankCandidates`: filtros da campanha + Offer Score (com compatibilidade do perfil de audiência do destino) ≥ mínimo.
4. Para o melhor candidato com destino elegível (controle de repetição): `revalidate` na fonte oficial → `resolveLink` (API oficial ou link manual) → `renderOfferMessage` → `enqueue` (auto: `scheduled`; semi: `awaiting_approval`) no próximo horário permitido do destino.
5. `processQueue`: itens vencidos → verificações do destino (janela, limite diário, intervalo) → `sending` (CAS) → provedor → `sent` / `scheduled` (retry com backoff) / `failed` / `unknown` / `pending` (assistido).
6. Sem oferta válida: registra motivo e agenda próxima execução; nada é publicado.

## Máquina de estados da fila
```
awaiting_approval ─aprovar→ scheduled ─vence→ sending ─┬→ sent
pending (assistido) ─confirmar→ sent                    ├→ scheduled (falha temporária, backoff)
                                                        ├→ failed (definitiva)
                                                        ├→ unknown (sem resposta; confirmação manual)
                                                        └→ pending (modo assistido)
reinício: sending→unknown · validating/processing→scheduled · scheduled atrasado>tolerância→expired
```

## Decisões técnicas
| Decisão | Motivo |
|---|---|
| `node:sqlite` (embutido) em vez de better-sqlite3 | Elimina compilação nativa por versão do Electron/arquitetura; build Windows reproduzível a partir de qualquer SO. API síncrona equivalente, `VACUUM INTO` para backup. |
| Agendador próprio (ciclo de 30 s) + estado no SQLite em vez de node-cron | Toda a programação já é dado persistido (`next_run_at`, `scheduled_at`); um ciclo simples torna a recuperação após reinício trivial e testável com relógio injetado. |
| IPC único com whitelist + Zod | Superfície mínima, validação centralizada, erros redigidos. |
| electron-vite | Build integrado de main/preload/renderer com Vite. |
| Texto puro nas mensagens | Impede que títulos externos injetem formatação/links (Telegram sem `parse_mode`). |
| Mensagens de teste somente com `confirm: true` | Exigência: nenhum envio real sem autorização explícita. |
| Shadcn/UI não utilizado | Componentes equivalentes próprios (Tailwind) em `components/ui.tsx` — menos dependências, mesmo resultado visual. |
| safeStorage síncrono | Disponível no Electron 45 (deprecado). Migração para API assíncrona registrada no ROADMAP. |
| SDK oficial Anthropic | Conforme recomendação do provedor para projetos TypeScript; modelo editável pelo usuário. |

## Extensão
- **Novo marketplace**: implementar `BaseConnector` (`integrations/marketplaces/types.ts`), declarar `MarketplaceInfo.capabilities`, registrar em `ConnectorRegistry`.
- **Novo canal**: implementar `DistributionProvider` (`integrations/channels/types.ts`) e adicionar em `context.ts` + tabela `channels`.
- **SaaS futuro**: `core/` e `automation/` não dependem de Electron; `Repository` isola SQL.
