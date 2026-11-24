import { useState } from 'react'
import { CheckCircle2, CircleDashed, Plug, Plus, Trash2, Users, XCircle } from 'lucide-react'
import type { AudienceProfile, ChannelAccount, ChannelId, Destination, MarketplaceAccount, MarketplaceInfo } from '@shared/types'
import { Badge, Button, Card, Chips, Empty, Field, Input, Loading, Modal, Notice, Page, Select, Table, Td, Toggle, useAction, useFeedback } from '../components/ui'
import { IntegrationBadge } from '../components/domain'
import { call, useQuery } from '../lib/api'
import { CHANNEL_NAMES, formatBRL, parseMoneyToCents, relative } from '../lib/format'
import type { Route } from '../components/Shell'

interface MkRow {
  info: MarketplaceInfo
  accounts: MarketplaceAccount[]
}

const CAP_LABEL: Record<string, string> = {
  authenticate: 'Autenticação', searchProducts: 'Pesquisa de produtos', searchByCategory: 'Pesquisa por categoria', productDetails: 'Detalhes do produto',
  price: 'Preço', discount: 'Desconto', images: 'Imagens', rating: 'Avaliação', salesVolume: 'Volume de vendas', availability: 'Disponibilidade',
  commission: 'Comissão', campaigns: 'Campanhas', coupons: 'Cupons', affiliateLink: 'Link de afiliado', conversions: 'Conversões',
  financialReports: 'Relatórios financeiros', csvImport: 'Importação CSV', manualEntry: 'Cadastro manual'
}

function CapIcon({ status }: { status: string }) {
  if (status === 'supported') return <CheckCircle2 className="h-4 w-4 text-ok" aria-label="Suportado" />
  if (status === 'partial') return <CheckCircle2 className="h-4 w-4 text-warn" aria-label="Parcial" />
  if (status === 'pending') return <CircleDashed className="h-4 w-4 text-muted" aria-label="Pendente" />
  return <XCircle className="h-4 w-4 text-bad/70" aria-label="Indisponível" />
}

const OFFICIAL_LABEL = { available: ['API oficial disponível', 'ok'], restricted: ['API restrita', 'warn'], none: ['Sem API pública', 'neutral'], unknown: ['A verificar', 'neutral'] } as const

export function Marketplaces() {
  const { data } = useQuery<MkRow[]>('marketplaces.list')
  if (!data) return <Loading />
  const rows = data.filter((m) => m.info.id !== 'manual')
  const caps = rows[0]?.info.capabilities.map((c) => c.capability) ?? []
  return (
    <Page title="Marketplaces" subtitle="Matriz de recursos por integração. Recursos não oferecidos oficialmente aparecem como indisponíveis — sem scraping ou atalhos não autorizados.">
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><CapIcon status="supported" /> Suportado</span>
        <span className="flex items-center gap-1.5"><CapIcon status="partial" /> Parcial</span>
        <span className="flex items-center gap-1.5"><CapIcon status="pending" /> Pendente / a validar</span>
        <span className="flex items-center gap-1.5"><CapIcon status="unsupported" /> Indisponível oficialmente</span>
      </div>
      <Card padded={false}>
        <Table head={['Recurso', ...rows.map((r) => r.info.name)]}>
          <tr>
            <Td className="text-xs text-muted">Situação</Td>
            {rows.map((r) => <Td key={r.info.id}><Badge tone={OFFICIAL_LABEL[r.info.officialApi][1]}>{OFFICIAL_LABEL[r.info.officialApi][0]}</Badge></Td>)}
          </tr>
          {caps.map((cap) => (
            <tr key={cap}>
              <Td className="text-[13px]">{CAP_LABEL[cap] ?? cap}</Td>
              {rows.map((r) => {
                const c = r.info.capabilities.find((x) => x.capability === cap)
                return <Td key={r.info.id}><span title={c?.note}><CapIcon status={c?.status ?? 'unsupported'} /></span></Td>
              })}
            </tr>
          ))}
        </Table>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((r) => (
          <Card key={r.info.id} title={r.info.name}>
            <p className="text-sm text-muted">{r.info.summary}</p>
            {r.info.knownLimits.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-muted">{r.info.knownLimits.map((l) => <li key={l}>{l}</li>)}</ul>
            )}
          </Card>
        ))}
      </div>
    </Page>
  )
}

