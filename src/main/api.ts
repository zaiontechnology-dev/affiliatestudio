import { z } from 'zod'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppContext } from './context'
import { computeOfferScore, audienceMatch } from '../core/offer-score'
import { buildVariables, renderOfferMessage, unknownVariables, TEMPLATE_VARIABLES } from '../core/smart-copy'
import { detectMarketplace, isSafeHttpUrl, normalizeUrl, parseShopeeIds, sanitizeSubIds } from '../core/urls'
import { ConnectorError, supports } from '../integrations/marketplaces/types'
import { SecretUnavailableError } from '../security/secret-store'
import { redactString } from '../security/redact'
import { importProductsCsv, toCsv } from '../services/csv'
import { applyRetention, createBackup, listBackups, stageRestore, verifyBackupFile } from '../services/backup'
import { generateAiCopy, hardwareReport, ollamaStatus, type AiFacts } from '../intelligence/ai-copy'
import { integrityCheck } from '../database/db'
import { addMinutes, startOfLocalDayUtc } from '../core/schedule'
import { formatBRL, formatPct } from '../shared/money'
import { BRAND, CATEGORIES } from '../shared/brand'
import type { ChannelId, DashboardSummary, MarketplaceId, Product, QueueStatus } from '../shared/types'

/**
 * Superfície IPC. Cada método valida a entrada com Zod.
 * O renderer só consegue chamar métodos listados aqui (whitelist).
 */

const marketplaceId = z.enum(['shopee', 'mercado-livre', 'shein', 'amazon', 'aliexpress', 'magalu', 'temu', 'manual'])
const channelId = z.enum(['telegram', 'whatsapp_assisted', 'whatsapp_cloud'])
const id = z.number().int().positive()
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const safeUrl = z.string().max(2000).refine(isSafeHttpUrl, 'URL inválida')
const shortText = z.string().trim().max(200)
const strList = z.array(z.string().trim().max(100)).max(100)

const campaignSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).default(''),
  status: z.enum(['draft', 'active', 'paused']),
  mode: z.enum(['manual', 'semi', 'auto']),
  marketplaces: z.array(marketplaceId).max(10),
  categories: strList,
  keywords: strList,
  excludedKeywords: strList,
  minPriceCents: z.number().int().min(0).nullable(),
  maxPriceCents: z.number().int().min(0).nullable(),
  minDiscountPct: z.number().min(0).max(100).nullable(),
  minCommissionRate: z.number().min(0).max(1).nullable(),
  minScore: z.number().min(0).max(100),
  minRating: z.number().min(0).max(5).nullable(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: hhmm,
  endTime: hhmm,
  intervalMinutes: z.number().int().min(5).max(24 * 60),
  dailyLimit: z.number().int().min(1).max(500),
  templateId: id.nullable(),
  repeatDays: z.number().int().min(-1).max(365),
  repeatOnPriceDropPct: z.number().min(1).max(90).nullable(),
  stalePolicy: z.enum(['suspend', 'allow']),
  destinationIds: z.array(id).max(100)
})

const destinationSchema = z.object({
  id: id.optional(),
  channelAccountId: id,
  name: z.string().trim().min(1).max(120),
  externalId: z.string().trim().min(1).max(120),
  audienceProfileId: id.nullable(),
  categories: strList,
  allowedStart: hhmm,
  allowedEnd: hhmm,
  minIntervalMinutes: z.number().int().min(5).max(24 * 60),
  dailyLimit: z.number().int().min(1).max(200),
  consentConfirmed: z.boolean()
})

const settingsSchema = z
  .object({
    timezone: z.string().max(60),
    theme: z.enum(['dark', 'light', 'system']),
    closeBehavior: z.enum(['ask', 'tray', 'quit']),
    autoLaunch: z.boolean(),
    preventSleepWhileActive: z.boolean(),
    scoreWeights: z.object({
      sales: z.number().min(0).max(100),
      discount: z.number().min(0).max(100),
      commission: z.number().min(0).max(100),
      rating: z.number().min(0).max(100),
      audience: z.number().min(0).max(100),
      history: z.number().min(0).max(100)
    }),
    backupDailyEnabled: z.boolean(),
    backupWeeklyEnabled: z.boolean(),
    backupRetention: z.number().int().min(1).max(365),
    missedPublicationGraceMinutes: z.number().int().min(5).max(24 * 60),
    ai: z.object({
      provider: z.enum(['none', 'ollama', 'openai', 'anthropic']),
      ollamaUrl: z.string().max(200),
      model: z.string().max(100)
    }),
    disclosureText: z.string().trim().min(5).max(300),
    notificationsEnabled: z.boolean()
  })
  .partial()

export interface ApiHooks {
  onSettingsChanged(): void
  copyToClipboard(text: string): void
  openExternal(url: string): Promise<void>
  showSaveDialog(defaultName: string, filters: Array<{ name: string; extensions: string[] }>): Promise<string | null>
  showOpenDialog(filters: Array<{ name: string; extensions: string[] }>): Promise<string | null>
  readTextFile(path: string): string
  isOnline(): boolean | null
  gpuInfo(): Promise<string | null>
  appVersion(): string
}

