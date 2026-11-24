import { describe, expect, it } from 'vitest'
import { computeOfferScore, NEUTRAL_PRIOR } from '../src/core/offer-score'
import { renderOfferMessage, renderTemplate, BUILTIN_TEMPLATES, unknownVariables } from '../src/core/smart-copy'
import { detectMarketplace, normalizeUrl, parseShopeeIds, sanitizeSubIds, isSafeHttpUrl } from '../src/core/urls'
import { isWithinWindow, localParts, startOfLocalDayUtc, backoffDelayMs } from '../src/core/schedule'
import { parseMoneyToCents, formatBRL } from '../src/shared/money'
import { redact, redactString } from '../src/security/redact'
import { importProductsCsv, toCsv, parseCsv } from '../src/services/csv'

describe('Zaion Offer Score', () => {
  it('pontua produto bem documentado alto', () => {
    const r = computeOfferScore({ salesCount: 10000, discountPct: 50, commissionRate: 0.12, rating: 4.9, ratingCount: 2000, audienceMatch: 1, historyScore: 0.8 })
    expect(r.score).toBeGreaterThan(80)
    expect(r.confidence).toBe(1)
  })

  it('não permite que produto com poucos dados supere produto documentado', () => {
    const sparse = computeOfferScore({ discountPct: 60 }) // só desconto, valor máximo
    const documented = computeOfferScore({ salesCount: 2000, discountPct: 30, commissionRate: 0.08, rating: 4.7, ratingCount: 300 })
    expect(sparse.confidence).toBeLessThan(0.3)
    expect(sparse.score).toBeLessThan(documented.score)
    expect(sparse.score).toBeLessThan(60)
  })

  it('sem nenhum dado retorna baixa prioridade com confiança zero', () => {
    const r = computeOfferScore({})
    expect(r.confidence).toBe(0)
    expect(r.score).toBe(0)
    expect(r.tier).toBe('low')
  })

  it('shrink nunca aumenta a nota bruta', () => {
    const r = computeOfferScore({ rating: 3.6, ratingCount: 1 })
    expect(r.score).toBeLessThanOrEqual(NEUTRAL_PRIOR)
  })

  it('pesos editáveis são respeitados', () => {
    const a = computeOfferScore({ salesCount: 10000, commissionRate: 0 }, { sales: 100, discount: 0, commission: 0, rating: 0, audience: 0, history: 0 })
    expect(a.score).toBe(100)
  })
})

describe('Zaion Smart Copy', () => {
  const body = BUILTIN_TEMPLATES[0]!.body
  const base = {
    title: 'Fone Bluetooth',
    marketplaceName: 'Shopee',
    priceCents: 4990,
    originalPriceCents: null,
    discountPct: null,
    coupon: null,
    affiliateUrl: 'https://s.shopee.com.br/abc',
    rating: null,
    freeShipping: null,
    category: null,
    validUntil: null,
    disclosure: 'Publicidade | Link de afiliado.'
  }

  it('omite linhas sem dados reais (sem cupom e sem preço anterior inventados)', () => {
    const { text } = renderOfferMessage(body, base)
    expect(text).not.toContain('Cupom')
    expect(text).not.toContain('De:')
    expect(text).toContain('R$')
    expect(text).toContain('https://s.shopee.com.br/abc')
    expect(text).toContain('Publicidade')
  })

  it('preço anterior só aparece quando maior que o atual', () => {
    expect(renderOfferMessage(body, { ...base, originalPriceCents: 3000 }).text).not.toContain('De:')
    expect(renderOfferMessage(body, { ...base, originalPriceCents: 9990 }).text).toContain('De:')
  })

  it('garante link e identificação publicitária mesmo se o modelo omitir', () => {
    const { text } = renderOfferMessage('{{produto}}', base)
    expect(text).toContain(base.affiliateUrl)
    expect(text).toContain(base.disclosure)
  })

  it('remove caracteres de controle de títulos externos', () => {
    const t = renderTemplate('{{produto}}', { produto: 'abc' })
    expect(t).toBe('abc')
    const { text } = renderOfferMessage('{{produto}}', { ...base, title: 'Fone\u202E\u0000 top' })
    expect(text.startsWith('Fone top')).toBe(true)
  })

  it('detecta variáveis desconhecidas', () => {
    expect(unknownVariables('{{produto}} {{xyz}}')).toEqual(['xyz'])
  })
})

