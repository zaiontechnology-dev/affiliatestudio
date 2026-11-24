import type { Db } from './db'
import { boolOrNull, intOrNull, json, nowIso, transaction } from './db'
import { normalizeUrl } from '../core/urls'
import { BUILTIN_TEMPLATES } from '../core/smart-copy'
import { CATEGORIES } from '../shared/brand'
import type {
  AffiliateLink,
  AppSettings,
  AudienceProfile,
  Campaign,
  ChannelAccount,
  ChannelId,
  Destination,
  IntegrationStatus,
  LogEntry,
  MarketplaceAccount,
  MarketplaceId,
  MarketplaceInfo,
  MessageTemplate,
  PriceObservation,
  PriceStats,
  Product,
  ProductInput,
  QueueItem,
  QueueStatus
} from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'

type Row = Record<string, unknown>
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export interface ProductFilter {
  search?: string
  marketplaceId?: MarketplaceId
  category?: string
  minPriceCents?: number
  maxPriceCents?: number
  minDiscountPct?: number
  minCommissionRate?: number
  minRating?: number
  minSales?: number
  favoritesOnly?: boolean
  includeBlocked?: boolean
  limit?: number
  offset?: number
}

export class Repository {
  constructor(readonly db: Db) {}

  // ───────────────────────── seed ─────────────────────────
  seed(marketplaces: MarketplaceInfo[]): void {
    transaction(this.db, () => {
      const insMk = this.db.prepare('INSERT INTO marketplaces (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name')
      const delCap = this.db.prepare('DELETE FROM integration_capabilities WHERE marketplace_id = ?')
      const insCap = this.db.prepare('INSERT INTO integration_capabilities (marketplace_id, capability, status, note) VALUES (?, ?, ?, ?)')
      for (const m of marketplaces) {
        insMk.run(m.id, m.name)
        delCap.run(m.id)
        for (const c of m.capabilities) insCap.run(m.id, c.capability, c.status, c.note ?? null)
      }
      const insCh = this.db.prepare('INSERT OR IGNORE INTO channels (id, name) VALUES (?, ?)')
      insCh.run('telegram', 'Telegram')
      insCh.run('whatsapp_assisted', 'WhatsApp (modo assistido)')
      insCh.run('whatsapp_cloud', 'WhatsApp Cloud API')
      const insCat = this.db.prepare('INSERT OR IGNORE INTO product_categories (name) VALUES (?)')
      for (const c of CATEGORIES) insCat.run(c)
      const insT = this.db.prepare('INSERT OR IGNORE INTO message_templates (name, style, body, is_builtin) VALUES (?, ?, ?, 1)')
      for (const t of BUILTIN_TEMPLATES) insT.run(t.name, t.style, t.body)
      // campanha demonstrativa — criada como RASCUNHO, nunca ativa automaticamente
      const tpl = this.db.prepare("SELECT id FROM message_templates WHERE name = 'Achadinho do dia'").get() as Row | undefined
      this.db
        .prepare(
          `INSERT OR IGNORE INTO campaigns (name, description, status, mode, marketplaces, min_discount_pct, min_commission_rate, min_score,
             start_time, end_time, interval_minutes, daily_limit, repeat_days, template_id)
           VALUES ('Achadinhos Gerais (demonstração)', 'Configuração demonstrativa. Revise, vincule destinos e ative manualmente.', 'draft', 'auto',
             '["shopee","mercado-livre"]', 20, 0.05, 75, '08:00', '22:00', 30, 28, 7, ?)`
        )
        .run(n(tpl?.id))
    })
  }

