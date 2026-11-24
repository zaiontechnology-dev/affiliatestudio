import type { CapabilityInfo, MarketplaceInfo, ProductInput } from '../../shared/types'

export type ConnectorErrorCode =
  | 'auth' // credencial inválida/expirada
  | 'rate_limit'
  | 'network' // falha antes de obter resposta
  | 'unsupported'
  | 'invalid_input'
  | 'not_found'
  | 'upstream' // erro do serviço externo
  | 'unknown'

export class ConnectorError extends Error {
  constructor(
    public readonly code: ConnectorErrorCode,
    message: string,
    public readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'ConnectorError'
  }
}

export type Credentials = Record<string, string>

export interface SearchQuery {
  keyword?: string
  categoryId?: string
  sort?: 'relevance' | 'sales' | 'price_asc' | 'price_desc' | 'commission'
  page?: number
  limit?: number
}

export interface SearchResult {
  items: ProductInput[]
  hasNextPage: boolean
}

export interface AffiliateLinkResult {
  url: string
  /** true somente quando gerado/confirmado pelo mecanismo oficial. */
  verified: boolean
}

export interface OfferValidation {
  valid: boolean
  reasons: string[]
  fresh: ProductInput | null
}

export interface ConnectionTest {
  ok: boolean
  message: string
  accountRef?: string
}

export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>
}

/** Interface padronizada de conector de marketplace. */
export interface MarketplaceConnector {
  readonly info: MarketplaceInfo
  getCapabilities(): CapabilityInfo[]
  authenticate(creds: Credentials): Promise<ConnectionTest>
  testConnection(creds: Credentials): Promise<ConnectionTest>
  searchProducts(creds: Credentials, query: SearchQuery): Promise<SearchResult>
  getProductDetails(creds: Credentials, ref: { externalId?: string; url?: string }): Promise<ProductInput | null>
  getProductPrice(creds: Credentials, ref: { externalId?: string; url?: string }): Promise<number | null>
  getCommission(creds: Credentials, ref: { externalId?: string; url?: string }): Promise<number | null>
  getAvailableCoupons(creds: Credentials, ref: { externalId?: string; url?: string }): Promise<string[]>
  generateAffiliateLink(creds: Credentials, url: string, subIds: string[]): Promise<AffiliateLinkResult>
  validateOffer(creds: Credentials, product: ProductInput, opts?: { maxPriceIncreasePct?: number }): Promise<OfferValidation>
  getReports(creds: Credentials, range: { from: Date; to: Date }): Promise<unknown[]>
}

export function supports(info: MarketplaceInfo, cap: CapabilityInfo['capability']): boolean {
  const c = info.capabilities.find((x) => x.capability === cap)
  return !!c && (c.status === 'supported' || c.status === 'partial')
}

/** Base com comportamento padrão: recursos não suportados lançam ConnectorError('unsupported'). */
export abstract class BaseConnector implements MarketplaceConnector {
  abstract readonly info: MarketplaceInfo

  getCapabilities(): CapabilityInfo[] {
    return this.info.capabilities
  }

  protected unsupported(feature: string): never {
    throw new ConnectorError('unsupported', `${this.info.name}: recurso "${feature}" não disponível por integração oficial.`)
  }

  async authenticate(creds: Credentials): Promise<ConnectionTest> {
    return this.testConnection(creds)
  }
  async testConnection(_creds: Credentials): Promise<ConnectionTest> {
    return { ok: false, message: `${this.info.name}: integração oficial ainda não disponível neste aplicativo.` }
  }
  async searchProducts(_c: Credentials, _q: SearchQuery): Promise<SearchResult> {
    return this.unsupported('pesquisa de produtos')
  }
  async getProductDetails(_c: Credentials, _r: { externalId?: string; url?: string }): Promise<ProductInput | null> {
    return this.unsupported('detalhes do produto')
  }
  async getProductPrice(c: Credentials, r: { externalId?: string; url?: string }): Promise<number | null> {
    return (await this.getProductDetails(c, r))?.priceCents ?? null
  }
  async getCommission(c: Credentials, r: { externalId?: string; url?: string }): Promise<number | null> {
    return (await this.getProductDetails(c, r))?.commissionRate ?? null
  }
  async getAvailableCoupons(_c: Credentials, _r: { externalId?: string; url?: string }): Promise<string[]> {
    return this.unsupported('cupons')
  }
  async generateAffiliateLink(_c: Credentials, _url: string, _subIds: string[]): Promise<AffiliateLinkResult> {
    return this.unsupported('geração de link de afiliado')
  }
  async getReports(_c: Credentials, _range: { from: Date; to: Date }): Promise<unknown[]> {
    return this.unsupported('relatórios')
  }

  async validateOffer(creds: Credentials, product: ProductInput, opts: { maxPriceIncreasePct?: number } = {}): Promise<OfferValidation> {
    const reasons: string[] = []
    const fresh = await this.getProductDetails(creds, { externalId: product.externalId, url: product.url })
    if (!fresh) return { valid: false, reasons: ['Produto não encontrado na consulta oficial.'], fresh: null }
    if (fresh.available === false) reasons.push('Produto indisponível.')
    if (fresh.priceCents === null || fresh.priceCents === undefined) reasons.push('Preço atual não informado pela fonte.')
    else if (product.priceCents !== null && product.priceCents !== undefined) {
      const inc = ((fresh.priceCents - product.priceCents) / product.priceCents) * 100
      if (inc > (opts.maxPriceIncreasePct ?? 0)) reasons.push(`Preço aumentou ${inc.toFixed(1)}% desde a seleção.`)
    }
    return { valid: reasons.length === 0, reasons, fresh }
  }
}
