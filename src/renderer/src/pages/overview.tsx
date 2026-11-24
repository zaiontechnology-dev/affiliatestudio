import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, CheckCircle2, Clock, Megaphone, Package, Send, Target, Users } from 'lucide-react'
import type { DashboardSummary, LogEntry, QueueItem } from '@shared/types'
import { Badge, Button, Card, Empty, ErrorBox, Loading, Notice, Page, Stat, Table, Tabs, Td } from '../components/ui'
import { QueueBadge } from '../components/domain'
import { useQuery } from '../lib/api'
import { dt, formatBRL, MARKETPLACE_NAMES, relative } from '../lib/format'
import type { Route } from '../components/Shell'

export const chartTheme = {
  grid: 'var(--border)',
  axis: 'var(--muted)',
  bar: 'var(--brand)',
  bad: 'var(--danger)',
  tooltip: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 12 }
}

function MiniBars({ data, dataKey, nameKey }: { data: Array<Record<string, unknown>>; dataKey: string; nameKey: string }) {
  if (!data.length) return <div className="py-8 text-center text-xs text-muted">Sem publicações no período.</div>
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey={nameKey} width={140} tick={{ fill: chartTheme.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={chartTheme.tooltip} cursor={{ fill: 'var(--card-hover)' }} />
        <Bar dataKey={dataKey} name="Publicações" fill={chartTheme.bar} radius={[0, 4, 4, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function Dashboard({ go }: { go: (r: Route) => void }) {
  const { data: d, error, reload } = useQuery<DashboardSummary>('dashboard.summary', undefined, { live: true })
  const { data: upcoming } = useQuery<QueueItem[]>('queue.list', ['scheduled', 'awaiting_approval', 'pending', 'unknown'], { live: true })
  const { data: logs } = useQuery<LogEntry[]>('logs.list', { limit: 8 }, { live: true })
  if (error) return <Page title="Dashboard"><ErrorBox error={error} onRetry={reload} /></Page>
  if (!d) return <Loading />

  const setupDone = d.marketplacesConnected > 0 && d.channelsConnected > 0 && d.destinations > 0
  const unavailable = <span className="text-base text-muted">Indisponível</span>

  return (
    <Page title="Dashboard" subtitle="Visão executiva da sua operação de afiliados. Todos os números vêm do banco local; métricas não fornecidas pelas integrações aparecem como indisponíveis.">
      {!setupDone && (
        <Notice tone="info" title="Configuração inicial">
          Para operar o fluxo completo: <button className="text-brand underline" onClick={() => go('accounts')}>conecte uma conta de afiliado</button> (ou importe produtos via CSV),{' '}
          <button className="text-brand underline" onClick={() => go('telegram')}>conecte um canal</button>,{' '}
          <button className="text-brand underline" onClick={() => go('destinations')}>cadastre destinos autorizados</button> e{' '}
          <button className="text-brand underline" onClick={() => go('campaigns')}>ative uma campanha</button>.
        </Notice>
      )}
      {(d.failuresToday > 0 || d.unknownStatus > 0) && (
        <Notice tone="warn" title="Alertas operacionais">
          {d.failuresToday > 0 && <div>{d.failuresToday} publicação(ões) falharam hoje.</div>}
          {d.unknownStatus > 0 && <div>{d.unknownStatus} envio(s) com status desconhecido aguardam sua verificação.</div>}
          <button className="mt-1 text-brand underline" onClick={() => go('queue')}>Abrir fila de publicações</button>
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Produtos no catálogo" value={d.productsFound.toLocaleString('pt-BR')} icon={<Package className="h-4 w-4" />} />
        <Stat label="Ofertas qualificadas (score ≥ 70)" value={d.qualifiedOffers.toLocaleString('pt-BR')} tone="brand" icon={<Target className="h-4 w-4" />} />
        <Stat label="Publicações hoje" value={d.publishedToday} icon={<Send className="h-4 w-4" />} hint={`${d.publishedMonth} no mês`} />
        <Stat label="Agendadas" value={d.scheduled} icon={<Clock className="h-4 w-4" />} hint={d.awaitingApproval ? `${d.awaitingApproval} aguardando você` : undefined} />
        <Stat label="Campanhas ativas" value={d.activeCampaigns} icon={<Megaphone className="h-4 w-4" />} />
        <Stat label="Destinos cadastrados" value={d.destinations} icon={<Users className="h-4 w-4" />} />
        <Stat label="Falhas hoje" value={d.failuresToday} tone={d.failuresToday ? 'bad' : undefined} icon={<AlertTriangle className="h-4 w-4" />} />
        <Stat
          label="Motor de automação"
          value={d.autopilot.enabled ? 'Ativo' : 'Pausado'}
          tone={d.autopilot.enabled ? 'ok' : 'warn'}
          icon={<CheckCircle2 className="h-4 w-4" />}
          hint={d.autopilot.lastTickAt ? `Último ciclo ${relative(d.autopilot.lastTickAt)}` : 'Nenhum ciclo nesta sessão'}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Cliques" value={d.clicks ?? unavailable} hint="Não fornecido pelas integrações atuais" />
        <Stat label="Conversões (mês)" value={d.conversions ?? unavailable} hint={d.conversions === null ? 'Sincronize relatórios oficiais' : 'Fonte: relatório oficial'} />
        <Stat label="Comissões estimadas (mês)" value={d.commissionEstimatedCents === null ? unavailable : formatBRL(d.commissionEstimatedCents)} hint="Pendentes de validação" />
        <Stat label="Comissões confirmadas (mês)" value={d.commissionConfirmedCents === null ? unavailable : formatBRL(d.commissionConfirmedCents)} tone="ok" hint="Status concluído/aprovado" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Publicações por dia" subtitle="Últimos 14 dias" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.publicationsByDay}>
              <CartesianGrid stroke={chartTheme.grid} vertical={false} />
              <XAxis dataKey="day" tick={{ fill: chartTheme.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: chartTheme.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={chartTheme.tooltip} cursor={{ fill: 'var(--card-hover)' }} />
              <Bar dataKey="sent" name="Enviadas" fill={chartTheme.bar} radius={[4, 4, 0, 0]} />
              <Bar dataKey="failed" name="Falhas" fill={chartTheme.bad} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Próximas publicações" actions={<Button size="sm" variant="ghost" onClick={() => go('queue')}>Ver fila</Button>} padded={false}>
          {upcoming && upcoming.length ? (
            <ul className="divide-y divide-line">
              {upcoming.slice(0, 6).map((q) => (
                <li key={q.id} className="px-5 py-2.5">
                  <div className="truncate text-[13px]">{q.productTitle}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted">
                    <span className="truncate">{q.destinationName} · {dt(q.scheduledAt)}</span>
                    <QueueBadge status={q.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5"><Empty title="Nada programado">Ative uma campanha ou adicione ofertas à fila.</Empty></div>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Por marketplace" subtitle="Mês atual"><MiniBars data={d.byMarketplace.map((x) => ({ ...x, marketplace: MARKETPLACE_NAMES[x.marketplace] ?? x.marketplace }))} dataKey="sent" nameKey="marketplace" /></Card>
        <Card title="Por campanha" subtitle="Mês atual"><MiniBars data={d.byCampaign} dataKey="sent" nameKey="campaign" /></Card>
        <Card title="Por destino" subtitle="Mês atual"><MiniBars data={d.byDestination} dataKey="sent" nameKey="destination" /></Card>
      </div>

      <Card title="Últimas atividades" actions={<Button size="sm" variant="ghost" onClick={() => go('activity')}>Central de atividades</Button>} padded={false}>
        <ActivityList logs={logs ?? []} />
      </Card>
    </Page>
  )
}

function ActivityList({ logs }: { logs: LogEntry[] }) {
  if (!logs.length) return <div className="p-6 text-center text-sm text-muted">Nenhuma atividade registrada ainda.</div>
  return (
    <ul className="divide-y divide-line">
      {logs.map((l) => (
        <li key={l.id} className="flex items-start gap-3 px-5 py-2.5 text-[13px]">
          <Badge tone={l.level === 'error' ? 'bad' : l.level === 'warn' ? 'warn' : 'neutral'}>{l.scope}</Badge>
          <span className="flex-1">{l.message}</span>
          <span className="shrink-0 text-[11px] text-muted">{dt(l.createdAt)}</span>
        </li>
      ))}
    </ul>
  )
}

export function ActivityCenter() {
  const [tab, setTab] = useState<'activity' | 'audit'>('activity')
  const { data: logs, loading } = useQuery<LogEntry[]>('logs.list', { limit: 300 }, { live: true })
  const { data: audit } = useQuery<Array<{ id: number; actor: string; action: string; entity: string | null; entityId: string | null; createdAt: string }>>('audit.list', undefined, { live: true })
  return (
    <Page title="Central de atividades" subtitle="Tudo o que o motor de automação e você fizeram, em ordem cronológica.">
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'activity', label: 'Atividades do sistema' }, { value: 'audit', label: 'Auditoria de ações' }]} />
      <Card padded={false}>
        {tab === 'activity' ? (
          loading ? <Loading /> : <ActivityList logs={logs ?? []} />
        ) : (
          <Table head={['Data', 'Origem', 'Ação', 'Entidade']} empty={!audit?.length}>
            {audit?.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap text-muted">{dt(a.createdAt)}</Td>
                <Td>{a.actor === 'user' ? 'Você' : a.actor}</Td>
                <Td><code className="text-xs">{a.action}</code></Td>
                <Td className="text-muted">{a.entity ? `${a.entity}${a.entityId ? ` #${a.entityId}` : ''}` : '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </Page>
  )
}
