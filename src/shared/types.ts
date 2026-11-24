// Tipos de domínio compartilhados entre processo principal e interface.
// Valores monetários SEMPRE em centavos (inteiros). Datas SEMPRE em ISO-8601 UTC.

export type MarketplaceId =
  | 'shopee'
  | 'mercado-livre'
  | 'shein'
  | 'amazon'
  | 'aliexpress'
  | 'magalu'
  | 'temu'
  | 'manual'

export type IntegrationStatus =
  | 'not_configured'
  | 'awaiting_auth'
  | 'connected'
  | 'disconnected'
  | 'expired'
  | 'rate_limited'
  | 'unavailable'
  | 'awaiting_approval'
  | 'error'

export const INTEGRATION_STATUS_LABEL: Record<IntegrationStatus, string> = {
  not_configured: 'Não configurado',
  awaiting_auth: 'Aguardando autenticação',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  expired: 'Credencial expirada',
  rate_limited: 'Limite de API atingido',
  unavailable: 'Integração indisponível',
  awaiting_approval: 'Aguardando aprovação',
  error: 'Erro de conexão'
}

export type Capability =
  | 'authenticate'
  | 'searchProducts'
  | 'searchByCategory'
  | 'productDetails'
  | 'price'
  | 'discount'
  | 'images'
  | 'rating'
  | 'salesVolume'
  | 'availability'
  | 'commission'
  | 'campaigns'
  | 'coupons'
  | 'affiliateLink'
  | 'conversions'
  | 'financialReports'
  | 'csvImport'
  | 'manualEntry'

export type CapabilityStatus = 'supported' | 'unsupported' | 'pending' | 'partial'

export interface CapabilityInfo {
  capability: Capability
  status: CapabilityStatus
  note?: string
}

export interface MarketplaceInfo {
  id: MarketplaceId
  name: string
  /** Situação da integração oficial conhecida (documentada em API_CAPABILITIES.md). */
  officialApi: 'available' | 'restricted' | 'none' | 'unknown'
  summary: string
  docsUrl?: string
  capabilities: CapabilityInfo[]
  knownLimits: string[]
  credentialFields: CredentialField[]
}

export interface CredentialField {
  key: string
  label: string
  secret: boolean
  placeholder?: string
  help?: string
}

export interface MarketplaceAccount {
  id: number
  marketplaceId: MarketplaceId
  label: string
  status: IntegrationStatus
  accountRef: string | null
  lastSyncAt: string | null
  lastError: string | null
  hasCredentials: boolean
  createdAt: string
}

export interface Product {
  id: number
  marketplaceId: MarketplaceId
  externalId: string
  title: string
  url: string
  normalizedUrl: string
  shopId: string | null
  shopName: string | null
  category: string | null
  imageUrl: string | null
  priceCents: number | null
  /** Preço "de" informado pela fonte oficial. Nunca inventado. */
  originalPriceCents: number | null
  discountPct: number | null
  /** Fração (0.07 = 7%). */
  commissionRate: number | null
  commissionCents: number | null
  rating: number | null
  ratingCount: number | null
  salesCount: number | null
  available: boolean | null
  freeShipping: boolean | null
  offerLink: string | null
  dataSource: 'api' | 'csv' | 'manual' | 'fixture'
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
  isFavorite?: boolean
  isBlocked?: boolean
  score?: OfferScoreResult
}

export interface ProductInput {
  marketplaceId: MarketplaceId
  externalId: string
  title: string
  url: string
  shopId?: string | null
  shopName?: string | null
  category?: string | null
  imageUrl?: string | null
  priceCents?: number | null
  originalPriceCents?: number | null
  discountPct?: number | null
  commissionRate?: number | null
  commissionCents?: number | null
  rating?: number | null
  ratingCount?: number | null
  salesCount?: number | null
  available?: boolean | null
  freeShipping?: boolean | null
  offerLink?: string | null
  dataSource: Product['dataSource']
  raw?: unknown
}

export interface ScoreWeights {
  sales: number
  discount: number
  commission: number
  rating: number
  audience: number
  history: number
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  sales: 25,
  discount: 25,
  commission: 20,
  rating: 15,
  audience: 10,
  history: 5
}

export interface OfferScoreResult {
  score: number
  /** 0..1 — fração do peso total coberta por dados reais. */
  confidence: number
  tier: 'exceptional' | 'excellent' | 'good' | 'moderate' | 'low'
  breakdown: Array<{ criterion: keyof ScoreWeights; available: boolean; value: number | null; weight: number }>
}

export type ChannelId = 'telegram' | 'whatsapp_assisted' | 'whatsapp_cloud'

export interface ChannelAccount {
  id: number
  channelId: ChannelId
  label: string
  status: IntegrationStatus
  meta: Record<string, unknown>
  lastError: string | null
  hasCredentials: boolean
  createdAt: string
}

export interface Destination {
  id: number
  channelAccountId: number
  channelId: ChannelId
  name: string
  externalId: string
  status: 'active' | 'paused' | 'error' | 'unverified'
  audienceProfileId: number | null
  categories: string[]
  allowedStart: string // HH:MM
  allowedEnd: string // HH:MM
  minIntervalMinutes: number
  dailyLimit: number
  consentConfirmed: boolean
  permissions: Record<string, unknown>
  createdAt: string
}

