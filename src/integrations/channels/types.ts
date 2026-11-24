import type { ChannelId } from '../../shared/types'
import type { FetchLike } from '../marketplaces/types'

export type SendOutcome = 'sent' | 'failed' | 'unknown' | 'assisted'

export interface SendResult {
  outcome: SendOutcome
  /** Para 'failed': pode tentar novamente com segurança (nada foi entregue). */
  retryable: boolean
  messageId?: string
  error?: string
  retryAfterMs?: number
  response?: unknown
}

export interface OutgoingMessage {
  text: string
  imageUrl?: string | null
}

export interface DestinationCheck {
  ok: boolean
  title?: string
  type?: string
  canPost: boolean
  message: string
  permissions?: Record<string, unknown>
}

export interface ProviderInfo {
  id: ChannelId
  name: string
  official: boolean
  automatic: boolean
  summary: string
  requirements: string[]
  credentialFields: Array<{ key: string; label: string; secret: boolean; placeholder?: string; help?: string }>
}

/** Camada abstrata de distribuição. Novos provedores autorizados implementam esta interface. */
export interface DistributionProvider {
  readonly info: ProviderInfo
  testAccount(creds: Record<string, string>): Promise<{ ok: boolean; message: string; meta?: Record<string, unknown> }>
  checkDestination(creds: Record<string, string>, externalId: string): Promise<DestinationCheck>
  send(creds: Record<string, string>, externalId: string, msg: OutgoingMessage): Promise<SendResult>
}

export type { FetchLike }

/** Erros de rede em que a requisição comprovadamente NÃO chegou ao servidor. */
export function isPreConnectError(e: unknown): boolean {
  const code = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code
  return ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET_BEFORE_SEND'].includes(
    code ?? ''
  )
}
