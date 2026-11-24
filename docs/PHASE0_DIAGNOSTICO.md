# Fase 0 — Diagnóstico do ambiente e matriz de viabilidade (2026-11-24)

## Ambiente efetivamente disponível
| Item | Resultado |
|---|---|
| Onde o Claude Code executou | **Container Linux na nuvem** (Ubuntu 24.04, x86_64, 4 vCPU, 15 GB RAM, ~61 GB livres) |
| Computador Windows do proprietário | **Não conectado** (nenhuma pasta compartilhada via Remote Control) |
| Node.js / npm / pnpm / Git | 22.23.5 / 10.9.9 / 10.28.0 / 2.43.0 (no container) |
| GPU | Não aplicável no container |
| Electron (Node embutido) | 45.4.1 (Node 24.22.3) — `node:sqlite` disponível |
| Wine (para NSIS no Linux) | Ausente; instalação **não autorizada** pelo controle de permissões |

**Consequência**: diagnóstico de RAM/GPU/VRAM/disco do PC Windows, instalação e testes no Windows ficaram pendentes.
O app possui diagnóstico de hardware embutido (*Sistema → Inteligência artificial*) que roda no PC do usuário.

## Matriz de viabilidade
| Requisito | Viável? | Observação |
|---|---|---|
| App desktop local Windows | Sim | Electron + NSIS |
| Banco local, backups | Sim | SQLite embutido |
| Credenciais seguras | Sim | DPAPI via safeStorage |
| Shopee: busca + link + conversões | Sim, com aprovação da Open API | Credenciais do proprietário necessárias |
| Mercado Livre, SHEIN, Magalu, Temu: automação | Não por API oficial de afiliados | CSV/manual |
| Amazon | Restrito (vendas qualificadas) | Pendente |
| AliExpress | Sim (Open Platform) | Fase 7 |
| Telegram automático | Sim | Bot API |
| WhatsApp automático em grupos existentes | **Não** (sem API oficial) | Modo assistido |
| WhatsApp automático (Groups API) | Sim, com OBA e grupos criados via API | Custo por mensagem |
| IA local | Sim, opcional | Depende do hardware |
| Operar com PC desligado | Não | Limitação inerente a app local |

## Riscos e bloqueios
1. Integrações reais dependem de credenciais/aprovações externas.
2. Campos GraphQL da Shopee precisam de revalidação com a doc do portal (acesso com login).
3. Instalador NSIS precisa ser gerado em Windows (ou Linux com Wine).
4. Container efêmero: código precisa ser publicado/baixado.
