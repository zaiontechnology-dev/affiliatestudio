const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—'
  return brl.format(cents / 100)
}

/** Converte "19.90", "19,90", "R$ 1.234,56" ou número em centavos. Retorna null se inválido. */
export function parseMoneyToCents(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) : null
  if (typeof input !== 'string') return null
  let s = input.replace(/[^\d.,-]/g, '').trim()
  if (!s) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > lastDot) {
    // formato brasileiro: 1.234,56
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    // formato internacional: 1,234.56
    s = s.replace(/,/g, '')
  }
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export function formatPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits).replace('.', ',')}%`
}

export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '—'
  return formatPct(rate * 100, rate * 100 < 10 ? 1 : 0)
}
