import { createHash } from 'node:crypto'
import type { MarketplaceInfo, ProductInput } from '../../../shared/types'
import { parseMoneyToCents } from '../../../shared/money'
import { parseShopeeIds, isSafeHttpUrl } from '../../../core/urls'
import {
  BaseConnector,
  ConnectorError,
  type AffiliateLinkResult,
  type ConnectionTest,
  type Credentials,
  type FetchLike,
  type SearchQuery,
  type SearchResult
} from '../types'

/**
 * Conector Shopee — Shopee Affiliate Open API (GraphQL).
 *
 * Endpoint Brasil: https://open-api.affiliate.shopee.com.br/graphql
 * Autenticação: cabeçalho
 *   Authorization: SHA256 Credential={AppId}, Timestamp={unix}, Signature={sha256(AppId + Timestamp + Payload + Secret)}
 * onde Payload é exatamente o corpo JSON enviado.
 *
 * Acesso: solicitado no portal de afiliados Shopee (seção Open API), sujeito a aprovação.
 * A documentação oficial completa fica dentro do portal (requer login). Os campos usados aqui
 * foram conferidos com implementações públicas e DEVEM ser revalidados com a documentação do portal
 * ao conectar com credenciais reais (ver API_CAPABILITIES.md).
 */

export const SHOPEE_ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql'

export const SHOPEE_INFO: MarketplaceInfo = {
  id: 'shopee',
  name: 'Shopee',
  officialApi: 'available',
  summary:
    'Shopee Affiliate Open API (GraphQL). Requer cadastro aprovado no Programa de Afiliados Shopee e solicitação de acesso à Open API no portal.',
  docsUrl: 'https://affiliate.shopee.com.br/open_api',
  capabilities: [
    { capability: 'authenticate', status: 'supported', note: 'AppId + Secret com assinatura SHA256.' },
    { capability: 'searchProducts', status: 'supported', note: 'productOfferV2 por palavra-chave.' },
    { capability: 'searchByCategory', status: 'partial', note: 'productOfferV2 aceita productCatId (IDs da Shopee).' },
    { capability: 'productDetails', status: 'supported', note: 'productOfferV2 filtrando por itemId/shopId.' },
    { capability: 'price', status: 'supported' },
    { capability: 'discount', status: 'partial', note: 'priceDiscountRate quando informado pela API.' },
    { capability: 'images', status: 'supported', note: 'imageUrl fornecida pela API.' },
    { capability: 'rating', status: 'supported', note: 'ratingStar (sem contagem de avaliações).' },
    { capability: 'salesVolume', status: 'supported', note: 'Campo sales.' },
    { capability: 'availability', status: 'partial', note: 'Inferida: produto retornado pela API = ofertado.' },
    { capability: 'commission', status: 'supported', note: 'commissionRate / commission.' },
    { capability: 'campaigns', status: 'pending', note: 'Ofertas de campanha (shopeeOfferV2) a avaliar.' },
    { capability: 'coupons', status: 'unsupported', note: 'Sem endpoint de cupons identificado na Open API.' },
    { capability: 'affiliateLink', status: 'supported', note: 'Mutation generateShortLink com até 5 subIds.' },
    { capability: 'conversions', status: 'supported', note: 'conversionReport.' },
    { capability: 'financialReports', status: 'partial', note: 'Comissões via conversionReport/validatedReport.' },
    { capability: 'csvImport', status: 'supported' },
    { capability: 'manualEntry', status: 'supported' }
  ],
  knownLimits: [
    'Limite de requisições por janela de tempo definido pela Shopee (erro de limite ao exceder).',
    'Timestamp da assinatura deve estar sincronizado com o relógio (janela de poucos minutos).',
    'Até 5 subIds alfanuméricos por link.'
  ],
  credentialFields: [
    { key: 'appId', label: 'App ID', secret: false, placeholder: 'Ex.: 18300000000' },
    { key: 'secret', label: 'Secret (Senha da API)', secret: true }
  ]
}

const PRODUCT_FIELDS = `itemId productName commissionRate commission price priceMin priceMax priceDiscountRate sales ratingStar imageUrl shopId shopName productLink offerLink periodStartTime periodEndTime productCatIds`

interface ShopeeNode {
  itemId?: number | string
  productName?: string
  commissionRate?: string | number
  commission?: string | number
  price?: string | number
  priceMin?: string | number
  priceMax?: string | number
  priceDiscountRate?: number | string
  sales?: number | string
  ratingStar?: string | number
  imageUrl?: string
  shopId?: number | string
  shopName?: string
  productLink?: string
  offerLink?: string
  productCatIds?: number[]
}

