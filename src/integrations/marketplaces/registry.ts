import type { Capability, CapabilityInfo, MarketplaceId, MarketplaceInfo } from '../../shared/types'
import { BaseConnector, type MarketplaceConnector } from './types'
import { ShopeeConnector } from './shopee/shopee-connector'

/**
 * Marketplaces sem integração oficial implementada nesta versão.
 * Operam por cadastro manual, importação CSV e links de afiliado gerados no portal oficial do programa.
 * Status verificado em 2026-11 (ver API_CAPABILITIES.md). Reavaliar antes de implementar.
 */
const fallbackCaps = (extra: CapabilityInfo[] = []): CapabilityInfo[] => {
  const base: Capability[] = [
    'authenticate',
    'searchProducts',
    'productDetails',
    'price',
    'commission',
    'coupons',
    'affiliateLink',
    'conversions'
  ]
  const map = new Map<Capability, CapabilityInfo>(base.map((c) => [c, { capability: c, status: 'pending' }]))
  for (const e of extra) map.set(e.capability, e)
  map.set('csvImport', { capability: 'csvImport', status: 'supported' })
  map.set('manualEntry', { capability: 'manualEntry', status: 'supported', note: 'Cole o link de afiliado gerado no portal oficial.' })
  return [...map.values()]
}

class PendingConnector extends BaseConnector {
  constructor(readonly info: MarketplaceInfo) {
    super()
  }
}

const PENDING: MarketplaceInfo[] = [
  {
    id: 'mercado-livre',
    name: 'Mercado Livre',
    officialApi: 'restricted',
    summary:
      'Programa de Afiliados Mercado Livre. Links são gerados no portal/barra de afiliados. A API pública de itens exige app registrado e não gera links de afiliado. Integração por API: pendente de validação.',
    docsUrl: 'https://developers.mercadolivre.com.br/',
    capabilities: fallbackCaps([
      { capability: 'affiliateLink', status: 'unsupported', note: 'Sem API oficial de geração de link identificada. Use o gerador do portal.' }
    ]),
    knownLimits: ['Requer aprovação no programa de afiliados.'],
    credentialFields: []
  },
  {
    id: 'shein',
    name: 'SHEIN',
    officialApi: 'none',
    summary: 'Programa de afiliados SHEIN sem API pública identificada para afiliados no Brasil. Use cadastro manual/CSV.',
    capabilities: fallbackCaps(),
    knownLimits: [],
    credentialFields: []
  },
  {
    id: 'amazon',
    name: 'Amazon',
    officialApi: 'restricted',
    summary:
      'Amazon Associados. A API de produtos (PA-API / sucessora) exige conta aprovada com vendas qualificadas. Integração pendente de credenciais e verificação da API vigente.',
    docsUrl: 'https://associados.amazon.com.br/',
    capabilities: fallbackCaps(),
    knownLimits: ['Acesso à API condicionado a vendas qualificadas recentes.'],
    credentialFields: []
  },
  {
    id: 'aliexpress',
    name: 'AliExpress',
    officialApi: 'available',
    summary:
      'AliExpress Open Platform possui APIs de afiliados (consulta de produtos e geração de links). Conector planejado para a Fase 7.',
    docsUrl: 'https://openservice.aliexpress.com/',
    capabilities: fallbackCaps(),
    knownLimits: [],
    credentialFields: []
  },
  {
    id: 'magalu',
    name: 'Magalu',
    officialApi: 'none',
    summary: 'Parceiro Magalu sem API pública de afiliados identificada. Use cadastro manual/CSV.',
    capabilities: fallbackCaps(),
    knownLimits: [],
    credentialFields: []
  },
  {
    id: 'temu',
    name: 'Temu',
    officialApi: 'unknown',
    summary: 'Programa de afiliados Temu sem API pública identificada. Use cadastro manual/CSV.',
    capabilities: fallbackCaps(),
    knownLimits: [],
    credentialFields: []
  }
]

export const MANUAL_INFO: MarketplaceInfo = {
  id: 'manual',
  name: 'Cadastro manual',
  officialApi: 'none',
  summary: 'Produtos cadastrados manualmente ou importados de CSV.',
  capabilities: fallbackCaps(),
  knownLimits: [],
  credentialFields: []
}

export class ConnectorRegistry {
  private connectors = new Map<MarketplaceId, MarketplaceConnector>()

  constructor(overrides: Partial<Record<MarketplaceId, MarketplaceConnector>> = {}) {
    this.connectors.set('shopee', overrides.shopee ?? new ShopeeConnector())
    for (const info of PENDING) this.connectors.set(info.id, overrides[info.id] ?? new PendingConnector(info))
    this.connectors.set('manual', overrides.manual ?? new PendingConnector(MANUAL_INFO))
  }

  get(id: MarketplaceId): MarketplaceConnector {
    const c = this.connectors.get(id)
    if (!c) throw new Error(`Marketplace desconhecido: ${id}`)
    return c
  }

  list(): MarketplaceInfo[] {
    return [...this.connectors.values()].map((c) => c.info)
  }
}
