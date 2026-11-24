import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FileUp, Heart, LayoutGrid, Link2, Pickaxe, Plus, RefreshCw, Search, TrendingDown } from 'lucide-react'
import type { AffiliateLink, AppSettings, MarketplaceId, PriceObservation, PriceStats, Product, ScoreWeights } from '@shared/types'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Notice, Page, Select, Stat, Table, Tabs, Td, Toggle, useAction } from '../components/ui'
import { DataSource, ProductCard, ScoreBadge, type ProductActions } from '../components/domain'
import { LinkModal, ManualProductModal, PublishModal } from '../components/modals'
import { call, useQuery } from '../lib/api'
import { dt, formatBRL, formatPct, formatRate, MARKETPLACE_NAMES, parseMoneyToCents } from '../lib/format'
import { chartTheme } from './overview'
import type { Route } from '../components/Shell'

interface MarketplaceRow {
  info: { id: MarketplaceId; name: string; capabilities: Array<{ capability: string; status: string }> }
  accounts: Array<{ id: number; status: string }>
}

function useProductActions(reload: () => void) {
  const { run } = useAction()
  const [publish, setPublish] = useState<Product | null>(null)
  const [link, setLink] = useState<Product | null>(null)
  const actions: ProductActions = {
    onFavorite: (p) => run('f', async () => { await call('products.favorite', { productId: p.id, on: !p.isFavorite }); reload() }, p.isFavorite ? 'Removido dos favoritos.' : 'Favoritado — preço será monitorado.'),
    onBlock: (p) => run('b', async () => { await call('products.block', { productId: p.id, on: !p.isBlocked }); reload() }, p.isBlocked ? 'Produto desbloqueado.' : 'Produto bloqueado.'),
    onLink: (p) => setLink(p),
    onQueue: (p) => setPublish(p),
    onOpen: (p) => run('o', () => call('products.openOriginal', p.id))
  }
  const modals = (
    <>
      <PublishModal product={publish} onClose={() => setPublish(null)} />
      <LinkModal product={link} onClose={() => setLink(null)} />
    </>
  )
  return { actions, modals }
}

function ProductTable({ items, actions }: { items: Product[]; actions: ProductActions }) {
  return (
    <Card padded={false}>
      <Table head={['Produto', 'Marketplace', 'Preço', 'Desconto', 'Comissão', 'Avaliação', 'Vendas', 'Offer Score', 'Fonte', 'Atualizado', '']} empty={!items.length}>
        {items.map((p) => (
          <tr key={p.id} className="hover:bg-card-hover">
            <Td className="max-w-[320px]"><div className="truncate" title={p.title}>{p.title}</div></Td>
            <Td>{MARKETPLACE_NAMES[p.marketplaceId]}</Td>
            <Td className="tabular whitespace-nowrap">{formatBRL(p.priceCents)}</Td>
            <Td className="tabular">{formatPct(p.discountPct)}</Td>
            <Td className="tabular">{formatRate(p.commissionRate)}</Td>
            <Td className="tabular">{p.rating?.toFixed(1) ?? '—'}</Td>
            <Td className="tabular">{p.salesCount?.toLocaleString('pt-BR') ?? '—'}</Td>
            <Td><ScoreBadge score={p.score} compact /></Td>
            <Td><DataSource source={p.dataSource} /></Td>
            <Td className="whitespace-nowrap text-xs text-muted">{dt(p.lastCheckedAt)}</Td>
            <Td>
              <div className="flex gap-1">
                <Button size="sm" variant="primary" onClick={() => actions.onQueue?.(p)}>Publicar</Button>
                <Button size="sm" variant="ghost" onClick={() => actions.onLink?.(p)} aria-label="Link"><Link2 className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => actions.onFavorite?.(p)} aria-label="Favoritar"><Heart className={p.isFavorite ? 'h-3.5 w-3.5 fill-bad text-bad' : 'h-3.5 w-3.5'} /></Button>
              </div>
            </Td>
          </tr>
        ))}
      </Table>
    </Card>
  )
}

function ProductGrid({ items, actions }: { items: Product[]; actions: ProductActions }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {items.map((p) => <ProductCard key={p.id} p={p} actions={actions} />)}
    </div>
  )
}

