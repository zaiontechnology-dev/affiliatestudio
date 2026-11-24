import { describe, expect, it } from 'vitest'
import { generateAiCopy, validateAiOutput, type AiFacts } from '../src/intelligence/ai-copy'
import { fixtureProduct, setup } from './helpers'

const facts: AiFacts = {
  produto: 'Fone Bluetooth',
  marketplace: 'Shopee',
  preco_atual: 'R$ 49,90',
  preco_anterior: null,
  desconto: null,
  cupom: null,
  avaliacao: null,
  frete: null,
  link_afiliado: 'https://s.shopee.com.br/abc123',
  identificacao_publicitaria: 'Publicidade | Link de afiliado.'
}

describe('Cupons', () => {
  it('cupom expirado não é usado; cupom válido é', () => {
    const env = setup()
    const pid = env.repo.upsertProduct(fixtureProduct())
    env.repo.addCoupon({ marketplaceId: 'shopee', productId: pid, code: 'VELHO10', validUntil: '2026-01-01T00:00:00.000Z', source: 'manual' })
    expect(env.repo.activeCouponForProduct(pid, '2026-11-24T15:00:00.000Z')).toBeNull()
    env.repo.addCoupon({ marketplaceId: 'shopee', productId: pid, code: 'NOVO5', validUntil: '2026-12-31T00:00:00.000Z', source: 'manual' })
    expect(env.repo.activeCouponForProduct(pid, '2026-11-24T15:00:00.000Z')?.code).toBe('NOVO5')
  })
})

describe('IA opcional', () => {
  it('IA desconectada: retorna problema e não produz texto (o app usa template)', async () => {
    const r = await generateAiCopy({ provider: 'ollama', model: 'x', ollamaUrl: 'http://127.0.0.1:1' }, facts, 'Objetivo')
    expect(r.usedAi).toBe(false)
    expect(r.text).toBeNull()
    expect(r.problems.length).toBeGreaterThan(0)
  })
  it('recusa Ollama fora do localhost', async () => {
    const r = await generateAiCopy({ provider: 'ollama', model: 'x', ollamaUrl: 'http://example.com:11434' }, facts, 'Objetivo')
    expect(r.problems[0]).toMatch(/localmente/)
  })
  it('sem chave de API não chama o provedor', async () => {
    const r = await generateAiCopy({ provider: 'anthropic', model: '', ollamaUrl: '' }, facts, 'Objetivo')
    expect(r.problems[0]).toMatch(/Chave/)
  })
  it('valida saída: link alterado, identificação ausente e números inventados', () => {
    const ok = `Fone Bluetooth por R$ 49,90\n${facts.link_afiliado}\n${facts.identificacao_publicitaria}`
    expect(validateAiOutput(ok, facts)).toEqual([])
    expect(validateAiOutput(ok.replace('abc123', 'xyz'), facts).join()).toMatch(/link/)
    expect(validateAiOutput(`Fone\n${facts.link_afiliado}`, facts).join()).toMatch(/identificação/)
    expect(validateAiOutput(`Fone com 70% OFF! ${facts.link_afiliado}\n${facts.identificacao_publicitaria}`, facts).join()).toMatch(/70/)
  })
})
