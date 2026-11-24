import { describe, expect, it } from 'vitest'
import { baseCampaign, fixtureProduct, setup } from './helpers'

function seedProductWithLink(env: ReturnType<typeof setup>, over = {}) {
  const pid = env.repo.upsertProduct(fixtureProduct(over), '2026-11-24T14:59:00.000Z')
  env.repo.saveAffiliateLink({
    productId: pid,
    marketplaceId: 'shopee',
    accountId: null,
    originalUrl: 'https://shopee.com.br/product/111/222',
    affiliateUrl: 'https://s.shopee.com.br/fixture',
    subIds: [],
    status: 'unverified',
    generatedBy: 'manual'
  })
  return pid
}

describe('AutoPilot — fluxo completo', () => {
  it('produto → validação → link → mensagem → fila → envio → registro', async () => {
    const env = setup()
    seedProductWithLink(env)
    const cid = env.repo.saveCampaign(baseCampaign([env.destId]))
    const r = await env.autopilot.runCampaign(env.repo.getCampaign(cid)!)
    expect(r.status).toBe('enqueued')
    const q = env.repo.listQueue(['scheduled'])
    expect(q).toHaveLength(1)
    expect(q[0]!.messageText).toContain('https://s.shopee.com.br/fixture')
    expect(q[0]!.messageText).toContain('Publicidade')

    const sent = await env.autopilot.processQueue()
    expect(sent).toBe(1)
    expect(env.telegram.sent).toHaveLength(1)
    expect(env.repo.listQueue(['sent'])).toHaveLength(1)
    expect(env.repo.listPublications()).toHaveLength(1)
  })

  it('não publica nada quando não há oferta válida', async () => {
    const env = setup()
    seedProductWithLink(env, { discountPct: 5 })
    const cid = env.repo.saveCampaign(baseCampaign([env.destId]))
    const r = await env.autopilot.runCampaign(env.repo.getCampaign(cid)!)
    expect(r.status).toBe('no_offer')
    expect(env.repo.listQueue()).toHaveLength(0)
  })

  it('desconto não verificável não passa no filtro de desconto mínimo', async () => {
    const env = setup()
    seedProductWithLink(env, { discountPct: null, originalPriceCents: null })
    const cid = env.repo.saveCampaign(baseCampaign([env.destId]))
    expect((await env.autopilot.runCampaign(env.repo.getCampaign(cid)!)).status).toBe('no_offer')
  })

  it('comissão indisponível não bloqueia (aplicada só quando verificável)', async () => {
    const env = setup()
    seedProductWithLink(env, { commissionRate: null })
    const cid = env.repo.saveCampaign(baseCampaign([env.destId], { minScore: 50 }))
    expect((await env.autopilot.runCampaign(env.repo.getCampaign(cid)!)).status).toBe('enqueued')
  })

  it('sem link de afiliado válido, a oferta não é programada', async () => {
    const env = setup()
    env.repo.upsertProduct(fixtureProduct(), '2026-11-24T14:59:00.000Z')
    const cid = env.repo.saveCampaign(baseCampaign([env.destId]))
    const r = await env.autopilot.runCampaign(env.repo.getCampaign(cid)!)
    expect(r.status).toBe('no_offer')
    expect(env.repo.listQueue()).toHaveLength(0)
  })

  it('produto indisponível é descartado', async () => {
    const env = setup()
    seedProductWithLink(env, { available: false })
    const cid = env.repo.saveCampaign(baseCampaign([env.destId]))
    expect((await env.autopilot.runCampaign(env.repo.getCampaign(cid)!)).status).toBe('no_offer')
  })

  it('política suspender: dado desatualizado sem integração não é publicado', async () => {
    const env = setup()
    env.repo.upsertProduct(fixtureProduct(), '2026-11-20T00:00:00.000Z') // antigo
    const pid = env.repo.listProducts()[0]!.id
    env.repo.saveAffiliateLink({ productId: pid, marketplaceId: 'shopee', accountId: null, originalUrl: 'u', affiliateUrl: 'https://s.shopee.com.br/x', subIds: [], status: 'unverified', generatedBy: 'manual' })
    const cid = env.repo.saveCampaign(baseCampaign([env.destId], { stalePolicy: 'suspend' }))
    expect((await env.autopilot.runCampaign(env.repo.getCampaign(cid)!)).status).toBe('no_offer')
  })
})