  // ───────────────────────── settings ─────────────────────────
  getSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    for (const r of rows) out[r.key] = json(r.value, (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[r.key])
    return out as unknown as AppSettings
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    )
    transaction(this.db, () => {
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) stmt.run(k, JSON.stringify(v), nowIso())
    })
    return this.getSettings()
  }

  getKv<T>(key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(`_kv:${key}`) as Row | undefined
    return r ? json<T>(s(r.value), fallback) : fallback
  }
  setKv(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = ?')
      .run(`_kv:${key}`, JSON.stringify(value), nowIso())
  }

  // ───────────────────────── marketplace accounts ─────────────────────────
  private mapAccount(r: Row): MarketplaceAccount {
    return {
      id: Number(r.id),
      marketplaceId: s(r.marketplace_id) as MarketplaceId,
      label: s(r.label),
      status: s(r.status) as IntegrationStatus,
      accountRef: sn(r.account_ref),
      lastSyncAt: sn(r.last_sync_at),
      lastError: sn(r.last_error),
      hasCredentials: !!r.secret_ref,
      createdAt: s(r.created_at)
    }
  }

  listAccounts(): MarketplaceAccount[] {
    return (this.db.prepare('SELECT * FROM marketplace_accounts ORDER BY marketplace_id, id').all() as Row[]).map((r) => this.mapAccount(r))
  }

  getAccount(id: number): MarketplaceAccount & { secretRef: string | null } {
    const r = this.db.prepare('SELECT * FROM marketplace_accounts WHERE id = ?').get(id) as Row | undefined
    if (!r) throw new Error('Conta não encontrada.')
    return { ...this.mapAccount(r), secretRef: sn(r.secret_ref) }
  }

  primaryAccount(marketplaceId: MarketplaceId): (MarketplaceAccount & { secretRef: string | null }) | null {
    const r = this.db
      .prepare("SELECT * FROM marketplace_accounts WHERE marketplace_id = ? ORDER BY (status = 'connected') DESC, id LIMIT 1")
      .get(marketplaceId) as Row | undefined
    return r ? { ...this.mapAccount(r), secretRef: sn(r.secret_ref) } : null
  }

  upsertAccount(marketplaceId: MarketplaceId, label: string, secretRef: string | null): number {
    this.db
      .prepare(
        `INSERT INTO marketplace_accounts (marketplace_id, label, secret_ref, status) VALUES (?, ?, ?, 'awaiting_auth')
         ON CONFLICT(marketplace_id, label) DO UPDATE SET secret_ref = excluded.secret_ref, status = 'awaiting_auth', updated_at = ?`
      )
      .run(marketplaceId, label, secretRef, nowIso())
    const r = this.db.prepare('SELECT id FROM marketplace_accounts WHERE marketplace_id = ? AND label = ?').get(marketplaceId, label) as Row
    return Number(r.id)
  }

  setAccountStatus(id: number, status: IntegrationStatus, patch: { error?: string | null; accountRef?: string | null; synced?: boolean } = {}): void {
    this.db
      .prepare(
        `UPDATE marketplace_accounts SET status = ?, last_error = ?, account_ref = COALESCE(?, account_ref),
         last_sync_at = CASE WHEN ? THEN ? ELSE last_sync_at END, updated_at = ? WHERE id = ?`
      )
      .run(status, patch.error ?? null, patch.accountRef ?? null, patch.synced ? 1 : 0, nowIso(), nowIso(), id)
  }

  deleteAccount(id: number): void {
    this.db.prepare('DELETE FROM marketplace_accounts WHERE id = ?').run(id)
  }

  // ───────────────────────── products ─────────────────────────
  private categoryId(name: string | null | undefined): number | null {
    if (!name) return null
    this.db.prepare('INSERT OR IGNORE INTO product_categories (name) VALUES (?)').run(name)
    const r = this.db.prepare('SELECT id FROM product_categories WHERE name = ?').get(name) as Row
    return Number(r.id)
  }

  /** Insere/atualiza o produto e registra observação de preço/comissão (apenas dados reais). */
  upsertProduct(p: ProductInput, observedAt = nowIso()): number {
    return transaction(this.db, () => {
      const catId = this.categoryId(p.category)
      this.db
        .prepare(
          `INSERT INTO products (marketplace_id, external_id, title, url, normalized_url, shop_id, shop_name, category_id, image_url,
             price_cents, original_price_cents, discount_pct, commission_rate, commission_cents, rating, rating_count, sales_count,
             available, free_shipping, offer_link, data_source, raw_json, last_checked_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(marketplace_id, external_id) DO UPDATE SET
             title = excluded.title, url = excluded.url, normalized_url = excluded.normalized_url,
             shop_id = COALESCE(excluded.shop_id, shop_id), shop_name = COALESCE(excluded.shop_name, shop_name),
             category_id = COALESCE(excluded.category_id, category_id), image_url = COALESCE(excluded.image_url, image_url),
             price_cents = excluded.price_cents, original_price_cents = excluded.original_price_cents,
             discount_pct = excluded.discount_pct, commission_rate = excluded.commission_rate, commission_cents = excluded.commission_cents,
             rating = excluded.rating, rating_count = excluded.rating_count, sales_count = excluded.sales_count,
             available = excluded.available, free_shipping = excluded.free_shipping, offer_link = COALESCE(excluded.offer_link, offer_link),
             data_source = excluded.data_source, raw_json = excluded.raw_json, last_checked_at = excluded.last_checked_at,
             updated_at = excluded.last_checked_at`
        )
        .run(
          p.marketplaceId,
          p.externalId,
          p.title,
          p.url,
          normalizeUrl(p.url),
          p.shopId ?? null,
          p.shopName ?? null,
          catId,
          p.imageUrl ?? null,
          p.priceCents ?? null,
          p.originalPriceCents ?? null,
          p.discountPct ?? null,
          p.commissionRate ?? null,
          p.commissionCents ?? null,
          p.rating ?? null,
          p.ratingCount ?? null,
          p.salesCount ?? null,
          intOrNull(p.available),
          intOrNull(p.freeShipping),
          p.offerLink ?? null,
          p.dataSource,
          p.raw === undefined ? null : JSON.stringify(p.raw).slice(0, 20_000),
          observedAt
        )
      const id = Number(
        (this.db.prepare('SELECT id FROM products WHERE marketplace_id = ? AND external_id = ?').get(p.marketplaceId, p.externalId) as Row).id
      )
      if (p.priceCents !== null && p.priceCents !== undefined) {
        const last = this.db
          .prepare('SELECT price_cents, observed_at FROM product_price_history WHERE product_id = ? ORDER BY observed_at DESC LIMIT 1')
          .get(id) as Row | undefined
        // registra se o preço mudou ou se a última observação tem mais de 6h
        const stale = !last || Date.parse(observedAt) - Date.parse(s(last.observed_at)) > 6 * 3600_000
        if (!last || Number(last.price_cents) !== p.priceCents || stale) {
          this.db
            .prepare('INSERT INTO product_price_history (product_id, price_cents, original_price_cents, source, observed_at) VALUES (?,?,?,?,?)')
            .run(id, p.priceCents, p.originalPriceCents ?? null, p.dataSource, observedAt)
        }
      }
      if (p.commissionRate !== null && p.commissionRate !== undefined) {
        this.db
          .prepare('INSERT INTO product_commissions (product_id, rate, amount_cents, source, observed_at) VALUES (?,?,?,?,?)')
          .run(id, p.commissionRate, p.commissionCents ?? null, p.dataSource, observedAt)
      }
      if (p.imageUrl) this.db.prepare('INSERT OR IGNORE INTO product_images (product_id, url, is_primary) VALUES (?, ?, 1)').run(id, p.imageUrl)
      return id
    })
  }

  private mapProduct(r: Row): Product {
    return {
      id: Number(r.id),
      marketplaceId: s(r.marketplace_id) as MarketplaceId,
      externalId: s(r.external_id),
      title: s(r.title),
      url: s(r.url),
      normalizedUrl: s(r.normalized_url),
      shopId: sn(r.shop_id),
      shopName: sn(r.shop_name),
      category: sn(r.category_name),
      imageUrl: sn(r.image_url),
      priceCents: n(r.price_cents),
      originalPriceCents: n(r.original_price_cents),
      discountPct: n(r.discount_pct),
      commissionRate: n(r.commission_rate),
      commissionCents: n(r.commission_cents),
      rating: n(r.rating),
      ratingCount: n(r.rating_count),
      salesCount: n(r.sales_count),
      available: boolOrNull(r.available),
      freeShipping: boolOrNull(r.free_shipping),
      offerLink: sn(r.offer_link),
      dataSource: s(r.data_source) as Product['dataSource'],
      lastCheckedAt: sn(r.last_checked_at),
      createdAt: s(r.created_at),
      updatedAt: s(r.updated_at),
      isFavorite: Number(r.is_favorite) === 1,
      isBlocked: Number(r.is_blocked) === 1
    }
  }

  private productSelect = `SELECT p.*, c.name AS category_name,
      EXISTS(SELECT 1 FROM favorites f WHERE f.product_id = p.id) AS is_favorite,
      (EXISTS(SELECT 1 FROM blocked_products b WHERE b.product_id = p.id)
        OR EXISTS(SELECT 1 FROM blocked_sellers bs WHERE bs.marketplace_id = p.marketplace_id AND bs.shop_id = p.shop_id)) AS is_blocked
    FROM products p LEFT JOIN product_categories c ON c.id = p.category_id`

  getProduct(id: number): Product | null {
    const r = this.db.prepare(`${this.productSelect} WHERE p.id = ?`).get(id) as Row | undefined
    return r ? this.mapProduct(r) : null
  }

  listProducts(f: ProductFilter = {}): Product[] {
    const where: string[] = []
    const args: Array<string | number> = []
    if (f.search) {
      where.push('(p.title LIKE ? OR p.external_id = ?)')
      args.push(`%${f.search}%`, f.search)
    }
    if (f.marketplaceId) {
      where.push('p.marketplace_id = ?')
      args.push(f.marketplaceId)
    }
    if (f.category) {
      where.push('c.name = ?')
      args.push(f.category)
    }
    if (f.minPriceCents !== undefined) {
      where.push('p.price_cents >= ?')
      args.push(f.minPriceCents)
    }
    if (f.maxPriceCents !== undefined) {
      where.push('p.price_cents <= ?')
      args.push(f.maxPriceCents)
    }
    if (f.minDiscountPct !== undefined) {
      where.push('p.discount_pct >= ?')
      args.push(f.minDiscountPct)
    }
    if (f.minCommissionRate !== undefined) {
      where.push('p.commission_rate >= ?')
      args.push(f.minCommissionRate)
    }
    if (f.minRating !== undefined) {
      where.push('p.rating >= ?')
      args.push(f.minRating)
    }
    if (f.minSales !== undefined) {
      where.push('p.sales_count >= ?')
      args.push(f.minSales)
    }
    if (f.favoritesOnly) where.push('EXISTS(SELECT 1 FROM favorites f WHERE f.product_id = p.id)')
    const sql = `SELECT * FROM (${this.productSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}) x
      ${f.includeBlocked ? '' : 'WHERE x.is_blocked = 0'} ORDER BY x.updated_at DESC LIMIT ? OFFSET ?`
    args.push(Math.min(f.limit ?? 200, 1000), f.offset ?? 0)
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => this.mapProduct(r))
  }

  countProducts(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS c FROM products').get() as Row).c)
  }

  setFavorite(productId: number, on: boolean): void {
    if (on) this.db.prepare('INSERT OR IGNORE INTO favorites (product_id) VALUES (?)').run(productId)
    else this.db.prepare('DELETE FROM favorites WHERE product_id = ?').run(productId)
  }

  setBlocked(productId: number, on: boolean, reason?: string): void {
    if (on) this.db.prepare('INSERT OR REPLACE INTO blocked_products (product_id, reason) VALUES (?, ?)').run(productId, reason ?? null)
    else this.db.prepare('DELETE FROM blocked_products WHERE product_id = ?').run(productId)
  }

  blockSeller(marketplaceId: MarketplaceId, shopId: string, shopName: string | null, on: boolean): void {
    if (on)
      this.db.prepare('INSERT OR IGNORE INTO blocked_sellers (marketplace_id, shop_id, shop_name) VALUES (?, ?, ?)').run(marketplaceId, shopId, shopName)
    else this.db.prepare('DELETE FROM blocked_sellers WHERE marketplace_id = ? AND shop_id = ?').run(marketplaceId, shopId)
  }

  listBlockedSellers(): Array<{ marketplaceId: string; shopId: string; shopName: string | null }> {
    return (this.db.prepare('SELECT * FROM blocked_sellers ORDER BY created_at DESC').all() as Row[]).map((r) => ({
      marketplaceId: s(r.marketplace_id),
      shopId: s(r.shop_id),
      shopName: sn(r.shop_name)
    }))
  }

  favoriteProductIds(): number[] {
    return (this.db.prepare('SELECT product_id FROM favorites WHERE monitor_price = 1').all() as Row[]).map((r) => Number(r.product_id))
  }

  // ───────────────────────── price radar ─────────────────────────
  priceHistory(productId: number, sinceIso?: string): PriceObservation[] {
    const rows = this.db
      .prepare(
        `SELECT price_cents, original_price_cents, source, observed_at FROM product_price_history
         WHERE product_id = ? ${sinceIso ? 'AND observed_at >= ?' : ''} ORDER BY observed_at`
      )
      .all(...(sinceIso ? [productId, sinceIso] : [productId])) as Row[]
    return rows.map((r) => ({
      priceCents: Number(r.price_cents),
      originalPriceCents: n(r.original_price_cents),
      source: s(r.source),
      observedAt: s(r.observed_at)
    }))
  }

  priceStats(productId: number, sinceIso?: string): PriceStats {
    const h = this.priceHistory(productId, sinceIso)
    if (!h.length) return { current: null, min: null, max: null, avg: null, count: 0, changePct: null }
    const prices = h.map((x) => x.priceCents)
    const first = prices[0]!
    const current = prices[prices.length - 1]!
    return {
      current,
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      count: prices.length,
      changePct: first > 0 ? Math.round(((current - first) / first) * 1000) / 10 : null
    }
  }

  /** Produtos cujo último preço caiu em relação à observação anterior. */
  priceDrops(sinceIso: string, minDropPct = 5): Array<{ product: Product; previous: number; current: number; dropPct: number }> {
    const rows = this.db
      .prepare(
        `WITH ranked AS (
           SELECT product_id, price_cents, observed_at,
             ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY observed_at DESC) AS rn
           FROM product_price_history)
         SELECT a.product_id, a.price_cents AS cur, b.price_cents AS prev
         FROM ranked a JOIN ranked b ON a.product_id = b.product_id AND b.rn = 2
         WHERE a.rn = 1 AND a.observed_at >= ? AND a.price_cents < b.price_cents`
      )
      .all(sinceIso) as Row[]
    const out: Array<{ product: Product; previous: number; current: number; dropPct: number }> = []
    for (const r of rows) {
      const prev = Number(r.prev)
      const cur = Number(r.cur)
      const dropPct = Math.round(((prev - cur) / prev) * 1000) / 10
      if (dropPct < minDropPct) continue
      const product = this.getProduct(Number(r.product_id))
      if (product) out.push({ product, previous: prev, current: cur, dropPct })
    }
    return out.sort((a, b) => b.dropPct - a.dropPct)
  }

  // ───────────────────────── affiliate links ─────────────────────────
  saveAffiliateLink(l: Omit<AffiliateLink, 'id' | 'createdAt'>): number {
    this.db
      .prepare(
        `INSERT INTO affiliate_links (product_id, marketplace_id, account_id, original_url, affiliate_url, sub_ids, status, generated_by)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(account_id, original_url, sub_ids) DO UPDATE SET affiliate_url = excluded.affiliate_url, status = excluded.status,
           product_id = COALESCE(excluded.product_id, product_id)`
      )
      .run(l.productId, l.marketplaceId, l.accountId, l.originalUrl, l.affiliateUrl, JSON.stringify(l.subIds), l.status, l.generatedBy)
    const r = this.db
      .prepare('SELECT id FROM affiliate_links WHERE account_id IS ? AND original_url = ? AND sub_ids = ?')
      .get(l.accountId, l.originalUrl, JSON.stringify(l.subIds)) as Row
    return Number(r.id)
  }

  listAffiliateLinks(limit = 100): AffiliateLink[] {
    return (this.db.prepare('SELECT * FROM affiliate_links ORDER BY created_at DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      id: Number(r.id),
      productId: n(r.product_id),
      marketplaceId: s(r.marketplace_id) as MarketplaceId,
      accountId: n(r.account_id),
      originalUrl: s(r.original_url),
      affiliateUrl: s(r.affiliate_url),
      subIds: json<string[]>(sn(r.sub_ids), []),
      status: s(r.status) as AffiliateLink['status'],
      generatedBy: s(r.generated_by) as AffiliateLink['generatedBy'],
      createdAt: s(r.created_at)
    }))
  }

  getAffiliateLink(id: number): AffiliateLink | null {
    return this.listAffiliateLinksWhere('id = ?', [id])[0] ?? null
  }

  /** Link válido mais recente para o produto (gerado pela API ou cadastrado manualmente). */
  latestLinkForProduct(productId: number, maxAgeHours = 24 * 30): AffiliateLink | null {
    const since = new Date(Date.now() - maxAgeHours * 3600_000).toISOString()
    return this.listAffiliateLinksWhere("product_id = ? AND status IN ('valid','unverified') AND created_at >= ?", [productId, since])[0] ?? null
  }

  private listAffiliateLinksWhere(where: string, args: Array<string | number>): AffiliateLink[] {
    return (this.db.prepare(`SELECT * FROM affiliate_links WHERE ${where} ORDER BY (status='valid') DESC, created_at DESC`).all(...args) as Row[]).map(
      (r) => ({
        id: Number(r.id),
        productId: n(r.product_id),
        marketplaceId: s(r.marketplace_id) as MarketplaceId,
        accountId: n(r.account_id),
        originalUrl: s(r.original_url),
        affiliateUrl: s(r.affiliate_url),
        subIds: json<string[]>(sn(r.sub_ids), []),
        status: s(r.status) as AffiliateLink['status'],
        generatedBy: s(r.generated_by) as AffiliateLink['generatedBy'],
        createdAt: s(r.created_at)
      })
    )
  }

  // ───────────────────────── coupons ─────────────────────────
  addCoupon(c: { marketplaceId: MarketplaceId; productId: number | null; code: string; description?: string; validUntil?: string | null; source: string }): void {
    this.db
      .prepare('INSERT OR REPLACE INTO coupons (marketplace_id, product_id, code, description, valid_until, source) VALUES (?,?,?,?,?,?)')
      .run(c.marketplaceId, c.productId, c.code, c.description ?? null, c.validUntil ?? null, c.source)
  }

  activeCouponForProduct(productId: number, now = nowIso()): { code: string; validUntil: string | null } | null {
    const r = this.db
      .prepare(
        `SELECT code, valid_until FROM coupons WHERE product_id = ? AND (valid_until IS NULL OR valid_until > ?) ORDER BY created_at DESC LIMIT 1`
      )
      .get(productId, now) as Row | undefined
    return r ? { code: s(r.code), validUntil: sn(r.valid_until) } : null
  }

  listCoupons(): Array<{ id: number; marketplaceId: string; productId: number | null; code: string; description: string | null; validUntil: string | null }> {
    return (this.db.prepare('SELECT * FROM coupons ORDER BY created_at DESC LIMIT 200').all() as Row[]).map((r) => ({
      id: Number(r.id),
      marketplaceId: s(r.marketplace_id),
      productId: n(r.product_id),
      code: s(r.code),
      description: sn(r.description),
      validUntil: sn(r.valid_until)
    }))
  }

  deleteCoupon(id: number): void {
    this.db.prepare('DELETE FROM coupons WHERE id = ?').run(id)
  }

  // ───────────────────────── audience profiles ─────────────────────────
  listAudienceProfiles(): AudienceProfile[] {
    return (this.db.prepare('SELECT * FROM audience_profiles ORDER BY name').all() as Row[]).map((r) => ({
      id: Number(r.id),
      name: s(r.name),
      description: s(r.description),
      categories: json<string[]>(sn(r.categories), []),
      keywords: json<string[]>(sn(r.keywords), []),
      maxPriceCents: n(r.max_price_cents)
    }))
  }

  getAudienceProfile(id: number | null): AudienceProfile | null {
    if (id === null) return null
    return this.listAudienceProfiles().find((p) => p.id === id) ?? null
  }

  saveAudienceProfile(p: Omit<AudienceProfile, 'id'> & { id?: number }): number {
    if (p.id) {
      this.db
        .prepare('UPDATE audience_profiles SET name=?, description=?, categories=?, keywords=?, max_price_cents=? WHERE id=?')
        .run(p.name, p.description, JSON.stringify(p.categories), JSON.stringify(p.keywords), p.maxPriceCents, p.id)
      return p.id
    }
    const r = this.db
      .prepare('INSERT INTO audience_profiles (name, description, categories, keywords, max_price_cents) VALUES (?,?,?,?,?)')
      .run(p.name, p.description, JSON.stringify(p.categories), JSON.stringify(p.keywords), p.maxPriceCents)
    return Number(r.lastInsertRowid)
  }

  deleteAudienceProfile(id: number): void {
    this.db.prepare('DELETE FROM audience_profiles WHERE id = ?').run(id)
  }

  // ───────────────────────── channel accounts & destinations ─────────────────────────
  private mapChannelAccount(r: Row): ChannelAccount {
    return {
      id: Number(r.id),
      channelId: s(r.channel_id) as ChannelId,
      label: s(r.label),
      status: s(r.status) as IntegrationStatus,
      meta: json<Record<string, unknown>>(sn(r.meta), {}),
      lastError: sn(r.last_error),
      hasCredentials: !!r.secret_ref,
      createdAt: s(r.created_at)
    }
  }

  listChannelAccounts(): ChannelAccount[] {
    return (this.db.prepare('SELECT * FROM channel_accounts ORDER BY channel_id, id').all() as Row[]).map((r) => this.mapChannelAccount(r))
  }

  getChannelAccount(id: number): ChannelAccount & { secretRef: string | null } {
    const r = this.db.prepare('SELECT * FROM channel_accounts WHERE id = ?').get(id) as Row | undefined
    if (!r) throw new Error('Conta de canal não encontrada.')
    return { ...this.mapChannelAccount(r), secretRef: sn(r.secret_ref) }
  }

  upsertChannelAccount(channelId: ChannelId, label: string, secretRef: string | null): number {
    this.db
      .prepare(
        `INSERT INTO channel_accounts (channel_id, label, secret_ref, status) VALUES (?, ?, ?, 'awaiting_auth')
         ON CONFLICT(channel_id, label) DO UPDATE SET secret_ref = COALESCE(excluded.secret_ref, secret_ref), updated_at = ?`
      )
      .run(channelId, label, secretRef, nowIso())
    return Number((this.db.prepare('SELECT id FROM channel_accounts WHERE channel_id = ? AND label = ?').get(channelId, label) as Row).id)
  }

  setChannelAccountStatus(id: number, status: IntegrationStatus, error: string | null, meta?: Record<string, unknown>): void {
    this.db
      .prepare('UPDATE channel_accounts SET status = ?, last_error = ?, meta = COALESCE(?, meta), updated_at = ? WHERE id = ?')
      .run(status, error, meta ? JSON.stringify(meta) : null, nowIso(), id)
  }

  deleteChannelAccount(id: number): void {
    this.db.prepare('DELETE FROM channel_accounts WHERE id = ?').run(id)
  }

  private mapDestination(r: Row): Destination {
    return {
      id: Number(r.id),
      channelAccountId: Number(r.channel_account_id),
      channelId: s(r.channel_id) as ChannelId,
      name: s(r.name),
      externalId: s(r.external_id),
      status: s(r.status) as Destination['status'],
      audienceProfileId: n(r.audience_profile_id),
      categories: json<string[]>(sn(r.categories), []),
      allowedStart: s(r.allowed_start),
      allowedEnd: s(r.allowed_end),
      minIntervalMinutes: Number(r.min_interval_minutes),
      dailyLimit: Number(r.daily_limit),
      consentConfirmed: Number(r.consent_confirmed) === 1,
      permissions: json<Record<string, unknown>>(sn(r.permissions), {}),
      createdAt: s(r.created_at)
    }
  }

  listDestinations(): Destination[] {
    return (
      this.db
        .prepare('SELECT d.*, ca.channel_id FROM destinations d JOIN channel_accounts ca ON ca.id = d.channel_account_id ORDER BY d.name')
        .all() as Row[]
    ).map((r) => this.mapDestination(r))
  }

  getDestination(id: number): Destination | null {
    const r = this.db
      .prepare('SELECT d.*, ca.channel_id FROM destinations d JOIN channel_accounts ca ON ca.id = d.channel_account_id WHERE d.id = ?')
      .get(id) as Row | undefined
    return r ? this.mapDestination(r) : null
  }

  saveDestination(d: Omit<Destination, 'id' | 'createdAt' | 'channelId' | 'permissions' | 'status'> & { id?: number }): number {
    if (d.id) {
      this.db
        .prepare(
          `UPDATE destinations SET channel_account_id=?, name=?, external_id=?, audience_profile_id=?, categories=?, allowed_start=?, allowed_end=?,
           min_interval_minutes=?, daily_limit=?, consent_confirmed=?, updated_at=? WHERE id=?`
        )
        .run(
          d.channelAccountId,
          d.name,
          d.externalId,
          d.audienceProfileId,
          JSON.stringify(d.categories),
          d.allowedStart,
          d.allowedEnd,
          d.minIntervalMinutes,
          d.dailyLimit,
          d.consentConfirmed ? 1 : 0,
          nowIso(),
          d.id
        )
      return d.id
    }
    const r = this.db
      .prepare(
        `INSERT INTO destinations (channel_account_id, name, external_id, audience_profile_id, categories, allowed_start, allowed_end,
         min_interval_minutes, daily_limit, consent_confirmed) VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        d.channelAccountId,
        d.name,
        d.externalId,
        d.audienceProfileId,
        JSON.stringify(d.categories),
        d.allowedStart,
        d.allowedEnd,
        d.minIntervalMinutes,
        d.dailyLimit,
        d.consentConfirmed ? 1 : 0
      )
    return Number(r.lastInsertRowid)
  }

  setDestinationStatus(id: number, status: Destination['status'], permissions?: Record<string, unknown>): void {
    this.db
      .prepare('UPDATE destinations SET status = ?, permissions = COALESCE(?, permissions), updated_at = ? WHERE id = ?')
      .run(status, permissions ? JSON.stringify(permissions) : null, nowIso(), id)
  }

  deleteDestination(id: number): void {
    this.db.prepare('DELETE FROM destinations WHERE id = ?').run(id)
  }

  // ───────────────────────── templates ─────────────────────────
  listTemplates(): MessageTemplate[] {
    return (this.db.prepare('SELECT * FROM message_templates ORDER BY is_builtin DESC, name').all() as Row[]).map((r) => ({
      id: Number(r.id),
      name: s(r.name),
      style: s(r.style),
      body: s(r.body),
      isBuiltin: Number(r.is_builtin) === 1,
      createdAt: s(r.created_at),
      updatedAt: s(r.updated_at)
    }))
  }

  getTemplate(id: number | null): MessageTemplate | null {
    const all = this.listTemplates()
    return (id !== null ? all.find((t) => t.id === id) : undefined) ?? all[0] ?? null
  }

  saveTemplate(t: { id?: number; name: string; style: string; body: string }): number {
    if (t.id) {
      const cur = this.getTemplate(t.id)
      if (cur?.isBuiltin) throw new Error('Modelos padrão não podem ser editados. Duplique para personalizar.')
      this.db.prepare('UPDATE message_templates SET name=?, style=?, body=?, updated_at=? WHERE id=?').run(t.name, t.style, t.body, nowIso(), t.id)
      return t.id
    }
    return Number(this.db.prepare('INSERT INTO message_templates (name, style, body) VALUES (?,?,?)').run(t.name, t.style, t.body).lastInsertRowid)
  }

  deleteTemplate(id: number): void {
    const cur = this.getTemplate(id)
    if (cur?.isBuiltin) throw new Error('Modelos padrão não podem ser excluídos.')
    this.db.prepare('DELETE FROM message_templates WHERE id = ? AND is_builtin = 0').run(id)
  }

  // ───────────────────────── campaigns ─────────────────────────
  private mapCampaign(r: Row): Campaign {
    const dest = (this.db.prepare('SELECT destination_id FROM campaign_destinations WHERE campaign_id = ?').all(Number(r.id)) as Row[]).map((x) =>
      Number(x.destination_id)
    )
    return {
      id: Number(r.id),
      name: s(r.name),
      description: s(r.description),
      status: s(r.status) as Campaign['status'],
      mode: s(r.mode) as Campaign['mode'],
      marketplaces: json<MarketplaceId[]>(sn(r.marketplaces), []),
      categories: json<string[]>(sn(r.categories), []),
      keywords: json<string[]>(sn(r.keywords), []),
      excludedKeywords: json<string[]>(sn(r.excluded_keywords), []),
      minPriceCents: n(r.min_price_cents),
      maxPriceCents: n(r.max_price_cents),
      minDiscountPct: n(r.min_discount_pct),
      minCommissionRate: n(r.min_commission_rate),
      minScore: Number(r.min_score),
      minRating: n(r.min_rating),
      daysOfWeek: json<number[]>(sn(r.days_of_week), [0, 1, 2, 3, 4, 5, 6]),
      startTime: s(r.start_time),
      endTime: s(r.end_time),
      intervalMinutes: Number(r.interval_minutes),
      dailyLimit: Number(r.daily_limit),
      templateId: n(r.template_id),
      repeatDays: Number(r.repeat_days),
      repeatOnPriceDropPct: n(r.repeat_on_price_drop_pct),
      stalePolicy: s(r.stale_policy) as Campaign['stalePolicy'],
      destinationIds: dest,
      lastRunAt: sn(r.last_run_at),
      nextRunAt: sn(r.next_run_at),
      createdAt: s(r.created_at),
      updatedAt: s(r.updated_at)
    }
  }

  listCampaigns(): Campaign[] {
    return (this.db.prepare("SELECT * FROM campaigns ORDER BY status = 'active' DESC, name").all() as Row[]).map((r) => this.mapCampaign(r))
  }

  getCampaign(id: number): Campaign | null {
    const r = this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Row | undefined
    return r ? this.mapCampaign(r) : null
  }

  saveCampaign(c: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'nextRunAt'> & { id?: number }): number {
    return transaction(this.db, () => {
      const vals = [
        c.name,
        c.description,
        c.status,
        c.mode,
        JSON.stringify(c.marketplaces),
        JSON.stringify(c.categories),
        JSON.stringify(c.keywords),
        JSON.stringify(c.excludedKeywords),
        c.minPriceCents,
        c.maxPriceCents,
        c.minDiscountPct,
        c.minCommissionRate,
        c.minScore,
        c.minRating,
        JSON.stringify(c.daysOfWeek),
        c.startTime,
        c.endTime,
        c.intervalMinutes,
        c.dailyLimit,
        c.templateId,
        c.repeatDays,
        c.repeatOnPriceDropPct,
        c.stalePolicy
      ]
      let id = c.id
      if (id) {
        this.db
          .prepare(
            `UPDATE campaigns SET name=?, description=?, status=?, mode=?, marketplaces=?, categories=?, keywords=?, excluded_keywords=?,
             min_price_cents=?, max_price_cents=?, min_discount_pct=?, min_commission_rate=?, min_score=?, min_rating=?, days_of_week=?,
             start_time=?, end_time=?, interval_minutes=?, daily_limit=?, template_id=?, repeat_days=?, repeat_on_price_drop_pct=?, stale_policy=?,
             updated_at=? WHERE id=?`
          )
          .run(...vals, nowIso(), id)
      } else {
        id = Number(
          this.db
            .prepare(
              `INSERT INTO campaigns (name, description, status, mode, marketplaces, categories, keywords, excluded_keywords,
               min_price_cents, max_price_cents, min_discount_pct, min_commission_rate, min_score, min_rating, days_of_week,
               start_time, end_time, interval_minutes, daily_limit, template_id, repeat_days, repeat_on_price_drop_pct, stale_policy)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
            )
            .run(...vals).lastInsertRowid
        )
      }
      this.db.prepare('DELETE FROM campaign_destinations WHERE campaign_id = ?').run(id)
      const ins = this.db.prepare('INSERT INTO campaign_destinations (campaign_id, destination_id) VALUES (?, ?)')
      for (const d of c.destinationIds) ins.run(id, d)
      return id
    })
  }

  setCampaignStatus(id: number, status: Campaign['status']): void {
    this.db.prepare("UPDATE campaigns SET status = ?, next_run_at = CASE WHEN ? = 'active' THEN NULL ELSE next_run_at END, updated_at = ? WHERE id = ?").run(status, status, nowIso(), id)
  }

  setCampaignRun(id: number, lastRunAt: string, nextRunAt: string | null): void {
    this.db.prepare('UPDATE campaigns SET last_run_at = ?, next_run_at = ? WHERE id = ?').run(lastRunAt, nextRunAt, id)
  }

  deleteCampaign(id: number): void {
    this.db.prepare('DELETE FROM campaigns WHERE id = ?').run(id)
  }

  // ───────────────────────── queue ─────────────────────────
  enqueue(item: {
    campaignId: number | null
    productId: number
    destinationId: number
    affiliateLinkId: number | null
    messageText: string
    imageUrl: string | null
    status: QueueStatus
    scheduledAt: string
    priceCents: number | null
    idempotencyKey: string
  }): number | null {
    const r = this.db
      .prepare(
        `INSERT OR IGNORE INTO publication_queue (campaign_id, product_id, destination_id, affiliate_link_id, message_text, image_url, status,
         scheduled_at, position, price_cents_at_enqueue, idempotency_key)
         VALUES (?,?,?,?,?,?,?,?, (SELECT COALESCE(MAX(position),0)+1 FROM publication_queue), ?, ?)`
      )
      .run(
        item.campaignId,
        item.productId,
        item.destinationId,
        item.affiliateLinkId,
        item.messageText,
        item.imageUrl,
        item.status,
        item.scheduledAt,
        item.priceCents,
        item.idempotencyKey
      )
    return r.changes ? Number(r.lastInsertRowid) : null
  }

  private queueSelect = `SELECT q.*, c.name AS campaign_name, p.title AS product_title, d.name AS destination_name, ca.channel_id,
      al.affiliate_url
    FROM publication_queue q
    JOIN products p ON p.id = q.product_id
    JOIN destinations d ON d.id = q.destination_id
    JOIN channel_accounts ca ON ca.id = d.channel_account_id
    LEFT JOIN campaigns c ON c.id = q.campaign_id
    LEFT JOIN affiliate_links al ON al.id = q.affiliate_link_id`

  private mapQueue(r: Row): QueueItem {
    return {
      id: Number(r.id),
      campaignId: n(r.campaign_id),
      campaignName: sn(r.campaign_name),
      productId: Number(r.product_id),
      productTitle: s(r.product_title),
      destinationId: Number(r.destination_id),
      destinationName: s(r.destination_name),
      channelId: s(r.channel_id) as ChannelId,
      affiliateUrl: sn(r.affiliate_url),
      messageText: s(r.message_text),
      imageUrl: sn(r.image_url),
      status: s(r.status) as QueueStatus,
      scheduledAt: s(r.scheduled_at),
      position: Number(r.position),
      attempts: Number(r.attempts),
      lastError: sn(r.last_error),
      createdAt: s(r.created_at),
      updatedAt: s(r.updated_at)
    }
  }

  listQueue(statuses?: QueueStatus[], limit = 300): QueueItem[] {
    const where = statuses?.length ? `WHERE q.status IN (${statuses.map(() => '?').join(',')})` : ''
    return (this.db.prepare(`${this.queueSelect} ${where} ORDER BY q.scheduled_at, q.position LIMIT ?`).all(...(statuses ?? []), limit) as Row[]).map((r) =>
      this.mapQueue(r)
    )
  }

  getQueueItem(id: number): (QueueItem & { priceCentsAtEnqueue: number | null }) | null {
    const r = this.db.prepare(`${this.queueSelect} WHERE q.id = ?`).get(id) as Row | undefined
    return r ? { ...this.mapQueue(r), priceCentsAtEnqueue: n(r.price_cents_at_enqueue) } : null
  }

  /** Transição atômica de status (compare-and-set). Retorna false se o item não estava em `from`. */
  transitionQueue(id: number, from: QueueStatus[], to: QueueStatus, patch: { error?: string | null; scheduledAt?: string; incAttempt?: boolean } = {}): boolean {
    const r = this.db
      .prepare(
        `UPDATE publication_queue SET status = ?, last_error = COALESCE(?, last_error), scheduled_at = COALESCE(?, scheduled_at),
         attempts = attempts + ?, approved_at = CASE WHEN ? = 'scheduled' AND status = 'awaiting_approval' THEN ? ELSE approved_at END,
         updated_at = ? WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`
      )
      .run(to, patch.error ?? null, patch.scheduledAt ?? null, patch.incAttempt ? 1 : 0, to, nowIso(), nowIso(), id, ...from)
    return r.changes === 1
  }

  updateQueueMessage(id: number, text: string, scheduledAt?: string): void {
    this.db
      .prepare(
        `UPDATE publication_queue SET message_text = ?, scheduled_at = COALESCE(?, scheduled_at), updated_at = ?
         WHERE id = ? AND status IN ('pending','awaiting_approval','scheduled','failed')`
      )
      .run(text, scheduledAt ?? null, nowIso(), id)
  }

  moveQueue(id: number, direction: -1 | 1): void {
    const items = this.listQueue(['pending', 'awaiting_approval', 'scheduled'])
    const idx = items.findIndex((i) => i.id === id)
    const other = items[idx + direction]
    const cur = items[idx]
    if (!cur || !other) return
    transaction(this.db, () => {
      // troca horário e posição para refletir a nova ordem
      this.db.prepare('UPDATE publication_queue SET scheduled_at = ?, position = ? WHERE id = ?').run(other.scheduledAt, other.position, cur.id)
      this.db.prepare('UPDATE publication_queue SET scheduled_at = ?, position = ? WHERE id = ?').run(cur.scheduledAt, cur.position, other.id)
    })
  }

  dueQueueItems(nowIsoStr: string, limit = 20): QueueItem[] {
    return (
      this.db.prepare(`${this.queueSelect} WHERE q.status = 'scheduled' AND q.scheduled_at <= ? ORDER BY q.scheduled_at, q.position LIMIT ?`).all(
        nowIsoStr,
        limit
      ) as Row[]
    ).map((r) => this.mapQueue(r))
  }

  addAttempt(queueId: number, startedAt: string, outcome: string, error: string | null, response: unknown): void {
    this.db
      .prepare('INSERT INTO publication_attempts (queue_id, started_at, finished_at, outcome, error, response) VALUES (?,?,?,?,?,?)')
      .run(queueId, startedAt, nowIso(), outcome, error, response === undefined ? null : JSON.stringify(response).slice(0, 4000))
  }

  listAttempts(queueId: number): Array<{ startedAt: string; finishedAt: string | null; outcome: string | null; error: string | null }> {
    return (this.db.prepare('SELECT * FROM publication_attempts WHERE queue_id = ? ORDER BY id').all(queueId) as Row[]).map((r) => ({
      startedAt: s(r.started_at),
      finishedAt: sn(r.finished_at),
      outcome: sn(r.outcome),
      error: sn(r.error)
    }))
  }

  recordPublication(p: {
    queueId: number | null
    campaignId: number | null
    productId: number
    destinationId: number
    marketplaceId: string
    channelMessageId: string | null
    priceCents: number | null
    mode: 'api' | 'assisted'
    sentAt?: string
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO publications (queue_id, campaign_id, product_id, destination_id, marketplace_id, channel_message_id, price_cents, mode, sent_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(p.queueId, p.campaignId, p.productId, p.destinationId, p.marketplaceId, p.channelMessageId, p.priceCents, p.mode, p.sentAt ?? nowIso())
  }

  /** Última publicação (ou item em andamento na fila) do produto para o destino. */
  lastPublication(productId: number, destinationId: number): { sentAt: string; priceCents: number | null } | null {
    const r = this.db
      .prepare('SELECT sent_at, price_cents FROM publications WHERE product_id = ? AND destination_id = ? ORDER BY sent_at DESC LIMIT 1')
      .get(productId, destinationId) as Row | undefined
    return r ? { sentAt: s(r.sent_at), priceCents: n(r.price_cents) } : null
  }

  hasOpenQueueItem(productId: number, destinationId: number): boolean {
    return !!this.db
      .prepare(
        `SELECT 1 FROM publication_queue WHERE product_id = ? AND destination_id = ?
         AND status IN ('pending','awaiting_approval','scheduled','validating','processing','sending','unknown')`
      )
      .get(productId, destinationId)
  }

  countPublications(destinationId: number | null, sinceIso: string, campaignId?: number): number {
    const where = ['sent_at >= ?']
    const args: Array<string | number> = [sinceIso]
    if (destinationId !== null) {
      where.push('destination_id = ?')
      args.push(destinationId)
    }
    if (campaignId !== undefined) {
      where.push('campaign_id = ?')
      args.push(campaignId)
    }
    return Number((this.db.prepare(`SELECT COUNT(*) AS c FROM publications WHERE ${where.join(' AND ')}`).get(...args) as Row).c)
  }

  /** Itens que ocupam cota do dia (enviados + programados ainda abertos) por campanha. */
  countCampaignQueueSince(campaignId: number, sinceIso: string): number {
    return Number(
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS c FROM publication_queue WHERE campaign_id = ? AND created_at >= ?
             AND status NOT IN ('canceled','expired','failed')`
          )
          .get(campaignId, sinceIso) as Row
      ).c
    )
  }

  lastSentAtForDestination(destinationId: number): string | null {
    const r = this.db.prepare('SELECT MAX(sent_at) AS m FROM publications WHERE destination_id = ?').get(destinationId) as Row
    return sn(r.m)
  }

  listPublications(f: { from?: string; to?: string; limit?: number } = {}): Array<{
    id: number
    sentAt: string
    productTitle: string
    marketplaceId: string
    destinationName: string
    campaignName: string | null
    priceCents: number | null
    mode: string
    channelMessageId: string | null
  }> {
    const rows = this.db
      .prepare(
        `SELECT pb.*, p.title, d.name AS dname, c.name AS cname FROM publications pb
         JOIN products p ON p.id = pb.product_id JOIN destinations d ON d.id = pb.destination_id
         LEFT JOIN campaigns c ON c.id = pb.campaign_id
         WHERE pb.sent_at >= ? AND pb.sent_at <= ? ORDER BY pb.sent_at DESC LIMIT ?`
      )
      .all(f.from ?? '0000', f.to ?? '9999', f.limit ?? 500) as Row[]
    return rows.map((r) => ({
      id: Number(r.id),
      sentAt: s(r.sent_at),
      productTitle: s(r.title),
      marketplaceId: s(r.marketplace_id),
      destinationName: s(r.dname),
      campaignName: sn(r.cname),
      priceCents: n(r.price_cents),
      mode: s(r.mode),
      channelMessageId: sn(r.channel_message_id)
    }))
  }

  // ───────────────────────── conversions / commissions ─────────────────────────
  upsertConversion(c: {
    marketplaceId: MarketplaceId
    accountId: number | null
    externalOrderId: string
    productExternalId: string
    subIds: string[]
    clickTime: string | null
    purchaseTime: string | null
    status: string
    amountCents: number | null
    commissionCents: number | null
    source: 'api' | 'csv'
    raw?: unknown
  }): void {
    this.db
      .prepare(
        `INSERT INTO conversions (marketplace_id, account_id, external_order_id, product_external_id, sub_ids, click_time, purchase_time, status,
         amount_cents, commission_cents, source, raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(marketplace_id, external_order_id, product_external_id) DO UPDATE SET status = excluded.status,
           commission_cents = excluded.commission_cents, amount_cents = excluded.amount_cents`
      )
      .run(
        c.marketplaceId,
        c.accountId,
        c.externalOrderId,
        c.productExternalId,
        JSON.stringify(c.subIds),
        c.clickTime,
        c.purchaseTime,
        c.status,
        c.amountCents,
        c.commissionCents,
        c.source,
        c.raw === undefined ? null : JSON.stringify(c.raw).slice(0, 8000)
      )
  }

  conversionTotals(fromIso: string, toIso: string): { orders: number; estimatedCents: number; confirmedCents: number; canceledCents: number } {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS orders,
           COALESCE(SUM(CASE WHEN status IN ('pending','estimated','unpaid','PENDING','UNPAID') THEN commission_cents END),0) AS est,
           COALESCE(SUM(CASE WHEN status IN ('completed','approved','paid','COMPLETED','APPROVED','PAID') THEN commission_cents END),0) AS conf,
           COALESCE(SUM(CASE WHEN status IN ('canceled','cancelled','CANCELLED','CANCELED','INVALID') THEN commission_cents END),0) AS canc
         FROM conversions WHERE COALESCE(purchase_time, created_at) BETWEEN ? AND ?`
      )
      .get(fromIso, toIso) as Row
    return { orders: Number(r.orders), estimatedCents: Number(r.est), confirmedCents: Number(r.conf), canceledCents: Number(r.canc) }
  }

  listConversions(limit = 300): Array<Record<string, unknown>> {
    return (this.db.prepare('SELECT * FROM conversions ORDER BY COALESCE(purchase_time, created_at) DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      id: Number(r.id),
      marketplaceId: s(r.marketplace_id),
      orderId: s(r.external_order_id),
      productId: s(r.product_external_id),
      subIds: json<string[]>(sn(r.sub_ids), []),
      purchaseTime: sn(r.purchase_time),
      status: s(r.status),
      amountCents: n(r.amount_cents),
      commissionCents: n(r.commission_cents),
      source: s(r.source)
    }))
  }

  // ───────────────────────── logs & audit ─────────────────────────
  log(level: LogEntry['level'], scope: string, message: string, context?: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO application_logs (level, scope, message, context) VALUES (?,?,?,?)')
      .run(level, scope, message, context ? JSON.stringify(context).slice(0, 8000) : null)
  }

  listLogs(f: { level?: string; scope?: string; limit?: number } = {}): LogEntry[] {
    const where: string[] = []
    const args: Array<string | number> = []
    if (f.level) {
      where.push('level = ?')
      args.push(f.level)
    }
    if (f.scope) {
      where.push('scope = ?')
      args.push(f.scope)
    }
    args.push(f.limit ?? 300)
    return (
      this.db.prepare(`SELECT * FROM application_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args) as Row[]
    ).map((r) => ({
      id: Number(r.id),
      level: s(r.level) as LogEntry['level'],
      scope: s(r.scope),
      message: s(r.message),
      context: json<Record<string, unknown> | null>(sn(r.context), null),
      createdAt: s(r.created_at)
    }))
  }

  pruneLogs(keepDays = 30): void {
    this.db.prepare('DELETE FROM application_logs WHERE created_at < ?').run(new Date(Date.now() - keepDays * 86400_000).toISOString())
  }

  audit(action: string, entity?: string, entityId?: string | number, details?: Record<string, unknown>, actor = 'user'): void {
    this.db
      .prepare('INSERT INTO audit_logs (actor, action, entity, entity_id, details) VALUES (?,?,?,?,?)')
      .run(actor, action, entity ?? null, entityId === undefined ? null : String(entityId), details ? JSON.stringify(details) : null)
  }

  listAudit(limit = 200): Array<{ id: number; actor: string; action: string; entity: string | null; entityId: string | null; details: unknown; createdAt: string }> {
    return (this.db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      id: Number(r.id),
      actor: s(r.actor),
      action: s(r.action),
      entity: sn(r.entity),
      entityId: sn(r.entity_id),
      details: json(sn(r.details), null),
      createdAt: s(r.created_at)
    }))
  }
}
