export { formatBRL, formatPct, formatRate, parseMoneyToCents } from '@shared/money'

const TZ = 'America/Sao_Paulo'
let currentTz = TZ
export const setTimezone = (tz: string) => {
  currentTz = tz || TZ
}

export function dt(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', { timeZone: currentTz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}

export function dateOnly(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: currentTz, weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(iso))
}

export function timeOnly(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: currentTz, timeStyle: 'short' }).format(new Date(iso))
}

export function relative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.parse(iso) - Date.now()
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second')
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute')
  if (abs < 86400_000) return rtf.format(Math.round(diff / 3600_000), 'hour')
  return rtf.format(Math.round(diff / 86400_000), 'day')
}

export function countdown(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const s = Math.max(0, Math.floor((Date.parse(iso) - now) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export const MARKETPLACE_NAMES: Record<string, string> = {
  shopee: 'Shopee',
  'mercado-livre': 'Mercado Livre',
  shein: 'SHEIN',
  amazon: 'Amazon',
  aliexpress: 'AliExpress',
  magalu: 'Magalu',
  temu: 'Temu',
  manual: 'Manual'
}

export const CHANNEL_NAMES: Record<string, string> = {
  telegram: 'Telegram',
  whatsapp_assisted: 'WhatsApp (assistido)',
  whatsapp_cloud: 'WhatsApp Cloud API'
}
