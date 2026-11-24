# TEST_REPORT — 2026-11-24

Ambiente: container Linux (Ubuntu 24.04), Node 22.23 (Vitest) e Electron 45.4.1/Node 24.22 (app real sob Xvfb).
**Não executado em Windows.** Integrações externas testadas com respostas simuladas (fixtures claramente identificadas) — **não substituem validação real**.

## Resumo
| Verificação | Resultado |
|---|---|
| `npm test` (Vitest) | **81/81 aprovados** (core, banco, integrações, automação, IA, cupons) |
| `npm run typecheck` | Sem erros (main + renderer) |
| `npm run lint` | Sem erros |
| `npm run build` | OK |
| App real (Electron, Xvfb): abertura e 5 telas | OK — nenhum erro de página/console |
| E2E no app real via IPC | OK — ver abaixo |
| Empacotamento Windows (`win-unpacked`, .exe PE com ícone/metadados) | OK |
| Instalador NSIS / portátil | **Não gerado** (exige Wine no Linux; instalação não autorizada) |
| Instalação no Windows (PC do proprietário) | **Aprovado** — app abriu, Dashboard e motor ativos |
| Desinstalação no Windows | Não testado |

## E2E no app real (IPC do processo principal)
Método inexistente rejeitado (`Método não permitido`) · payload inválido rejeitado pelo Zod · produto manual com link → destino WhatsApp assistido
(consentimento confirmado) → pré-visualização com dados reais e identificação publicitária → fila (aguardando aprovação) → aprovar →
publicar agora → `pending` (assistido) → confirmar → histórico com 1 publicação → backup manual → `integrity_check = ok` → dashboard atualizado.
Observação: `safeStorage` indisponível no container (sem chaveiro) → o app corretamente **recusa** salvar credenciais nesse ambiente.

## Cenários obrigatórios (seção 33)
| Cenário | Resultado | Teste |
|---|---|---|
| Marketplace desconectado | Aprovado | sem credenciais → `discover`/`revalidate` ignoram; política `suspend` impede publicação (`política suspender…`) |
| Credencial inválida | Aprovado | `credencial inválida → ConnectorError auth` |
| Credencial expirada | Aprovado | `credencial de outro computador exige nova autenticação`; erro `auth` marca conta como expirada |
| Limite de API atingido | Aprovado | `limite de API → rate_limit`; Telegram `429 é reprocessável` |
| Produto indisponível | Aprovado | `produto indisponível é descartado`; validação Shopee |
| Preço alterado | Aprovado | `produto indisponível/preço alterado na validação` |
| Cupom expirado | Aprovado | `cupom expirado não é usado; cupom válido é` |
| Comissão indisponível | Aprovado | `comissão indisponível não bloqueia` |
| Produto duplicado | Aprovado | `chave única impede produto duplicado`; idempotência da fila |
| Link de afiliado inválido | Aprovado | `gera link curto e só o considera válido se a API devolver URL`; `sem link… não é programada` |
| Grupo sem permissão | Aprovado | `grupo sem permissão: falha definitiva…`; `verifica permissão do bot em canal` |
| Falha de publicação | Aprovado | idem + backoff |
| Status de envio desconhecido | Aprovado | `status desconhecido não é reenviado`; `timeout após envio → unknown` |
| Internet desconectada | Aprovado | `falha temporária… reagenda com backoff`; `internet desconectada → network`; ciclo não roda offline (`net.isOnline`) |
| Computador reiniciado | Aprovado | `Recuperação após reinicialização` |
| App encerrado inesperadamente | Aprovado | idem (`sending → unknown`) |
| Computador suspenso | Implementado | `powerMonitor.resume` → `recover()`; não testado em hardware |
| Campanha pausada | Aprovado | `campanha pausada mantém itens…` |
| Fora da janela permitida | Aprovado | `fora do horário permitido do destino é adiado`; janela/dias |
| Limite diário atingido | Aprovado | `limite diário do destino adia para o dia seguinte` |
| Banco de dados indisponível | Aprovado | `caminho inválido gera erro tratável`; inicialização mostra diálogo de erro |
| Backup corrompido | Aprovado | `backup corrompido é rejeitado`; `checksum adulterado` |
| IA desconectada | Aprovado | `IA desconectada: retorna problema…`; validação de saída da IA |

## Pendências de teste
- Execução no Windows 10/11 (instalação, bandeja, autostart, notificações, DPAPI, suspensão, desinstalação preservando dados).
- Integrações reais (Shopee, Telegram, WhatsApp Cloud).
- Testes automatizados de interface; teste de desempenho com catálogo grande.
