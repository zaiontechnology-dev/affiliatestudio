import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, RefreshCw } from 'lucide-react'
import { Badge, Button, Card, Empty, Field, Input, Loading, Notice, Page, Stat, Table, Td, useAction } from '../components/ui'
import { call, useQuery } from '../lib/api'
import { dt, formatBRL, MARKETPLACE_NAMES } from '../lib/format'
import { chartTheme } from './overview'

type Report = {
  publications: number
  byMarketplace: Array<{ name: string; count: number }>
  byCampaign: Array<{ name: string; count: number }>
  byDestination: Array<{ name: string; count: number }>
  byHour: Array<{ name: string; count: number }>
  byProduct: Array<{ name: string; count: number }>
  conversions: { orders: number; estimatedCents: number; confirmedCents: number; canceledCents: number }
  clicksAvailable: boolean
}

function usePeriod() {
  const [preset, setPreset] = useState<'day' | 'week' | 'month' | 'custom'>('month')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const range = useMemo(() => {
    const now = new Date()
    const to = new Date(now.getTime() + 60_000).toISOString()
    if (preset === 'custom' && custom.from && custom.to) return { from: new Date(custom.from).toISOString(), to: new Date(`${custom.to}T23:59:59`).toISOString() }
    const days = preset === 'day' ? 1 : preset === 'week' ? 7 : 30
    return { from: new Date(now.getTime() - days * 86400_000).toISOString(), to }
  }, [preset, custom])
  const control = (
    <div className="flex flex-wrap items-end gap-2">
      {(['day', 'week', 'month', 'custom'] as const).map((p) => (
        <Button key={p} size="sm" variant={preset === p ? 'primary' : 'secondary'} onClick={() => setPreset(p)}>{{ day: 'Hoje', week: '7 dias', month: '30 dias', custom: 'Personalizado' }[p]}</Button>
      ))}
      {preset === 'custom' && (
        <>
          <Field label="De"><Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field>
          <Field label="Até"><Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field>
        </>
      )}
    </div>
  )
  return { range, control }
}

