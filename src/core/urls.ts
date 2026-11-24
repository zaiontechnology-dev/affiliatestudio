import type { MarketplaceId } from '../shared/types'

const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mkt_/i,
  /^sp_atk$/i,
  /^xptdk$/i,
  /^smtt$/i,
  /^af_/i,
  /^aff_/i,
  /^ref$/i,
  /^tag$/i,
  /^matt_/i,
  /^tracking_id$/i,
  /^spm$/i
]

export function isSafeHttpUrl(input: string): boolean {
  try {
    const u = new URL(input)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname && !u.username && !u.password
  } catch {
    return false
  }
}

/** URL canônica para detecção de duplicidade (não usar para publicação). */
export function normalizeUrl(input: string): string {
  try {
    const u = new URL(input.trim())
    u.hash = ''
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '')
    const keep = new URLSearchParams()
    const entries = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.some((re) => re.test(k)))
    entries.sort(([a], [b]) => a.localeCompare(b))
    for (const [k, v] of entries) keep.append(k, v)
    u.search = keep.toString()
    let s = u.toString()
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1)
    return s.replace(/^http:/, 'https:')
  } catch {
    return input.trim()
  }
}

const HOST_MAP: Array<[RegExp, MarketplaceId]> = [
  [/(^|\.)shopee\.com\.br$|(^|\.)shp\.ee$|(^|\.)s\.shopee\.com\.br$/i, 'shopee'],
  [/(^|\.)mercadolivre\.com\.br$|(^|\.)mercadolibre\.com$|(^|\.)meli\.la$/i, 'mercado-livre'],
  [/(^|\.)shein\.com(\.br)?$/i, 'shein'],
  [/(^|\.)amazon\.com\.br$|(^|\.)amzn\.to$/i, 'amazon'],
  [/(^|\.)aliexpress\.(com|us)$|(^|\.)s\.click\.aliexpress\.com$/i, 'aliexpress'],
  [/(^|\.)magazineluiza\.com\.br$|(^|\.)magalu\.com(\.br)?$/i, 'magalu'],
  [/(^|\.)temu\.com$/i, 'temu']
]

export function detectMarketplace(url: string): MarketplaceId | null {
  try {
    const host = new URL(url).hostname
    for (const [re, id] of HOST_MAP) if (re.test(host)) return id
    return null
  } catch {
    return null
  }
}

/** Extrai shopId/itemId de URLs da Shopee (formatos "-i.SHOP.ITEM" e "/product/SHOP/ITEM"). */
export function parseShopeeIds(url: string): { shopId: string; itemId: string } | null {
  try {
    const u = new URL(url)
    const m1 = u.pathname.match(/-i\.(\d+)\.(\d+)/)
    if (m1) return { shopId: m1[1]!, itemId: m1[2]! }
    const m2 = u.pathname.match(/\/product\/(\d+)\/(\d+)/)
    if (m2) return { shopId: m2[1]!, itemId: m2[2]! }
    const m3 = u.pathname.match(/^\/[^/]+\/(\d+)\/(\d+)/)
    if (m3) return { shopId: m3[1]!, itemId: m3[2]! }
    return null
  } catch {
    return null
  }
}

/** Sub IDs: apenas alfanuméricos, máx. 5 (limite usado pela Shopee). */
export function sanitizeSubIds(parts: Array<string | null | undefined>): string[] {
  return parts
    .map((p) => (p ?? '').toString().normalize('NFD').replace(/[^a-zA-Z0-9]/g, '').slice(0, 50))
    .filter(Boolean)
    .slice(0, 5)
}