describe('Controle de repetição', () => {
  it('não repete o mesmo produto no mesmo destino dentro do período', async () => {
    const env = setup()
    seedProductWithLink(env)
    const cid = env.repo.saveCampaign(baseCampaign([env.destId]))
    await env.autopilot.runCampaign(env.repo.getCampaign(cid)!)
    await env.autopilot.processQueue()
    env.setNow('2026-11-24T16:00:00.000Z')
    const r2 = await env.autopilot.runCampaign(env.repo.getCampaign(cid)!, { force: true })
    expect(r2.status).toBe('no_offer')
  })

  it('permite repetir após o período configurado', async () => {
    const env = setup()
    seedProductWithLink(env)
    const cid = env.repo.saveCampaign(baseCampaign([env.destId], { repeatDays: 1, stalePolicy: 'allow' }))
    await env.autopilot.runCampaign(env.repo.getCampaign(cid)!)
    await env.autopilot.processQueue()
    env.setNow('2026-11-25T16:00:00.000Z')
    env.repo.upsertProduct(fixtureProduct(), '2026-11-25T15:59:00.000Z')
    expect((await env.autopilot.runCampaign(env.repo.getCampaign(cid)!)).status).toBe('enqueued')
  })

  it('permite repetir antes do prazo se houver queda relevante de preço', async () => {
    const env = setup()
    seedProductWithLink(env)
    const cid = env.repo.saveCampaign(baseCampaign([env.destId], { repeatOnPriceDropPct: 10 }))
    await env.autopilot.runCampaign(env.repo.getCampaign(cid)!)
    await env.autopilot.processQueue()
    env.setNow('2026-11-24T17:00:00.000Z')
    env.repo.upsertProduct(fixtureProduct({ priceCents: 2490 }), '2026-11-24T16:59:00.000Z')
    expect((await env.autopilot.runCampaign(env.repo.getCampaign(cid)!)).status).toBe('enqueued')
  })

  it('idempotência: item duplicado na fila é ignorado', () => {
    const env = setup()
    const pid = seedProductWithLink(env)
    const base = { campaignId: null, productId: pid, destinationId: env.destId, affiliateLinkId: null, messageText: 'x', imageUrl: null, status: 'scheduled' as const, scheduledAt: '2026-11-24T15:00:00.000Z', priceCents: 1, idempotencyKey: 'k1' }
    expect(env.repo.enqueue(base)).not.toBeNull()
    expect(env.repo.enqueue(base)).toBeNull()
  })
})

describe('Fila, limites e falhas', () => {
  function enqueueN(env: ReturnType<typeof setup>, n: number, at = '2026-11-24T15:00:00.000Z') {
    const ids: number[] = []
    for (let i = 0; i < n; i++) {
      const pid = env.repo.upsertProduct(fixtureProduct({ externalId: `9.${i}` }))
      ids.push(env.repo.enqueue({ campaignId: null, productId: pid, destinationId: env.destId, affiliateLinkId: null, messageText: `m${i}`, imageUrl: null, status: 'scheduled', scheduledAt: at, priceCents: 1, idempotencyKey: `k${i}` })!)
    }
    return ids
  }

  it('não dispara tudo de uma vez: 1 envio por destino por ciclo + intervalo mínimo', async () => {
    const env = setup()
    env.repo.updateSettings({ autopilotEnabled: true })
    enqueueN(env, 3)
    await env.autopilot.processQueue()
    expect(env.telegram.sent).toHaveLength(1)
    await env.autopilot.processQueue()
    expect(env.telegram.sent).toHaveLength(1) // intervalo mínimo de 30 min
    env.setNow('2026-11-24T15:31:00.000Z')
    await env.autopilot.processQueue()
    expect(env.telegram.sent).toHaveLength(2)
  })

  it('limite diário do destino adia para o dia seguinte', async () => {
    const env = setup()
    enqueueN(env, 4)
    for (let i = 0; i < 4; i++) {
      env.setNow(`2026-11-24T${15 + i}:00:00.000Z`)
      await env.autopilot.processQueue()
    }
    expect(env.telegram.sent).toHaveLength(3)
    const pending = env.repo.listQueue(['scheduled'])
    expect(pending).toHaveLength(1)
    expect(pending[0]!.scheduledAt).toBe('2026-11-25T11:00:00.000Z') // 08:00 BRT
  })

  it('fora do horário permitido do destino é adiado', async () => {
    const env = setup('2026-11-25T02:00:00.000Z') // 23h BRT
    enqueueN(env, 1, '2026-11-25T02:00:00.000Z')
    await env.autopilot.processQueue()
    expect(env.telegram.sent).toHaveLength(0)
    expect(env.repo.listQueue(['scheduled'])[0]!.scheduledAt >= '2026-11-25T11:00:00.000Z').toBe(true)
  })

  it('falha temporária (internet desconectada) reagenda com backoff', async () => {
    const env = setup()
    enqueueN(env, 1)
    env.telegram.next.push({ outcome: 'failed', retryable: true, error: 'Sem conexão' })
    await env.autopilot.processQueue()
    const q = env.repo.listQueue(['scheduled'])
    expect(q).toHaveLength(1)
    expect(q[0]!.attempts).toBe(1)
    expect(q[0]!.scheduledAt > '2026-11-24T15:00:00.000Z').toBe(true)
  })

  it('grupo sem permissão: falha definitiva e destino marcado com erro', async () => {
    const env = setup()
    enqueueN(env, 1)
    env.telegram.next.push({ outcome: 'failed', retryable: false, error: 'Telegram: Forbidden: bot is not a member (403)' })
    await env.autopilot.processQueue()
    expect(env.repo.listQueue(['failed'])).toHaveLength(1)
    expect(env.repo.getDestination(env.destId)!.status).toBe('error')
  })

  it('status desconhecido não é reenviado automaticamente', async () => {
    const env = setup()
    enqueueN(env, 1)
    env.telegram.next.push({ outcome: 'unknown', retryable: false, error: 'timeout' })
    await env.autopilot.processQueue()
    env.setNow('2026-11-24T18:00:00.000Z')
    await env.autopilot.processQueue()
    expect(env.repo.listQueue(['unknown'])).toHaveLength(1)
    expect(env.telegram.sent).toHaveLength(0)
  })

  it('campanha pausada mantém itens na fila sem enviar', async () => {
    const env = setup()
    const cid = env.repo.saveCampaign(baseCampaign([env.destId], { status: 'paused' }))
    const pid = env.repo.upsertProduct(fixtureProduct())
    env.repo.enqueue({ campaignId: cid, productId: pid, destinationId: env.destId, affiliateLinkId: null, messageText: 'x', imageUrl: null, status: 'scheduled', scheduledAt: '2026-11-24T15:00:00.000Z', priceCents: 1, idempotencyKey: 'p1' })
    await env.autopilot.processQueue()
    expect(env.telegram.sent).toHaveLength(0)
  })

  it('AutoPilot pausado não executa ciclo', async () => {
    const env = setup()
    env.repo.updateSettings({ autopilotEnabled: false })
    enqueueN(env, 1)
    await env.autopilot.tick()
    expect(env.telegram.sent).toHaveLength(0)
  })

  it('destino sem consentimento confirmado não recebe envio', async () => {
    const env = setup()
    const d = env.repo.getDestination(env.destId)!
    env.repo.saveDestination({ ...d, consentConfirmed: false })
    const [id] = enqueueN(env, 1)
    await env.autopilot.sendItem(id!, { manualOverride: true })
    expect(env.telegram.sent).toHaveLength(0)
    expect(env.repo.getQueueItem(id!)!.status).toBe('failed')
  })
})

