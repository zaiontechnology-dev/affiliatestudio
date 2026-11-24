import { parseMoneyToCents } from '../shared/money'
import { detectMarketplace, isSafeHttpUrl, normalizeUrl, parseShopeeIds } from '../core/urls'
import type { MarketplaceId, ProductInput } from '../shared/types'
import { createHash } from 'node:crypto'

/** Parser CSV (RFC 4180) com detecção de separador ; ou , */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === sep) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Neutraliza fórmulas ao exportar para planilhas (CSV injection). */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[";,\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  return '﻿' + [headers.map(cell).join(';'), ...rows.map((r) => r.map(cell).join(';'))].join('\r\n')
}

const ALIASES: Record<string, string[]> = {
  title: ['titulo', 'título', 'nome', 'produto', 'title', 'product name', 'item name', 'nome do produto'],
  url: ['url', 'link', 'link do produto', 'product link', 'url do produto'],
  affiliateUrl: ['link afiliado', 'link de afiliado', 'affiliate link', 'offer link', 'link comissionado', 'short link'],
  price: ['preco', 'preço', 'price', 'preco atual', 'preço atual', 'valor'],
  originalPrice: ['preco anterior', 'preço anterior', 'preco original', 'preço original', 'original price', 'de'],
  discount: ['desconto', 'discount', 'desconto %'],
  commission: ['comissao', 'comissão', 'commission rate', 'taxa de comissao', 'taxa de comissão', 'comissao %', 'comissão %'],
  rating: ['avaliacao', 'avaliação', 'rating', 'nota'],
  ratingCount: ['avaliacoes', 'avaliações', 'quantidade de avaliacoes', 'rating count', 'reviews'],
  sales: ['vendas', 'vendidos', 'sales', 'sold'],
  image: ['imagem', 'image', 'image url', 'url da imagem', 'foto'],
  category: ['categoria', 'category'],
  shop: ['loja', 'shop', 'shop name', 'vendedor'],
  coupon: ['cupom', 'coupon'],
  marketplace: ['marketplace', 'plataforma'],
  id: ['id', 'item id', 'itemid', 'sku', 'id do produto']
}

function headerIndex(headers: string[]): Record<string, number> {
  const norm = headers.map((h) => h.trim().toLowerCase())
  const out: Record<string, number> = {}
  for (const [key, names] of Object.entries(ALIASES)) {
    const idx = norm.findIndex((h) => names.includes(h))
    if (idx >= 0) out[key] = idx
  }
  return out
}

const pct = (v: string | undefined): number | null => {
  if (!v) return null
  const n = Number(v.replace('%', '').replace(',', '.').trim())
  return Number.isFinite(n) ? n : null
}

export interface CsvImportRow {
  product: ProductInput
  affiliateUrl: string | null
  coupon: string | null
}

export interface CsvImportResult {
  rows: CsvImportRow[]
  errors: Array<{ line: number; message: string }>
}

export function importProductsCsv(text: string, defaultMarketplace?: MarketplaceId): CsvImportResult {
  const table = parseCsv(text)
  const errors: CsvImportResult['errors'] = []
  if (table.length < 2) return { rows: [], errors: [{ line: 1, message: 'Arquivo sem dados.' }] }
  const idx = headerIndex(table[0]!)
  if (idx.title === undefined || (idx.url === undefined && idx.affiliateUrl === undefined))
    return { rows: [], errors: [{ line: 1, message: 'Colunas obrigatórias: título/nome e url/link.' }] }
  const rows: CsvImportRow[] = []
  table.slice(1).forEach((r, i) => {
    const line = i + 2
    const get = (k: string) => (idx[k] !== undefined ? (r[idx[k]!] ?? '').trim() : undefined)
    const title = get('title')
    const url = get('url') || get('affiliateUrl')
    if (!title || !url || !isSafeHttpUrl(url)) {
      errors.push({ line, message: 'Título ou URL inválidos.' })
      return
    }
    const mkRaw = get('marketplace')?.toLowerCase()
    const mk = (detectMarketplace(url) ?? (mkRaw as MarketplaceId | undefined) ?? defaultMarketplace ?? 'manual') as MarketplaceId
    const shopee = mk === 'shopee' ? parseShopeeIds(url) : null
    const externalId =
      get('id') || (shopee ? `${shopee.shopId}.${shopee.itemId}` : createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 16))
    const commission = pct(get('commission'))
    const affiliateUrl = get('affiliateUrl')
    const image = get('image')
    rows.push({
      product: {
        marketplaceId: mk,
        externalId,
        title,
        url,
        shopName: get('shop') || null,
        category: get('category') || null,
        imageUrl: image && isSafeHttpUrl(image) ? image : null,
        priceCents: parseMoneyToCents(get('price') ?? null),
        originalPriceCents: parseMoneyToCents(get('originalPrice') ?? null),
        discountPct: pct(get('discount')),
        commissionRate: commission === null ? null : commission > 1 ? commission / 100 : commission,
        rating: pct(get('rating')),
        ratingCount: pct(get('ratingCount')),
        salesCount: pct(get('sales')),
        available: null,
        freeShipping: null,
        dataSource: 'csv'
      },
      affiliateUrl: affiliateUrl && isSafeHttpUrl(affiliateUrl) ? affiliateUrl : null,
      coupon: get('coupon') || null
    })
  })
  // desconto derivado somente de preços informados
  for (const r of rows) {
    const p = r.product
    if (p.discountPct == null && p.originalPriceCents && p.priceCents && p.originalPriceCents > p.priceCents)
      p.discountPct = Math.round((1 - p.priceCents / p.originalPriceCents) * 1000) / 10
  }
  return { rows, errors }
}
