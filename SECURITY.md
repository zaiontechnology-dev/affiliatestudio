# SECURITY — Zaion Affiliate Studio

## Controles implementados
| Requisito | Implementação |
|---|---|
| Credenciais nunca em texto puro | `SecretStore` + Electron `safeStorage` (Windows: DPAPI do usuário). Sem fallback: se indisponível, não salva. |
| Tokens fora de logs | `security/redact.ts` (tokens de bot, Bearer, Signature, `sk-…`, chaves sensíveis) aplicado a logs e erros IPC |
| Sem credenciais no código/Git | Inseridas apenas pela interface; `.gitignore` cobre `.env`, `*.db` |
| Validação de entradas | Zod em todos os métodos IPC; URLs só http(s) sem usuário/senha |
| SQL injection | Consultas parametrizadas; `VACUUM INTO ?` parametrizado |
| XSS | React (escape automático); nenhum `dangerouslySetInnerHTML`; mensagens em texto puro |
| Isolamento do renderer | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload mínimo |
| CSP | Meta tag + cabeçalho: `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'` (imagens https permitidas) |
| Navegação | `will-navigate` bloqueado; `window.open` negado (https abre no navegador padrão) |
| Permissões web | Todas negadas (`setPermissionRequestHandler`) |
| Origem do IPC | Aceita apenas da janela principal e URL do app |
| Execução de comandos | Nenhum `child_process`; arquivos só via diálogos nativos |
| Conteúdo externo | `sanitizeExternalText` (controle/bidi), limite de tamanho; prompt de IA trata dados como não confiáveis + validação de saída |
| GraphQL injection | Strings serializadas com `JSON.stringify`; IDs validados como numéricos |
| CSV injection | Exportação neutraliza `= + - @` |
| Telemetria | Nenhuma |
| Backups | Credenciais permanecem cifradas (DPAPI); exportação de configurações exclui credenciais e desativa autorização de destinos |
| LGPD / consentimento | Destino exige confirmação explícita de autorização; sem coleta de contatos; sem disparos em massa |

## Riscos conhecidos
- `safeStorage` síncrono está deprecado no Electron 45 (ainda funcional) → migrar para API assíncrona.
- Sem assinatura de código: SmartScreen pode alertar. Não desative proteções do Windows; obtenha certificado para distribuição.
- `npm audit` reporta avisos em dependências de desenvolvimento (cadeia de build); revisar antes de distribuir comercialmente.
- Versão portátil: dados em `ZaionData` ao lado do .exe; credenciais só abrem no mesmo usuário do Windows.