describe('Recuperação após reinicialização', () => {
  it('envio interrompido vira desconhecido; atrasados expiram; processando volta para agendado', () => {
    const env = setup()
    const pid = env.repo.upsertProduct(fixtureProduct())
    const mk = (key: string, status: 'sending' | 'processing' | 'scheduled', at: string) =>
      env.repo.enqueue({ campaignId: null, productId: pid, destinationId: env.destId, affiliateLinkId: null, messageText: key, imageUrl: null, status, scheduledAt: at, priceCents: 1, idempotencyKey: key })
    mk('a', 'sending', '2026-11-24T14:00:00.000Z')
    mk('b', 'processing', '2026-11-24T14:59:00.000Z')
    mk('c', 'scheduled', '2026-11-24T10:00:00.000Z')
    mk('d', 'scheduled', '2026-11-24T14:50:00.000Z')
    const r = env.autopilot.recover()
    expect(r).toEqual({ unknown: 1, requeued: 1, expired: 1 })
    expect(env.repo.listQueue(['scheduled']).map((q) => q.messageText).sort()).toEqual(['b', 'd'])
  })

  it('modo assistido (WhatsApp) prepara publicação manual e confirma', async () => {
    const env = setup()
    const acc = env.repo.upsertChannelAccount('whatsapp_assisted', 'Meu WhatsApp', null)
    const did = env.repo.saveDestination({ channelAccountId: acc, name: 'Grupo WA', externalId: 'Achadinhos', audienceProfileId: null, categories: [], allowedStart: '00:00', allowedEnd: '00:00', minIntervalMinutes: 10, dailyLimit: 10, consentConfirmed: true })
    env.repo.setDestinationStatus(did, 'active')
    const pid = env.repo.upsertProduct(fixtureProduct())
    const id = env.repo.enqueue({ campaignId: null, productId: pid, destinationId: did, affiliateLinkId: null, messageText: 'x', imageUrl: null, status: 'scheduled', scheduledAt: '2026-11-24T15:00:00.000Z', priceCents: 1, idempotencyKey: 'wa' })!
    expect(await env.autopilot.sendItem(id)).toBe('assisted')
    expect(env.repo.getQueueItem(id)!.status).toBe('pending')
    expect(env.notes.some((n) => n.includes('WhatsApp'))).toBe(true)
    expect(env.autopilot.confirmPublished(id)).toBe(true)
    expect(env.repo.listPublications()[0]!.mode).toBe('assisted')
  })
})