// ───────────── Garimpo ─────────────
export function Garimpo({ go, categories }: { go: (r: Route) => void; categories: readonly string[] }) {
  const { data: mks } = useQuery<MarketplaceRow[]>('marketplaces.list')
  const searchable = (mks ?? []).filter((m) => m.info.capabilities.some((c) => c.capability === 'searchProducts' && c.status === 'supported'))
  const connected = searchable.filter((m) => m.accounts.some((a) => a.status === 'connected'))
  const [q, setQ] = useState({ marketplace: 'shopee' as MarketplaceId, keyword: '', category: '', sort: 'sales', minDiscount: '', minCommission: '', minRating: '', maxPrice: '', minScore: '' })
  const [results, setResults] = useState<Product[] | null>(null)
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const { run, busy } = useAction()
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)

  const filtered = useMemo(() => {
    if (!results) return null
    return results.filter((p) => {
      if (q.minDiscount && (p.discountPct ?? -1) < Number(q.minDiscount)) return false
      if (q.minCommission && (p.commissionRate ?? -1) * 100 < Number(q.minCommission)) return false
      if (q.minRating && (p.rating ?? -1) < Number(q.minRating)) return false
      if (q.maxPrice && (p.priceCents ?? Infinity) > (parseMoneyToCents(q.maxPrice) ?? Infinity)) return false
      if (q.minScore && (p.score?.score ?? 0) < Number(q.minScore)) return false
      return true
    })
  }, [results, q])

  const search = (pg = 1) =>
    run('s', async () => {
      const r = await call<{ items: Product[]; hasNextPage: boolean }>('products.search', { marketplace: q.marketplace, keyword: q.keyword || undefined, sort: q.sort, page: pg, category: q.category || undefined })
      setResults(pg === 1 ? r.items : [...(results ?? []), ...r.items])
      setHasNext(r.hasNextPage)
      setPage(pg)
    })

  const { actions, modals } = useProductActions(() => void search(1))

  return (
    <Page title="Garimpo inteligente" subtitle="Busca produtos reais nas APIs oficiais conectadas, salva no catálogo e calcula o Zaion Offer Score.">
      {mks && !connected.length && (
        <Notice tone="warn" title="Nenhuma integração de busca conectada">
          A busca automática requer uma conta oficial conectada (hoje: Shopee Affiliate Open API). Você pode{' '}
          <button className="text-brand underline" onClick={() => go('accounts')}>conectar uma conta</button> ou{' '}
          <button className="text-brand underline" onClick={() => go('catalog')}>importar produtos via CSV</button>.
        </Notice>
      )}
      <Card>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Field label="Marketplace">
            <Select value={q.marketplace} onChange={(e) => setQ({ ...q, marketplace: e.target.value as MarketplaceId })} options={searchable.map((m) => ({ value: m.info.id, label: m.info.name }))} />
          </Field>
          <Field label="Palavra-chave" className="col-span-2">
            <Input value={q.keyword} onChange={(e) => setQ({ ...q, keyword: e.target.value })} placeholder="ex.: fone bluetooth" onKeyDown={(e) => e.key === 'Enter' && void search(1)} />
          </Field>
          <Field label="Categoria (para o catálogo)">
            <Select value={q.category} onChange={(e) => setQ({ ...q, category: e.target.value })} options={[{ value: '', label: 'Não definir' }, ...categories.map((c) => ({ value: c, label: c }))]} />
          </Field>
          <Field label="Ordenar por">
            <Select value={q.sort} onChange={(e) => setQ({ ...q, sort: e.target.value })} options={[{ value: 'sales', label: 'Mais vendidos' }, { value: 'relevance', label: 'Relevância' }, { value: 'commission', label: 'Maior comissão' }, { value: 'price_asc', label: 'Menor preço' }, { value: 'price_desc', label: 'Maior preço' }]} />
          </Field>
          <div className="flex items-end">
            <Button variant="primary" className="w-full" icon={<Search className="h-4 w-4" />} loading={busy === 's'} disabled={!connected.length} onClick={() => void search(1)}>
              Buscar
            </Button>
          </div>
          <Field label="Desconto mínimo (%)"><Input value={q.minDiscount} onChange={(e) => setQ({ ...q, minDiscount: e.target.value })} /></Field>
          <Field label="Comissão mínima (%)"><Input value={q.minCommission} onChange={(e) => setQ({ ...q, minCommission: e.target.value })} /></Field>
          <Field label="Avaliação mínima"><Input value={q.minRating} onChange={(e) => setQ({ ...q, minRating: e.target.value })} /></Field>
          <Field label="Preço máximo (R$)"><Input value={q.maxPrice} onChange={(e) => setQ({ ...q, maxPrice: e.target.value })} /></Field>
          <Field label="Offer Score mínimo"><Input value={q.minScore} onChange={(e) => setQ({ ...q, minScore: e.target.value })} /></Field>
        </div>
      </Card>
      {filtered && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted">{filtered.length} de {results!.length} produtos atendem aos filtros</div>
            <Tabs value={view} onChange={setView} tabs={[{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Tabela' }]} />
          </div>
          {filtered.length ? (view === 'cards' ? <ProductGrid items={filtered} actions={actions} /> : <ProductTable items={filtered} actions={actions} />) : <Empty icon={<Pickaxe />} title="Nenhum produto atende aos filtros" />}
          {hasNext && <div className="text-center"><Button loading={busy === 's'} onClick={() => void search(page + 1)}>Carregar mais</Button></div>}
        </>
      )}
      {modals}
    </Page>
  )
}

// ───────────── Catálogo / Favoritos ─────────────
export function Catalog({ favoritesOnly, categories }: { favoritesOnly?: boolean; categories: readonly string[] }) {
  const [f, setF] = useState({ search: '', marketplaceId: '', category: '', minScore: '', includeBlocked: false })
  const args = { search: f.search || undefined, marketplaceId: f.marketplaceId || undefined, category: f.category || undefined, minScore: f.minScore ? Number(f.minScore) : undefined, favoritesOnly, includeBlocked: f.includeBlocked }
  const { data, error, loading, reload } = useQuery<Product[]>('products.list', args)
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [manual, setManual] = useState(false)
  const { run, busy } = useAction()
  const { actions, modals } = useProductActions(() => void reload())
  return (
    <Page
      title={favoritesOnly ? 'Favoritos' : 'Catálogo de produtos'}
      subtitle={favoritesOnly ? 'Produtos favoritados têm o preço monitorado pelo Price Radar quando há integração oficial.' : 'Todos os produtos reais obtidos por API oficial, CSV ou cadastro manual.'}
      actions={
        !favoritesOnly && (
          <>
            <Button icon={<FileUp className="h-4 w-4" />} loading={busy === 'csv'} onClick={() => run('csv', async () => { const r = await call<{ imported: number; errors: unknown[] } | null>('products.importCsv'); void reload(); return r }, (r) => (r ? `${r.imported} produto(s) importado(s)${r.errors.length ? `, ${r.errors.length} linha(s) com erro` : ''}.` : null))}>
              Importar CSV
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setManual(true)}>Cadastrar produto</Button>
          </>
        )
      }
    >
      <Card>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Buscar" className="col-span-2"><Input value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} placeholder="Título ou ID" /></Field>
          <Field label="Marketplace"><Select value={f.marketplaceId} onChange={(e) => setF({ ...f, marketplaceId: e.target.value })} options={[{ value: '', label: 'Todos' }, ...Object.entries(MARKETPLACE_NAMES).map(([value, label]) => ({ value, label }))]} /></Field>
          <Field label="Categoria"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={[{ value: '', label: 'Todas' }, ...categories.map((c) => ({ value: c, label: c }))]} /></Field>
          <Field label="Offer Score mínimo"><Input value={f.minScore} onChange={(e) => setF({ ...f, minScore: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <Toggle checked={f.includeBlocked} onChange={(v) => setF({ ...f, includeBlocked: v })} label="Mostrar bloqueados" />
          <Tabs value={view} onChange={setView} tabs={[{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Tabela' }]} />
        </div>
      </Card>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading ? <Loading /> : data?.length ? (view === 'cards' ? <ProductGrid items={data} actions={actions} /> : <ProductTable items={data} actions={actions} />) : (
        <Empty icon={favoritesOnly ? <Heart /> : <LayoutGrid />} title={favoritesOnly ? 'Nenhum favorito' : 'Catálogo vazio'}>
          {favoritesOnly ? 'Use o coração nos cards de produto para favoritar.' : 'Use o Garimpo (API oficial), importe um CSV do programa de afiliados ou cadastre manualmente.'}
        </Empty>
      )}
      <ManualProductModal open={manual} onClose={() => { setManual(false); void reload() }} categories={categories} />
      {modals}
    </Page>
  )
}

// ───────────── Offer Score ─────────────
const CRITERIA: Array<{ key: keyof ScoreWeights; label: string; desc: string }> = [
  { key: 'sales', label: 'Volume de vendas', desc: 'Escala logarítmica; 10 mil+ vendas = máximo.' },
  { key: 'discount', label: 'Desconto real', desc: 'Somente desconto informado pela fonte; 60%+ = máximo; acima de 90% gera desconfiança.' },
  { key: 'commission', label: 'Comissão', desc: '15%+ = máximo.' },
  { key: 'rating', label: 'Avaliação dos compradores', desc: 'Nota ajustada pela quantidade de avaliações.' },
  { key: 'audience', label: 'Compatibilidade com a audiência', desc: 'Categoria, palavras-chave e preço do perfil de audiência do destino.' },
  { key: 'history', label: 'Desempenho histórico', desc: 'Requer dados de conversão atribuíveis (ainda não disponível).' }
]

export function OfferScorePage() {
  const { data: s, reload } = useQuery<AppSettings>('settings.get')
  const [w, setW] = useState<ScoreWeights | null>(null)
  const { data: products } = useQuery<Product[]>('products.list', { limit: 1000 })
  const { run, busy } = useAction()
  useEffect(() => {
    if (s && !w) setW(s.scoreWeights)
  }, [s, w])
  const dist = useMemo(() => {
    const buckets = [['90–100', 90], ['80–89', 80], ['70–79', 70], ['60–69', 60], ['< 60', 0]] as const
    return buckets.map(([label, min], i) => ({ label, count: (products ?? []).filter((p) => (p.score?.score ?? 0) >= min && (i === 0 || (p.score?.score ?? 0) < buckets[i - 1]![1])).length }))
  }, [products])
  if (!w) return <Loading />
  const total = Object.values(w).reduce((a, b) => a + b, 0)
  return (
    <Page title="Zaion Offer Score" subtitle="Classificação heurística de 0 a 100 para priorizar ofertas com potencial de conversão — não é previsão garantida de vendas.">
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Pesos dos critérios" subtitle={`Soma atual: ${total}. Os pesos são normalizados automaticamente.`} className="lg:col-span-2"
          actions={<Button variant="primary" size="sm" loading={busy === 'w'} onClick={() => run('w', async () => { await call('settings.update', { scoreWeights: w }); await reload() }, 'Pesos salvos.')}>Salvar pesos</Button>}>
          <div className="space-y-4">
            {CRITERIA.map((c) => (
              <div key={c.key} className="grid grid-cols-[1fr_200px_48px] items-center gap-4">
                <div><div className="text-sm font-medium">{c.label}</div><div className="text-xs text-muted">{c.desc}</div></div>
                <input type="range" min={0} max={50} value={w[c.key]} onChange={(e) => setW({ ...w, [c.key]: Number(e.target.value) })} className="accent-[var(--brand)]" aria-label={c.label} />
                <div className="tabular text-right text-sm">{w[c.key]}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Como funciona">
          <ul className="space-y-2 text-sm text-muted">
            <li>• Critérios sem dado real são ignorados e seu peso é redistribuído.</li>
            <li>• A <strong className="text-fg">confiança</strong> é a fração do peso total coberta por dados reais.</li>
            <li>• A nota é puxada para um valor neutro (40) conforme a confiança cai — produtos com poucos dados não superam produtos bem documentados.</li>
            <li>• Faixas: 90+ excepcional · 80+ excelente · 70+ boa · 60+ moderada · abaixo de 60 baixa prioridade.</li>
          </ul>
        </Card>
      </div>
      <Card title="Distribuição do catálogo atual">
        <div className="grid grid-cols-5 gap-3">{dist.map((d) => <Stat key={d.label} label={d.label} value={d.count} />)}</div>
      </Card>
    </Page>
  )
}

// ───────────── Price Radar ─────────────
export function PriceRadar() {
  const { data: favs } = useQuery<Product[]>('products.list', { favoritesOnly: true })
  const [days, setDays] = useState(30)
  const [pid, setPid] = useState<number | null>(null)
  const { data: drops, reload: reloadDrops } = useQuery<Array<{ product: Product; previous: number; current: number; dropPct: number }>>('prices.drops', { days: 7, minDropPct: 5 })
  const { data: hist } = useQuery<{ history: PriceObservation[]; stats: PriceStats }>('prices.history', pid ? { productId: pid, days } : { productId: 1, days })
  const { run, busy } = useAction()
  useEffect(() => {
    if (!pid && favs?.length) setPid(favs[0]!.id)
  }, [favs, pid])
  const chart = (pid ? hist?.history ?? [] : []).map((h) => ({ t: dt(h.observedAt), preco: h.priceCents / 100 }))
  const st = pid ? hist?.stats : null
  return (
    <Page title="Zaion Price Radar" subtitle="Histórico construído exclusivamente com observações reais registradas pelo Zaion. Nenhum preço anterior é estimado."
      actions={<Button icon={<RefreshCw className="h-4 w-4" />} loading={busy === 'r'} onClick={() => run('r', async () => { const r = await call<{ updated: number; drops: number }>('prices.refreshFavorites'); void reloadDrops(); return r }, (r) => `${r.updated} favorito(s) atualizado(s), ${r.drops} queda(s).`)}>Atualizar favoritos agora</Button>}>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Histórico de preço" className="lg:col-span-2" actions={<Tabs value={String(days)} onChange={(v) => setDays(Number(v))} tabs={[{ value: '1', label: '24h' }, { value: '7', label: '7d' }, { value: '15', label: '15d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]} />}>
          {favs?.length ? (
            <>
              <Select value={pid ?? ''} onChange={(e) => setPid(Number(e.target.value))} options={favs.map((p) => ({ value: p.id, label: p.title.slice(0, 90) }))} />
              <div className="mt-4 grid grid-cols-4 gap-3">
                <Stat label="Atual" value={formatBRL(st?.current)} />
                <Stat label="Menor observado" value={formatBRL(st?.min)} tone="ok" />
                <Stat label="Médio" value={formatBRL(st?.avg)} />
                <Stat label="Variação no período" value={st?.changePct === null || st?.changePct === undefined ? '—' : `${st.changePct > 0 ? '+' : ''}${formatPct(st.changePct, 1)}`} tone={st?.changePct && st.changePct < 0 ? 'ok' : undefined} />
              </div>
              <div className="mt-4">
                {chart.length > 1 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chart}>
                      <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                      <XAxis dataKey="t" tick={{ fill: chartTheme.axis, fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={40} />
                      <YAxis tick={{ fill: chartTheme.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={50} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={chartTheme.tooltip} formatter={(v) => formatBRL(Math.round(Number(v) * 100))} />
                      <Line type="stepAfter" dataKey="preco" name="Preço" stroke="var(--brand)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty title="Observações insuficientes">São necessárias ao menos duas observações reais no período.</Empty>
                )}
              </div>
            </>
          ) : (
            <Empty icon={<Heart />} title="Nenhum produto monitorado">Favorite produtos no catálogo para acompanhar o preço.</Empty>
          )}
        </Card>
        <Card title="Quedas de preço (7 dias)" padded={false}>
          {drops?.length ? (
            <ul className="divide-y divide-line">
              {drops.slice(0, 12).map((d) => (
                <li key={d.product.id} className="px-5 py-2.5">
                  <div className="truncate text-[13px]">{d.product.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs">
                    <span className="text-muted line-through">{formatBRL(d.previous)}</span>
                    <span className="font-medium">{formatBRL(d.current)}</span>
                    <Badge tone="ok"><TrendingDown className="h-3 w-3" /> {formatPct(d.dropPct, 1)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : <div className="p-5 text-sm text-muted">Nenhuma queda ≥ 5% observada.</div>}
        </Card>
      </div>
    </Page>
  )
}

// ───────────── Gerador de links ─────────────
export function LinkGenerator() {
  const [url, setUrl] = useState('')
  const [subIds, setSubIds] = useState({ campanha: '', grupo: '', canal: '', categoria: '', produto: '' })
  const [detected, setDetected] = useState<{ marketplace: string | null; name: string | null; canGenerate: boolean } | null>(null)
  const [result, setResult] = useState<{ url: string; verified: boolean } | null>(null)
  const [manual, setManual] = useState('')
  const { data: links, reload } = useQuery<AffiliateLink[]>('links.list')
  const { run, busy } = useAction()
  useEffect(() => {
    setResult(null)
    if (!/^https?:\/\//.test(url)) return setDetected(null)
    const t = setTimeout(() => call<typeof detected>('links.detect', url).then(setDetected).catch(() => setDetected(null)), 300)
    return () => clearTimeout(t)
  }, [url])
  return (
    <Page title="Gerador de links" subtitle="Links comissionados gerados exclusivamente pelo mecanismo oficial de cada programa. Links colados manualmente ficam marcados como não verificados.">
      <Card>
        <div className="space-y-4">
          <Field label="URL do produto"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shopee.com.br/…" /></Field>
          {detected && (
            <div className="flex items-center gap-2 text-sm">
              Marketplace: {detected.name ? <Badge tone="brand">{detected.name}</Badge> : <Badge tone="warn">não reconhecido</Badge>}
              {detected.name && !detected.canGenerate && <span className="text-xs text-muted">— geração automática indisponível (sem API oficial ou conta não conectada)</span>}
            </div>
          )}
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted">Identificadores de rastreamento (Sub IDs — apenas letras e números, até 5)</div>
            <div className="grid grid-cols-5 gap-2">
              {(Object.keys(subIds) as Array<keyof typeof subIds>).map((k) => (
                <Input key={k} placeholder={k} value={subIds[k]} onChange={(e) => setSubIds({ ...subIds, [k]: e.target.value })} />
              ))}
            </div>
          </div>
          <Button variant="primary" disabled={!detected?.canGenerate} loading={busy === 'g'} onClick={() => run('g', async () => { const r = await call<{ url: string; verified: boolean }>('links.generate', { url, subIds: Object.values(subIds).filter(Boolean) }); setResult(r); void reload() }, 'Link gerado e salvo.')}>
            Gerar link comissionado
          </Button>
          {result && (
            <Notice tone="ok" title={result.verified ? 'Link confirmado pela API oficial' : 'Link gerado'}>
              <div className="mt-1 flex gap-2"><Input readOnly value={result.url} /><Button onClick={() => run('c', () => call('links.copy', result.url), 'Copiado.')}>Copiar</Button></div>
            </Notice>
          )}
          {detected && !detected.canGenerate && (
            <Field label="Cadastrar link gerado no portal oficial" hint="Será salvo como não verificado.">
              <div className="flex gap-2">
                <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="https://…" />
                <Button disabled={!manual} onClick={() => run('m', async () => { await call('links.saveManual', { url, affiliateUrl: manual, productId: null }); void reload() }, 'Link salvo.')}>Salvar</Button>
              </div>
            </Field>
          )}
        </div>
      </Card>
      <Card title="Links salvos" padded={false}>
        <Table head={['Data', 'Marketplace', 'Link', 'Sub IDs', 'Status', '']} empty={!links?.length}>
          {links?.map((l) => (
            <tr key={l.id}>
              <Td className="whitespace-nowrap text-xs text-muted">{dt(l.createdAt)}</Td>
              <Td>{MARKETPLACE_NAMES[l.marketplaceId]}</Td>
              <Td className="max-w-[360px]"><div className="truncate font-mono text-xs">{l.affiliateUrl}</div></Td>
              <Td className="text-xs text-muted">{l.subIds.join(' · ') || '—'}</Td>
              <Td><Badge tone={l.status === 'valid' ? 'ok' : l.status === 'failed' ? 'bad' : 'warn'}>{l.status === 'valid' ? 'Verificado (API)' : l.status === 'failed' ? 'Falhou' : 'Não verificado'}</Badge></Td>
              <Td><Button size="sm" variant="ghost" onClick={() => run('c', () => call('links.copy', l.affiliateUrl), 'Copiado.')}>Copiar</Button></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  )
}
