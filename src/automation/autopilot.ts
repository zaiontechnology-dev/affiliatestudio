import type { Repository } from '../database/repository'
import type { SecretStore } from '../security/secret-store'
import { SecretUnavailableError } from '../security/secret-store'
import type { ConnectorRegistry } from '../integrations/marketplaces/registry'
import { ConnectorError, supports } from '../integrations/marketplaces/types'
import type { DistributionProvider } from '../integrations/channels/types'
import { audienceMatch, computeOfferScore } from '../core/offer-score'
import { renderOfferMessage } from '../core/smart-copy'
import { sanitizeSubIds } from '../core/urls'
import { addMinutes, backoffDelayMs, isWithinWindow, localParts, parseHHMM, startOfLocalDayUtc } from '../core/schedule'
import { redactString } from '../security/redact'
import type { Campaign, ChannelId, Destination, MarketplaceId, Product, ProductInput, QueueItem } from '../shared/types'

export interface Notifier {
  notify(title: string, body: string): void
  /** Modo assistido: prepara a publicação manual (copiar texto, abrir destino etc.). */
  assisted?(item: QueueItem): void
}

export interface AutopilotDeps {
  repo: Repository
  secrets: SecretStore
  connectors: ConnectorRegistry
  providers: Record<ChannelId, DistributionProvider>
  notifier?: Notifier
  now?: () => Date
}

export type CampaignRunOutcome =
  | { status: 'enqueued'; productId: number; queueIds: number[]; score: number }
  | { status: 'no_offer'; reason: string }
  | { status: 'skipped'; reason: string }

const MAX_SEND_ATTEMPTS = 4
const MAX_CANDIDATE_VALIDATIONS = 5

export class Autopilot {
  private readonly repo: Repository
  private readonly now: () => Date
  private running = false
  lastTickAt: string | null = null

  constructor(private readonly deps: AutopilotDeps) {
    this.repo = deps.repo
    this.now = deps.now ?? (() => new Date())
  }

  private get tz() {
    return this.repo.getSettings().timezone
  }

