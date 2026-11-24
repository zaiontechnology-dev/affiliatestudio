import { formatBRL, formatPct } from '../shared/money'

/**
 * Zaion Smart Copy — motor determinístico de templates.
 *
 * Regras:
 *  - Variáveis no formato {{nome}}.
 *  - Uma linha que contenha QUALQUER variável sem valor é removida inteira
 *    (ex.: "🏷️ Cupom: {{cupom}}" some quando não há cupom real).
 *  - Nada é inventado: valores vêm exclusivamente dos dados do produto.
 *  - Texto sai como texto puro (sem HTML/Markdown) para evitar injeção de formatação.
 */

export const TEMPLATE_VARIABLES = [
  'produto',
  'marketplace',
  'preco_atual',
  'preco_anterior',
  'desconto',
  'cupom',
  'link_afiliado',
  'avaliacao',
  'frete',
  'categoria',
  'validade',
  'identificacao_publicitaria'
] as const

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]

export interface CopyData {
  title: string
  marketplaceName: string
  priceCents: number | null
  originalPriceCents: number | null
  discountPct: number | null
  coupon: string | null
  affiliateUrl: string | null
  rating: number | null
  freeShipping: boolean | null
  category: string | null
  validUntil: string | null
  disclosure: string
}

const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/g

/** Remove caracteres de controle e limita tamanho de textos vindos de fontes externas. */
export function sanitizeExternalText(s: string, max = 300): string {
  return s
    // eslint-disable-next-line no-control-regex -- remoção intencional de caracteres de controle
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

export function buildVariables(d: CopyData): Record<TemplateVariable, string | null> {
  const hasRealDiscount =
    d.originalPriceCents !== null && d.priceCents !== null && d.originalPriceCents > d.priceCents
  return {
    produto: d.title ? sanitizeExternalText(d.title, 200) : null,
    marketplace: d.marketplaceName || null,
    preco_atual: d.priceCents !== null ? formatBRL(d.priceCents) : null,
    preco_anterior: hasRealDiscount ? formatBRL(d.originalPriceCents) : null,
    desconto: d.discountPct !== null && d.discountPct > 0 ? `${formatPct(d.discountPct)} OFF` : null,
    cupom: d.coupon ? sanitizeExternalText(d.coupon, 60) : null,
    link_afiliado: d.affiliateUrl,
    avaliacao: d.rating !== null && d.rating > 0 ? `${d.rating.toFixed(1).replace('.', ',')} ★` : null,
    frete: d.freeShipping === true ? 'Frete grátis' : null,
    categoria: d.category,
    validade: d.validUntil,
    identificacao_publicitaria: d.disclosure || null
  }
}

export function renderTemplate(body: string, vars: Partial<Record<string, string | null>>): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    let missing = false
    const rendered = line.replace(VAR_RE, (_m, name: string) => {
      const v = vars[name]
      if (v === null || v === undefined || v === '') {
        missing = true
        return ''
      }
      return v
    })
    if (!missing) out.push(rendered)
  }
  // colapsa linhas em branco consecutivas e apara extremidades
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface RenderResult {
  text: string
  missingRequired: string[]
}

/** Renderiza garantindo link e identificação publicitária. */
export function renderOfferMessage(body: string, data: CopyData): RenderResult {
  const vars = buildVariables(data)
  let text = renderTemplate(body, vars)
  const missingRequired: string[] = []
  if (!data.affiliateUrl) missingRequired.push('link_afiliado')
  else if (!text.includes(data.affiliateUrl)) text = `${text}\n\n${data.affiliateUrl}`
  if (data.disclosure && !text.includes(data.disclosure)) text = `${text}\n\n${data.disclosure}`
  return { text, missingRequired }
}

export function listTemplateVariables(body: string): string[] {
  return [...new Set([...body.matchAll(VAR_RE)].map((m) => m[1]!))]
}

export function unknownVariables(body: string): string[] {
  const known = new Set<string>(TEMPLATE_VARIABLES)
  return listTemplateVariables(body).filter((v) => !known.has(v))
}

export const BUILTIN_TEMPLATES: Array<{ name: string; style: string; body: string }> = [
  {
    name: 'Achadinho do dia',
    style: 'Achadinhos',
    body: `🔥 ACHADINHO DO DIA!

{{produto}}

De: {{preco_anterior}}
Por apenas: {{preco_atual}}
🏷️ Cupom: {{cupom}}
🚚 {{frete}}

🛒 Compre aqui:
{{link_afiliado}}

{{identificacao_publicitaria}}`
  },
  {
    name: 'Objetivo',
    style: 'Objetivo',
    body: `{{produto}}
Preço: {{preco_atual}} ({{desconto}})
Cupom: {{cupom}}
{{link_afiliado}}

{{identificacao_publicitaria}}`
  },
  {
    name: 'Minimalista sem emojis',
    style: 'Minimalista',
    body: `{{produto}}
{{preco_atual}}
{{link_afiliado}}

{{identificacao_publicitaria}}`
  },
  {
    name: 'Premium',
    style: 'Premium',
    body: `✨ Seleção Zaion

{{produto}}
Avaliação: {{avaliacao}}

De {{preco_anterior}} por {{preco_atual}}

Confira: {{link_afiliado}}

{{identificacao_publicitaria}}`
  },
  {
    name: 'Oferta relâmpago',
    style: 'Ofertas relâmpago',
    body: `⚡ OFERTA NO {{marketplace}}

{{produto}}
💰 {{preco_atual}} — {{desconto}}
🏷️ Cupom: {{cupom}}
⏳ Válido até: {{validade}}

👉 {{link_afiliado}}

{{identificacao_publicitaria}}`
  }
]
