import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Copy, Megaphone, Pause, Play, Plus, RotateCcw, Send, Sparkles, Trash2, X } from 'lucide-react'
import type { AppSettings, Campaign, DashboardSummary, Destination, MessageTemplate, Product, QueueItem, QueueStatus } from '@shared/types'
import { QUEUE_STATUS_LABEL } from '@shared/types'
import { INTERVAL_OPTIONS, REPEAT_OPTIONS } from '@shared/brand'
import { Badge, Button, Card, Chips, Empty, Field, Input, Loading, Modal, Notice, Page, Select, Stat, Table, Tabs, Td, Textarea, useAction, useFeedback } from '../components/ui'
import { MessagePreview, QueueBadge, ScoreBadge } from '../components/domain'
import { call, useQuery } from '../lib/api'
import { CHANNEL_NAMES, countdown, dateOnly, dt, formatBRL, formatPct, MARKETPLACE_NAMES, parseMoneyToCents, relative, timeOnly } from '../lib/format'
import type { Route } from '../components/Shell'

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MODE_LABEL = { manual: 'Manual', semi: 'Semiautomático', auto: 'Automático' } as const
const STATUS_LABEL = { draft: 'Rascunho', active: 'Ativa', paused: 'Pausada' } as const

// ───────────── AutoPilot ─────────────
export function AutopilotPage({ go }: { go: (r: Route) => void }) {
  const { data: d, reload } = useQuery<DashboardSummary>('dashboard.summary', undefined, { live: true })
  const { data: campaigns, reload: rc } = useQuery<Campaign[]>('campaigns.list', undefined, { live: true })
  const { data: s } = useQuery<AppSettings>('settings.get', undefined, { live: true })
  const { run, busy } = useAction()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!d || !campaigns) return <Loading />
  const active = campaigns.filter((c) => c.status === 'active')
  return (
    <Page title="Zaion AutoPilot" subtitle="O motor executa as campanhas ativas enquanto o computador estiver ligado, acordado e conectado. Com o computador desligado ou suspenso nada é publicado — e o atrasado não é disparado em lote ao voltar."
      actions={
        <Button variant={d.autopilot.enabled ? 'danger' : 'primary'} loading={busy === 'ap'} icon={d.autopilot.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          onClick={() => run('ap', async () => { await call('autopilot.setEnabled', !d.autopilot.enabled); void reload() }, d.autopilot.enabled ? 'AutoPilot pausado.' : 'AutoPilot iniciado.')}>
          {d.autopilot.enabled ? 'Pausar todas as automações' : 'Iniciar AutoPilot'}
        </Button>
      }>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Status do motor" value={d.autopilot.enabled ? 'Ativo' : 'Pausado'} tone={d.autopilot.enabled ? 'ok' : 'warn'} hint={d.autopilot.lastTickAt ? `Último ciclo ${relative(d.autopilot.lastTickAt)}` : 'Ciclo a cada 30 s'} />
        <Stat label="Próxima publicação" value={d.autopilot.nextPublicationAt ? countdown(d.autopilot.nextPublicationAt, now) : '—'} hint={d.autopilot.nextPublicationAt ? dt(d.autopilot.nextPublicationAt) : undefined} />
        <Stat label="Campanhas ativas" value={active.length} />
        <Stat label="Conexão" value={d.online === false ? 'Offline' : 'Online'} tone={d.online === false ? 'bad' : 'ok'} />
      </div>
      {s && !s.preventSleepWhileActive && d.autopilot.enabled && <Notice tone="info">Dica: em Configurações você pode impedir a suspensão do computador enquanto houver campanhas ativas (sem alterar o plano de energia do Windows).</Notice>}
      <Card title="Campanhas" actions={<Button size="sm" onClick={() => go('campaigns')}>Gerenciar</Button>} padded={false}>
        <Table head={['Campanha', 'Modo', 'Status', 'Janela', 'Intervalo', 'Última execução', 'Próxima', '']} empty={!campaigns.length}>
          {campaigns.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium">{c.name}</Td>
              <Td>{MODE_LABEL[c.mode]}</Td>
              <Td><Badge tone={c.status === 'active' ? 'ok' : c.status === 'paused' ? 'warn' : 'neutral'}>{STATUS_LABEL[c.status]}</Badge></Td>
              <Td className="tabular text-xs">{c.startTime}–{c.endTime}</Td>
              <Td className="text-xs">{c.intervalMinutes} min</Td>
              <Td className="text-xs text-muted">{relative(c.lastRunAt)}</Td>
              <Td className="text-xs text-muted">{c.status === 'active' ? (c.nextRunAt ? dt(c.nextRunAt) : 'no próximo ciclo') : '—'}</Td>
              <Td>
                <div className="flex gap-1">
                  {c.status === 'active' ? (
                    <Button size="sm" onClick={() => run('p', async () => { await call('campaigns.setStatus', { campaignId: c.id, status: 'paused' }); void rc() }, 'Campanha pausada.')}>Pausar</Button>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => run('a', async () => { await call('campaigns.setStatus', { campaignId: c.id, status: 'active' }); void rc() }, 'Campanha ativada.')}>Ativar</Button>
                  )}
                  <Button size="sm" loading={busy === `r${c.id}`} onClick={() => run(`r${c.id}`, () => call<{ status: string; reason?: string }>('campaigns.runNow', c.id), (r) => (r.status === 'enqueued' ? 'Oferta selecionada e programada na fila.' : `Nenhuma oferta programada: ${r.reason}`))}>Executar agora</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Fluxo operacional por execução">
        <ol className="grid gap-x-6 gap-y-1.5 text-sm text-muted md:grid-cols-2">
          {['Verifica janela de horário, dias e limite diário', 'Busca produtos nas integrações oficiais conectadas', 'Aplica filtros da campanha', 'Calcula o Zaion Offer Score', 'Verifica histórico e duplicidades por destino', 'Revalida preço e disponibilidade na fonte oficial', 'Gera link de afiliado oficial (ou usa link manual cadastrado)', 'Monta a mensagem com identificação publicitária', 'Insere na fila respeitando intervalo e limite de cada destino', 'Envia, registra o resultado e programa a próxima execução'].map((s, i) => (
            <li key={s} className="flex gap-2"><span className="tabular w-5 shrink-0 text-brand">{i + 1}.</span>{s}</li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted">Se nenhuma oferta for válida, nada é publicado apenas para cumprir o intervalo.</p>
      </Card>
    </Page>
  )
}

// ───────────── Campanhas ─────────────
type CampaignForm = Omit<Campaign, 'id' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'nextRunAt'> & { id?: number }
const newCampaign = (): CampaignForm => ({
  name: '', description: '', status: 'draft', mode: 'semi', marketplaces: ['shopee'], categories: [], keywords: [], excludedKeywords: [],
  minPriceCents: null, maxPriceCents: null, minDiscountPct: 20, minCommissionRate: 0.05, minScore: 70, minRating: null,
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '22:00', intervalMinutes: 30, dailyLimit: 20, templateId: null,
  repeatDays: 7, repeatOnPriceDropPct: 10, stalePolicy: 'suspend', destinationIds: []
})

export function Campaigns({ categories }: { categories: readonly string[] }) {
  const { data, reload } = useQuery<Campaign[]>('campaigns.list')
  const [edit, setEdit] = useState<CampaignForm | null>(null)
  const { run } = useAction()
  const { confirm } = useFeedback()
  return (
    <Page title="Campanhas" subtitle="Cada campanha tem suas próprias regras, destinos, horários e modo de operação."
      actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit(newCampaign())}>Nova campanha</Button>}>
      {data?.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <Card key={c.id}>
              <div className="flex items-start justify-between gap-2">
                <div><div className="font-semibold">{c.name}</div><div className="mt-0.5 line-clamp-2 text-xs text-muted">{c.description || '—'}</div></div>
                <Badge tone={c.status === 'active' ? 'ok' : c.status === 'paused' ? 'warn' : 'neutral'}>{STATUS_LABEL[c.status]}</Badge>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-y-1 text-xs">
                <dt className="text-muted">Modo</dt><dd className="text-right">{MODE_LABEL[c.mode]}</dd>
                <dt className="text-muted">Marketplaces</dt><dd className="truncate text-right">{c.marketplaces.map((m) => MARKETPLACE_NAMES[m]).join(', ') || 'Todos'}</dd>
                <dt className="text-muted">Horário</dt><dd className="text-right tabular">{c.startTime}–{c.endTime} · {c.intervalMinutes} min</dd>
                <dt className="text-muted">Score mínimo</dt><dd className="text-right">{c.minScore}</dd>
                <dt className="text-muted">Desconto mínimo</dt><dd className="text-right">{formatPct(c.minDiscountPct)}</dd>
                <dt className="text-muted">Destinos</dt><dd className="text-right">{c.destinationIds.length}</dd>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setEdit({ ...c })}>Editar</Button>
                {c.status === 'active'
                  ? <Button size="sm" onClick={() => run('s', async () => { await call('campaigns.setStatus', { campaignId: c.id, status: 'paused' }); void reload() }, 'Pausada.')}>Pausar</Button>
                  : <Button size="sm" variant="primary" onClick={() => run('s', async () => { await call('campaigns.setStatus', { campaignId: c.id, status: 'active' }); void reload() }, 'Ativada.')}>Ativar</Button>}
                <Button size="sm" variant="ghost" onClick={() => setEdit({ ...c, id: undefined, name: `${c.name} (cópia)`, status: 'draft' })}>Duplicar</Button>
                <Button size="sm" variant="ghost" aria-label="Excluir" onClick={async () => { if (await confirm({ title: 'Excluir campanha', message: `Excluir “${c.name}”? O histórico de publicações é mantido.`, danger: true, confirmLabel: 'Excluir' })) run('x', async () => { await call('campaigns.delete', c.id); void reload() }, 'Campanha excluída.') }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </Card>
          ))}
        </div>
      ) : <Empty icon={<Megaphone />} title="Nenhuma campanha" />}
      {edit && <CampaignEditor value={edit} onClose={() => { setEdit(null); void reload() }} categories={categories} />}
    </Page>
  )
}

