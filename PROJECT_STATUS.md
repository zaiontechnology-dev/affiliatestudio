# PROJECT_STATUS — Zaion Affiliate Studio 1.0.0

Atualizado: 2026-11-24 · Sessão 1 (Claude Code, container Linux na nuvem)

Legenda: **Validado** (testado em condição real) · **Testado** (testes automatizados/fixtures) · **Implementado** · **Dependente de credenciais** · **Bloqueado** · **Indisponível por restrição externa** · **Pendente**

## ⚠️ Contexto desta sessão
- O desenvolvimento ocorreu em um **container Linux na nuvem**, não no computador Windows do proprietário (nenhuma máquina foi conectada via Remote Control).
  Por isso: diagnóstico do hardware real, instalação e teste no Windows **não foram feitos**.
- O container é efêmero: o código está em `/home/user/zaion-affiliate-studio` com commits **locais**. Precisa ser copiado/publicado antes do fim da sessão (aguardando autorização do proprietário).
- Nenhuma credencial real foi fornecida → integrações reais **não validadas**.

## Critérios de aceitação (seção 32)
| # | Critério | Status | Evidência / observação |
|---|---|---|---|
| 1 | Abertura normal no Windows | Pendente | App abre e funciona no Electron/Linux (Xvfb). `.exe` Windows empacotado, não executado em Windows. |
| 2 | Persistência das configurações | Testado | `tests/database.test.ts`; E2E no app real |
| 3 | Banco local funcional | Testado | migrations, integridade, transações, E2E |
| 4 | Credenciais seguras | Implementado / Testado (lógica) | safeStorage/DPAPI; recusa texto puro. DPAPI real só no Windows. |
| 5 | Integração real com 1 marketplace | Dependente de credenciais | Conector Shopee completo, testado com fixtures |
| 6 | Busca de produtos reais | Dependente de credenciais | idem |
| 7 | Links de afiliado válidos | Dependente de credenciais | `generateShortLink` implementado |
| 8 | Mensagens promocionais | Testado | Smart Copy + E2E |
| 9 | Canal autorizado funcional | Dependente de credenciais | Telegram implementado e testado com fixtures; WhatsApp assistido **testado E2E** |
| 10 | Cadastro de campanhas | Testado | |
| 11 | Agendamento automático | Testado | ciclo 30 s, janelas, dias, fuso |
| 12 | Publicação em intervalos | Testado | intervalo mínimo por destino, 1 envio/destino/ciclo |
| 13 | Controle de repetidos | Testado | período, nunca repetir, queda de preço, idempotência |
| 14 | Registro de publicações | Testado | publications + publication_attempts |
| 15 | Tratamento de falhas | Testado | retry/backoff, unknown, permissões, offline |
| 16 | Funcionamento minimizado | Implementado | bandeja + motor independente da janela; não testado no Windows |
| 17 | Recuperação após reinício | Testado | `recover()` |
| 18 | Backup e restauração | Testado | VACUUM INTO + integrity_check + SHA-256 + restauração agendada |
| 19 | Instalador Windows | **Bloqueado aqui** | NSIS exige Wine no Linux (instalação negada). Gerar com `scripts/build-windows.ps1` no Windows. Entregue `.zip` do app. |
| 20 | Manual de utilização | Implementado | `USER_GUIDE.md` |
| WA | WhatsApp em grupos tradicionais | Indisponível por restrição externa (automático) · Testado (assistido) | ver `INTEGRATIONS.md` |

**O MVP NÃO está concluído**: itens 1, 5, 6, 7, 9 (real) e 19 dependem de credenciais ou de uma máquina Windows.

## Módulos
| Módulo | Status |
|---|---|
| Fundação (Electron/React/TS/Tailwind/SQLite/testes/lint) | Testado |
| Banco, migrations, repositório | Testado |
| Cofre de credenciais | Testado (lógica) |
| Conector Shopee (Affiliate Open API) | Testado com fixtures · Dependente de credenciais |
| Mercado Livre, SHEIN, Amazon, AliExpress, Magalu, Temu | Pendente (CSV/manual funcionam) |
| Telegram Bot API | Testado com fixtures · Dependente de credenciais |
| WhatsApp modo assistido | Testado (E2E) |
| WhatsApp Cloud API (Groups) | Implementado · Dependente de aprovação OBA |
| Zaion Offer Score | Testado |
| Zaion AutoPilot (campanhas, fila, modos, recuperação) | Testado |
| Zaion Smart Copy + templates | Testado |
| Zaion Price Radar | Implementado (histórico real; atualização depende de integração) |
| Zaion Analytics / relatórios CSV | Implementado |
| Conversões Shopee (conversionReport) | Implementado · Dependente de credenciais |
| IA opcional (Ollama/OpenAI/Anthropic) | Testado (falhas e validação de saída) · não executado com provedor real |
| Interface (28 telas, tema claro/escuro) | Implementado · verificado por screenshots |
| Bandeja, instância única, autostart, prevenção de suspensão | Implementado · não testado no Windows |
| Backup/restauração | Testado |
| Empacotamento Windows | `.exe` empacotado + `.zip`; NSIS/portátil Bloqueado aqui |

## 📍 Ponto de retomada
1. **Preservar o código**: o proprietário deve autorizar publicação em repositório privado (GitHub) ou baixar o projeto.
2. No Windows: `powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1` → instalar → testar critérios 1, 16, 19.
3. Inserir credenciais Shopee (App ID/Secret) em *Contas de afiliados* → validar busca real, link real (critérios 5–7) e **revalidar nomes de campos** com a documentação do portal (`API_CAPABILITIES.md`).
4. Criar bot do Telegram + canal de teste próprio → autorizar envio de teste → ativar campanha em modo semiautomático (critério 9).
5. Próximo desenvolvimento: migrar para `safeStorage` assíncrono; conector AliExpress; testes de UI automatizados; assinatura de código.
