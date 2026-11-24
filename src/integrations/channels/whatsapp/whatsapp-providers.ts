import type { DistributionProvider, DestinationCheck, FetchLike, OutgoingMessage, ProviderInfo, SendResult } from '../types'
import { isPreConnectError } from '../types'
import { isSafeHttpUrl } from '../../../core/urls'

/**
 * WhatsApp — análise técnica (2026-11), detalhada em INTEGRATIONS.md:
 *
 * 1) WhatsApp Business Platform (Cloud API) + Groups API:
 *    - Disponível somente para empresas com Official Business Account (OBA).
 *    - Grupos são CRIADOS pela empresa via API e os participantes entram por convite.
 *    - NÃO permite publicar em grupos tradicionais já existentes criados no app.
 *    - Cobrança por mensagem; números do app WhatsApp Business não são elegíveis.
 *    → Implementado como provedor "whatsapp_cloud", dependente de aprovação externa.
 *
 * 2) Grupos tradicionais existentes: não há API oficial. Bibliotecas não oficiais violam os
 *    termos do WhatsApp e arriscam banimento — NÃO são usadas.
 *    → Implementado o "Modo assistido": o app prepara mensagem e imagem, copia para a área de
 *      transferência, notifica no horário e o usuário publica manualmente.
 */

export const WHATSAPP_ASSISTED_INFO: ProviderInfo = {
  id: 'whatsapp_assisted',
  name: 'WhatsApp (modo assistido)',
  official: true,
  automatic: false,
  summary:
    'Para grupos tradicionais do WhatsApp. O Zaion prepara a mensagem, copia para a área de transferência e notifica no horário programado. A publicação é feita por você.',
  requirements: ['Nenhuma credencial. Funciona com qualquer grupo do qual você participe.'],
  credentialFields: []
}

export const WHATSAPP_CLOUD_INFO: ProviderInfo = {
  id: 'whatsapp_cloud',
  name: 'WhatsApp Cloud API (Groups API)',
  official: true,
  automatic: true,
  summary:
    'API oficial da Meta. Envia somente para grupos criados pela sua empresa via Groups API. Exige Official Business Account (OBA) e tem custo por mensagem.',
  requirements: [
    'Conta Meta Business verificada com número na WhatsApp Business Platform (Cloud API).',
    'Official Business Account (OBA) aprovada para usar a Groups API.',
    'Token de acesso permanente (System User) e Phone Number ID.',
    'Grupos criados via API; participantes entram por link de convite.'
  ],
  credentialFields: [
    { key: 'accessToken', label: 'Token de acesso (System User)', secret: true },
    { key: 'phoneNumberId', label: 'Phone Number ID', secret: false },
    { key: 'apiVersion', label: 'Versão da Graph API', secret: false, placeholder: 'v24.0' }
  ]
}

export class WhatsAppAssistedProvider implements DistributionProvider {
  readonly info = WHATSAPP_ASSISTED_INFO

  async testAccount() {
    return { ok: true, message: 'Modo assistido não requer conexão.' }
  }

  async checkDestination(_c: Record<string, string>, externalId: string): Promise<DestinationCheck> {
    const ok = externalId.trim().length > 0
    return {
      ok,
      canPost: ok,
      message: ok ? 'Destino assistido: a publicação será feita manualmente por você.' : 'Informe um nome/identificador para o grupo.'
    }
  }

  /** Não envia nada: o motor transforma o item em "aguardando publicação manual". */
  async send(): Promise<SendResult> {
    return { outcome: 'assisted', retryable: false }
  }
}

export class WhatsAppCloudProvider implements DistributionProvider {
  readonly info = WHATSAPP_CLOUD_INFO

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  private base(c: Record<string, string>) {
    const v = /^v\d+\.\d+$/.test(c.apiVersion ?? '') ? c.apiVersion : 'v24.0'
    const id = (c.phoneNumberId ?? '').trim()
    if (!/^\d{5,25}$/.test(id)) throw new Error('Phone Number ID inválido.')
    if (!c.accessToken) throw new Error('Token de acesso não informado.')
    return { url: `https://graph.facebook.com/${v}/${id}`, token: c.accessToken }
  }

  async testAccount(c: Record<string, string>) {
    try {
      const { url, token } = this.base(c)
      const res = await this.fetchImpl(`${url}?fields=display_phone_number,verified_name,quality_rating`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000)
      })
      const body = (await res.json()) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } }
      if (!res.ok) return { ok: false, message: `Meta recusou: ${body.error?.message ?? res.status}` }
      return {
        ok: true,
        message: `Número ${body.display_phone_number ?? ''} (${body.verified_name ?? ''}) conectado. A elegibilidade para grupos (OBA) deve ser confirmada no Business Manager.`,
        meta: { phone: body.display_phone_number, name: body.verified_name }
      }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }

  async checkDestination(_c: Record<string, string>, externalId: string): Promise<DestinationCheck> {
    const ok = /^[A-Za-z0-9._@-]{5,100}$/.test(externalId)
    return {
      ok,
      canPost: ok,
      message: ok
        ? 'ID de grupo aceito. A permissão real só é confirmada no primeiro envio (grupo precisa ter sido criado via Groups API).'
        : 'ID de grupo inválido.'
    }
  }

  async send(c: Record<string, string>, externalId: string, msg: OutgoingMessage): Promise<SendResult> {
    let base: { url: string; token: string }
    try {
      base = this.base(c)
    } catch (e) {
      return { outcome: 'failed', retryable: false, error: (e as Error).message }
    }
    const payload =
      msg.imageUrl && isSafeHttpUrl(msg.imageUrl) && msg.text.length <= 1024
        ? { messaging_product: 'whatsapp', recipient_type: 'group', to: externalId, type: 'image', image: { link: msg.imageUrl, caption: msg.text } }
        : { messaging_product: 'whatsapp', recipient_type: 'group', to: externalId, type: 'text', text: { body: msg.text, preview_url: true } }
    let res: Response
    try {
      res = await this.fetchImpl(`${base.url}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${base.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000)
      })
    } catch (e) {
      if (isPreConnectError(e)) return { outcome: 'failed', retryable: true, error: `Sem conexão: ${(e as Error).message}` }
      return { outcome: 'unknown', retryable: false, error: `Resposta não recebida: ${(e as Error).message}` }
    }
    const body = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string; code?: number } }
    if (res.ok && body.messages?.[0]?.id) return { outcome: 'sent', retryable: false, messageId: body.messages[0].id }
    if (res.status === 429 || body.error?.code === 130429 || body.error?.code === 131056)
      return { outcome: 'failed', retryable: true, error: 'Limite de envio da Meta.', retryAfterMs: 60_000 }
    return { outcome: 'failed', retryable: res.status >= 500, error: `Meta: ${body.error?.message ?? `HTTP ${res.status}`}` }
  }
}
