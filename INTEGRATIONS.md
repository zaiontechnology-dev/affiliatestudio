# INTEGRATIONS — análise e uso das integrações

## Shopee (prioridade 1)
1. Tenha cadastro aprovado no Programa de Afiliados Shopee Brasil.
2. No portal de afiliados, seção **Open API**, solicite acesso (aprovação da Shopee).
3. No Zaion: *Integrações → Contas de afiliados → Shopee → Conectar*, informe App ID e Secret. O teste executa uma consulta mínima.
4. Use *Garimpo inteligente* para buscar; *Gerador de links* para links curtos oficiais; *Comissões → Sincronizar* para conversões.

## Demais marketplaces
Sem API oficial implementada nesta versão. Fluxo autorizado: gere o link no portal do programa → cadastre o produto (*Catálogo → Cadastrar produto*) com o link, ou importe CSV exportado do programa (colunas reconhecidas: nome/título, link/url, preço, preço anterior, comissão %, link de afiliado, imagem, categoria, cupom, vendas, avaliação). Nenhum scraping é utilizado.

## Telegram (canal recomendado para validar o motor)
1. No Telegram, fale com **@BotFather** → `/newbot` → copie o token.
2. Adicione o bot ao seu canal (como **administrador com permissão de publicar**) ou grupo.
3. *Integrações → Telegram*: cole o token → **Conectar e validar**.
4. *Grupos e canais → Novo destino*: identificador `@seucanal` (público) ou ID numérico `-100…`; marque a confirmação de autorização; clique **Verificar permissões**.
5. **Testar envio** só envia após sua confirmação explícita.

## WhatsApp — análise técnica (nov/2026)
| Opção | Grupos tradicionais existentes? | Requisitos | Custo | Status no Zaion |
|---|---|---|---|---|
| WhatsApp Business Platform — Cloud API + **Groups API** | **Não** — só grupos criados pela empresa via API, participantes por convite | Official Business Account (OBA); número da Cloud API (não do app Business); token de System User | Por mensagem | Implementado (`whatsapp_cloud`), **dependente de aprovação** |
| Bibliotecas não oficiais (WhatsApp Web) | Sim, tecnicamente | Violam os Termos do WhatsApp; risco de banimento | — | **Não implementado** (vedado) |
| **Modo assistido** | Sim (publicação manual) | Nenhum | Gratuito | **Implementado e testado** |

**Modo assistido**: no horário programado o Zaion copia a mensagem para a área de transferência e mostra uma notificação. Você cola no grupo e clica *Marcar como publicada* na fila. O controle de repetição, intervalos e histórico funcionam normalmente.

Fontes: [Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/), [Get started with Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/get-started/), [Group messaging](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/).

## IA (opcional)
- **Ollama** (local, gratuito): instale em ollama.com, `ollama pull llama3.2:3b` (ou o sugerido em *Inteligência artificial*). O Zaion só aceita endereço localhost.
- **OpenAI / Anthropic**: informe sua chave (criptografada). Uso cobrado pelo provedor. Modelo padrão Anthropic: `claude-opus-5-5` (editável).
- Toda saída de IA é validada: precisa conter o link exato e a identificação publicitária, e não pode trazer números ausentes nos dados; caso contrário é descartada.
