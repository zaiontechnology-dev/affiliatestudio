import { openDatabase } from '../src/database/db'
import { Repository } from '../src/database/repository'
import { SecretStore, TestOnlyCipher } from '../src/security/secret-store'
import { ConnectorRegistry } from '../src/integrations/marketplaces/registry'
import type { DistributionProvider, OutgoingMessage, SendResult } from '../src/integrations/channels/types'
import { WhatsAppAssistedProvider, WhatsAppCloudProvider } from '../src/integrations/channels/whatsapp/whatsapp-providers'
import { Autopilot } from '../src/automation/autopilot'
import type { ProductInput } from '../src/shared/types'

/**
 * FIXTURES DE TESTE — dados fictícios usados EXCLUSIVAMENTE em testes automatizados.
 * Nunca são gravados no banco de produção.
 */
export function fixtureProduct(over: Partial<ProductInput> = {}): ProductInput {
  return {
    marketplaceId: 'shopee',
    externalId: '111.222',
    title: '[FIXTURE] Organizador de gaveta',
    url: 'https://shopee.com.br/product/111/222',
    category: 'Casa e decoração',
    imageUrl: 'https://cf.shopee.com.br/file/fixture.jpg',
    priceCents: 2990,
    originalPriceCents: 4990,
    discountPct: 40,
    commissionRate: 0.08,
    rating: 4.8,
    ratingCount: 500,
    salesCount: 3000,
    available: true,
    dataSource: 'fixture',
    ...over
  }
}

export class FakeProvider implements DistributionProvider {
  readonly info = { id: 'telegram' as const, name: 'Fake', official: true, automatic: true, summary: '', requirements: [], credentialFields: [] }
  sent: Array<{ to: string; msg: OutgoingMessage }> = []
  next: SendResult[] = []
  async testAccount() {
    return { ok: true, message: 'ok' }
  }
  async checkDestination() {
    return { ok: true, canPost: true, message: 'ok' }
  }
  async send(_c: Record<string, string>, to: string, msg: OutgoingMessage): Promise<SendResult> {
    const r = this.next.shift() ?? { outcome: 'sent', retryable: false, messageId: String(this.sent.length + 1) }
    if (r.outcome === 'sent') this.sent.push({ to, msg })
    return r
  }
}

export function setup(nowIso = '2026-11-24T15:00:00.000Z') {
  const db = openDatabase({ path: ':memory:' })
  const repo = new Repository(db)
  const connectors = new ConnectorRegistry()
  repo.seed(connectors.list())
  const secrets = new SecretStore(db, new TestOnlyCipher())
  const telegram = new FakeProvider()
  let now = new Date(nowIso)
  const notes: string[] = []
  const autopilot = new Autopilot({
    repo,
    secrets,
    connectors,
    providers: { telegram, whatsapp_assisted: new WhatsAppAssistedProvider(), whatsapp_cloud: new WhatsAppCloudProvider() },
    notifier: { notify: (t, b) => notes.push(`${t}: ${b}`) },
    now: () => now
  })
  const setNow = (iso: string) => {
    now = new Date(iso)
  }

  // destino autorizado de teste
  secrets.set('channel:test', { token: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
  const accountId = repo.upsertChannelAccount('telegram', 'Bot teste', 'channel:test')
  repo.setChannelAccountStatus(accountId, 'connected', null)
  const destId = repo.saveDestination({
    channelAccountId: accountId,
    name: 'Grupo teste',
    externalId: '@grupo_teste',
    audienceProfileId: null,
    categories: [],
    allowedStart: '08:00',
    allowedEnd: '22:00',
    minIntervalMinutes: 30,
    dailyLimit: 3,
    consentConfirmed: true
  })
  repo.setDestinationStatus(destId, 'active')

  return { db, repo, connectors, secrets, telegram, autopilot, setNow, notes, destId, accountId }
}

export function baseCampaign(destIds: number[], over: Record<string, unknown> = {}) {
  return {
    name: 'Teste',
    description: '',
    status: 'active' as const,
    mode: 'auto' as const,
    marketplaces: ['shopee' as const],
    categories: [],
    keywords: [],
    excludedKeywords: [],
    minPriceCents: null,
    maxPriceCents: null,
    minDiscountPct: 20,
    minCommissionRate: 0.05,
    minScore: 60,
    minRating: null,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: '08:00',
    endTime: '22:00',
    intervalMinutes: 30,
    dailyLimit: 10,
    templateId: null,
    repeatDays: 7,
    repeatOnPriceDropPct: null,
    stalePolicy: 'allow' as const,
    destinationIds: destIds,
    ...over
  }
}
