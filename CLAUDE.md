# CLAUDE.md — Zaion Affiliate Studio (Desktop Edition)

> Leia este arquivo e `PROJECT_STATUS.md` antes de qualquer alteração. **Nunca reinicie o projeto do zero.**

## Objetivo
Aplicação desktop Windows (local, sem nuvem) que automatiza marketing de afiliados: encontra produtos reais
por APIs oficiais, classifica com o **Zaion Offer Score**, gera links de afiliado oficiais, cria mensagens
(**Zaion Smart Copy**), agenda e distribui em canais autorizados (**Zaion AutoPilot**), com histórico,
Price Radar, Analytics, backup e segurança. Slogan: *Inteligência que transforma ofertas em resultados.*

## Stack
- Electron 45 (Node 24 embutido) · electron-vite 6 · Vite 8 · React 19 · TypeScript 5.9 · Tailwind CSS 4 · Recharts · Lucide
- Banco: **SQLite via `node:sqlite`** (embutido no Electron — sem módulo nativo, sem recompilação por plataforma)
- Validação: Zod 4 · Testes: Vitest 5 · Lint: ESLint 10 + typescript-eslint
- Empacotamento: electron-builder 26 (NSIS + portable x64)
- IA opcional: Ollama (local), OpenAI (fetch), Anthropic (`@anthropic-ai/sdk`, modelo padrão `claude-opus-5-5`, editável)

## Arquitetura (camadas)
| Camada | Pasta | Observações |
|---|---|---|
| Apresentação | `src/renderer` | React; acesso ao backend **somente** por `window.zaion.call(method,args)` |
| Ponte | `src/preload` | contextBridge mínimo (invoke + eventos) |
| Aplicação / IPC | `src/main/api.ts` | whitelist de métodos, **todos validados com Zod** |
| Ciclo de vida | `src/main/index.ts`, `context.ts` | janela, bandeja, instância única, agendador, backups, CSP |
| Domínio puro | `src/core` | offer-score, smart-copy, urls, schedule (sem I/O, 100% testável) |
| Integração | `src/integrations` | conectores de marketplace (interface padronizada) e provedores de canal |
| Automação | `src/automation/autopilot.ts` | seleção → validação → link → mensagem → fila → envio → registro; recuperação |
| Inteligência | `src/intelligence/ai-copy.ts` | IA opcional com validação de saída |
| Persistência | `src/database` | migrations versionadas, `Repository` |
| Segurança | `src/security` | cofre (safeStorage/DPAPI), redação de segredos |
| Serviços | `src/services` | backup/restauração, CSV |

## Regras de negócio essenciais
1. **Nunca inventar dados**: preço anterior, desconto, comissão, avaliação, vendas, cupons, cliques — só de fonte real. Campos ausentes = `null` e são omitidos nas mensagens.
2. Offer Score: critérios sem dado têm peso redistribuído **e** a nota é encolhida para 40 conforme a confiança cai (`final = min(raw, raw*conf + 40*(1-conf))`).
3. Sem oferta válida → não publica nada.
4. Link de afiliado: só é "válido" se gerado pelo mecanismo oficial; manual = "não verificado". Sem link → não enfileira.
5. Revalidação de preço/disponibilidade antes de enfileirar; política padrão `suspend` quando não for possível.
6. Fila: transições atômicas (compare-and-set), chave de idempotência única; `sending` interrompido → `unknown` (nunca reenviado automaticamente); atrasados além da tolerância → `expired` (sem disparo em lote).
7. Destino: janela de horário, intervalo mínimo, limite diário e **consentimento confirmado** obrigatórios; no máximo 1 envio por destino por ciclo.
8. Toda mensagem contém a identificação publicitária configurada.
9. WhatsApp: grupos tradicionais = **modo assistido** (copiar + notificar + confirmar manualmente). Cloud API só para grupos criados via Groups API (OBA). Nada de bibliotecas não oficiais.
10. Nenhuma mensagem real de teste sem confirmação explícita na interface.

## Padrões de código
- TypeScript estrito, `noUncheckedIndexedAccess` no backend. Dinheiro em **centavos inteiros**; datas em **ISO UTC**; exibição em `America/Sao_Paulo`.
- SQL sempre parametrizado; strings SQL com aspas simples (DQS desabilitado).
- Conteúdo externo (títulos, descrições) = dado não confiável: `sanitizeExternalText`, mensagens em texto puro (Telegram sem `parse_mode`).
- Erros de conector: `ConnectorError(code)` → status da conta (`auth`→expirada, `rate_limit`→limite, `network`→erro).
- Interface em pt-BR; nenhum botão decorativo — ações indisponíveis mostram o motivo.

## Padrões visuais
Paleta: fundo `#0B1120`, superfícies `#111827`, cards `#1A2435`, verde Zaion `#10B981`, texto `#F8FAFC`/`#94A3B8`, bordas `#263244`,
sucesso `#22C55E`, alerta `#F59E0B`, erro `#EF4444`. Tokens CSS em `src/renderer/src/styles.css` (tema claro via `[data-theme=light]`).
Fonte Inter (empacotada, sem CDN). Logo: “Z” com terminais inclinados (`assets/brand/*.svg`); ícones gerados por `scripts/generate-icons.cjs`.

## Banco de dados
Arquivo `zaion-affiliate-studio.db` em `%APPDATA%\Zaion Affiliate Studio\` (portátil: `ZaionData\` ao lado do .exe).
Tabelas: ver `src/database/migrations.ts` (settings, secrets, marketplaces, marketplace_accounts, integration_capabilities, products,
product_categories, product_images, product_price_history, product_commissions, coupons, affiliate_links, favorites, blocked_products,
blocked_sellers, audience_profiles, channels, channel_accounts, destinations, message_templates, campaigns, campaign_rules,
campaign_destinations, automation_jobs, publication_queue, publications, publication_attempts, analytics, conversions, commissions,
application_logs, audit_logs, backups, migrations). **Nova mudança de schema = nova migration** (nunca editar a v1).

## Comandos
```bash
npm install            # dependências
npm run dev            # app em modo desenvolvimento
npm test               # testes (Vitest)
npm run typecheck      # tsc main+renderer
npm run lint           # ESLint
npm run build          # build de produção (out/)
npm run dist:win       # instalador NSIS + portátil (rodar no Windows; no Linux exige Wine)
node scripts/generate-icons.cjs   # regenera ícones (requer Playwright)
```

## Decisões técnicas
Ver `ARCHITECTURE.md` § Decisões. Resumo: `node:sqlite` em vez de better-sqlite3 (evita build nativo cruzado); IPC único com whitelist+Zod;
fila no SQLite em vez de node-cron (ciclo de 30 s + estados persistentes → recuperação simples); safeStorage síncrono (deprecado no Electron 45, migrar para API assíncrona).

## Implementado / pendente / restrições
Ver `PROJECT_STATUS.md` (fonte da verdade) e `ROADMAP.md`.

## Critérios de aceitação
Ver seção 32 do prompt mestre, reproduzida em `PROJECT_STATUS.md` com o status de cada item.