export function Accounts() {
  const { data, reload } = useQuery<MkRow[]>('marketplaces.list')
  const [connect, setConnect] = useState<MarketplaceInfo | null>(null)
  const { run, busy } = useAction()
  const { confirm } = useFeedback()
  if (!data) return <Loading />
  return (
    <Page title="Contas de afiliados" subtitle="Credenciais são criptografadas pelo Windows (DPAPI) e nunca gravadas em texto puro, código-fonte ou logs."
      actions={<Button loading={busy === 'sync'} onClick={() => run('sync', () => call<{ imported: number }>('accounts.syncConversions'), (r) => `${r.imported} item(ns) de conversão sincronizado(s).`)}>Sincronizar relatórios</Button>}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.filter((m) => m.info.id !== 'manual').map(({ info, accounts }) => {
          const acc = accounts[0]
          const canConnect = info.capabilities.some((c) => c.capability === 'authenticate' && c.status === 'supported')
          const status = acc?.status ?? (canConnect ? 'not_configured' : 'unavailable')
          return (
            <Card key={info.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-sm font-bold text-brand">{info.name.slice(0, 2).toUpperCase()}</div>
                  <div><div className="font-semibold">{info.name}</div><div className="text-xs text-muted">{acc ? acc.label : 'Nenhuma conta vinculada'}</div></div>
                </div>
                <IntegrationBadge status={status} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-y-1.5 text-xs">
                <dt className="text-muted">Última sincronização</dt><dd className="text-right">{acc?.lastSyncAt ? relative(acc.lastSyncAt) : '—'}</dd>
                <dt className="text-muted">Recursos</dt><dd className="text-right">{info.capabilities.filter((c) => c.status === 'supported').length} de {info.capabilities.length}</dd>
                {acc?.accountRef && (<><dt className="text-muted">Conta</dt><dd className="text-right font-mono">{acc.accountRef}</dd></>)}
              </dl>
              {acc?.lastError && <div className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{acc.lastError}</div>}
              {!canConnect && <p className="mt-3 text-xs text-muted">{info.summary}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                {canConnect && <Button size="sm" variant={acc ? 'secondary' : 'primary'} icon={<Plug className="h-3.5 w-3.5" />} onClick={() => setConnect(info)}>{acc ? 'Configurar' : 'Conectar'}</Button>}
                {acc && <Button size="sm" loading={busy === `t${acc.id}`} onClick={() => run(`t${acc.id}`, async () => { const r = await call<{ ok: boolean; message: string }>('accounts.test', acc.id); void reload(); if (!r.ok) throw new Error(r.message); return r }, (r) => r.message)}>Testar conexão</Button>}
                {acc && <Button size="sm" loading={busy === 's'} onClick={() => run('s', () => call<{ imported: number }>('accounts.syncConversions'), (r) => `${r.imported} conversão(ões) sincronizada(s).`)}>Sincronizar</Button>}
                {acc && <Button size="sm" variant="danger" onClick={async () => { if (await confirm({ title: 'Desconectar conta', message: 'As credenciais serão apagadas deste computador.', danger: true, confirmLabel: 'Desconectar' })) run('d', async () => { await call('accounts.disconnect', acc.id); void reload() }, 'Conta desconectada.') }}>Desconectar</Button>}
              </div>
            </Card>
          )
        })}
      </div>
      <ConnectMarketplaceModal info={connect} onClose={() => { setConnect(null); void reload() }} />
    </Page>
  )
}

function ConnectMarketplaceModal({ info, onClose }: { info: MarketplaceInfo | null; onClose: () => void }) {
  const [label, setLabel] = useState('Conta principal')
  const [creds, setCreds] = useState<Record<string, string>>({})
  const { run, busy } = useAction()
  if (!info) return null
  return (
    <Modal open onClose={onClose} title={`Conectar ${info.name}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy === 'c'} onClick={() => run('c', async () => { const r = await call<{ ok: boolean; message: string }>('accounts.connect', { marketplace: info.id, label, credentials: creds }); if (!r.ok) throw new Error(r.message); onClose(); return r }, (r) => r.message)}>Salvar e testar</Button></>}>
      <div className="space-y-4">
        {info.id === 'shopee' && (
          <Notice tone="info" title="Como obter as credenciais oficiais">
            <ol className="mt-1 list-decimal space-y-1 pl-4">
              <li>Acesse o portal do Programa de Afiliados Shopee com sua conta aprovada.</li>
              <li>Abra a seção <strong>Open API</strong> e solicite acesso (sujeito à aprovação da Shopee).</li>
              <li>Após aprovado, copie o <strong>App ID</strong> e o <strong>Secret</strong> e cole abaixo.</li>
            </ol>
            <button className="mt-2 text-brand underline" onClick={() => info.docsUrl && call('system.openUrl', info.docsUrl)}>Abrir portal de afiliados</button>
          </Notice>
        )}
        <Field label="Nome da conta"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        {info.credentialFields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.help}>
            <Input type={f.secret ? 'password' : 'text'} autoComplete="off" placeholder={f.placeholder} value={creds[f.key] ?? ''} onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })} />
          </Field>
        ))}
      </div>
    </Modal>
  )
}

// ───────────── Canais ─────────────
interface ProviderInfo { id: ChannelId; name: string; official: boolean; automatic: boolean; summary: string; requirements: string[]; credentialFields: Array<{ key: string; label: string; secret: boolean; placeholder?: string }> }

function ChannelAccounts({ channel }: { channel: ChannelId }) {
  const { data: providers } = useQuery<ProviderInfo[]>('channels.providers')
  const { data: accounts, reload } = useQuery<ChannelAccount[]>('channels.accounts')
  const [label, setLabel] = useState(channel === 'telegram' ? 'Bot de ofertas' : 'Meu WhatsApp')
  const [creds, setCreds] = useState<Record<string, string>>({})
  const { run, busy } = useAction()
  const { confirm } = useFeedback()
  const p = providers?.find((x) => x.id === channel)
  if (!p) return <Loading />
  const mine = (accounts ?? []).filter((a) => a.channelId === channel)
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={p.name} subtitle={p.automatic ? 'Envio automático' : 'Publicação manual assistida'}>
        <p className="text-sm text-muted">{p.summary}</p>
        <div className="mt-3 text-xs font-medium text-muted">Requisitos</div>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">{p.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
        <div className="mt-5 space-y-3">
          <Field label="Nome da conexão"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          {p.credentialFields.map((f) => (
            <Field key={f.key} label={f.label}>
              <Input type={f.secret ? 'password' : 'text'} autoComplete="off" placeholder={f.placeholder} value={creds[f.key] ?? ''} onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })} />
            </Field>
          ))}
          <Button variant="primary" loading={busy === 'c'} onClick={() => run('c', async () => { const r = await call<{ ok: boolean; message: string }>('channels.connect', { channel, label, credentials: creds }); setCreds({}); void reload(); if (!r.ok) throw new Error(r.message); return r }, (r) => r.message)}>
            {p.credentialFields.length ? 'Conectar e validar' : 'Ativar'}
          </Button>
        </div>
      </Card>
      <Card title="Conexões" padded={false}>
        {mine.length ? (
          <ul className="divide-y divide-line">
            {mine.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <div className="text-sm font-medium">{a.label}{typeof a.meta.username === 'string' && <span className="ml-2 text-xs text-muted">@{a.meta.username}</span>}</div>
                  {a.lastError && <div className="text-xs text-bad">{a.lastError}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <IntegrationBadge status={a.status} />
                  <Button size="sm" loading={busy === `t${a.id}`} onClick={() => run(`t${a.id}`, async () => { const r = await call<{ ok: boolean; message: string }>('channels.test', a.id); void reload(); if (!r.ok) throw new Error(r.message); return r }, (r) => r.message)}>Testar</Button>
                  <Button size="sm" variant="ghost" aria-label="Remover" onClick={async () => { if (await confirm({ title: 'Remover conexão', message: 'Os destinos vinculados também serão removidos.', danger: true, confirmLabel: 'Remover' })) run('d', async () => { await call('channels.disconnect', a.id); void reload() }, 'Conexão removida.') }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </li>
            ))}
          </ul>
        ) : <div className="p-5 text-sm text-muted">Nenhuma conexão.</div>}
      </Card>
    </div>
  )
}

export function TelegramPage({ go }: { go: (r: Route) => void }) {
  return (
    <Page title="Telegram" subtitle="Integração pela API oficial de bots. Canal recomendado para validar o motor de distribuição automática.">
      <ChannelAccounts channel="telegram" />
      <Notice tone="info">Após conectar o bot, cadastre grupos e canais em <button className="text-brand underline" onClick={() => go('destinations')}>Grupos e canais</button> e use “Verificar permissões”.</Notice>
    </Page>
  )
}

export function WhatsAppPage({ go }: { go: (r: Route) => void }) {
  return (
    <Page title="WhatsApp" subtitle="Análise técnica das opções oficiais e modos disponíveis.">
      <Card title="Situação da integração (verificada em nov/2026)">
        <div className="grid gap-4 md:grid-cols-3 text-sm">
          <div><Badge tone="ok">Disponível</Badge><div className="mt-2 font-medium">Modo assistido</div><p className="mt-1 text-muted">Para grupos tradicionais. O Zaion prepara a mensagem, copia para a área de transferência e notifica no horário. Você cola e publica. Confirme depois na fila.</p></div>
          <div><Badge tone="warn">Depende de aprovação</Badge><div className="mt-2 font-medium">Cloud API · Groups API</div><p className="mt-1 text-muted">Exige Official Business Account (OBA). Só publica em grupos <strong className="text-fg">criados pela sua empresa via API</strong>, com participantes que entram por convite. Cobrança por mensagem.</p></div>
          <div><Badge tone="bad">Não suportado</Badge><div className="mt-2 font-medium">Automação de grupos existentes</div><p className="mt-1 text-muted">Não há API oficial para publicar automaticamente em grupos comuns já existentes. Bibliotecas não oficiais violam os termos e arriscam banimento — não são usadas.</p></div>
        </div>
      </Card>
      <h2 className="pt-2 text-sm font-semibold">Modo assistido</h2>
      <ChannelAccounts channel="whatsapp_assisted" />
      <h2 className="pt-2 text-sm font-semibold">WhatsApp Cloud API (Groups API)</h2>
      <ChannelAccounts channel="whatsapp_cloud" />
      <Notice tone="warn" title="Critério de aceitação separado">A publicação automática no WhatsApp só será considerada validada após teste real com conta OBA aprovada e grupo criado via API. Cadastre destinos em <button className="text-brand underline" onClick={() => go('destinations')}>Grupos e canais</button>.</Notice>
    </Page>
  )
}

// ───────────── Destinos ─────────────
const emptyDest = { channelAccountId: 0, name: '', externalId: '', audienceProfileId: null as number | null, categories: [] as string[], allowedStart: '08:00', allowedEnd: '22:00', minIntervalMinutes: 30, dailyLimit: 20, consentConfirmed: false }

export function Destinations({ categories }: { categories: readonly string[] }) {
  const { data: dests, reload } = useQuery<Destination[]>('destinations.list')
  const { data: accounts } = useQuery<ChannelAccount[]>('channels.accounts')
  const { data: audiences, reload: reloadAud } = useQuery<AudienceProfile[]>('audiences.list')
  const [edit, setEdit] = useState<(typeof emptyDest & { id?: number }) | null>(null)
  const [aud, setAud] = useState<{ id?: number; name: string; description: string; categories: string[]; keywords: string; maxPrice: string } | null>(null)
  const { run, busy } = useAction()
  const { confirm } = useFeedback()
  return (
    <Page title="Grupos e canais" subtitle="Somente destinos autorizados, cujos membros aderiram ao recebimento de ofertas. Cada destino tem horários, frequência e limite diário próprios."
      actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!accounts?.length} onClick={() => setEdit({ ...emptyDest, channelAccountId: accounts?.[0]?.id ?? 0 })}>Novo destino</Button>}>
      {!accounts?.length && <Notice tone="info">Conecte primeiro o Telegram ou ative o modo assistido do WhatsApp.</Notice>}
      {dests?.length ? (
        <Card padded={false}>
          <Table head={['Destino', 'Plataforma', 'Identificador', 'Status', 'Horário', 'Intervalo', 'Limite/dia', 'Autorizado', '']}>
            {dests.map((d) => (
              <tr key={d.id}>
                <Td className="font-medium">{d.name}</Td>
                <Td>{CHANNEL_NAMES[d.channelId]}</Td>
                <Td className="font-mono text-xs">{d.externalId}</Td>
                <Td><Badge tone={d.status === 'active' ? 'ok' : d.status === 'error' ? 'bad' : d.status === 'paused' ? 'warn' : 'neutral'}>{{ active: 'Ativo', paused: 'Pausado', error: 'Erro', unverified: 'Não verificado' }[d.status]}</Badge></Td>
                <Td className="tabular text-xs">{d.allowedStart}–{d.allowedEnd}</Td>
                <Td className="tabular text-xs">{d.minIntervalMinutes} min</Td>
                <Td className="tabular text-xs">{d.dailyLimit}</Td>
                <Td>{d.consentConfirmed ? <Badge tone="ok">Sim</Badge> : <Badge tone="bad">Não</Badge>}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" loading={busy === `v${d.id}`} onClick={() => run(`v${d.id}`, async () => { const r = await call<{ ok: boolean; canPost: boolean; message: string }>('destinations.check', d.id); void reload(); if (!r.canPost) throw new Error(r.message); return r }, (r) => r.message)}>Verificar permissões</Button>
                    <Button size="sm" onClick={async () => { if (await confirm({ title: 'Enviar mensagem de teste', message: `Uma mensagem REAL de teste será enviada para “${d.name}”. Confirma?`, confirmLabel: 'Enviar teste' })) run('ts', async () => { const r = await call<{ outcome: string; message: string }>('destinations.testSend', { destinationId: d.id, confirm: true }); if (r.outcome === 'failed') throw new Error(r.message); return r }, (r) => r.message) }}>Testar envio</Button>
                    <Button size="sm" variant="ghost" onClick={() => run('p', async () => { await call('destinations.setPaused', { destinationId: d.id, paused: d.status !== 'paused' }); void reload() })}>{d.status === 'paused' ? 'Retomar' : 'Pausar'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEdit({ ...d })}>Editar</Button>
                    <Button size="sm" variant="ghost" aria-label="Excluir" onClick={async () => { if (await confirm({ title: 'Excluir destino', message: 'Itens da fila deste destino também serão removidos.', danger: true, confirmLabel: 'Excluir' })) run('x', async () => { await call('destinations.delete', d.id); void reload() }, 'Destino excluído.') }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : <Empty icon={<Users />} title="Nenhum destino cadastrado" />}

      <Card title="Perfis de audiência" subtitle="Usados pelo Offer Score para medir compatibilidade com o público do destino." actions={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAud({ name: '', description: '', categories: [], keywords: '', maxPrice: '' })}>Novo perfil</Button>} padded={false}>
        {audiences?.length ? (
          <ul className="divide-y divide-line">
            {audiences.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-5 py-3">
                <div><div className="text-sm font-medium">{a.name}</div><div className="text-xs text-muted">{[a.categories.join(', '), a.keywords.join(', '), a.maxPriceCents ? `até ${formatBRL(a.maxPriceCents)}` : ''].filter(Boolean).join(' · ') || 'Sem critérios'}</div></div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setAud({ id: a.id, name: a.name, description: a.description, categories: a.categories, keywords: a.keywords.join(', '), maxPrice: a.maxPriceCents ? String(a.maxPriceCents / 100) : '' })}>Editar</Button>
                  <Button size="sm" variant="ghost" aria-label="Excluir" onClick={() => run('ad', async () => { await call('audiences.delete', a.id); void reloadAud() })}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </li>
            ))}
          </ul>
        ) : <div className="p-5 text-sm text-muted">Exemplos: Achadinhos, Ofertas femininas, Tecnologia, Casa e decoração, Fitness, Premium, Até R$ 50, Infantil.</div>}
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar destino' : 'Novo destino'}
        footer={<><Button onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" loading={busy === 'sv'} onClick={() => run('sv', async () => { await call('destinations.save', edit); setEdit(null); void reload() }, 'Destino salvo.')}>Salvar</Button></>}>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Conexão" className="col-span-2"><Select value={edit.channelAccountId} onChange={(e) => setEdit({ ...edit, channelAccountId: Number(e.target.value) })} options={(accounts ?? []).map((a) => ({ value: a.id, label: `${a.label} · ${CHANNEL_NAMES[a.channelId]}` }))} /></Field>
            <Field label="Nome"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Identificador" hint="Telegram: @canal ou ID -100…; WhatsApp assistido: nome do grupo"><Input value={edit.externalId} onChange={(e) => setEdit({ ...edit, externalId: e.target.value })} /></Field>
            <Field label="Horário inicial"><Input type="time" value={edit.allowedStart} onChange={(e) => setEdit({ ...edit, allowedStart: e.target.value })} /></Field>
            <Field label="Horário final"><Input type="time" value={edit.allowedEnd} onChange={(e) => setEdit({ ...edit, allowedEnd: e.target.value })} /></Field>
            <Field label="Intervalo mínimo (min)"><Input type="number" min={5} value={edit.minIntervalMinutes} onChange={(e) => setEdit({ ...edit, minIntervalMinutes: Number(e.target.value) })} /></Field>
            <Field label="Limite diário"><Input type="number" min={1} value={edit.dailyLimit} onChange={(e) => setEdit({ ...edit, dailyLimit: Number(e.target.value) })} /></Field>
            <Field label="Perfil de audiência" className="col-span-2"><Select value={edit.audienceProfileId ?? ''} onChange={(e) => setEdit({ ...edit, audienceProfileId: e.target.value ? Number(e.target.value) : null })} options={[{ value: '', label: 'Nenhum' }, ...(audiences ?? []).map((a) => ({ value: a.id, label: a.name }))]} /></Field>
            <Field label="Categorias de interesse" className="col-span-2"><Chips options={categories.map((c) => ({ value: c, label: c }))} value={edit.categories} onChange={(v) => setEdit({ ...edit, categories: v as string[] })} /></Field>
            <div className="col-span-2 rounded-lg border border-line p-3">
              <Toggle checked={edit.consentConfirmed} onChange={(v) => setEdit({ ...edit, consentConfirmed: v })} label={<span>Confirmo que este destino é meu ou estou autorizado, e que os membros aderiram ao recebimento de ofertas (LGPD).</span>} />
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!aud} onClose={() => setAud(null)} title="Perfil de audiência"
        footer={<><Button onClick={() => setAud(null)}>Cancelar</Button><Button variant="primary" onClick={() => run('as', async () => { await call('audiences.save', { id: aud!.id, name: aud!.name, description: aud!.description, categories: aud!.categories, keywords: aud!.keywords.split(',').map((s) => s.trim()).filter(Boolean), maxPriceCents: parseMoneyToCents(aud!.maxPrice) }); setAud(null); void reloadAud() }, 'Perfil salvo.')}>Salvar</Button></>}>
        {aud && (
          <div className="space-y-3">
            <Field label="Nome"><Input value={aud.name} onChange={(e) => setAud({ ...aud, name: e.target.value })} /></Field>
            <Field label="Descrição"><Input value={aud.description} onChange={(e) => setAud({ ...aud, description: e.target.value })} /></Field>
            <Field label="Categorias"><Chips options={categories.map((c) => ({ value: c, label: c }))} value={aud.categories} onChange={(v) => setAud({ ...aud, categories: v as string[] })} /></Field>
            <Field label="Palavras-chave (separadas por vírgula)"><Input value={aud.keywords} onChange={(e) => setAud({ ...aud, keywords: e.target.value })} /></Field>
            <Field label="Preço máximo (R$)"><Input value={aud.maxPrice} onChange={(e) => setAud({ ...aud, maxPrice: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Page>
  )
}