const SORT_TYPES: Record<NonNullable<SearchQuery['sort']>, number> = {
  relevance: 1,
  sales: 2,
  price_desc: 3,
  price_asc: 4,
  commission: 5
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Literal de string GraphQL seguro (JSON string é compatível com string GraphQL). */
const gqlString = (s: string) => JSON.stringify(s)

export function shopeeSignature(appId: string, timestamp: number, payload: string, secret: string): string {
  return createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`, 'utf8').digest('hex')
}

export function mapShopeeNode(n: ShopeeNode): ProductInput | null {
  if (n.itemId === undefined || !n.productName) return null
  const shopId = n.shopId !== undefined ? String(n.shopId) : null
  const itemId = String(n.itemId)
  const url =
    n.productLink && isSafeHttpUrl(n.productLink)
      ? n.productLink
      : shopId
        ? `https://shopee.com.br/product/${shopId}/${itemId}`
        : `https://shopee.com.br/`
  const priceCents = parseMoneyToCents(n.priceMin ?? n.price ?? null)
  const discount = num(n.priceDiscountRate)
  const rate = num(n.commissionRate)
  return {
    marketplaceId: 'shopee',
    externalId: shopId ? `${shopId}.${itemId}` : itemId,
    title: n.productName,
    url,
    shopId,
    shopName: n.shopName ?? null,
    imageUrl: n.imageUrl && isSafeHttpUrl(n.imageUrl) ? n.imageUrl : null,
    priceCents,
    // A API não devolve preço "de" diretamente; só preenchemos se puder ser derivado do desconto informado.
    originalPriceCents:
      priceCents !== null && discount !== null && discount > 0 && discount < 100
        ? Math.round(priceCents / (1 - discount / 100))
        : null,
    discountPct: discount !== null && discount > 0 ? discount : null,
    commissionRate: rate !== null ? (rate > 1 ? rate / 100 : rate) : null,
    commissionCents: parseMoneyToCents(n.commission ?? null),
    rating: num(n.ratingStar),
    ratingCount: null,
    salesCount: num(n.sales),
    available: true,
    freeShipping: null,
    offerLink: n.offerLink && isSafeHttpUrl(n.offerLink) ? n.offerLink : null,
    dataSource: 'api',
    raw: n
  }
}

export class ShopeeConnector extends BaseConnector {
  readonly info = SHOPEE_INFO

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly endpoint = SHOPEE_ENDPOINT,
    private readonly now: () => number = () => Date.now()
  ) {
    super()
  }

  private creds(c: Credentials): { appId: string; secret: string } {
    const appId = (c.appId ?? '').trim()
    const secret = (c.secret ?? '').trim()
    if (!/^\d{4,20}$/.test(appId)) throw new ConnectorError('invalid_input', 'App ID inválido.')
    if (!secret) throw new ConnectorError('invalid_input', 'Secret não informado.')
    return { appId, secret }
  }

  async request<T>(c: Credentials, query: string): Promise<T> {
    const { appId, secret } = this.creds(c)
    const payload = JSON.stringify({ query })
    const ts = Math.floor(this.now() / 1000)
    const sig = shopeeSignature(appId, ts, payload, secret)
    let res: Response
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `SHA256 Credential=${appId}, Timestamp=${ts}, Signature=${sig}`
        },
        body: payload,
        signal: AbortSignal.timeout(20_000)
      })
    } catch (e) {
      throw new ConnectorError('network', `Falha de rede ao acessar a Shopee: ${(e as Error).message}`)
    }
    if (res.status === 429) throw new ConnectorError('rate_limit', 'Limite de requisições da Shopee atingido.', 60_000)
    if (res.status === 401 || res.status === 403) throw new ConnectorError('auth', 'Credenciais da Shopee recusadas.')
    let body: { data?: T; errors?: Array<{ message?: string; extensions?: { code?: number | string; message?: string } }> }
    try {
      body = (await res.json()) as typeof body
    } catch {
      throw new ConnectorError('upstream', `Resposta inválida da Shopee (HTTP ${res.status}).`)
    }
    if (body.errors && body.errors.length) {
      const e = body.errors[0]!
      const code = Number(e.extensions?.code)
      const msg = e.extensions?.message || e.message || 'Erro desconhecido'
      // Códigos observados na Open API: 10020 (assinatura/autenticação), 10030 (limite), 10035 (sem acesso).
      if (code === 10030) throw new ConnectorError('rate_limit', `Shopee: limite de requisições (${msg}).`, 60_000)
      if (code === 10020 || code === 10035 || /auth|signature|credential|permission/i.test(msg))
        throw new ConnectorError('auth', `Shopee recusou a autenticação: ${msg} (código ${e.extensions?.code ?? 'n/d'}).`)
      throw new ConnectorError('upstream', `Shopee: ${msg} (código ${e.extensions?.code ?? 'n/d'}).`)
    }
    if (!res.ok || !body.data) throw new ConnectorError('upstream', `Shopee respondeu HTTP ${res.status}.`)
    return body.data
  }

  async testConnection(c: Credentials): Promise<ConnectionTest> {
    const data = await this.request<{ productOfferV2: { nodes: ShopeeNode[] } }>(
      c,
      `{ productOfferV2(keyword: ${gqlString('casa')}, limit: 1, page: 1) { nodes { itemId } pageInfo { hasNextPage } } }`
    )
    if (!data.productOfferV2) throw new ConnectorError('upstream', 'Resposta inesperada da Shopee.')
    return { ok: true, message: 'Conexão com a Shopee Affiliate Open API validada.', accountRef: c.appId }
  }

  async searchProducts(c: Credentials, q: SearchQuery): Promise<SearchResult> {
    const args: string[] = []
    if (q.keyword) args.push(`keyword: ${gqlString(q.keyword.slice(0, 100))}`)
    if (q.categoryId && /^\d+$/.test(q.categoryId)) args.push(`productCatId: ${q.categoryId}`)
    args.push(`sortType: ${SORT_TYPES[q.sort ?? 'relevance']}`)
    args.push(`page: ${Math.max(1, Math.floor(q.page ?? 1))}`)
    args.push(`limit: ${Math.min(50, Math.max(1, Math.floor(q.limit ?? 20)))}`)
    const data = await this.request<{ productOfferV2: { nodes: ShopeeNode[]; pageInfo?: { hasNextPage?: boolean } } }>(
      c,
      `{ productOfferV2(${args.join(', ')}) { nodes { ${PRODUCT_FIELDS} } pageInfo { page limit hasNextPage } } }`
    )
    const nodes = data.productOfferV2?.nodes ?? []
    return {
      items: nodes.map(mapShopeeNode).filter((x): x is ProductInput => x !== null),
      hasNextPage: !!data.productOfferV2?.pageInfo?.hasNextPage
    }
  }

  async getProductDetails(c: Credentials, ref: { externalId?: string; url?: string }): Promise<ProductInput | null> {
    let shopId: string | undefined
    let itemId: string | undefined
    if (ref.externalId && /^\d+\.\d+$/.test(ref.externalId)) [shopId, itemId] = ref.externalId.split('.')
    else if (ref.url) {
      const ids = parseShopeeIds(ref.url)
      if (ids) ({ shopId, itemId } = ids)
    }
    if (!itemId || !shopId) throw new ConnectorError('invalid_input', 'Não foi possível identificar o produto Shopee (shopId/itemId).')
    const data = await this.request<{ productOfferV2: { nodes: ShopeeNode[] } }>(
      c,
      `{ productOfferV2(itemId: ${itemId}, shopId: ${shopId}, limit: 1, page: 1) { nodes { ${PRODUCT_FIELDS} } } }`
    )
    const node = data.productOfferV2?.nodes?.[0]
    return node ? mapShopeeNode(node) : null
  }

  async getAvailableCoupons(): Promise<string[]> {
    return this.unsupported('cupons')
  }

  async generateAffiliateLink(c: Credentials, url: string, subIds: string[]): Promise<AffiliateLinkResult> {
    if (!isSafeHttpUrl(url)) throw new ConnectorError('invalid_input', 'URL inválida.')
    const ids = subIds.filter((s) => /^[a-zA-Z0-9]{1,50}$/.test(s)).slice(0, 5)
    const data = await this.request<{ generateShortLink: { shortLink?: string } }>(
      c,
      `mutation { generateShortLink(input: { originUrl: ${gqlString(url)}, subIds: ${JSON.stringify(ids)} }) { shortLink } }`
    )
    const link = data.generateShortLink?.shortLink
    if (!link || !isSafeHttpUrl(link)) throw new ConnectorError('upstream', 'A Shopee não retornou um link válido.')
    return { url: link, verified: true }
  }

  async getReports(c: Credentials, range: { from: Date; to: Date }): Promise<unknown[]> {
    const start = Math.floor(range.from.getTime() / 1000)
    const end = Math.floor(range.to.getTime() / 1000)
    const out: unknown[] = []
    let scrollId = ''
    for (let i = 0; i < 20; i++) {
      const data = await this.request<{
        conversionReport: { nodes: unknown[]; pageInfo: { scrollId?: string; hasNextPage?: boolean } }
      }>(
        c,
        `{ conversionReport(purchaseTimeStart: ${start}, purchaseTimeEnd: ${end}, limit: 500${scrollId ? `, scrollId: ${gqlString(scrollId)}` : ''}) { nodes { purchaseTime clickTime conversionId checkoutId totalCommission netCommission estimatedTotalCommission utmContent orders { orderId orderStatus items { itemId itemName itemPrice qty itemTotalCommission } } } pageInfo { scrollId hasNextPage } } }`
      )
      out.push(...(data.conversionReport?.nodes ?? []))
      if (!data.conversionReport?.pageInfo?.hasNextPage) break
      scrollId = data.conversionReport.pageInfo.scrollId ?? ''
      if (!scrollId) break
    }
    return out
  }
}