function listToText(l: string[]) {
  return l.join(', ')
}
function textToList(s: string) {
  return s.split(',').map((x) => x.trim()).filter(Boolean)
}

function CampaignEditor({ value, onClose, categories }: { value: CampaignForm; onClose: () => void; categories: readonly string[] }) {
  const [c, setC] = useState<CampaignForm>(value)
  const [kw, setKw] = useState(listToText(value.keywords))
  const [ex, setEx] = useState(listToText(value.excludedKeywords))
  const [price, setPrice] = useState({ min: value.minPriceCents ? String(value.minPriceCents / 100) : '', max: value.maxPriceCents ? String(value.maxPriceCents / 100) : '' })
  const [customInterval, setCustomInterval] = useState(!INTERVAL_OPTIONS.includes(value.intervalMinutes as (typeof INTERVAL_OPTIONS)[number]))
  const { data: dests } = useQuery<Destination[]>('destinations.list')
  const { data: templates } = useQuery<MessageTemplate[]>('templates.list')
  const [preview, setPreview] = useState<Product[] | null>(null)
  const { run, busy } = useAction()
  const payload = () => ({ ...c, keywords: textToList(kw), excludedKeywords: textToList(ex), minPriceCents: parseMoneyToCents(price.min), maxPriceCents: parseMoneyToCents(price.max) })
  const set = <K extends keyof CampaignForm>(k: K, v: CampaignForm[K]) => setC({ ...c, [k]: v })
  return (
    <Modal open onClose={onClose} title={c.id ? 'Editar campanha' : 'Nova campanha'} wide
      footer={<>
        <Button onClick={() => run('pv', async () => setPreview(await call<Product[]>('campaigns.preview', payload())))} loading={busy === 'pv'}>Pré-visualizar ofertas elegíveis</Button>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={busy === 'sv'} onClick={() => run('sv', async () => { await call('campaigns.save', payload()); onClose() }, 'Campanha salva.')}>Salvar</Button>
      </>}>
      <div className="grid grid-cols-4 gap-3">
        <Field label="Nome" className="col-span-2"><Input value={c.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Status"><Select value={c.status} onChange={(e) => set('status', e.target.value as Campaign['status'])} options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Modo de operação"><Select value={c.mode} onChange={(e) => set('mode', e.target.value as Campaign['mode'])} options={[{ value: 'manual', label: 'Manual — você escolhe e aprova' }, { value: 'semi', label: 'Semiautomático — sistema seleciona, você aprova' }, { value: 'auto', label: 'Automático — seleciona, valida e publica' }]} /></Field>
        <Field label="Descrição" className="col-span-4"><Input value={c.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Marketplaces" className="col-span-4"><Chips options={Object.entries(MARKETPLACE_NAMES).map(([value, label]) => ({ value, label }))} value={c.marketplaces} onChange={(v) => set('marketplaces', v as CampaignForm['marketplaces'])} /></Field>
        <Field label="Categorias" className="col-span-4"><Chips options={categories.map((x) => ({ value: x, label: x }))} value={c.categories} onChange={(v) => set('categories', v as string[])} /></Field>
        <Field label="Palavras-chave (vírgula)" className="col-span-2"><Input value={kw} onChange={(e) => setKw(e.target.value)} /></Field>
        <Field label="Palavras excluídas (vírgula)" className="col-span-2"><Input value={ex} onChange={(e) => setEx(e.target.value)} /></Field>
        <Field label="Preço mínimo (R$)"><Input value={price.min} onChange={(e) => setPrice({ ...price, min: e.target.value })} /></Field>
        <Field label="Preço máximo (R$)"><Input value={price.max} onChange={(e) => setPrice({ ...price, max: e.target.value })} /></Field>
        <Field label="Desconto mínimo (%)" hint="Somente desconto verificável"><Input type="number" value={c.minDiscountPct ?? ''} onChange={(e) => set('minDiscountPct', e.target.value === '' ? null : Number(e.target.value))} /></Field>
        <Field label="Comissão mínima (%)" hint="Aplicada quando verificável"><Input type="number" value={c.minCommissionRate === null ? '' : c.minCommissionRate * 100} onChange={(e) => set('minCommissionRate', e.target.value === '' ? null : Number(e.target.value) / 100)} /></Field>
        <Field label="Offer Score mínimo"><Input type="number" value={c.minScore} onChange={(e) => set('minScore', Number(e.target.value))} /></Field>
        <Field label="Avaliação mínima"><Input type="number" step="0.1" value={c.minRating ?? ''} onChange={(e) => set('minRating', e.target.value === '' ? null : Number(e.target.value))} /></Field>
        <Field label="Horário inicial"><Input type="time" value={c.startTime} onChange={(e) => set('startTime', e.target.value)} /></Field>
        <Field label="Horário final"><Input type="time" value={c.endTime} onChange={(e) => set('endTime', e.target.value)} /></Field>
        <Field label="Dias da semana" className="col-span-2"><Chips options={DAYS.map((d, i) => ({ value: i, label: d }))} value={c.daysOfWeek} onChange={(v) => set('daysOfWeek', (v as number[]).sort())} /></Field>
        <Field label="Intervalo de publicação">
          <Select value={customInterval ? 'custom' : c.intervalMinutes} onChange={(e) => { if (e.target.value === 'custom') setCustomInterval(true); else { setCustomInterval(false); set('intervalMinutes', Number(e.target.value)) } }}
            options={[...INTERVAL_OPTIONS.map((m) => ({ value: m, label: m < 60 ? `${m} minutos` : `${m / 60} hora${m > 60 ? 's' : ''}` })), { value: 'custom', label: 'Personalizado' }]} />
        </Field>
        {customInterval ? <Field label="Minutos"><Input type="number" min={5} value={c.intervalMinutes} onChange={(e) => set('intervalMinutes', Number(e.target.value))} /></Field> : <div />}
        <Field label="Limite diário"><Input type="number" min={1} value={c.dailyLimit} onChange={(e) => set('dailyLimit', Number(e.target.value))} /></Field>
        <Field label="Modelo de mensagem"><Select value={c.templateId ?? ''} onChange={(e) => set('templateId', e.target.value ? Number(e.target.value) : null)} options={[{ value: '', label: 'Padrão' }, ...(templates ?? []).map((t) => ({ value: t.id, label: t.name }))]} /></Field>
        <Field label="Política de repetição" className="col-span-2"><Select value={c.repeatDays} onChange={(e) => set('repeatDays', Number(e.target.value))} options={REPEAT_OPTIONS} /></Field>
        <Field label="Repetir antes se o preço cair (%)" hint="Vazio = não repetir por queda"><Input type="number" value={c.repeatOnPriceDropPct ?? ''} onChange={(e) => set('repeatOnPriceDropPct', e.target.value === '' ? null : Number(e.target.value))} /></Field>
        <Field label="Dados não revalidáveis"><Select value={c.stalePolicy} onChange={(e) => set('stalePolicy', e.target.value as Campaign['stalePolicy'])} options={[{ value: 'suspend', label: 'Suspender publicação' }, { value: 'allow', label: 'Permitir (dados recentes)' }]} /></Field>
        <Field label="Destinos autorizados" className="col-span-4">
          {dests?.length ? <Chips options={dests.map((d) => ({ value: d.id, label: `${d.name} · ${CHANNEL_NAMES[d.channelId]}${d.consentConfirmed ? '' : ' (sem autorização)'}` }))} value={c.destinationIds} onChange={(v) => set('destinationIds', v as number[])} /> : <span className="text-xs text-muted">Nenhum destino cadastrado.</span>}
        </Field>
      </div>
      {preview && (
        <div className="mt-5">
          <div className="mb-2 text-sm font-medium">{preview.length} oferta(s) elegível(is) no catálogo atual</div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
            <Table head={['Produto', 'Preço', 'Desconto', 'Score']} empty={!preview.length}>
              {preview.map((p) => <tr key={p.id}><Td className="max-w-[360px] truncate">{p.title}</Td><Td>{formatBRL(p.priceCents)}</Td><Td>{formatPct(p.discountPct)}</Td><Td><ScoreBadge score={p.score} compact /></Td></tr>)}
            </Table>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ───────────── Fila ─────────────
const FILTERS: Record<string, QueueStatus[] | undefined> = {
  open: ['pending', 'awaiting_approval', 'scheduled', 'validating', 'processing', 'sending', 'unknown'],
  done: ['sent'],
  problems: ['failed', 'unknown', 'expired'],
  all: undefined
}

export function Queue() {
  const [tab, setTab] = useState<keyof typeof FILTERS>('open')
  const { data, reload, loading } = useQuery<QueueItem[]>('queue.list', FILTERS[tab], { live: true })
  const [edit, setEdit] = useState<QueueItem | null>(null)
  const [text, setText] = useState('')
  const [when, setWhen] = useState('')
  const { run } = useAction()
  const { confirm } = useFeedback()
  const act = (key: string, method: string, args: unknown, msg: string) => run(key, async () => { const r = await call(method, args); void reload(); return r }, msg)
  return (
    <Page title="Fila de publicações" subtitle="Fila persistente com idempotência. Envios com status desconhecido nunca são repetidos automaticamente.">
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'open', label: 'Em aberto' }, { value: 'problems', label: 'Falhas e pendências' }, { value: 'done', label: 'Enviadas' }, { value: 'all', label: 'Todas' }]} />
      <Card padded={false}>
        {loading ? <Loading /> : (
          <Table head={['Horário', 'Produto', 'Destino', 'Campanha', 'Status', 'Tentativas', '']} empty={!data?.length}>
            {data?.map((q, i) => (
              <tr key={q.id} className="align-top">
                <Td className="whitespace-nowrap tabular text-xs">{dt(q.scheduledAt)}</Td>
                <Td className="max-w-[280px]"><div className="truncate">{q.productTitle}</div>{q.lastError && <div className="mt-0.5 text-[11px] text-bad">{q.lastError}</div>}</Td>
                <Td className="text-xs">{q.destinationName}<div className="text-muted">{CHANNEL_NAMES[q.channelId]}</div></Td>
                <Td className="text-xs text-muted">{q.campaignName ?? 'Manual'}</Td>
                <Td><QueueBadge status={q.status} /></Td>
                <Td className="tabular text-xs">{q.attempts}</Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-1">
                    {q.status === 'awaiting_approval' && <Button size="sm" variant="primary" icon={<Check className="h-3.5 w-3.5" />} onClick={() => act('ap', 'queue.approve', q.id, 'Aprovada e agendada.')}>Aprovar</Button>}
                    {q.status === 'pending' && <>
                      <Button size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => act('cp', 'queue.copyForManual', q.id, 'Mensagem copiada. Cole no grupo do WhatsApp.')}>Copiar</Button>
                      <Button size="sm" variant="primary" onClick={() => act('cf', 'queue.confirmPublished', q.id, 'Publicação registrada.')}>Marcar como publicada</Button>
                    </>}
                    {q.status === 'unknown' && <>
                      <Button size="sm" variant="primary" onClick={() => act('cf', 'queue.confirmPublished', q.id, 'Confirmada como enviada.')}>Foi enviada</Button>
                    </>}
                    {(q.status === 'failed' || q.status === 'expired') && <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => act('rt', 'queue.retry', q.id, 'Reagendada.')}>Reprocessar</Button>}
                    {['scheduled', 'awaiting_approval', 'failed'].includes(q.status) && (
                      <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} onClick={async () => { if (await confirm({ title: 'Publicar agora', message: `Enviar AGORA para “${q.destinationName}”, ignorando o horário programado?`, confirmLabel: 'Publicar agora' })) void act('pn', 'queue.publishNow', { queueId: q.id, confirm: true }, 'Envio executado — veja o status.') }}>Agora</Button>
                    )}
                    {['scheduled', 'awaiting_approval', 'pending'].includes(q.status) && <>
                      <Button size="sm" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => act('mv', 'queue.move', { queueId: q.id, direction: -1 }, '')}><ArrowUp className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" aria-label="Descer" onClick={() => act('mv', 'queue.move', { queueId: q.id, direction: 1 }, '')}><ArrowDown className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { setEdit(q); setText(q.messageText); setWhen(q.scheduledAt.slice(0, 16)) }}>Editar</Button>
                    </>}
                    {['scheduled', 'awaiting_approval', 'pending', 'failed', 'unknown'].includes(q.status) && <Button size="sm" variant="ghost" aria-label="Cancelar" onClick={() => act('cn', 'queue.cancel', q.id, 'Cancelada.')}><X className="h-3.5 w-3.5" /></Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Editar publicação" wide
        footer={<><Button onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" onClick={() => run('ed', async () => { await call('queue.edit', { queueId: edit!.id, text, scheduledAt: when ? new Date(when).toISOString() : undefined }); setEdit(null); void reload() }, 'Publicação atualizada.')}>Salvar</Button></>}>
        {edit && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <Field label="Horário (seu fuso local)"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
              <Field label="Mensagem"><Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} /></Field>
              {edit.affiliateUrl && !text.includes(edit.affiliateUrl) && <Notice tone="warn">O link de afiliado não está mais na mensagem.</Notice>}
            </div>
            <MessagePreview text={text} imageUrl={edit.imageUrl} channel={edit.channelId === 'telegram' ? 'telegram' : 'whatsapp'} />
          </div>
        )}
      </Modal>
      <p className="text-xs text-muted">Status: {Object.values(QUEUE_STATUS_LABEL).join(' · ')}</p>
    </Page>
  )
}

// ───────────── Calendário ─────────────
export function CalendarPage() {
  const { data } = useQuery<QueueItem[]>('queue.list', ['scheduled', 'awaiting_approval', 'pending', 'sent'], { live: true })
  const groups = useMemo(() => {
    const m = new Map<string, QueueItem[]>()
    const from = Date.now() - 86400_000
    for (const q of (data ?? []).filter((x) => Date.parse(x.scheduledAt) >= from).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
      const k = dateOnly(q.scheduledAt)
      m.set(k, [...(m.get(k) ?? []), q])
    }
    return [...m.entries()]
  }, [data])
  return (
    <Page title="Calendário" subtitle="Publicações programadas e realizadas a partir de ontem, por dia.">
      {groups.length ? groups.map(([day, items]) => (
        <Card key={day} title={<span className="capitalize">{day}</span>} subtitle={`${items.length} publicação(ões)`} padded={false}>
          <ul className="divide-y divide-line">
            {items.map((q) => (
              <li key={q.id} className="flex items-center gap-4 px-5 py-2.5 text-sm">
                <span className="tabular w-14 shrink-0 font-medium">{timeOnly(q.scheduledAt)}</span>
                <span className="flex-1 truncate">{q.productTitle}</span>
                <span className="text-xs text-muted">{q.destinationName}</span>
                <QueueBadge status={q.status} />
              </li>
            ))}
          </ul>
        </Card>
      )) : <Empty title="Nada no calendário" />}
    </Page>
  )
}

// ───────────── Smart Copy ─────────────
const STYLES = ['Objetivo', 'Persuasivo', 'Premium', 'Informal', 'Achadinhos', 'Ofertas relâmpago', 'Minimalista', 'Com emojis', 'Sem emojis']

export function SmartCopy({ go }: { go: (r: Route) => void }) {
  const { data: templates } = useQuery<MessageTemplate[]>('templates.list')
  const { data: products } = useQuery<Product[]>('products.list', { limit: 300 })
  const { data: settings } = useQuery<AppSettings>('settings.get')
  const [tid, setTid] = useState<number | null>(null)
  const [pid, setPid] = useState<number | null>(null)
  const [style, setStyle] = useState('Achadinhos')
  const [preview, setPreview] = useState<{ text: string; hasLink: boolean } | null>(null)
  const [ai, setAi] = useState<{ text: string | null; usedAi: boolean; problems: string[] } | null>(null)
  const [channel, setChannel] = useState<'whatsapp' | 'telegram'>('whatsapp')
  const { run, busy } = useAction()
  useEffect(() => {
    if (templates?.length && tid === null) setTid(templates[0]!.id)
  }, [templates, tid])
  useEffect(() => {
    if (tid === null) return
    call<{ text: string; hasLink: boolean }>('copy.preview', { templateId: tid, productId: pid ?? undefined }).then(setPreview).catch(() => setPreview(null))
    setAi(null)
  }, [tid, pid])
  const product = products?.find((p) => p.id === pid)
  return (
    <Page title="Zaion Smart Copy" subtitle="Mensagens geradas apenas com dados reais do produto. Campos sem informação são omitidos — nada de cupons, descontos ou urgência inventados.">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Composição">
          <div className="space-y-3">
            <Field label="Produto (do catálogo)"><Select value={pid ?? ''} onChange={(e) => setPid(e.target.value ? Number(e.target.value) : null)} options={[{ value: '', label: 'Selecione…' }, ...(products ?? []).map((p) => ({ value: p.id, label: p.title.slice(0, 80) }))]} /></Field>
            <Field label="Modelo"><Select value={tid ?? ''} onChange={(e) => setTid(Number(e.target.value))} options={(templates ?? []).map((t) => ({ value: t.id, label: `${t.name} · ${t.style}` }))} /></Field>
            {pid && preview && !preview.hasLink && <Notice tone="warn">Este produto ainda não tem link de afiliado. Gere-o no Gerador de links.</Notice>}
            <div className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between"><div className="text-sm font-medium">Reescrita com IA (opcional)</div><Badge tone={settings?.ai.provider === 'none' ? 'neutral' : 'brand'}>{settings?.ai.provider === 'none' ? 'Desativada' : settings?.ai.provider}</Badge></div>
              <p className="mt-1 text-xs text-muted">A IA recebe somente os fatos do produto. A saída é rejeitada se alterar o link, omitir a identificação publicitária ou incluir valores ausentes nos dados.</p>
              <div className="mt-3 flex gap-2">
                <Select value={style} onChange={(e) => setStyle(e.target.value)} options={STYLES.map((s) => ({ value: s, label: s }))} />
                <Button icon={<Sparkles className="h-4 w-4" />} disabled={!pid || settings?.ai.provider === 'none'} loading={busy === 'ai'} onClick={() => run('ai', async () => setAi(await call('copy.ai', { productId: pid, style })))}>Gerar</Button>
              </div>
              {settings?.ai.provider === 'none' && <button className="mt-2 text-xs text-brand underline" onClick={() => go('ai')}>Configurar inteligência artificial</button>}
              {ai && !ai.usedAi && <Notice tone="warn" title="Resultado da IA descartado">{ai.problems.join('; ')}. Use o template determinístico.</Notice>}
            </div>
          </div>
        </Card>
        <Card title="Pré-visualização" actions={<Tabs value={channel} onChange={setChannel} tabs={[{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'telegram', label: 'Telegram' }]} />}>
          <MessagePreview text={ai?.text ?? preview?.text ?? ''} imageUrl={product?.imageUrl} channel={channel} />
          <div className="mt-3 flex justify-end">
            <Button size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => run('c', () => call('links.copy', ai?.text ?? preview?.text ?? ''), 'Mensagem copiada.')}>Copiar mensagem</Button>
          </div>
        </Card>
      </div>
    </Page>
  )
}

// ───────────── Templates ─────────────
export function Templates({ variables }: { variables: readonly string[] }) {
  const { data, reload } = useQuery<MessageTemplate[]>('templates.list')
  const [edit, setEdit] = useState<{ id?: number; name: string; style: string; body: string } | null>(null)
  const [preview, setPreview] = useState('')
  const { run, busy } = useAction()
  useEffect(() => {
    if (!edit) return
    const t = setTimeout(() => call<{ text: string }>('copy.preview', { body: edit.body }).then((r) => setPreview(r.text)).catch(() => setPreview('')), 250)
    return () => clearTimeout(t)
  }, [edit])
  return (
    <Page title="Templates" subtitle="Crie, edite, duplique e salve modelos com variáveis dinâmicas. Linhas com variáveis sem dados reais são removidas automaticamente."
      actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ name: '', style: 'Personalizado', body: '{{produto}}\n{{preco_atual}}\n{{link_afiliado}}\n\n{{identificacao_publicitaria}}' })}>Novo modelo</Button>}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((t) => (
          <Card key={t.id} title={t.name} subtitle={t.style} actions={t.isBuiltin ? <Badge>Padrão</Badge> : undefined}>
            <pre className="max-h-40 overflow-hidden whitespace-pre-wrap font-mono text-[11px] text-muted">{t.body}</pre>
            <div className="mt-3 flex gap-2">
              {!t.isBuiltin && <Button size="sm" onClick={() => setEdit({ ...t })}>Editar</Button>}
              <Button size="sm" variant="ghost" onClick={() => setEdit({ name: `${t.name} (cópia)`, style: t.style, body: t.body })}>Duplicar</Button>
              {!t.isBuiltin && <Button size="sm" variant="ghost" aria-label="Excluir" onClick={() => run('d', async () => { await call('templates.delete', t.id); void reload() }, 'Modelo excluído.')}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </div>
          </Card>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar modelo' : 'Novo modelo'} wide
        footer={<><Button onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" loading={busy === 's'} onClick={() => run('s', async () => { await call('templates.save', edit); setEdit(null); void reload() }, 'Modelo salvo.')}>Salvar</Button></>}>
        {edit && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
                <Field label="Estilo"><Select value={edit.style} onChange={(e) => setEdit({ ...edit, style: e.target.value })} options={['Personalizado', ...STYLES].map((s) => ({ value: s, label: s }))} /></Field>
              </div>
              <Field label="Corpo"><Textarea rows={14} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
              <div className="flex flex-wrap gap-1">{variables.map((v) => <button key={v} className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted hover:text-brand" onClick={() => setEdit({ ...edit, body: `${edit.body}{{${v}}}` })}>{`{{${v}}}`}</button>)}</div>
            </div>
            <div><div className="mb-2 text-xs text-muted">Pré-visualização (sem produto: só linhas fixas aparecem)</div><MessagePreview text={preview} channel="whatsapp" /></div>
          </div>
        )}
      </Modal>
    </Page>
  )
}