describe('URLs', () => {
  it('normaliza removendo rastreamento', () => {
    expect(normalizeUrl('https://www.Shopee.com.br/produto-i.1.2?utm_source=x&sp_atk=y#top')).toBe('https://shopee.com.br/produto-i.1.2')
  })
  it('detecta marketplace', () => {
    expect(detectMarketplace('https://shopee.com.br/x-i.1.2')).toBe('shopee')
    expect(detectMarketplace('https://produto.mercadolivre.com.br/MLB-1')).toBe('mercado-livre')
    expect(detectMarketplace('https://evil.com/shopee.com.br')).toBe(null)
  })
  it('extrai ids da Shopee', () => {
    expect(parseShopeeIds('https://shopee.com.br/Nome-i.123.456')).toEqual({ shopId: '123', itemId: '456' })
    expect(parseShopeeIds('https://shopee.com.br/product/123/456')).toEqual({ shopId: '123', itemId: '456' })
  })
  it('sanitiza subIds', () => {
    expect(sanitizeSubIds(['zaion', 'c-1', 'Casa e decoração', '', 'a', 'b', 'c'])).toEqual(['zaion', 'c1', 'Casaedecoracao', 'a', 'b'])
  })
  it('rejeita URLs perigosas', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeHttpUrl('https://user:pass@x.com')).toBe(false)
  })
})

describe('Agenda e fuso horário', () => {
  it('converte para America/Sao_Paulo (UTC-3)', () => {
    const p = localParts(new Date('2026-11-24T15:00:00Z'), 'America/Sao_Paulo')
    expect(p.hour).toBe(12)
    expect(p.dateKey).toBe('2026-11-24')
  })
  it('janela de horário', () => {
    const tz = 'America/Sao_Paulo'
    expect(isWithinWindow(new Date('2026-11-24T15:00:00Z'), tz, '08:00', '22:00')).toBe(true) // 12h
    expect(isWithinWindow(new Date('2026-11-25T02:00:00Z'), tz, '08:00', '22:00')).toBe(false) // 23h
    expect(isWithinWindow(new Date('2026-11-25T02:00:00Z'), tz, '20:00', '02:00')).toBe(true) // cruza meia-noite
  })
  it('respeita dias da semana', () => {
    // 2026-11-24 é terça-feira (2)
    expect(isWithinWindow(new Date('2026-11-24T15:00:00Z'), 'America/Sao_Paulo', '08:00', '22:00', [1, 3])).toBe(false)
  })
  it('início do dia local', () => {
    expect(startOfLocalDayUtc(new Date('2026-11-24T15:00:00Z'), 'America/Sao_Paulo').toISOString()).toBe('2026-11-24T03:00:00.000Z')
  })
  it('backoff exponencial com teto', () => {
    expect(backoffDelayMs(1, 1000, 10_000, 0.5)).toBe(1000)
    expect(backoffDelayMs(3, 1000, 10_000, 0.5)).toBe(4000)
    expect(backoffDelayMs(10, 1000, 10_000, 0.5)).toBe(10_000)
  })
})

describe('Dinheiro', () => {
  it('converte formatos', () => {
    expect(parseMoneyToCents('19.90')).toBe(1990)
    expect(parseMoneyToCents('R$ 1.234,56')).toBe(123456)
    expect(parseMoneyToCents('abc')).toBe(null)
    expect(formatBRL(1990)).toMatch(/R\$\s?19,90/)
  })
})

describe('Redação de segredos', () => {
  it('remove tokens de logs', () => {
    expect(redactString('https://api.telegram.org/bot123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/sendMessage')).not.toContain('AAAA')
    expect(redact({ token: 'x', nested: { apiKey: 'y', ok: 1 } })).toEqual({ token: '[REDACTED]', nested: { apiKey: '[REDACTED]', ok: 1 } })
    expect(redactString('Authorization: SHA256 Credential=1, Signature=abcdef')).toContain('[REDACTED]')
  })
})

describe('CSV', () => {
  it('importa com separador ; e cabeçalhos em português', () => {
    const csv = 'Nome;Link;Preço;Preço anterior;Comissão %;Link de afiliado\n"Panela; inox";https://shopee.com.br/x-i.1.2;R$ 59,90;R$ 99,90;7;https://s.shopee.com.br/q'
    const r = importProductsCsv(csv)
    expect(r.errors).toEqual([])
    expect(r.rows[0]!.product.title).toBe('Panela; inox')
    expect(r.rows[0]!.product.priceCents).toBe(5990)
    expect(r.rows[0]!.product.commissionRate).toBeCloseTo(0.07)
    expect(r.rows[0]!.product.discountPct).toBeCloseTo(40.0, 0)
    expect(r.rows[0]!.product.externalId).toBe('1.2')
    expect(r.rows[0]!.affiliateUrl).toBe('https://s.shopee.com.br/q')
  })
  it('rejeita arquivo sem colunas obrigatórias', () => {
    expect(importProductsCsv('a;b\n1;2').errors.length).toBe(1)
  })
  it('exporta neutralizando fórmulas', () => {
    const out = toCsv(['a'], [['=HYPERLINK("x")']])
    expect(out).toContain(`"'=HYPERLINK(""x"")"`)
    expect(parseCsv(out.slice(1))[1]![0]).toBe(`'=HYPERLINK("x")`)
  })
})
