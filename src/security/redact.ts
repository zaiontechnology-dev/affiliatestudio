/** Remove dados sensíveis antes de gravar logs ou exibir erros. */

const SENSITIVE_KEYS = /(token|secret|password|senha|apikey|api_key|authorization|credential|signature|cookie)/i

export function redactString(s: string): string {
  return (
    s
      // token de bot do Telegram: 123456789:AA...
      .replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, '[REDACTED_BOT_TOKEN]')
      // URLs da API do Telegram com token
      .replace(/(api\.telegram\.org\/(?:file\/)?bot)[^/\s]+/gi, '$1[REDACTED]')
      // cabeçalhos Authorization
      .replace(/(Authorization["']?\s*[:=]\s*["']?)[^"'\n]+/gi, '$1[REDACTED]')
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
      .replace(/(Signature=)[a-f0-9]+/gi, '$1[REDACTED]')
      // chaves de API conhecidas
      .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_KEY]')
      .replace(/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_KEY]')
  )
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[…]'
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (value && typeof value === 'object') {
    if (value instanceof Error) return { name: value.name, message: redactString(value.message) }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1)
    }
    return out
  }
  return value
}