  private log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>) {
    this.repo.log(level, 'autopilot', redactString(message), ctx)
  }

  // ───────────────────────── recuperação ─────────────────────────

  /**
   * Executado na inicialização. Regras:
   *  - 'sending' → 'unknown' (pode ter sido entregue: NÃO reenviar automaticamente).
   *  - 'validating'/'processing' → 'scheduled' (nada foi enviado).
   *  - Itens agendados que passaram da tolerância → 'expired' (não dispara em lote o que ficou para trás).
   */
  get busy(): boolean {
    return this.running
  }

  recover(): { unknown: number; requeued: number; expired: number } {
    const now = this.now()
    const grace = this.repo.getSettings().missedPublicationGraceMinutes
    let unknown = 0
    let requeued = 0
    let expired = 0
    for (const item of this.repo.listQueue(['sending', 'validating', 'processing'], 1000)) {
      if (item.status === 'sending') {
        if (this.repo.transitionQueue(item.id, ['sending'], 'unknown', { error: 'Aplicativo encerrado durante o envio. Confirme manualmente.' })) unknown++
      } else if (this.repo.transitionQueue(item.id, [item.status], 'scheduled')) requeued++
    }
    const cutoff = addMinutes(now, -grace).toISOString()
    for (const item of this.repo.listQueue(['scheduled'], 1000)) {
      if (item.scheduledAt < cutoff) {
        if (this.repo.transitionQueue(item.id, ['scheduled'], 'expired', { error: 'Horário perdido (computador desligado/suspenso ou sem conexão).' }))
          expired++
      }
    }
    if (unknown || requeued || expired) this.log('warn', `Recuperação: ${unknown} desconhecido(s), ${requeued} reagendado(s), ${expired} expirado(s).`)
    return { unknown, requeued, expired }
  }

  // ───────────────────────── ciclo ─────────────────────────

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const settings = this.repo.getSettings()
      this.lastTickAt = this.now().toISOString()
      if (!settings.autopilotEnabled) return
      for (const c of this.repo.listCampaigns()) {
        if (c.status !== 'active' || c.mode === 'manual') continue
        if (c.nextRunAt && c.nextRunAt > this.now().toISOString()) continue
        try {
          const r = await this.runCampaign(c)
          if (r.status !== 'skipped') this.log('info', `Campanha "${c.name}": ${r.status === 'enqueued' ? 'oferta programada' : r.reason}`)
        } catch (e) {
          this.log('error', `Campanha "${c.name}" falhou: ${(e as Error).message}`)
        }
      }
      await this.processQueue()
    } finally {
      this.running = false
    }
  }

  // ───────────────────────── seleção de ofertas ─────────────────────────

  private credentialsFor(marketplaceId: MarketplaceId): { creds: Record<string, string>; accountId: number } | null {
    const acc = this.repo.primaryAccount(marketplaceId)
    if (!acc || !acc.secretRef || acc.status === 'disconnected') return null
    try {
      const creds = this.deps.secrets.get(acc.secretRef)
      return creds ? { creds, accountId: acc.id } : null
    } catch (e) {
      if (e instanceof SecretUnavailableError) this.repo.setAccountStatus(acc.id, 'expired', { error: e.message })
      return null
    }
  }

  private handleConnectorError(marketplaceId: MarketplaceId, e: unknown) {
    const acc = this.repo.primaryAccount(marketplaceId)
    if (!acc || !(e instanceof ConnectorError)) return
    if (e.code === 'auth') this.repo.setAccountStatus(acc.id, 'expired', { error: e.message })
    else if (e.code === 'rate_limit') this.repo.setAccountStatus(acc.id, 'rate_limited', { error: e.message })
    else if (e.code === 'network') this.repo.setAccountStatus(acc.id, 'error', { error: e.message })
  }

  /** Busca produtos novos nas integrações oficiais conectadas (até 2 palavras-chave por execução). */
  async discover(c: Campaign): Promise<number> {
    let found = 0
    for (const mk of c.marketplaces) {
      const connector = this.deps.connectors.get(mk)
      if (!supports(connector.info, 'searchProducts')) continue
      const cred = this.credentialsFor(mk)
      if (!cred) continue
      const keywords = c.keywords.length ? this.rotate(c.keywords, c.id, 2) : [undefined]
      for (const kw of keywords) {
        try {
          const res = await connector.searchProducts(cred.creds, { keyword: kw, sort: 'sales', limit: 30 })
          for (const p of res.items) {
            this.repo.upsertProduct({ ...p, category: p.category ?? (c.categories.length === 1 ? c.categories[0] : null) })
            found++
          }
          this.repo.setAccountStatus(cred.accountId, 'connected', { synced: true })
        } catch (e) {
          this.handleConnectorError(mk, e)
          this.log('warn', `Busca em ${connector.info.name} falhou: ${(e as Error).message}`)
          break
        }
      }
    }
    return found
  }

  private rotate<T>(arr: T[], seed: number, count: number): T[] {
    const k = this.repo.getKv<number>(`rot:${seed}`, 0)
    this.repo.setKv(`rot:${seed}`, k + count)
    return Array.from({ length: Math.min(count, arr.length) }, (_, i) => arr[(k + i) % arr.length]!)
  }

  /** Aplica os filtros da campanha. Retorna motivo da rejeição ou null se aprovado. */
  rejectReason(c: Campaign, p: Product): string | null {
    if (p.isBlocked) return 'bloqueado'
    if (c.marketplaces.length && !c.marketplaces.includes(p.marketplaceId)) return 'marketplace'
    if (p.available === false) return 'indisponível'
    if (p.priceCents === null) return 'sem preço'
    if (c.minPriceCents !== null && p.priceCents < c.minPriceCents) return 'preço abaixo da faixa'
    if (c.maxPriceCents !== null && p.priceCents > c.maxPriceCents) return 'preço acima da faixa'
    if (c.minDiscountPct !== null && c.minDiscountPct > 0 && (p.discountPct === null || p.discountPct < c.minDiscountPct)) return 'desconto insuficiente ou não verificável'
    // comissão mínima: aplicada somente quando verificável
    if (c.minCommissionRate !== null && p.commissionRate !== null && p.commissionRate < c.minCommissionRate) return 'comissão abaixo do mínimo'
    if (c.minRating !== null && (p.rating === null || p.rating < c.minRating)) return 'avaliação insuficiente'
    const title = p.title.toLowerCase()
    if (c.excludedKeywords.some((k) => k && title.includes(k.toLowerCase()))) return 'palavra excluída'
    if (c.categories.length) {
      const catOk = p.category && c.categories.includes(p.category)
      const kwOk = c.keywords.some((k) => k && title.includes(k.toLowerCase()))
      if (!catOk && !kwOk) return 'categoria'
    } else if (c.keywords.length && !c.keywords.some((k) => k && title.includes(k.toLowerCase()))) return 'palavra-chave'
    return null
  }

  /** Controle de repetição por produto+destino. */
  repeatBlocked(c: Campaign, productId: number, destinationId: number, currentPriceCents: number | null): boolean {
    if (this.repo.hasOpenQueueItem(productId, destinationId)) return true
    const last = this.repo.lastPublication(productId, destinationId)
    if (!last) return false
    const priceDropOk =
      c.repeatOnPriceDropPct !== null &&
      last.priceCents !== null &&
      currentPriceCents !== null &&
      currentPriceCents <= last.priceCents * (1 - c.repeatOnPriceDropPct / 100)
    if (c.repeatDays === 0) return false
    if (c.repeatDays === -1) return !priceDropOk
    const ageDays = (this.now().getTime() - Date.parse(last.sentAt)) / 86400_000
    if (ageDays >= c.repeatDays) return false
    return !priceDropOk
  }

  rankCandidates(c: Campaign, destinations: Destination[]): Array<{ product: Product; score: number }> {
    const weights = this.repo.getSettings().scoreWeights
    const profile = destinations.length ? this.repo.getAudienceProfile(destinations[0]!.audienceProfileId) : null
    const products = this.repo.listProducts({ limit: 1000 })
    const ranked: Array<{ product: Product; score: number }> = []
    for (const p of products) {
      if (this.rejectReason(c, p)) continue
      const sc = computeOfferScore(
        {
          salesCount: p.salesCount,
          discountPct: p.discountPct,
          commissionRate: p.commissionRate,
          rating: p.rating,
          ratingCount: p.ratingCount,
          audienceMatch: audienceMatch(p, profile)
        },
        weights
      )
      if (sc.score < c.minScore) continue
      ranked.push({ product: p, score: sc.score })
    }
    return ranked.sort((a, b) => b.score - a.score)
  }

  /** Revalida preço/disponibilidade na fonte oficial antes de programar. */
  private async revalidate(c: Campaign, p: Product): Promise<{ ok: boolean; product: Product; reason?: string }> {
    const connector = this.deps.connectors.get(p.marketplaceId)
    const cred = supports(connector.info, 'productDetails') ? this.credentialsFor(p.marketplaceId) : null
    const fresh = p.lastCheckedAt && this.now().getTime() - Date.parse(p.lastCheckedAt) < 30 * 60_000
    if (!cred) {
      if (fresh || c.stalePolicy === 'allow') return { ok: true, product: p }
      return { ok: false, product: p, reason: 'não foi possível revalidar (sem integração oficial) e a política é suspender' }
    }
    try {
      const input: ProductInput = { ...p, dataSource: p.dataSource }
      const v = await connector.validateOffer(cred.creds, input)
      if (v.fresh) this.repo.upsertProduct(v.fresh)
      const updated = this.repo.getProduct(p.id) ?? p
      if (!v.valid) return { ok: false, product: updated, reason: v.reasons.join(' ') }
      if (this.rejectReason(c, updated)) return { ok: false, product: updated, reason: 'deixou de atender aos filtros' }
      return { ok: true, product: updated }
    } catch (e) {
      this.handleConnectorError(p.marketplaceId, e)
      if (c.stalePolicy === 'allow' && fresh) return { ok: true, product: p }
      return { ok: false, product: p, reason: `revalidação falhou: ${(e as Error).message}` }
    }
  }

  /** Obtém link de afiliado válido para o destino (API oficial) ou link manual cadastrado. */
  async resolveLink(p: Product, subIds: string[]): Promise<{ id: number; url: string } | null> {
    const connector = this.deps.connectors.get(p.marketplaceId)
    if (supports(connector.info, 'affiliateLink')) {
      const cred = this.credentialsFor(p.marketplaceId)
      if (cred) {
        try {
          const r = await connector.generateAffiliateLink(cred.creds, p.url, subIds)
          const id = this.repo.saveAffiliateLink({
            productId: p.id,
            marketplaceId: p.marketplaceId,
            accountId: cred.accountId,
            originalUrl: p.url,
            affiliateUrl: r.url,
            subIds,
            status: r.verified ? 'valid' : 'unverified',
            generatedBy: 'api'
          })
          return { id, url: r.url }
        } catch (e) {
          this.handleConnectorError(p.marketplaceId, e)
          this.log('warn', `Geração de link falhou para "${p.title}": ${(e as Error).message}`)
        }
      }
    }
    const manual = this.repo.latestLinkForProduct(p.id)
    return manual ? { id: manual.id, url: manual.affiliateUrl } : null
  }

  /** Próximo horário permitido para o destino respeitando janela e intervalo mínimo. */
  nextSlot(d: Destination, from: Date): Date {
    const tz = this.tz
    let t = from
    const last = this.repo.lastSentAtForDestination(d.id)
    const queued = this.repo
      .listQueue(['scheduled', 'pending', 'sending'])
      .filter((q) => q.destinationId === d.id)
      .map((q) => q.scheduledAt)
      .sort()
      .pop()
    const ref = [last, queued].filter(Boolean).sort().pop()
    if (ref) {
      const min = addMinutes(new Date(ref), d.minIntervalMinutes)
      if (min > t) t = min
    }
    // avança em passos de 5 min até entrar na janela (máx. 8 dias)
    for (let i = 0; i < 8 * 288 && !isWithinWindow(t, tz, d.allowedStart, d.allowedEnd); i++) t = addMinutes(t, 5)
    return t
  }

  async runCampaign(c: Campaign, opts: { force?: boolean } = {}): Promise<CampaignRunOutcome> {
    const now = this.now()
    const tz = this.tz
    const scheduleNext = () => this.repo.setCampaignRun(c.id, now.toISOString(), addMinutes(now, c.intervalMinutes).toISOString())

    if (!opts.force) {
      if (!isWithinWindow(now, tz, c.startTime, c.endTime, c.daysOfWeek)) {
        this.repo.setCampaignRun(c.id, c.lastRunAt ?? now.toISOString(), addMinutes(now, 5).toISOString())
        return { status: 'skipped', reason: 'fora da janela de horário' }
      }
      const used = this.repo.countCampaignQueueSince(c.id, startOfLocalDayUtc(now, tz).toISOString())
      if (used >= c.dailyLimit) {
        scheduleNext()
        return { status: 'skipped', reason: 'limite diário da campanha atingido' }
      }
    }

    const destinations = c.destinationIds
      .map((id) => this.repo.getDestination(id))
      .filter((d): d is Destination => !!d && d.status === 'active' && d.consentConfirmed)
    if (!destinations.length) {
      scheduleNext()
      return { status: 'no_offer', reason: 'nenhum destino ativo e autorizado vinculado' }
    }

    await this.discover(c)
    const ranked = this.rankCandidates(c, destinations)
    let validations = 0
    for (const { product, score } of ranked) {
      const eligible = destinations.filter((d) => !this.repeatBlocked(c, product.id, d.id, product.priceCents))
      if (!eligible.length) continue
      if (validations++ >= MAX_CANDIDATE_VALIDATIONS) break
      const v = await this.revalidate(c, product)
      if (!v.ok) {
        this.log('info', `Oferta descartada "${product.title}": ${v.reason}`)
        continue
      }
      const p = v.product
      const template = this.repo.getTemplate(c.templateId)
      if (!template) return { status: 'no_offer', reason: 'nenhum modelo de mensagem disponível' }
      const coupon = this.repo.activeCouponForProduct(p.id)
      const settings = this.repo.getSettings()
      const queueIds: number[] = []
      for (const d of eligible) {
        const link = await this.resolveLink(p, sanitizeSubIds(['zaion', `c${c.id}`, `d${d.id}`, p.category ?? '']))
        if (!link) {
          this.log('warn', `Sem link de afiliado válido para "${p.title}". Oferta não programada.`)
          break
        }
        const { text } = renderOfferMessage(template.body, {
          title: p.title,
          marketplaceName: this.deps.connectors.get(p.marketplaceId).info.name,
          priceCents: p.priceCents,
          originalPriceCents: p.originalPriceCents,
          discountPct: p.discountPct,
          coupon: coupon?.code ?? null,
          affiliateUrl: link.url,
          rating: p.rating,
          freeShipping: p.freeShipping,
          category: p.category,
          validUntil: coupon?.validUntil ? new Date(coupon.validUntil).toLocaleDateString('pt-BR', { timeZone: tz }) : null,
          disclosure: settings.disclosureText
        })
        const slot = this.nextSlot(d, now)
        const id = this.repo.enqueue({
          campaignId: c.id,
          productId: p.id,
          destinationId: d.id,
          affiliateLinkId: link.id,
          messageText: text,
          imageUrl: p.imageUrl,
          status: c.mode === 'auto' ? 'scheduled' : 'awaiting_approval',
          scheduledAt: slot.toISOString(),
          priceCents: p.priceCents,
          idempotencyKey: `c${c.id}:p${p.id}:d${d.id}:${localParts(now, tz).dateKey}:${Math.floor(now.getTime() / 60000)}`
        })
        if (id) queueIds.push(id)
      }
      if (queueIds.length) {
        scheduleNext()
        if (c.mode === 'semi') this.deps.notifier?.notify('Oferta aguardando aprovação', `${p.title} — campanha ${c.name}`)
        return { status: 'enqueued', productId: p.id, queueIds, score }
      }
    }
    scheduleNext()
    return { status: 'no_offer', reason: ranked.length ? 'candidatos descartados na validação/repetição' : 'nenhum produto atende aos filtros' }
  }

  // ───────────────────────── envio ─────────────────────────

  /** Verifica restrições do destino. Retorna novo horário se precisar adiar, ou null se pode enviar agora. */
  private destinationDeferral(item: QueueItem, d: Destination, now: Date): { until: Date; reason: string } | null {
    const tz = this.tz
    if (!isWithinWindow(now, tz, d.allowedStart, d.allowedEnd)) return { until: this.nextSlot(d, now), reason: 'fora do horário permitido do destino' }
    const sent = this.repo.countPublications(d.id, startOfLocalDayUtc(now, tz).toISOString())
    if (sent >= d.dailyLimit) {
      // próximo início de janela do dia seguinte
      const start = parseHHMM(d.allowedStart)
      const tomorrow = addMinutes(startOfLocalDayUtc(addMinutes(now, 24 * 60), tz), start)
      return { until: tomorrow, reason: 'limite diário do destino atingido' }
    }
    const last = this.repo.lastSentAtForDestination(d.id)
    if (last) {
      const min = addMinutes(new Date(last), d.minIntervalMinutes)
      if (min > now) return { until: min, reason: 'intervalo mínimo do destino' }
    }
    void item
    return null
  }

  async processQueue(): Promise<number> {
    const now = this.now()
    let sent = 0
    const touchedDestinations = new Set<number>()
    for (const item of this.repo.dueQueueItems(now.toISOString(), 50)) {
      if (touchedDestinations.has(item.destinationId)) continue // no máximo 1 envio por destino por ciclo
      if (item.campaignId) {
        const c = this.repo.getCampaign(item.campaignId)
        if (c && c.status !== 'active') continue // campanha pausada: mantém na fila
      }
      const d = this.repo.getDestination(item.destinationId)
      if (!d || d.status === 'paused') continue
      const def = this.destinationDeferral(item, d, now)
      if (def) {
        this.repo.transitionQueue(item.id, ['scheduled'], 'scheduled', { scheduledAt: def.until.toISOString() })
        continue
      }
      touchedDestinations.add(d.id)
      if ((await this.sendItem(item.id)) === 'sent') sent++
    }
    return sent
  }

  /** Envia um item. Usado pelo ciclo e por "Publicar agora" (após confirmação do usuário). */
  async sendItem(queueId: number, opts: { manualOverride?: boolean } = {}): Promise<'sent' | 'failed' | 'unknown' | 'assisted' | 'skipped'> {
    const item = this.repo.getQueueItem(queueId)
    if (!item) return 'skipped'
    const allowedFrom = opts.manualOverride ? (['scheduled', 'awaiting_approval', 'pending', 'failed'] as const) : (['scheduled'] as const)
    const d = this.repo.getDestination(item.destinationId)
    if (!d) return 'skipped'
    if (!d.consentConfirmed) {
      this.repo.transitionQueue(item.id, [...allowedFrom], 'failed', { error: 'Destino sem autorização/consentimento confirmado.' })
      return 'failed'
    }
    if (!this.repo.transitionQueue(item.id, [...allowedFrom], 'sending')) return 'skipped'
    const startedAt = this.now().toISOString()
    const account = this.repo.getChannelAccount(d.channelAccountId)
    const provider = this.deps.providers[account.channelId]
    let creds: Record<string, string>
    try {
      creds = account.secretRef ? (this.deps.secrets.get(account.secretRef) ?? {}) : {}
    } catch (e) {
      this.repo.transitionQueue(item.id, ['sending'], 'failed', { error: (e as Error).message })
      this.repo.setChannelAccountStatus(account.id, 'expired', (e as Error).message)
      this.repo.addAttempt(item.id, startedAt, 'failed', (e as Error).message, undefined)
      return 'failed'
    }

    const result = await provider.send(creds, d.externalId, { text: item.messageText, imageUrl: item.imageUrl })
    const product = this.repo.getProduct(item.productId)
    this.repo.addAttempt(item.id, startedAt, result.outcome, result.error ? redactString(result.error) : null, result.response)

    switch (result.outcome) {
      case 'sent':
        this.repo.transitionQueue(item.id, ['sending'], 'sent', { incAttempt: true, error: null })
        this.repo.recordPublication({
          queueId: item.id,
          campaignId: item.campaignId,
          productId: item.productId,
          destinationId: d.id,
          marketplaceId: product?.marketplaceId ?? 'manual',
          channelMessageId: result.messageId ?? null,
          priceCents: product?.priceCents ?? null,
          mode: 'api',
          sentAt: this.now().toISOString()
        })
        this.log('info', `Publicado em "${d.name}": ${item.productTitle}`)
        return 'sent'
      case 'assisted':
        this.repo.transitionQueue(item.id, ['sending'], 'pending', { error: 'Aguardando publicação manual (modo assistido).' })
        this.deps.notifier?.assisted?.({ ...item, status: 'pending' })
        this.deps.notifier?.notify('Hora de publicar no WhatsApp', `${d.name}: ${item.productTitle}. Mensagem copiada.`)
        return 'assisted'
      case 'unknown':
        this.repo.transitionQueue(item.id, ['sending'], 'unknown', { incAttempt: true, error: result.error ?? 'Status desconhecido.' })
        this.deps.notifier?.notify('Status de envio desconhecido', `${d.name}: verifique se a oferta foi publicada.`)
        return 'unknown'
      case 'failed': {
        const attempts = item.attempts + 1
        if (result.retryable && attempts < MAX_SEND_ATTEMPTS) {
          const delay = Math.max(result.retryAfterMs ?? 0, backoffDelayMs(attempts))
          this.repo.transitionQueue(item.id, ['sending'], 'scheduled', {
            incAttempt: true,
            error: result.error ?? 'Falha temporária.',
            scheduledAt: new Date(this.now().getTime() + delay).toISOString()
          })
        } else {
          this.repo.transitionQueue(item.id, ['sending'], 'failed', { incAttempt: true, error: result.error ?? 'Falha.' })
          if (/permiss|forbidden|not enough rights|kicked|chat not found/i.test(result.error ?? '')) this.repo.setDestinationStatus(d.id, 'error')
          this.deps.notifier?.notify('Falha de publicação', `${d.name}: ${result.error ?? 'erro'}`)
        }
        return 'failed'
      }
    }
  }

  /** Confirmação manual de publicação (modo assistido ou status desconhecido verificado pelo usuário). */
  confirmPublished(queueId: number): boolean {
    const item = this.repo.getQueueItem(queueId)
    if (!item) return false
    if (!this.repo.transitionQueue(queueId, ['pending', 'unknown'], 'sent', { error: null })) return false
    const product = this.repo.getProduct(item.productId)
    this.repo.recordPublication({
      queueId,
      campaignId: item.campaignId,
      productId: item.productId,
      destinationId: item.destinationId,
      marketplaceId: product?.marketplaceId ?? 'manual',
      channelMessageId: null,
      priceCents: product?.priceCents ?? null,
      mode: item.channelId === 'whatsapp_assisted' ? 'assisted' : 'api',
      sentAt: this.now().toISOString()
    })
    this.repo.audit('queue.confirm_published', 'publication_queue', queueId)
    return true
  }

  /** Próxima publicação agendada (para contagem regressiva). */
  nextPublicationAt(): string | null {
    return this.repo.listQueue(['scheduled'], 1)[0]?.scheduledAt ?? null
  }

  // ───────────────────────── tarefas periódicas ─────────────────────────

  /** Atualiza preços dos favoritos monitorados pela fonte oficial (Price Radar). */
  async refreshFavorites(limit = 30): Promise<{ updated: number; drops: number }> {
    let updated = 0
    const before = new Map<number, number | null>()
    for (const id of this.repo.favoriteProductIds().slice(0, limit)) {
      const p = this.repo.getProduct(id)
      if (!p) continue
      const connector = this.deps.connectors.get(p.marketplaceId)
      if (!supports(connector.info, 'productDetails')) continue
      const cred = this.credentialsFor(p.marketplaceId)
      if (!cred) continue
      try {
        before.set(id, p.priceCents)
        const fresh = await connector.getProductDetails(cred.creds, { externalId: p.externalId, url: p.url })
        if (fresh) {
          this.repo.upsertProduct(fresh)
          updated++
        } else this.repo.upsertProduct({ ...p, available: false })
      } catch (e) {
        this.handleConnectorError(p.marketplaceId, e)
        if (e instanceof ConnectorError && (e.code === 'rate_limit' || e.code === 'auth')) break
      }
    }
    let drops = 0
    for (const [id, prev] of before) {
      const cur = this.repo.getProduct(id)?.priceCents
      if (prev && cur && cur < prev) {
        drops++
        const p = this.repo.getProduct(id)!
        this.deps.notifier?.notify('Queda de preço detectada', `${p.title}: ${(prev / 100).toFixed(2)} → ${(cur / 100).toFixed(2)}`)
      }
    }
    return { updated, drops }
  }

  /** Importa conversões oficiais (Shopee conversionReport) dos últimos `days` dias. */
  async syncConversions(days = 7): Promise<number> {
    let count = 0
    for (const acc of this.repo.listAccounts()) {
      const connector = this.deps.connectors.get(acc.marketplaceId)
      if (!supports(connector.info, 'conversions')) continue
      const cred = this.credentialsFor(acc.marketplaceId)
      if (!cred) continue
      try {
        const nodes = (await connector.getReports(cred.creds, {
          from: new Date(this.now().getTime() - days * 86400_000),
          to: this.now()
        })) as Array<Record<string, unknown>>
        for (const node of nodes) {
          const orders = (node.orders as Array<Record<string, unknown>> | undefined) ?? []
          for (const o of orders) {
            for (const it of (o.items as Array<Record<string, unknown>> | undefined) ?? []) {
              const toCents = (v: unknown) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v) * 100))
              this.repo.upsertConversion({
                marketplaceId: acc.marketplaceId,
                accountId: acc.id,
                externalOrderId: String(o.orderId ?? node.conversionId ?? ''),
                productExternalId: String(it.itemId ?? ''),
                subIds: String(node.utmContent ?? '')
                  .split('-')
                  .filter(Boolean),
                clickTime: node.clickTime ? new Date(Number(node.clickTime) * 1000).toISOString() : null,
                purchaseTime: node.purchaseTime ? new Date(Number(node.purchaseTime) * 1000).toISOString() : null,
                status: String(o.orderStatus ?? 'unknown'),
                amountCents: toCents(it.itemPrice),
                commissionCents: toCents(it.itemTotalCommission),
                source: 'api',
                raw: it
              })
              count++
            }
          }
        }
        this.repo.setAccountStatus(acc.id, 'connected', { synced: true })
      } catch (e) {
        this.handleConnectorError(acc.marketplaceId, e)
        this.log('warn', `Sincronização de conversões (${connector.info.name}) falhou: ${(e as Error).message}`)
      }
    }
    return count
  }
}
