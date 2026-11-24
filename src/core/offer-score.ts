import type { OfferScoreResult, ScoreWeights } from '../shared/types'
import { DEFAULT_SCORE_WEIGHTS } from '../shared/types'

/**
 * Zaion Offer Score (0–100).
 *
 * Cada critério é normalizado para 0..1 SOMENTE quando há dado real.
 * Critérios sem dado têm o peso redistribuído entre os disponíveis, mas o resultado
 * é "encolhido" em direção a um valor neutro conforme a confiança cai.
 * Assim um produto com poucos dados nunca supera automaticamente um produto bem documentado.
 *
 *   final = raw * confidence + NEUTRAL_PRIOR * (1 - confidence)   (limitado a raw)
 *
 * Heurística inicial; não é previsão de vendas.
 */
export const NEUTRAL_PRIOR = 40

export interface ScoreInput {
  salesCount?: number | null
  discountPct?: number | null
  commissionRate?: number | null
  rating?: number | null
  ratingCount?: number | null
  /** 0..1 — compatibilidade com o perfil de audiência, se calculada. */
  audienceMatch?: number | null
  /** 0..1 — desempenho histórico do produto/categoria, se existir. */
  historyScore?: number | null
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export function normalizeSales(sales: number): number {
  // escala logarítmica: 10k+ vendas = 1.0
  return clamp01(Math.log10(Math.max(0, sales) + 1) / 4)
}

export function normalizeDiscount(pct: number): number {
  // 60%+ = 1.0; descontos absurdos (>90) recebem desconfiança
  if (pct > 90) return 0.3
  return clamp01(pct / 60)
}

export function normalizeCommission(rate: number): number {
  // 15%+ = 1.0
  return clamp01(rate / 0.15)
}

export function normalizeRating(rating: number, count: number | null | undefined): number {
  const base = clamp01((rating - 3.5) / 1.5)
  if (!isNum(count)) return base * 0.8
  // poucas avaliações reduzem a confiança no valor (média bayesiana simplificada)
  const weight = count / (count + 20)
  return base * weight + 0.4 * (1 - weight)
}

export function scoreTier(score: number): OfferScoreResult['tier'] {
  if (score >= 90) return 'exceptional'
  if (score >= 80) return 'excellent'
  if (score >= 70) return 'good'
  if (score >= 60) return 'moderate'
  return 'low'
}

export const TIER_LABEL: Record<OfferScoreResult['tier'], string> = {
  exceptional: 'Oportunidade excepcional',
  excellent: 'Excelente oportunidade',
  good: 'Boa oportunidade',
  moderate: 'Oportunidade moderada',
  low: 'Baixa prioridade'
}

export function computeOfferScore(input: ScoreInput, weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS): OfferScoreResult {
  const values: Record<keyof ScoreWeights, number | null> = {
    sales: isNum(input.salesCount) ? normalizeSales(input.salesCount) : null,
    discount: isNum(input.discountPct) && input.discountPct >= 0 ? normalizeDiscount(input.discountPct) : null,
    commission: isNum(input.commissionRate) && input.commissionRate >= 0 ? normalizeCommission(input.commissionRate) : null,
    rating: isNum(input.rating) && input.rating > 0 ? normalizeRating(input.rating, input.ratingCount) : null,
    audience: isNum(input.audienceMatch) ? clamp01(input.audienceMatch) : null,
    history: isNum(input.historyScore) ? clamp01(input.historyScore) : null
  }

  const keys = Object.keys(weights) as Array<keyof ScoreWeights>
  const totalWeight = keys.reduce((s, k) => s + Math.max(0, weights[k]), 0)
  let availWeight = 0
  let weighted = 0
  for (const k of keys) {
    const v = values[k]
    const w = Math.max(0, weights[k])
    if (v !== null) {
      availWeight += w
      weighted += v * w
    }
  }

  const confidence = totalWeight > 0 ? availWeight / totalWeight : 0
  const raw = availWeight > 0 ? (weighted / availWeight) * 100 : 0
  const shrunk = raw * confidence + NEUTRAL_PRIOR * (1 - confidence)
  const score = Math.round(Math.min(raw, shrunk) * 10) / 10

  return {
    score,
    confidence: Math.round(confidence * 100) / 100,
    tier: scoreTier(score),
    breakdown: keys.map((k) => ({ criterion: k, available: values[k] !== null, value: values[k], weight: weights[k] }))
  }
}

/** Compatibilidade simples por categoria/palavra-chave com um perfil de audiência (0..1). */
export function audienceMatch(
  product: { title: string; category: string | null; priceCents: number | null },
  profile: { categories: string[]; keywords: string[]; maxPriceCents: number | null } | null
): number | null {
  if (!profile) return null
  const hasCriteria = profile.categories.length > 0 || profile.keywords.length > 0 || profile.maxPriceCents !== null
  if (!hasCriteria) return null
  let score = 0
  let parts = 0
  if (profile.categories.length > 0) {
    parts++
    if (product.category && profile.categories.some((c) => c.toLowerCase() === product.category!.toLowerCase())) score++
  }
  if (profile.keywords.length > 0) {
    parts++
    const t = product.title.toLowerCase()
    if (profile.keywords.some((k) => t.includes(k.toLowerCase()))) score++
  }
  if (profile.maxPriceCents !== null) {
    parts++
    if (product.priceCents !== null && product.priceCents <= profile.maxPriceCents) score++
  }
  return parts > 0 ? score / parts : null
}