export interface AudienceProfile {
  id: number
  name: string
  description: string
  categories: string[]
  keywords: string[]
  maxPriceCents: number | null
}

export type CampaignMode = 'manual' | 'semi' | 'auto'
export type CampaignStatus = 'draft' | 'active' | 'paused'

export interface Campaign {
  id: number
  name: string
  description: string
  status: CampaignStatus
  mode: CampaignMode
  marketplaces: MarketplaceId[]
  categories: string[]
  keywords: string[]
  excludedKeywords: string[]
  minPriceCents: number | null
  maxPriceCents: number | null
  minDiscountPct: number | null
  minCommissionRate: number | null
  minScore: number
  minRating: number | null
  daysOfWeek: number[] // 0=domingo
  startTime: string
  endTime: string
  intervalMinutes: number
  dailyLimit: number
  templateId: number | null
  /** Dias sem repetir. -1 = nunca repetir. 0 = sem restrição. */
  repeatDays: number
  /** Permite repetir se o preço caiu ao menos este percentual (null = não permite). */
  repeatOnPriceDropPct: number | null
  /** Política quando não é possível revalidar preço/disponibilidade. */
  stalePolicy: 'suspend' | 'allow'
  destinationIds: number[]
  lastRunAt: string | null
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

export type QueueStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'scheduled'
  | 'validating'
  | 'processing'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'canceled'
  | 'expired'
  | 'unknown'

export const QUEUE_STATUS_LABEL: Record<QueueStatus, string> = {
  pending: 'Pendente',
  awaiting_approval: 'Aguardando aprovação',
  scheduled: 'Agendada',
  validating: 'Validando',
  processing: 'Processando',
  sending: 'Enviando',
  sent: 'Enviada',
  failed: 'Falhou',
  canceled: 'Cancelada',
  expired: 'Expirada',
  unknown: 'Status de envio desconhecido'
}

export interface QueueItem {
  id: number
  campaignId: number | null
  campaignName: string | null
  productId: number
  productTitle: string
  destinationId: number
  destinationName: string
  channelId: ChannelId
  affiliateUrl: string | null
  messageText: string
  imageUrl: string | null
  status: QueueStatus
  scheduledAt: string
  position: number
  attempts: number
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface MessageTemplate {
  id: number
  name: string
  style: string
  body: string
  isBuiltin: boolean
  createdAt: string
  updatedAt: string
}

export interface AffiliateLink {
  id: number
  productId: number | null
  marketplaceId: MarketplaceId
  accountId: number | null
  originalUrl: string
  affiliateUrl: string
  subIds: string[]
  status: 'valid' | 'unverified' | 'failed'
  generatedBy: 'api' | 'manual'
  createdAt: string
}

export interface LogEntry {
  id: number
  level: 'debug' | 'info' | 'warn' | 'error'
  scope: string
  message: string
  context: Record<string, unknown> | null
  createdAt: string
}

export interface PriceObservation {
  priceCents: number
  originalPriceCents: number | null
  source: string
  observedAt: string
}

export interface PriceStats {
  current: number | null
  min: number | null
  max: number | null
  avg: number | null
  count: number
  changePct: number | null
}

export interface AppSettings {
  timezone: string
  theme: 'dark' | 'light' | 'system'
  closeBehavior: 'ask' | 'tray' | 'quit'
  autoLaunch: boolean
  preventSleepWhileActive: boolean
  autopilotEnabled: boolean
  scoreWeights: ScoreWeights
  backupDailyEnabled: boolean
  backupWeeklyEnabled: boolean
  backupRetention: number
  missedPublicationGraceMinutes: number
  ai: {
    provider: 'none' | 'ollama' | 'openai' | 'anthropic'
    ollamaUrl: string
    model: string
  }
  disclosureText: string
  notificationsEnabled: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  timezone: 'America/Sao_Paulo',
  theme: 'dark',
  closeBehavior: 'ask',
  autoLaunch: false,
  preventSleepWhileActive: false,
  autopilotEnabled: false,
  scoreWeights: DEFAULT_SCORE_WEIGHTS,
  backupDailyEnabled: true,
  backupWeeklyEnabled: true,
  backupRetention: 14,
  missedPublicationGraceMinutes: 30,
  ai: { provider: 'none', ollamaUrl: 'http://127.0.0.1:11434', model: '' },
  disclosureText: 'Publicidade | Link de afiliado. Preços e disponibilidade sujeitos a alterações.',
  notificationsEnabled: true
}

export interface DashboardSummary {
  productsFound: number
  qualifiedOffers: number
  publishedToday: number
  publishedMonth: number
  scheduled: number
  awaitingApproval: number
  activeCampaigns: number
  destinations: number
  marketplacesConnected: number
  channelsConnected: number
  failuresToday: number
  unknownStatus: number
  autopilot: { enabled: boolean; running: boolean; lastTickAt: string | null; nextPublicationAt: string | null }
  online: boolean | null
  clicks: number | null
  conversions: number | null
  commissionEstimatedCents: number | null
  commissionConfirmedCents: number | null
  publicationsByDay: Array<{ day: string; sent: number; failed: number }>
  byMarketplace: Array<{ marketplace: string; sent: number }>
  byCampaign: Array<{ campaign: string; sent: number }>
  byDestination: Array<{ destination: string; sent: number }>
  byHour: Array<{ hour: number; sent: number }>
}
