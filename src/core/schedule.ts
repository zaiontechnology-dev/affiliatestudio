/**
 * Utilidades de agenda com fuso horário explícito (padrão America/Sao_Paulo).
 * Internamente tudo é UTC; a janela de horário é avaliada no fuso configurado.
 */

export interface LocalParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number // 0 = domingo
  dateKey: string // YYYY-MM-DD no fuso local
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const fmtCache = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short'
    })
    fmtCache.set(tz, f)
  }
  return f
}

export function localParts(date: Date, tz: string): LocalParts {
  const parts = Object.fromEntries(formatter(tz).formatToParts(date).map((p) => [p.type, p.value]))
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday as string] ?? 0,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`
  }
}

export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) throw new Error(`Horário inválido: ${s}`)
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) throw new Error(`Horário inválido: ${s}`)
  return h * 60 + min
}

/** Verifica se `date` está dentro da janela [start, end] nos dias permitidos. Suporta janelas que cruzam meia-noite. */
export function isWithinWindow(date: Date, tz: string, start: string, end: string, days?: number[]): boolean {
  const p = localParts(date, tz)
  const minutes = p.hour * 60 + p.minute
  const s = parseHHMM(start)
  const e = parseHHMM(end)
  if (s === e) return days ? days.includes(p.weekday) : true
  if (s < e) {
    if (days && !days.includes(p.weekday)) return false
    return minutes >= s && minutes < e
  }
  // cruza meia-noite: pertence ao dia de início se minutes >= s
  if (minutes >= s) return days ? days.includes(p.weekday) : true
  if (minutes < e) return days ? days.includes((p.weekday + 6) % 7) : true
  return false
}

/** Início do dia local (em UTC) para contagem de limites diários. */
export function startOfLocalDayUtc(date: Date, tz: string): Date {
  const p = localParts(date, tz)
  // aproxima pelo offset atual do fuso
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  const offsetMs = asUtc - Math.floor(date.getTime() / 60000) * 60000
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - offsetMs)
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

/** Backoff exponencial com teto e jitter determinístico opcional. */
export function backoffDelayMs(attempt: number, baseMs = 30_000, maxMs = 30 * 60_000, jitter = Math.random()): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1))
  return Math.round(exp * (0.8 + 0.4 * jitter))
}

export function formatLocal(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}