function errorMessage(e: unknown): string {
  if (e instanceof ConnectorError || e instanceof SecretUnavailableError) return e.message
  if (e instanceof z.ZodError) return `Dados inválidos: ${e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
  return redactString((e as Error)?.message ?? String(e))
}

export function createApi(ctx: AppContext, hooks: ApiHooks) {
  const { repo, secrets, connectors, providers, autopilot } = ctx
  const tz = () => repo.getSettings().timezone

  const scoreProduct = (p: Product) =>
    computeOfferScore(
      { salesCount: p.salesCount, discountPct: p.discountPct, commissionRate: p.commissionRate, rating: p.rating, ratingCount: p.ratingCount },
      repo.getSettings().scoreWeights
    )

  const withScore = (list: Product[]) => list.map((p) => ({ ...p, score: scoreProduct(p) }))

  const mkCreds = (marketplace: MarketplaceId) => {
    const acc = repo.primaryAccount(marketplace)
    if (!acc?.secretRef) throw new Error(`Conecte uma conta ${connectors.get(marketplace).info.name} primeiro.`)
    const creds = secrets.get(acc.secretRef)
    if (!creds) throw new Error('Credenciais não encontradas. Conecte a conta novamente.')
    return { creds, acc }
  }

  const statusFromError = (e: unknown) =>
    e instanceof ConnectorError
      ? e.code === 'auth'
        ? 'expired'
        : e.code === 'rate_limit'
          ? 'rate_limited'
          : 'error'
      : e instanceof SecretUnavailableError
        ? 'expired'
        : 'error'

  const handlers: Record<string, (args: unknown) => unknown> = {
    // ───── sistema ─────
    'app.info': () => ({
      ...BRAND,
      version: hooks.appVersion(),
      paths: ctx.paths,
      secureStorage: secrets.isAvailable(),
      categories: CATEGORIES,
      templateVariables: TEMPLATE_VARIABLES
    }),
    'settings.get': () => repo.getSettings(),
    'settings.update': (a) => {
      const patch = settingsSchema.parse(a)
      const s = repo.updateSettings(patch)
      repo.audit('settings.update', 'settings', undefined, { keys: Object.keys(patch) })
      hooks.onSettingsChanged()
      return s
    },
    'dashboard.summary': (): DashboardSummary => dashboard(),

    // ───── marketplaces / contas ─────
    'marketplaces.list': () => {
      const accounts = repo.listAccounts()
      return connectors.list().map((info) => ({ info, accounts: accounts.filter((a) => a.marketplaceId === info.id) }))
    },
    'accounts.connect': async (a) => {
      const { marketplace, label, credentials } = z
        .object({ marketplace: marketplaceId, label: shortText.min(1), credentials: z.record(z.string(), z.string().max(500)) })
        .parse(a)
      const connector = connectors.get(marketplace)
      if (!supports(connector.info, 'authenticate')) throw new Error(`${connector.info.name}: integração oficial ainda não disponível.`)
      const ref = `marketplace:${marketplace}:${label}`
      secrets.set(ref, credentials)
      const accId = repo.upsertAccount(marketplace, label, ref)
      repo.audit('account.connect', 'marketplace_accounts', accId, { marketplace })
      try {
        const r = await connector.authenticate(credentials)
        repo.setAccountStatus(accId, r.ok ? 'connected' : 'error', { error: r.ok ? null : r.message, accountRef: r.accountRef ?? null, synced: r.ok })
        return { ok: r.ok, message: r.message, accountId: accId }
      } catch (e) {
        repo.setAccountStatus(accId, statusFromError(e), { error: errorMessage(e) })
        return { ok: false, message: errorMessage(e), accountId: accId }
      }
    },
    'accounts.test': async (a) => {
      const accId = id.parse(a)
      const acc = repo.getAccount(accId)
      try {
        if (!acc.secretRef) throw new Error('Conta sem credenciais.')
        const creds = secrets.get(acc.secretRef)
        if (!creds) throw new Error('Credenciais não encontradas.')
        const r = await connectors.get(acc.marketplaceId).testConnection(creds)
        repo.setAccountStatus(accId, r.ok ? 'connected' : 'error', { error: r.ok ? null : r.message, synced: r.ok })
        return r
      } catch (e) {
        repo.setAccountStatus(accId, statusFromError(e), { error: errorMessage(e) })
        return { ok: false, message: errorMessage(e) }
      }
    },
    'accounts.disconnect': (a) => {
      const accId = id.parse(a)
      const acc = repo.getAccount(accId)
      if (acc.secretRef) secrets.delete(acc.secretRef)
      repo.deleteAccount(accId)
      repo.audit('account.disconnect', 'marketplace_accounts', accId)
      return true
    },
    'accounts.syncConversions': async () => ({ imported: await autopilot.syncConversions(30) }),

    // ───── produtos / garimpo ─────
    'products.search': async (a) => {
      const q = z
        .object({
          marketplace: marketplaceId,
          keyword: z.string().trim().max(100).optional(),
          categoryId: z.string().max(20).optional(),
          sort: z.enum(['relevance', 'sales', 'price_asc', 'price_desc', 'commission']).optional(),
          page: z.number().int().min(1).max(100).optional(),
          category: z.string().max(60).optional()
        })
        .parse(a)
      const connector = connectors.get(q.marketplace)
      if (!supports(connector.info, 'searchProducts'))
        throw new Error(`${connector.info.name} não oferece pesquisa por API oficial. Use importação CSV ou cadastro manual.`)
      const { creds, acc } = mkCreds(q.marketplace)
      try {
        const res = await connector.searchProducts(creds, { keyword: q.keyword, categoryId: q.categoryId, sort: q.sort, page: q.page, limit: 30 })
        const ids = res.items.map((p) => repo.upsertProduct({ ...p, category: p.category ?? q.category ?? null }))
        repo.setAccountStatus(acc.id, 'connected', { synced: true })
        return { items: withScore(ids.map((i) => repo.getProduct(i)!).filter(Boolean)), hasNextPage: res.hasNextPage }
      } catch (e) {
        repo.setAccountStatus(acc.id, statusFromError(e), { error: errorMessage(e) })
        throw e
      }
    },
    'products.list': (a) => {
      const f = z
        .object({
          search: z.string().max(100).optional(),
          marketplaceId: marketplaceId.optional(),
          category: z.string().max(60).optional(),
          minPriceCents: z.number().int().optional(),
          maxPriceCents: z.number().int().optional(),
          minDiscountPct: z.number().optional(),
          minCommissionRate: z.number().optional(),
          minRating: z.number().optional(),
          minSales: z.number().optional(),
          minScore: z.number().optional(),
          favoritesOnly: z.boolean().optional(),
          includeBlocked: z.boolean().optional(),
          limit: z.number().int().max(1000).optional()
        })
        .parse(a ?? {})
      let list = withScore(repo.listProducts(f))
      if (f.minScore !== undefined) list = list.filter((p) => p.score.score >= f.minScore!)
      return list
    },
    'products.get': (a) => {
      const p = repo.getProduct(id.parse(a))
      return p ? { ...p, score: scoreProduct(p) } : null
    },
    'products.addManual': (a) => {
      const m = z
        .object({
          title: z.string().trim().min(2).max(300),
          url: safeUrl,
          affiliateUrl: safeUrl.optional().or(z.literal('')),
          priceCents: z.number().int().min(0).nullable(),
          originalPriceCents: z.number().int().min(0).nullable(),
          commissionRate: z.number().min(0).max(1).nullable(),
          category: z.string().max(60).nullable(),
          imageUrl: safeUrl.optional().or(z.literal('')),
          coupon: z.string().max(60).optional()
        })
        .parse(a)
      const mk = detectMarketplace(m.url) ?? 'manual'
      const sh = mk === 'shopee' ? parseShopeeIds(m.url) : null
      const discount =
        m.originalPriceCents && m.priceCents && m.originalPriceCents > m.priceCents
          ? Math.round((1 - m.priceCents / m.originalPriceCents) * 1000) / 10
          : null
      const pid = repo.upsertProduct({
        marketplaceId: mk,
        externalId: sh ? `${sh.shopId}.${sh.itemId}` : normalizeUrl(m.url).slice(0, 200),
        title: m.title,
        url: m.url,
        category: m.category,
        imageUrl: m.imageUrl || null,
        priceCents: m.priceCents,
        originalPriceCents: m.originalPriceCents,
        discountPct: discount,
        commissionRate: m.commissionRate,
        dataSource: 'manual'
      })
      if (m.affiliateUrl)
        repo.saveAffiliateLink({ productId: pid, marketplaceId: mk, accountId: null, originalUrl: m.url, affiliateUrl: m.affiliateUrl, subIds: [], status: 'unverified', generatedBy: 'manual' })
      if (m.coupon) repo.addCoupon({ marketplaceId: mk, productId: pid, code: m.coupon, source: 'manual' })
      repo.audit('product.manual_add', 'products', pid)
      return pid
    },
    'products.importCsv': async () => {
      const file = await hooks.showOpenDialog([{ name: 'CSV', extensions: ['csv', 'txt'] }])
      if (!file) return null
      const res = importProductsCsv(hooks.readTextFile(file))
      let imported = 0
      for (const r of res.rows) {
        const pid = repo.upsertProduct(r.product)
        if (r.affiliateUrl)
          repo.saveAffiliateLink({ productId: pid, marketplaceId: r.product.marketplaceId, accountId: null, originalUrl: r.product.url, affiliateUrl: r.affiliateUrl, subIds: [], status: 'unverified', generatedBy: 'manual' })
        if (r.coupon) repo.addCoupon({ marketplaceId: r.product.marketplaceId, productId: pid, code: r.coupon, source: 'csv' })
        imported++
      }
      repo.audit('product.csv_import', 'products', undefined, { imported, errors: res.errors.length })
      return { imported, errors: res.errors }
    },
    'products.favorite': (a) => {
      const { productId, on } = z.object({ productId: id, on: z.boolean() }).parse(a)
      repo.setFavorite(productId, on)
      return true
    },
    'products.block': (a) => {
      const { productId, on } = z.object({ productId: id, on: z.boolean() }).parse(a)
      repo.setBlocked(productId, on)
      return true
    },
    'products.blockSeller': (a) => {
      const { productId, on } = z.object({ productId: id, on: z.boolean() }).parse(a)
      const p = repo.getProduct(productId)
      if (!p?.shopId) throw new Error('Loja não identificada para este produto.')
      repo.blockSeller(p.marketplaceId, p.shopId, p.shopName, on)
      return true
    },
    'products.refresh': async (a) => {
      const p = repo.getProduct(id.parse(a))
      if (!p) throw new Error('Produto não encontrado.')
      const connector = connectors.get(p.marketplaceId)
      if (!supports(connector.info, 'productDetails')) throw new Error(`${connector.info.name}: consulta oficial indisponível.`)
      const { creds } = mkCreds(p.marketplaceId)
      const fresh = await connector.getProductDetails(creds, { externalId: p.externalId, url: p.url })
      if (!fresh) {
        repo.upsertProduct({ ...p, available: false })
        return { available: false }
      }
      repo.upsertProduct(fresh)
      return { available: true }
    },
    'products.openOriginal': async (a) => {
      const p = repo.getProduct(id.parse(a))
      if (!p || !isSafeHttpUrl(p.url)) throw new Error('URL inválida.')
      await hooks.openExternal(p.url)
      return true
    },
    'sellers.listBlocked': () => repo.listBlockedSellers(),

    // ───── price radar ─────
    'prices.history': (a) => {
      const { productId, days } = z.object({ productId: id, days: z.number().int().min(1).max(365) }).parse(a)
      const since = new Date(Date.now() - days * 86400_000).toISOString()
      return { history: repo.priceHistory(productId, since), stats: repo.priceStats(productId, since) }
    },
    'prices.drops': (a) => {
      const { days, minDropPct } = z.object({ days: z.number().int().min(1).max(90), minDropPct: z.number().min(0).max(90) }).parse(a)
      return repo.priceDrops(new Date(Date.now() - days * 86400_000).toISOString(), minDropPct)
    },
    'prices.refreshFavorites': async () => autopilot.refreshFavorites(50),

    // ───── links ─────
    'links.detect': (a) => {
      const url = safeUrl.parse(a)
      const mk = detectMarketplace(url)
      const info = mk ? connectors.get(mk).info : null
      return { marketplace: mk, name: info?.name ?? null, canGenerate: !!info && supports(info, 'affiliateLink') && !!repo.primaryAccount(mk!)?.secretRef }
    },
    'links.generate': async (a) => {
      const { url, subIds, productId } = z.object({ url: safeUrl, subIds: z.array(z.string().max(50)).max(5), productId: id.optional() }).parse(a)
      const mk = detectMarketplace(url)
      if (!mk) throw new Error('Marketplace não reconhecido.')
      const connector = connectors.get(mk)
      if (!supports(connector.info, 'affiliateLink'))
        throw new Error(`${connector.info.name}: geração por API oficial indisponível. Gere o link no portal do programa e cadastre-o manualmente.`)
      const { creds, acc } = mkCreds(mk)
      const clean = sanitizeSubIds(subIds)
      const r = await connector.generateAffiliateLink(creds, url, clean)
      const linkId = repo.saveAffiliateLink({ productId: productId ?? null, marketplaceId: mk, accountId: acc.id, originalUrl: url, affiliateUrl: r.url, subIds: clean, status: r.verified ? 'valid' : 'unverified', generatedBy: 'api' })
      repo.audit('link.generate', 'affiliate_links', linkId, { marketplace: mk })
      return { id: linkId, url: r.url, verified: r.verified }
    },
    'links.saveManual': (a) => {
      const { url, affiliateUrl, productId } = z.object({ url: safeUrl, affiliateUrl: safeUrl, productId: id.nullable() }).parse(a)
      const mk = detectMarketplace(url) ?? 'manual'
      return repo.saveAffiliateLink({ productId, marketplaceId: mk, accountId: null, originalUrl: url, affiliateUrl, subIds: [], status: 'unverified', generatedBy: 'manual' })
    },
    'links.list': () => repo.listAffiliateLinks(200),
    'links.copy': (a) => {
      hooks.copyToClipboard(z.string().max(5000).parse(a))
      return true
    },

    // ───── cupons ─────
    'coupons.list': () => repo.listCoupons(),
    'coupons.add': (a) => {
      const c = z
        .object({ productId: id, code: z.string().trim().min(1).max(60), description: z.string().max(200).optional(), validUntil: z.string().datetime().nullable() })
        .parse(a)
      const p = repo.getProduct(c.productId)
      if (!p) throw new Error('Produto não encontrado.')
      repo.addCoupon({ marketplaceId: p.marketplaceId, productId: p.id, code: c.code, description: c.description, validUntil: c.validUntil, source: 'manual' })
      return true
    },
    'coupons.delete': (a) => {
      repo.deleteCoupon(id.parse(a))
      return true
    },

    // ───── canais ─────
    'channels.providers': () => Object.values(providers).map((p) => p.info),
    'channels.accounts': () => repo.listChannelAccounts(),
    'channels.connect': async (a) => {
      const { channel, label, credentials } = z
        .object({ channel: channelId, label: shortText.min(1), credentials: z.record(z.string(), z.string().max(1000)) })
        .parse(a)
      const provider = providers[channel]
      let ref: string | null = null
      if (provider.info.credentialFields.length) {
        ref = `channel:${channel}:${label}`
        secrets.set(ref, credentials)
      }
      const accId = repo.upsertChannelAccount(channel, label, ref)
      const r = await provider.testAccount(credentials)
      repo.setChannelAccountStatus(accId, r.ok ? 'connected' : 'error', r.ok ? null : r.message, r.meta)
      repo.audit('channel.connect', 'channel_accounts', accId, { channel })
      return { ...r, accountId: accId }
    },
    'channels.test': async (a) => {
      const acc = repo.getChannelAccount(id.parse(a))
      try {
        const creds = acc.secretRef ? (secrets.get(acc.secretRef) ?? {}) : {}
        const r = await providers[acc.channelId].testAccount(creds)
        repo.setChannelAccountStatus(acc.id, r.ok ? 'connected' : 'error', r.ok ? null : r.message, r.meta)
        return r
      } catch (e) {
        repo.setChannelAccountStatus(acc.id, statusFromError(e), errorMessage(e))
        return { ok: false, message: errorMessage(e) }
      }
    },
    'channels.disconnect': (a) => {
      const acc = repo.getChannelAccount(id.parse(a))
      if (acc.secretRef) secrets.delete(acc.secretRef)
      repo.deleteChannelAccount(acc.id)
      repo.audit('channel.disconnect', 'channel_accounts', acc.id)
      return true
    },

    // ───── destinos ─────
    'destinations.list': () => repo.listDestinations(),
    'destinations.save': (a) => {
      const d = destinationSchema.parse(a)
      const did = repo.saveDestination(d)
      repo.audit(d.id ? 'destination.update' : 'destination.create', 'destinations', did, { consent: d.consentConfirmed })
      return did
    },
    'destinations.check': async (a) => {
      const d = repo.getDestination(id.parse(a))
      if (!d) throw new Error('Destino não encontrado.')
      const acc = repo.getChannelAccount(d.channelAccountId)
      const creds = acc.secretRef ? (secrets.get(acc.secretRef) ?? {}) : {}
      const r = await providers[acc.channelId].checkDestination(creds, d.externalId)
      repo.setDestinationStatus(d.id, r.ok && r.canPost ? (d.status === 'paused' ? 'paused' : 'active') : 'error', r.permissions ?? { message: r.message })
      return r
    },
    'destinations.setPaused': (a) => {
      const { destinationId, paused } = z.object({ destinationId: id, paused: z.boolean() }).parse(a)
      repo.setDestinationStatus(destinationId, paused ? 'paused' : 'active')
      return true
    },
    'destinations.delete': (a) => {
      repo.deleteDestination(id.parse(a))
      return true
    },
    'destinations.history': (a) => {
      const did = id.parse(a)
      return repo.listPublications({ limit: 1000 }).filter((p) => p.destinationName === repo.getDestination(did)?.name).slice(0, 100)
    },
    'destinations.testSend': async (a) => {
      // Envio de teste: exige confirmação explícita na interface.
      const { destinationId, confirm } = z.object({ destinationId: id, confirm: z.literal(true) }).parse(a)
      const d = repo.getDestination(destinationId)
      if (!d) throw new Error('Destino não encontrado.')
      if (!d.consentConfirmed) throw new Error('Confirme a autorização do destino antes de enviar.')
      void confirm
      const acc = repo.getChannelAccount(d.channelAccountId)
      const creds = acc.secretRef ? (secrets.get(acc.secretRef) ?? {}) : {}
      const text = `✅ Teste de conexão — ${BRAND.name}\nEste destino está pronto para receber ofertas.`
      if (acc.channelId === 'whatsapp_assisted') {
        hooks.copyToClipboard(text)
        return { outcome: 'assisted', message: 'Mensagem de teste copiada. Cole no grupo para validar o fluxo assistido.' }
      }
      const r = await providers[acc.channelId].send(creds, d.externalId, { text })
      repo.audit('destination.test_send', 'destinations', d.id, { outcome: r.outcome })
      return { outcome: r.outcome, message: r.outcome === 'sent' ? 'Mensagem de teste enviada.' : (r.error ?? 'Falha.') }
    },
    'audiences.list': () => repo.listAudienceProfiles(),
    'audiences.save': (a) =>
      repo.saveAudienceProfile(
        z.object({ id: id.optional(), name: shortText.min(1), description: z.string().max(500), categories: strList, keywords: strList, maxPriceCents: z.number().int().min(0).nullable() }).parse(a)
      ),
    'audiences.delete': (a) => {
      repo.deleteAudienceProfile(id.parse(a))
      return true
    },

    // ───── templates / smart copy ─────
    'templates.list': () => repo.listTemplates(),
    'templates.save': (a) => {
      const t = z.object({ id: id.optional(), name: shortText.min(1), style: shortText, body: z.string().min(1).max(4000) }).parse(a)
      const unknown = unknownVariables(t.body)
      if (unknown.length) throw new Error(`Variáveis desconhecidas: ${unknown.join(', ')}`)
      return repo.saveTemplate(t)
    },
    'templates.delete': (a) => {
      repo.deleteTemplate(id.parse(a))
      return true
    },
    'copy.preview': (a) => {
      const { templateId, body, productId } = z.object({ templateId: id.optional(), body: z.string().max(4000).optional(), productId: id.optional() }).parse(a)
      const tpl = body ?? repo.getTemplate(templateId ?? null)?.body ?? ''
      const p = productId ? repo.getProduct(productId) : null
      const link = p ? repo.latestLinkForProduct(p.id) : null
      const coupon = p ? repo.activeCouponForProduct(p.id) : null
      const settings = repo.getSettings()
      const data = {
        title: p?.title ?? 'Selecione um produto para visualizar com dados reais',
        marketplaceName: p ? connectors.get(p.marketplaceId).info.name : '',
        priceCents: p?.priceCents ?? null,
        originalPriceCents: p?.originalPriceCents ?? null,
        discountPct: p?.discountPct ?? null,
        coupon: coupon?.code ?? null,
        affiliateUrl: link?.affiliateUrl ?? null,
        rating: p?.rating ?? null,
        freeShipping: p?.freeShipping ?? null,
        category: p?.category ?? null,
        validUntil: coupon?.validUntil ? new Date(coupon.validUntil).toLocaleDateString('pt-BR', { timeZone: tz() }) : null,
        disclosure: settings.disclosureText
      }
      const r = renderOfferMessage(tpl, data)
      return { ...r, hasLink: !!link, linkStatus: link?.status ?? null }
    },
    'copy.ai': async (a) => {
      const { productId, style } = z.object({ productId: id, style: z.string().max(40) }).parse(a)
      const p = repo.getProduct(productId)
      if (!p) throw new Error('Produto não encontrado.')
      const link = repo.latestLinkForProduct(p.id)
      if (!link) throw new Error('Gere ou cadastre um link de afiliado para este produto primeiro.')
      const s = repo.getSettings()
      const coupon = repo.activeCouponForProduct(p.id)
      const vars = buildVariables({
        title: p.title,
        marketplaceName: connectors.get(p.marketplaceId).info.name,
        priceCents: p.priceCents,
        originalPriceCents: p.originalPriceCents,
        discountPct: p.discountPct,
        coupon: coupon?.code ?? null,
        affiliateUrl: link.affiliateUrl,
        rating: p.rating,
        freeShipping: p.freeShipping,
        category: p.category,
        validUntil: null,
        disclosure: s.disclosureText
      })
      const facts: AiFacts = {
        produto: vars.produto ?? p.title,
        marketplace: vars.marketplace ?? '',
        preco_atual: vars.preco_atual,
        preco_anterior: vars.preco_anterior,
        desconto: vars.desconto,
        cupom: vars.cupom,
        avaliacao: vars.avaliacao,
        frete: vars.frete,
        link_afiliado: link.affiliateUrl,
        identificacao_publicitaria: s.disclosureText
      }
      let apiKey: string | undefined
      if (s.ai.provider === 'openai' || s.ai.provider === 'anthropic') apiKey = secrets.get(`ai:${s.ai.provider}`)?.apiKey
      return generateAiCopy({ provider: s.ai.provider, model: s.ai.model, ollamaUrl: s.ai.ollamaUrl, apiKey }, facts, style)
    },

    // ───── IA ─────
    'ai.status': async () => {
      const s = repo.getSettings()
      return {
        provider: s.ai.provider,
        ollama: await ollamaStatus(s.ai.ollamaUrl),
        hasOpenAIKey: secrets.has('ai:openai'),
        hasAnthropicKey: secrets.has('ai:anthropic'),
        hardware: hardwareReport(await hooks.gpuInfo())
      }
    },
    'ai.setKey': (a) => {
      const { provider, apiKey } = z.object({ provider: z.enum(['openai', 'anthropic']), apiKey: z.string().trim().max(300) }).parse(a)
      if (!apiKey) secrets.delete(`ai:${provider}`)
      else secrets.set(`ai:${provider}`, { apiKey })
      repo.audit('ai.set_key', 'secrets', provider, { removed: !apiKey })
      return true
    },

    // ───── campanhas ─────
    'campaigns.list': () => repo.listCampaigns(),
    'campaigns.save': (a) => {
      const c = campaignSchema.parse(a)
      const cid = repo.saveCampaign(c)
      repo.audit(c.id ? 'campaign.update' : 'campaign.create', 'campaigns', cid, { status: c.status, mode: c.mode })
      return cid
    },
    'campaigns.setStatus': (a) => {
      const { campaignId, status } = z.object({ campaignId: id, status: z.enum(['draft', 'active', 'paused']) }).parse(a)
      const c = repo.getCampaign(campaignId)
      if (!c) throw new Error('Campanha não encontrada.')
      if (status === 'active' && !c.destinationIds.length) throw new Error('Vincule ao menos um destino autorizado antes de ativar.')
      repo.setCampaignStatus(campaignId, status)
      repo.audit('campaign.status', 'campaigns', campaignId, { status })
      return true
    },
    'campaigns.delete': (a) => {
      repo.deleteCampaign(id.parse(a))
      return true
    },
    'campaigns.runNow': async (a) => {
      const c = repo.getCampaign(id.parse(a))
      if (!c) throw new Error('Campanha não encontrada.')
      // Executa a seleção imediatamente. Em modo automático o item vai para a fila no próximo horário permitido.
      return autopilot.runCampaign(c, { force: true })
    },
    'campaigns.preview': (a) => {
      const c = campaignSchema.parse(a)
      const full = { ...c, id: c.id ?? 0, lastRunAt: null, nextRunAt: null, createdAt: '', updatedAt: '' }
      const dests = c.destinationIds.map((d) => repo.getDestination(d)).filter((d): d is NonNullable<typeof d> => !!d)
      const profile = dests[0] ? repo.getAudienceProfile(dests[0].audienceProfileId) : null
      const ranked = autopilot.rankCandidates(full, dests).slice(0, 20)
      return ranked.map((r) => ({ ...r.product, score: computeOfferScore({ ...r.product, audienceMatch: audienceMatch(r.product, profile) }, repo.getSettings().scoreWeights) }))
    },

    // ───── autopilot / fila ─────
    'autopilot.setEnabled': (a) => {
      const on = z.boolean().parse(a)
      repo.updateSettings({ autopilotEnabled: on })
      repo.audit(on ? 'autopilot.start' : 'autopilot.pause', 'settings')
      hooks.onSettingsChanged()
      return on
    },
    'queue.list': (a) => {
      const statuses = z.array(z.string()).optional().parse(a) as QueueStatus[] | undefined
      return repo.listQueue(statuses, 500)
    },
    'queue.attempts': (a) => repo.listAttempts(id.parse(a)),
    'queue.enqueueManual': async (a) => {
      const m = z.object({ productId: id, destinationIds: z.array(id).min(1), templateId: id.nullable(), scheduledAt: z.string().datetime().optional(), requireApproval: z.boolean() }).parse(a)
      const p = repo.getProduct(m.productId)
      if (!p) throw new Error('Produto não encontrado.')
      const tpl = repo.getTemplate(m.templateId)
      if (!tpl) throw new Error('Modelo não encontrado.')
      const coupon = repo.activeCouponForProduct(p.id)
      const s = repo.getSettings()
      const created: number[] = []
      for (const did of m.destinationIds) {
        const d = repo.getDestination(did)
        if (!d) continue
        const link = await autopilot.resolveLink(p, sanitizeSubIds(['zaion', 'manual', `d${did}`]))
        if (!link) throw new Error('Sem link de afiliado válido. Gere pelo gerador de links ou cadastre manualmente.')
        const { text } = renderOfferMessage(tpl.body, {
          title: p.title,
          marketplaceName: connectors.get(p.marketplaceId).info.name,
          priceCents: p.priceCents,
          originalPriceCents: p.originalPriceCents,
          discountPct: p.discountPct,
          coupon: coupon?.code ?? null,
          affiliateUrl: link.url,
          rating: p.rating,
          freeShipping: p.freeShipping,
          category: p.category,
          validUntil: null,
          disclosure: s.disclosureText
        })
        const when = m.scheduledAt ? new Date(m.scheduledAt) : autopilot.nextSlot(d, new Date())
        const qid = repo.enqueue({
          campaignId: null,
          productId: p.id,
          destinationId: did,
          affiliateLinkId: link.id,
          messageText: text,
          imageUrl: p.imageUrl,
          status: m.requireApproval ? 'awaiting_approval' : 'scheduled',
          scheduledAt: when.toISOString(),
          priceCents: p.priceCents,
          idempotencyKey: `manual:p${p.id}:d${did}:${Date.now()}`
        })
        if (qid) created.push(qid)
      }
      return created
    },
    'queue.approve': (a) => {
      const qid = id.parse(a)
      const ok = repo.transitionQueue(qid, ['awaiting_approval'], 'scheduled')
      if (ok) repo.audit('queue.approve', 'publication_queue', qid)
      return ok
    },
    'queue.cancel': (a) => {
      const qid = id.parse(a)
      const ok = repo.transitionQueue(qid, ['pending', 'awaiting_approval', 'scheduled', 'failed', 'unknown'], 'canceled')
      if (ok) repo.audit('queue.cancel', 'publication_queue', qid)
      return ok
    },
    'queue.retry': (a) => {
      const qid = id.parse(a)
      return repo.transitionQueue(qid, ['failed', 'expired'], 'scheduled', { scheduledAt: new Date().toISOString() })
    },
    'queue.edit': (a) => {
      const { queueId, text, scheduledAt } = z.object({ queueId: id, text: z.string().min(1).max(4000), scheduledAt: z.string().datetime().optional() }).parse(a)
      repo.updateQueueMessage(queueId, text, scheduledAt)
      repo.audit('queue.edit', 'publication_queue', queueId)
      return true
    },
    'queue.move': (a) => {
      const { queueId, direction } = z.object({ queueId: id, direction: z.union([z.literal(-1), z.literal(1)]) }).parse(a)
      repo.moveQueue(queueId, direction)
      return true
    },
    'queue.publishNow': async (a) => {
      const { queueId, confirm } = z.object({ queueId: id, confirm: z.literal(true) }).parse(a)
      void confirm
      repo.audit('queue.publish_now', 'publication_queue', queueId)
      return autopilot.sendItem(queueId, { manualOverride: true })
    },
    'queue.confirmPublished': (a) => autopilot.confirmPublished(id.parse(a)),
    'queue.copyForManual': async (a) => {
      const item = repo.getQueueItem(id.parse(a))
      if (!item) throw new Error('Item não encontrado.')
      hooks.copyToClipboard(item.messageText)
      return true
    },

    // ───── histórico / analytics ─────
    'publications.list': (a) => {
      const f = z.object({ from: z.string().optional(), to: z.string().optional(), limit: z.number().int().max(5000).optional() }).parse(a ?? {})
      return repo.listPublications(f)
    },
    'analytics.report': (a) => {
      const { from, to } = z.object({ from: z.string(), to: z.string() }).parse(a)
      const pubs = repo.listPublications({ from, to, limit: 50000 })
      const group = (key: (p: (typeof pubs)[number]) => string) => {
        const m = new Map<string, number>()
        for (const p of pubs) m.set(key(p), (m.get(key(p)) ?? 0) + 1)
        return [...m.entries()].map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count)
      }
      const conv = repo.conversionTotals(from, to)
      return {
        publications: pubs.length,
        byMarketplace: group((p) => p.marketplaceId),
        byCampaign: group((p) => p.campaignName ?? 'Manual'),
        byDestination: group((p) => p.destinationName),
        byHour: group((p) => String(new Date(p.sentAt).toLocaleString('pt-BR', { timeZone: tz(), hour: '2-digit', hour12: false }))),
        byProduct: group((p) => p.productTitle).slice(0, 20),
        conversions: conv,
        clicksAvailable: false
      }
    },
    'analytics.exportCsv': async (a) => {
      const { from, to, kind } = z.object({ from: z.string(), to: z.string(), kind: z.enum(['publications', 'conversions', 'products']) }).parse(a)
      const file = await hooks.showSaveDialog(`zaion-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, [{ name: 'CSV', extensions: ['csv'] }])
      if (!file) return null
      let csv: string
      if (kind === 'publications') {
        csv = toCsv(
          ['Data', 'Produto', 'Marketplace', 'Destino', 'Campanha', 'Preço', 'Modo'],
          repo.listPublications({ from, to, limit: 100000 }).map((p) => [new Date(p.sentAt).toLocaleString('pt-BR', { timeZone: tz() }), p.productTitle, p.marketplaceId, p.destinationName, p.campaignName ?? 'Manual', formatBRL(p.priceCents), p.mode])
        )
      } else if (kind === 'conversions') {
        csv = toCsv(
          ['Pedido', 'Produto', 'Marketplace', 'Data da compra', 'Status', 'Valor', 'Comissão', 'Sub IDs', 'Fonte'],
          repo.listConversions(100000).map((c) => [c.orderId, c.productId, c.marketplaceId, c.purchaseTime, c.status, formatBRL(c.amountCents as number | null), formatBRL(c.commissionCents as number | null), (c.subIds as string[]).join('-'), c.source])
        )
      } else {
        csv = toCsv(
          ['Título', 'Marketplace', 'Categoria', 'Preço', 'Desconto', 'Comissão', 'Avaliação', 'Vendas', 'Offer Score', 'Confiança', 'URL'],
          withScore(repo.listProducts({ limit: 1000 })).map((p) => [p.title, p.marketplaceId, p.category, formatBRL(p.priceCents), formatPct(p.discountPct), p.commissionRate === null ? '' : formatPct(p.commissionRate * 100, 1), p.rating, p.salesCount, p.score.score, p.score.confidence, p.url])
        )
      }
      writeFileSync(file, csv, 'utf8')
      return file
    },
    'conversions.list': () => repo.listConversions(500),

    // ───── logs / auditoria ─────
    'logs.list': (a) => repo.listLogs(z.object({ level: z.string().optional(), scope: z.string().optional(), limit: z.number().int().max(2000).optional() }).parse(a ?? {})),
    'audit.list': () => repo.listAudit(300),

    // ───── backup ─────
    'backup.list': () => listBackups(ctx.paths.backups),
    'backup.create': () => {
      const b = createBackup(ctx.db, ctx.paths.backups, 'manual')
      repo.audit('backup.create', 'backups', b.name)
      return b
    },
    'backup.verify': (a) => {
      const file = z.string().parse(a)
      if (!listBackups(ctx.paths.backups).some((b) => b.file === file)) throw new Error('Backup não encontrado.')
      verifyBackupFile(file)
      return { ok: true }
    },
    'backup.restore': (a) => {
      const { file, confirm } = z.object({ file: z.string(), confirm: z.literal(true) }).parse(a)
      void confirm
      if (!listBackups(ctx.paths.backups).some((b) => b.file === file)) throw new Error('Backup não encontrado.')
      stageRestore(file, ctx.paths.db)
      repo.audit('backup.restore_staged', 'backups', file)
      return { restartRequired: true }
    },
    'backup.restoreFromFile': async () => {
      const file = await hooks.showOpenDialog([{ name: 'Banco Zaion', extensions: ['db'] }])
      if (!file) return null
      stageRestore(file, ctx.paths.db)
      repo.audit('backup.restore_staged', 'backups', file)
      return { restartRequired: true }
    },
    'backup.export': async () => {
      const file = await hooks.showSaveDialog(`${BRAND.technicalName}-export-${new Date().toISOString().slice(0, 10)}.db`, [{ name: 'Banco Zaion', extensions: ['db'] }])
      if (!file) return null
      ctx.db.prepare('VACUUM INTO ?').run(file)
      return file
    },
    'backup.exportConfig': async () => {
      const file = await hooks.showSaveDialog(`zaion-configuracoes-${new Date().toISOString().slice(0, 10)}.json`, [{ name: 'JSON', extensions: ['json'] }])
      if (!file) return null
      // Sem credenciais: apenas configurações, campanhas, templates, destinos e perfis.
      const data = {
        exportedAt: new Date().toISOString(),
        app: BRAND.name,
        settings: { ...repo.getSettings(), autopilotEnabled: false },
        campaigns: repo.listCampaigns().map((c) => ({ ...c, status: 'draft' })),
        templates: repo.listTemplates().filter((t) => !t.isBuiltin),
        destinations: repo.listDestinations().map((d) => ({ ...d, consentConfirmed: false })),
        audiences: repo.listAudienceProfiles()
      }
      writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
      return file
    },
    'backup.integrity': () => integrityCheck(ctx.db),
    'backup.runRetention': () => applyRetention(ctx.paths.backups, repo.getSettings().backupRetention),
    'system.openDataFolder': async () => {
      await hooks.openExternal(`file://${ctx.paths.userData}`)
      return true
    },
    'system.openUrl': async (a) => {
      const url = safeUrl.parse(a)
      await hooks.openExternal(url)
      return true
    },
    'system.saveReport': async (a) => {
      const { name, content } = z.object({ name: z.string().max(100), content: z.string().max(5_000_000) }).parse(a)
      const target = join(ctx.paths.exports, name.replace(/[^a-zA-Z0-9._-]/g, '_'))
      writeFileSync(target, content, 'utf8')
      return target
    }
  }

  function dashboard(): DashboardSummary {
    const now = new Date()
    const t = tz()
    const dayStart = startOfLocalDayUtc(now, t).toISOString()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const s = repo.getSettings()
    const db = ctx.db
    const count = (sql: string, ...args: Array<string | number>) => Number((db.prepare(sql).get(...args) as { c: number }).c)
    const products = withScore(repo.listProducts({ limit: 1000 }))
    const since14 = addMinutes(now, -14 * 24 * 60).toISOString()
    const pubs14 = repo.listPublications({ from: since14, limit: 100000 })
    const byDay = new Map<string, { sent: number; failed: number }>()
    for (let i = 13; i >= 0; i--) {
      const key = new Date(now.getTime() - i * 86400_000).toLocaleDateString('pt-BR', { timeZone: t, day: '2-digit', month: '2-digit' })
      byDay.set(key, { sent: 0, failed: 0 })
    }
    const dayKey = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: t, day: '2-digit', month: '2-digit' })
    for (const p of pubs14) {
      const e = byDay.get(dayKey(p.sentAt))
      if (e) e.sent++
    }
    for (const r of db.prepare("SELECT updated_at FROM publication_queue WHERE status = 'failed' AND updated_at >= ?").all(since14) as Array<{ updated_at: string }>) {
      const e = byDay.get(dayKey(r.updated_at))
      if (e) e.failed++
    }
    const groupCount = <T,>(arr: T[], key: (x: T) => string) => {
      const m = new Map<string, number>()
      for (const x of arr) m.set(key(x), (m.get(key(x)) ?? 0) + 1)
      return [...m.entries()].sort((a, b) => b[1] - a[1])
    }
    const pubsMonth = repo.listPublications({ from: monthStart, limit: 100000 })
    const hours = new Map<number, number>()
    for (const p of pubsMonth) {
      const h = Number(new Date(p.sentAt).toLocaleString('en-US', { timeZone: t, hour: '2-digit', hour12: false })) % 24
      hours.set(h, (hours.get(h) ?? 0) + 1)
    }
    const conv = repo.conversionTotals(monthStart, now.toISOString())
    const hasConversions = count('SELECT COUNT(*) AS c FROM conversions') > 0
    return {
      productsFound: products.length,
      qualifiedOffers: products.filter((p) => p.score.score >= 70).length,
      publishedToday: repo.countPublications(null, dayStart),
      publishedMonth: pubsMonth.length,
      scheduled: count("SELECT COUNT(*) AS c FROM publication_queue WHERE status = 'scheduled'"),
      awaitingApproval: count("SELECT COUNT(*) AS c FROM publication_queue WHERE status IN ('awaiting_approval','pending')"),
      activeCampaigns: count("SELECT COUNT(*) AS c FROM campaigns WHERE status = 'active'"),
      destinations: count('SELECT COUNT(*) AS c FROM destinations'),
      marketplacesConnected: count("SELECT COUNT(DISTINCT marketplace_id) AS c FROM marketplace_accounts WHERE status = 'connected'"),
      channelsConnected: count("SELECT COUNT(*) AS c FROM channel_accounts WHERE status = 'connected'"),
      failuresToday: count("SELECT COUNT(*) AS c FROM publication_queue WHERE status = 'failed' AND updated_at >= ?", dayStart),
      unknownStatus: count("SELECT COUNT(*) AS c FROM publication_queue WHERE status = 'unknown'"),
      autopilot: { enabled: s.autopilotEnabled, running: s.autopilotEnabled, lastTickAt: autopilot.lastTickAt, nextPublicationAt: autopilot.nextPublicationAt() },
      online: hooks.isOnline(),
      clicks: null, // nenhuma integração oficial fornece cliques nesta versão
      conversions: hasConversions ? conv.orders : null,
      commissionEstimatedCents: hasConversions ? conv.estimatedCents : null,
      commissionConfirmedCents: hasConversions ? conv.confirmedCents : null,
      publicationsByDay: [...byDay.entries()].map(([day, v]) => ({ day, ...v })),
      byMarketplace: groupCount(pubsMonth, (p) => p.marketplaceId).map(([marketplace, sent]) => ({ marketplace, sent })),
      byCampaign: groupCount(pubsMonth, (p) => p.campaignName ?? 'Manual').map(([campaign, sent]) => ({ campaign, sent })),
      byDestination: groupCount(pubsMonth, (p) => p.destinationName).map(([destination, sent]) => ({ destination, sent })),
      byHour: [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([hour, sent]) => ({ hour, sent }))
    }
  }

  return {
    methods: Object.keys(handlers),
    async call(method: string, args: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
      const h = handlers[method]
      if (!h) return { ok: false, error: `Método não permitido: ${method}` }
      try {
        return { ok: true, data: await h(args) }
      } catch (e) {
        const msg = errorMessage(e)
        repo.log('warn', 'ipc', `${method}: ${msg}`)
        return { ok: false, error: msg }
      }
    }
  }
}

export type { ChannelId }
