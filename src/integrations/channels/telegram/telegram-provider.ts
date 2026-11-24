import type { DistributionProvider, DestinationCheck, FetchLike, OutgoingMessage, ProviderInfo, SendResult } from '../types'
import { isPreConnectError } from '../types'
import { isSafeHttpUrl } from '../../../core/urls'

/**
 * Telegram Bot API oficial (https://core.telegram.org/bots/api).
 * Mensagens são enviadas como TEXTO PURO (sem parse_mode) para impedir que dados externos
 * injetem formatação/links ocultos.
 */
export const TELEGRAM_INFO: ProviderInfo = {
  id: 'telegram',
  name: 'Telegram',
  official: true,
  automatic: true,
  summary: 'API oficial de bots do Telegram. Envio automático para grupos e canais onde o bot tem permissão.',
  requirements: [
    'Criar um bot com o @BotFather e copiar o token.',
    'Adicionar o bot ao grupo/canal. Em canais, o bot precisa ser administrador com permissão de publicar.',
    'Informar o @username público ou o ID numérico do chat (ex.: -100…).'
  ],
  credentialFields: [{ key: 'token', label: 'Token do bot', secret: true, placeholder: '123456789:AA…' }]
}

const CAPTION_LIMIT = 1024
const TEXT_LIMIT = 4096
const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,}$/
const CHAT_RE = /^(@[A-Za-z][A-Za-z0-9_]{3,31}|-?\d{5,20})$/

interface TgResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: { retry_after?: number; migrate_to_chat_id?: number }
}

export class TelegramProvider implements DistributionProvider {
  readonly info = TELEGRAM_INFO

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly base = 'https://api.telegram.org'
  ) {}

  private token(creds: Record<string, string>): string {
    const t = (creds.token ?? '').trim()
    if (!TOKEN_RE.test(t)) throw new Error('Token do bot em formato inválido.')
    return t
  }

  private async call<T>(token: string, method: string, body?: Record<string, unknown>): Promise<TgResponse<T>> {
    const res = await this.fetchImpl(`${this.base}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30_000)
    })
    return (await res.json()) as TgResponse<T>
  }

  async testAccount(creds: Record<string, string>) {
    try {
      const r = await this.call<{ id: number; username: string; first_name: string }>(this.token(creds), 'getMe')
      if (!r.ok || !r.result) return { ok: false, message: `Telegram recusou o token: ${r.description ?? 'erro'}` }
      return {
        ok: true,
        message: `Bot @${r.result.username} conectado.`,
        meta: { botId: r.result.id, username: r.result.username, name: r.result.first_name }
      }
    } catch (e) {
      return { ok: false, message: `Falha ao validar token: ${(e as Error).message}` }
    }
  }

  async checkDestination(creds: Record<string, string>, externalId: string): Promise<DestinationCheck> {
    if (!CHAT_RE.test(externalId)) return { ok: false, canPost: false, message: 'Identificador de chat inválido. Use @canal ou ID numérico.' }
    try {
      const token = this.token(creds)
      const me = await this.call<{ id: number }>(token, 'getMe')
      if (!me.ok || !me.result) return { ok: false, canPost: false, message: 'Token inválido.' }
      const chat = await this.call<{ id: number; title?: string; type: string }>(token, 'getChat', { chat_id: externalId })
      if (!chat.ok || !chat.result) return { ok: false, canPost: false, message: `Chat não acessível: ${chat.description ?? 'erro'}` }
      const member = await this.call<{ status: string; can_post_messages?: boolean; can_send_messages?: boolean }>(
        token,
        'getChatMember',
        { chat_id: externalId, user_id: me.result.id }
      )
      const st = member.result?.status
      let canPost = false
      if (chat.result.type === 'channel') canPost = st === 'creator' || (st === 'administrator' && member.result?.can_post_messages !== false)
      else canPost = ['creator', 'administrator', 'member'].includes(st ?? '') || (st === 'restricted' && member.result?.can_send_messages === true)
      return {
        ok: true,
        title: chat.result.title,
        type: chat.result.type,
        canPost,
        message: canPost ? 'Bot com permissão de publicação.' : `Bot sem permissão de publicação (status: ${st ?? 'desconhecido'}).`,
        permissions: { status: st, chatId: chat.result.id, type: chat.result.type }
      }
    } catch (e) {
      return { ok: false, canPost: false, message: `Falha na verificação: ${(e as Error).message}` }
    }
  }

  async send(creds: Record<string, string>, externalId: string, msg: OutgoingMessage): Promise<SendResult> {
    let token: string
    try {
      token = this.token(creds)
    } catch (e) {
      return { outcome: 'failed', retryable: false, error: (e as Error).message }
    }
    const usePhoto = !!msg.imageUrl && isSafeHttpUrl(msg.imageUrl) && msg.text.length <= CAPTION_LIMIT
    const method = usePhoto ? 'sendPhoto' : 'sendMessage'
    const body: Record<string, unknown> = usePhoto
      ? { chat_id: externalId, photo: msg.imageUrl, caption: msg.text }
      : { chat_id: externalId, text: msg.text.slice(0, TEXT_LIMIT), link_preview_options: { is_disabled: false } }

    let r: TgResponse<{ message_id: number }>
    try {
      r = await this.call<{ message_id: number }>(token, method, body)
    } catch (e) {
      if (isPreConnectError(e)) return { outcome: 'failed', retryable: true, error: `Sem conexão: ${(e as Error).message}` }
      // A requisição pode ter chegado ao Telegram: NÃO reenviar automaticamente.
      return { outcome: 'unknown', retryable: false, error: `Resposta não recebida: ${(e as Error).message}` }
    }
    if (r.ok && r.result) return { outcome: 'sent', retryable: false, messageId: String(r.result.message_id) }

    // Foto rejeitada pelo Telegram (URL inacessível etc.): tenta como texto, nada foi entregue.
    if (usePhoto && r.error_code === 400 && /photo|image|file|wrong type|IMAGE_PROCESS/i.test(r.description ?? '')) {
      return this.send(creds, externalId, { text: msg.text, imageUrl: null })
    }
    if (r.error_code === 429)
      return {
        outcome: 'failed',
        retryable: true,
        error: 'Limite de envio do Telegram.',
        retryAfterMs: (r.parameters?.retry_after ?? 30) * 1000
      }
    const retryable = (r.error_code ?? 0) >= 500
    return { outcome: 'failed', retryable, error: `Telegram: ${r.description ?? 'erro'} (${r.error_code ?? 'n/d'})`, response: r }
  }
}
