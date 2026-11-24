import { describe, expect, it } from 'vitest'
import { ShopeeConnector, shopeeSignature, mapShopeeNode } from '../src/integrations/marketplaces/shopee/shopee-connector'
import { ConnectorError } from '../src/integrations/marketplaces/types'
import { TelegramProvider } from '../src/integrations/channels/telegram/telegram-provider'
import { ConnectorRegistry } from '../src/integrations/marketplaces/registry'

/** Testes isolados com respostas simuladas (fixtures). NÃO substituem a validação com credenciais reais. */
function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown } | Error) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const f = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const r = handler(url, init)
    if (r instanceof Error) throw r
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { f, calls }
}

const creds = { appId: '18300000001', secret: 'FIXTURESECRET' }

describe('Shopee Affiliate Open API (fixtures)', () => {
  it('assina a requisição conforme especificação SHA256(AppId+Timestamp+Payload+Secret)', async () => {
    const { f, calls } = mockFetch(() => ({ body: { data: { productOfferV2: { nodes: [], pageInfo: { hasNextPage: false } } } } }))
    const c = new ShopeeConnector(f, 'https://example.test/graphql', () => 1_700_000_000_000)
    await c.searchProducts(creds, { keyword: 'fone' })
    const auth = (calls[0]!.init.headers as Record<string, string>).Authorization
    const payload = calls[0]!.init.body as string
    expect(auth).toBe(`SHA256 Credential=${creds.appId}, Timestamp=1700000000, Signature=${shopeeSignature(creds.appId, 1700000000, payload, creds.secret)}`)
    expect(payload).toContain('productOfferV2')
    expect(payload).toContain('\\"fone\\"')
  })

  it('escapa palavras-chave (sem injeção GraphQL)', async () => {
    const { f, calls } = mockFetch(() => ({ body: { data: { productOfferV2: { nodes: [] } } } }))
    await new ShopeeConnector(f).searchProducts(creds, { keyword: 'a") { x } #' })
    const query = JSON.parse(calls[0]!.init.body as string).query as string
    expect(query).toContain('keyword: "a\\") { x } #"')
  })

  it('mapeia produto sem inventar dados ausentes', () => {
    const p = mapShopeeNode({ itemId: 5, shopId: 7, productName: 'X', priceMin: '10.50', commissionRate: '0.07', sales: 12, ratingStar: '4.6' })!
    expect(p.externalId).toBe('7.5')
    expect(p.priceCents).toBe(1050)
    expect(p.commissionRate).toBe(0.07)
    expect(p.originalPriceCents).toBeNull()
    expect(p.discountPct).toBeNull()
    expect(p.ratingCount).toBeNull()
  })

  it('credencial inválida → ConnectorError auth', async () => {
    const { f } = mockFetch(() => ({ body: { errors: [{ message: 'Invalid Signature', extensions: { code: 10020, message: 'Invalid Signature' } }] } }))
    await expect(new ShopeeConnector(f).testConnection(creds)).rejects.toMatchObject({ code: 'auth' })
  })

  it('limite de API → ConnectorError rate_limit', async () => {
    const { f } = mockFetch(() => ({ body: { errors: [{ message: 'rate limit', extensions: { code: 10030 } }] } }))
    await expect(new ShopeeConnector(f).searchProducts(creds, {})).rejects.toMatchObject({ code: 'rate_limit' })
  })

  it('internet desconectada → ConnectorError network', async () => {
    const { f } = mockFetch(() => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))
    await expect(new ShopeeConnector(f).searchProducts(creds, {})).rejects.toBeInstanceOf(ConnectorError)
  })

  it('gera link curto e só o considera válido se a API devolver URL', async () => {
    const ok = mockFetch(() => ({ body: { data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/abc' } } } }))
    expect(await new ShopeeConnector(ok.f).generateAffiliateLink(creds, 'https://shopee.com.br/x-i.1.2', ['zaion', 'c1'])).toEqual({ url: 'https://s.shopee.com.br/abc', verified: true })
    const bad = mockFetch(() => ({ body: { data: { generateShortLink: { shortLink: null } } } }))
    await expect(new ShopeeConnector(bad.f).generateAffiliateLink(creds, 'https://shopee.com.br/x-i.1.2', [])).rejects.toMatchObject({ code: 'upstream' })
  })

  it('produto indisponível/preço alterado na validação', async () => {
    const { f } = mockFetch(() => ({ body: { data: { productOfferV2: { nodes: [{ itemId: 2, shopId: 1, productName: 'X', priceMin: '15.00' }] } } } }))
    const v = await new ShopeeConnector(f).validateOffer(creds, { marketplaceId: 'shopee', externalId: '1.2', title: 'X', url: 'https://shopee.com.br/product/1/2', priceCents: 1000, dataSource: 'api' })
    expect(v.valid).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/Preço aumentou/)
    const gone = mockFetch(() => ({ body: { data: { productOfferV2: { nodes: [] } } } }))
    expect((await new ShopeeConnector(gone.f).validateOffer(creds, { marketplaceId: 'shopee', externalId: '1.2', title: 'X', url: 'u', dataSource: 'api' })).valid).toBe(false)
  })

  it('marketplaces sem API informam limitação explicitamente', async () => {
    const reg = new ConnectorRegistry()
    await expect(reg.get('shein').searchProducts({}, {})).rejects.toMatchObject({ code: 'unsupported' })
    expect(reg.get('mercado-livre').getCapabilities().find((c) => c.capability === 'affiliateLink')!.status).toBe('unsupported')
  })
})

describe('Telegram Bot API (fixtures)', () => {
  const token = { token: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }

  it('envia foto com legenda em texto puro (sem parse_mode)', async () => {
    const { f, calls } = mockFetch(() => ({ body: { ok: true, result: { message_id: 42 } } }))
    const r = await new TelegramProvider(f).send(token, '@canal', { text: 'Oferta', imageUrl: 'https://img.test/a.jpg' })
    expect(r).toMatchObject({ outcome: 'sent', messageId: '42' })
    expect(calls[0]!.url).toContain('/sendPhoto')
    expect(JSON.parse(calls[0]!.init.body as string).parse_mode).toBeUndefined()
  })

  it('texto longo usa sendMessage', async () => {
    const { f, calls } = mockFetch(() => ({ body: { ok: true, result: { message_id: 1 } } }))
    await new TelegramProvider(f).send(token, '@canal', { text: 'x'.repeat(2000), imageUrl: 'https://img.test/a.jpg' })
    expect(calls[0]!.url).toContain('/sendMessage')
  })

  it('429 é reprocessável com retry_after', async () => {
    const { f } = mockFetch(() => ({ status: 429, body: { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } } }))
    expect(await new TelegramProvider(f).send(token, '@canal', { text: 'x' })).toMatchObject({ outcome: 'failed', retryable: true, retryAfterMs: 7000 })
  })

  it('timeout após envio → status desconhecido (sem reenvio)', async () => {
    const { f } = mockFetch(() => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
    expect(await new TelegramProvider(f).send(token, '@canal', { text: 'x' })).toMatchObject({ outcome: 'unknown', retryable: false })
  })

  it('falha de DNS antes do envio → reprocessável', async () => {
    const { f } = mockFetch(() => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))
    expect(await new TelegramProvider(f).send(token, '@canal', { text: 'x' })).toMatchObject({ outcome: 'failed', retryable: true })
  })

  it('verifica permissão do bot em canal', async () => {
    const { f } = mockFetch((url) => {
      if (url.endsWith('/getMe')) return { body: { ok: true, result: { id: 9, username: 'zaion_bot' } } }
      if (url.endsWith('/getChat')) return { body: { ok: true, result: { id: -100, title: 'Canal', type: 'channel' } } }
      return { body: { ok: true, result: { status: 'member' } } }
    })
    const r = await new TelegramProvider(f).checkDestination(token, '@canal')
    expect(r.canPost).toBe(false)
  })

  it('rejeita token malformado sem chamar a rede', async () => {
    const { f, calls } = mockFetch(() => ({ body: {} }))
    expect((await new TelegramProvider(f).send({ token: 'abc' }, '@c', { text: 'x' })).outcome).toBe('failed')
    expect(calls).toHaveLength(0)
  })
})
