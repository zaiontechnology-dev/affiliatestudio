# API_CAPABILITIES — matriz de viabilidade (verificada em 2026-11-24)

| Marketplace | API oficial p/ afiliados | Busca | Link de afiliado | Comissão | Conversões | Situação no Zaion |
|---|---|---|---|---|---|---|
| **Shopee** | Sim — Shopee Affiliate Open API (GraphQL), acesso por solicitação no portal | Sim | Sim (`generateShortLink`) | Sim | Sim (`conversionReport`) | **Implementado**, dependente de credenciais |
| Mercado Livre | Programa de afiliados sem API pública de geração de links identificada; API de itens é de vendedores/apps | A validar | Não (portal) | Não | Não | CSV / manual |
| SHEIN | Não identificada para afiliados BR | Não | Não | Não | Não | CSV / manual |
| Amazon | PA-API (ou sucessora) restrita a contas com vendas qualificadas | Restrita | Sim (tag) | — | Relatórios no portal | Pendente de credenciais e verificação da API vigente |
| AliExpress | Sim — AliExpress Open Platform (APIs de afiliado) | Sim | Sim | Sim | Sim | Pendente (Fase 7) |
| Magalu | Não identificada | Não | Não | Não | Não | CSV / manual |
| Temu | Não identificada | Não | Não | Não | Não | CSV / manual |

## Shopee Affiliate Open API — detalhes usados
- Endpoint BR: `https://open-api.affiliate.shopee.com.br/graphql` (POST JSON `{"query": "..."}`)
- Cabeçalho: `Authorization: SHA256 Credential={AppId}, Timestamp={unix}, Signature={sha256_hex(AppId + Timestamp + Payload + Secret)}` — Payload é o corpo exato enviado.
- Consultas: `productOfferV2(keyword, itemId, shopId, productCatId, sortType, page, limit)`; `generateShortLink(input:{originUrl, subIds})` (até 5 subIds alfanuméricos); `conversionReport(purchaseTimeStart, purchaseTimeEnd, scrollId, limit)`.
- Códigos de erro tratados: 10020 (autenticação/assinatura), 10030 (limite de requisições), 10035 (sem acesso).
- **Fonte e confiança**: a documentação oficial fica dentro do portal de afiliados (requer login). O formato de assinatura foi conferido em implementação pública (SDK Python `snja/shopee-affiliate-openapi`) e fontes de terceiros. Os **nomes de campos** de `productOfferV2` (ex.: `priceMin`, `priceDiscountRate`, `ratingStar`, `sales`, `commissionRate`, `offerLink`) e de `conversionReport` **devem ser revalidados** na primeira conexão real. O mapeamento é defensivo (campos ausentes ficam `null`).
- `originalPriceCents` é derivado **somente** do `priceDiscountRate` informado pela API; se ausente, fica `null`.

## Telegram
Bot API oficial (`api.telegram.org`): `getMe`, `getChat`, `getChatMember`, `sendMessage`, `sendPhoto` (legenda ≤ 1024). 429 → `retry_after`.

## WhatsApp
Ver `INTEGRATIONS.md`.