function Bars({ data }: { data: Array<{ name: string; count: number }> }) {
  if (!data.length) return <div className="py-8 text-center text-xs text-muted">Sem dados no período.</div>
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 30)}>
      <BarChart data={data} layout="vertical" margin={{ right: 16 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={170} tick={{ fill: chartTheme.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={chartTheme.tooltip} cursor={{ fill: 'var(--card-hover)' }} />
        <Bar dataKey="count" name="Publicações" fill={chartTheme.bar} radius={[0, 4, 4, 0]} barSize={14} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function Analytics() {
  const { range, control } = usePeriod()
  const { data, loading } = useQuery<Report>('analytics.report', range)
  return (
    <Page title="Zaion Analytics" subtitle="Publicações vêm do registro local. Conversões e comissões vêm apenas de relatórios oficiais sincronizados — sem atribuição presumida.">
      {control}
      {loading || !data ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat label="Publicações" value={data.publications} />
            <Stat label="Cliques" value={<span className="text-base text-muted">Indisponível</span>} hint="Nenhuma integração fornece cliques" />
            <Stat label="Conversões" value={data.conversions.orders} hint="Relatório oficial" />
            <Stat label="Comissão estimada" value={formatBRL(data.conversions.estimatedCents)} />
            <Stat label="Comissão confirmada" value={formatBRL(data.conversions.confirmedCents)} tone="ok" hint={data.conversions.canceledCents ? `${formatBRL(data.conversions.canceledCents)} canceladas` : undefined} />
          </div>
          <Notice tone="info">Taxa de conversão por grupo/campanha só é exibida quando o programa devolve os Sub IDs usados nos links (ex.: Shopee). Sem esse dado confiável, não atribuímos vendas.</Notice>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Por marketplace"><Bars data={data.byMarketplace.map((x) => ({ ...x, name: MARKETPLACE_NAMES[x.name] ?? x.name }))} /></Card>
            <Card title="Por campanha"><Bars data={data.byCampaign} /></Card>
            <Card title="Por destino"><Bars data={data.byDestination} /></Card>
            <Card title="Por horário">
              {data.byHour.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={[...data.byHour].sort((a, b) => Number(a.name) - Number(b.name))}>
                    <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: chartTheme.axis, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(h) => `${h}h`} />
                    <YAxis allowDecimals={false} tick={{ fill: chartTheme.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip contentStyle={chartTheme.tooltip} cursor={{ fill: 'var(--card-hover)' }} />
                    <Bar dataKey="count" name="Publicações" fill={chartTheme.bar} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="py-8 text-center text-xs text-muted">Sem dados no período.</div>}
            </Card>
            <Card title="Produtos mais publicados" className="lg:col-span-2"><Bars data={data.byProduct.map((p) => ({ ...p, name: p.name.slice(0, 40) }))} /></Card>
          </div>
        </>
      )}
    </Page>
  )
}

export function Reports() {
  const { range, control } = usePeriod()
  const { run, busy } = useAction()
  const exp = (kind: string) => run(kind, () => call<string | null>('analytics.exportCsv', { ...range, kind }), (f) => (f ? `Exportado para ${f}` : null))
  return (
    <Page title="Relatórios" subtitle="Exportação em CSV (separador ponto e vírgula, compatível com Excel em português).">
      {control}
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Publicações" subtitle="Data, produto, destino, campanha, preço"><Button icon={<Download className="h-4 w-4" />} loading={busy === 'publications'} onClick={() => exp('publications')}>Exportar CSV</Button></Card>
        <Card title="Conversões e comissões" subtitle="Somente dados de relatórios oficiais"><Button icon={<Download className="h-4 w-4" />} loading={busy === 'conversions'} onClick={() => exp('conversions')}>Exportar CSV</Button></Card>
        <Card title="Catálogo com Offer Score" subtitle="Produtos, métricas e nível de confiança"><Button icon={<Download className="h-4 w-4" />} loading={busy === 'products'} onClick={() => exp('products')}>Exportar CSV</Button></Card>
      </div>
    </Page>
  )
}

export function Commissions() {
  const { data, reload, loading } = useQuery<Array<{ id: number; marketplaceId: string; orderId: string; productId: string; subIds: string[]; purchaseTime: string | null; status: string; amountCents: number | null; commissionCents: number | null; source: string }>>('conversions.list')
  const { run, busy } = useAction()
  return (
    <Page title="Comissões" subtitle="Conversões importadas dos relatórios oficiais (ex.: Shopee conversionReport). Valores estimados podem mudar até a validação pelo programa."
      actions={<Button icon={<RefreshCw className="h-4 w-4" />} loading={busy === 's'} onClick={() => run('s', async () => { const r = await call<{ imported: number }>('accounts.syncConversions'); void reload(); return r }, (r) => `${r.imported} item(ns) sincronizado(s).`)}>Sincronizar agora</Button>}>
      <Card padded={false}>
        {loading ? <Loading /> : data?.length ? (
          <Table head={['Compra', 'Marketplace', 'Pedido', 'Item', 'Sub IDs', 'Status', 'Valor', 'Comissão']}>
            {data.map((c) => (
              <tr key={c.id}>
                <Td className="whitespace-nowrap text-xs">{dt(c.purchaseTime)}</Td>
                <Td>{MARKETPLACE_NAMES[c.marketplaceId]}</Td>
                <Td className="font-mono text-xs">{c.orderId}</Td>
                <Td className="font-mono text-xs">{c.productId}</Td>
                <Td className="text-xs text-muted">{c.subIds.join(' · ') || '—'}</Td>
                <Td><Badge tone={/complet|approv|paid/i.test(c.status) ? 'ok' : /cancel|invalid/i.test(c.status) ? 'bad' : 'warn'}>{c.status}</Badge></Td>
                <Td className="tabular">{formatBRL(c.amountCents)}</Td>
                <Td className="tabular font-medium">{formatBRL(c.commissionCents)}</Td>
              </tr>
            ))}
          </Table>
        ) : <div className="p-5"><Empty title="Nenhuma conversão importada">Conecte uma conta com relatórios oficiais e clique em Sincronizar.</Empty></div>}
      </Card>
    </Page>
  )
}

export function HistoryPage() {
  const { data, loading } = useQuery<Array<{ id: number; sentAt: string; productTitle: string; marketplaceId: string; destinationName: string; campaignName: string | null; priceCents: number | null; mode: string; channelMessageId: string | null }>>('publications.list', { limit: 1000 }, { live: true })
  return (
    <Page title="Histórico" subtitle="Todas as publicações confirmadas (API ou publicação manual assistida).">
      <Card padded={false}>
        {loading ? <Loading /> : (
          <Table head={['Data', 'Produto', 'Marketplace', 'Destino', 'Campanha', 'Preço publicado', 'Modo']} empty={!data?.length}>
            {data?.map((p) => (
              <tr key={p.id}>
                <Td className="whitespace-nowrap text-xs">{dt(p.sentAt)}</Td>
                <Td className="max-w-[340px] truncate">{p.productTitle}</Td>
                <Td>{MARKETPLACE_NAMES[p.marketplaceId] ?? p.marketplaceId}</Td>
                <Td>{p.destinationName}</Td>
                <Td className="text-muted">{p.campaignName ?? 'Manual'}</Td>
                <Td className="tabular">{formatBRL(p.priceCents)}</Td>
                <Td><Badge tone={p.mode === 'api' ? 'ok' : 'neutral'}>{p.mode === 'api' ? 'Automático (API)' : 'Assistido'}</Badge></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </Page>
  )
}
