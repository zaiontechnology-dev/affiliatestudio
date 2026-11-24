import { useEffect, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import {
  Activity,
  BarChart3,
  BotMessageSquare,
  Calendar,
  ChevronsLeft,
  ChevronsRight,
  CircleDollarSign,
  Cog,
  DatabaseBackup,
  FileText,
  Gauge,
  Heart,
  History,
  Info,
  LayoutDashboard,
  Link2,
  ListOrdered,
  MessageCircle,
  Megaphone,
  Package,
  Pause,
  Pickaxe,
  Play,
  Plug,
  Radar,
  ScrollText,
  Send,
  Sparkles,
  Store,
  Users,
  Wand2,
  Wifi,
  WifiOff,
  Zap
} from 'lucide-react'
import { ZaionMark, useAction } from './ui'
import { call, useQuery } from '../lib/api'
import { countdown } from '../lib/format'
import type { DashboardSummary } from '@shared/types'

export type Route =
  | 'dashboard' | 'activity'
  | 'garimpo' | 'score' | 'radar' | 'catalog' | 'favorites' | 'links'
  | 'marketplaces' | 'accounts' | 'whatsapp' | 'telegram' | 'destinations'
  | 'autopilot' | 'campaigns' | 'queue' | 'calendar' | 'smartcopy' | 'templates'
  | 'analytics' | 'reports' | 'commissions' | 'history'
  | 'settings' | 'ai' | 'logs' | 'backup' | 'about'

export const NAV: Array<{ group: string; items: Array<{ route: Route; label: string; icon: ReactNode }> }> = [
  { group: 'Visão geral', items: [
    { route: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard /> },
    { route: 'activity', label: 'Central de atividades', icon: <Activity /> }
  ] },
  { group: 'Inteligência de ofertas', items: [
    { route: 'garimpo', label: 'Garimpo inteligente', icon: <Pickaxe /> },
    { route: 'score', label: 'Zaion Offer Score', icon: <Gauge /> },
    { route: 'radar', label: 'Zaion Price Radar', icon: <Radar /> },
    { route: 'catalog', label: 'Catálogo de produtos', icon: <Package /> },
    { route: 'favorites', label: 'Favoritos', icon: <Heart /> },
    { route: 'links', label: 'Gerador de links', icon: <Link2 /> }
  ] },
  { group: 'Integrações', items: [
    { route: 'marketplaces', label: 'Marketplaces', icon: <Store /> },
    { route: 'accounts', label: 'Contas de afiliados', icon: <Plug /> },
    { route: 'whatsapp', label: 'WhatsApp', icon: <MessageCircle /> },
    { route: 'telegram', label: 'Telegram', icon: <Send /> },
    { route: 'destinations', label: 'Grupos e canais', icon: <Users /> }
  ] },
  { group: 'Automação', items: [
    { route: 'autopilot', label: 'Zaion AutoPilot', icon: <Zap /> },
    { route: 'campaigns', label: 'Campanhas', icon: <Megaphone /> },
    { route: 'queue', label: 'Fila de publicações', icon: <ListOrdered /> },
    { route: 'calendar', label: 'Calendário', icon: <Calendar /> },
    { route: 'smartcopy', label: 'Zaion Smart Copy', icon: <Wand2 /> },
    { route: 'templates', label: 'Templates', icon: <FileText /> }
  ] },
  { group: 'Desempenho', items: [
    { route: 'analytics', label: 'Zaion Analytics', icon: <BarChart3 /> },
    { route: 'reports', label: 'Relatórios', icon: <ScrollText /> },
    { route: 'commissions', label: 'Comissões', icon: <CircleDollarSign /> },
    { route: 'history', label: 'Histórico', icon: <History /> }
  ] },
  { group: 'Sistema', items: [
    { route: 'settings', label: 'Configurações', icon: <Cog /> },
    { route: 'ai', label: 'Inteligência artificial', icon: <Sparkles /> },
    { route: 'logs', label: 'Logs', icon: <BotMessageSquare /> },
    { route: 'backup', label: 'Backup e restauração', icon: <DatabaseBackup /> },
    { route: 'about', label: 'Sobre o Zaion', icon: <Info /> }
  ] }
]

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function Shell({ route, go, children }: { route: Route; go: (r: Route) => void; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('nav-collapsed') === '1'
    } catch {
      return false
    }
  })
  const { data: dash, reload } = useQuery<DashboardSummary>('dashboard.summary', undefined, { live: true })
  const { run, busy } = useAction()
  const now = useNow()
  useEffect(() => {
    try {
      localStorage.setItem('nav-collapsed', collapsed ? '1' : '0')
    } catch {
      /* armazenamento indisponível */
    }
  }, [collapsed])
  useEffect(() => {
    const t = setInterval(() => void reload(), 30_000)
    return () => clearInterval(t)
  }, [reload])

  const ap = dash?.autopilot
  const toggleAutopilot = () =>
    run('ap', async () => {
      await call('autopilot.setEnabled', !ap?.enabled)
      await reload()
    }, ap?.enabled ? 'AutoPilot pausado.' : 'AutoPilot iniciado.')

  return (
    <div className="flex h-full">
      <aside className={clsx('flex shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200', collapsed ? 'w-[64px]' : 'w-[248px]')}>
        <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
          <ZaionMark size={28} />
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[13px] font-semibold">Zaion Affiliate Studio</div>
              <div className="text-[10px] uppercase tracking-wider text-muted">Desktop Edition</div>
            </div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Menu principal">
          {NAV.map((g) => (
            <div key={g.group} className="mb-3">
              {!collapsed && <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted/80">{g.group}</div>}
              {g.items.map((it) => (
                <button
                  key={it.route}
                  onClick={() => go(it.route)}
                  title={collapsed ? it.label : undefined}
                  aria-current={route === it.route ? 'page' : undefined}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
                    route === it.route ? 'bg-brand-soft font-medium text-brand' : 'text-muted hover:bg-card hover:text-fg',
                    collapsed && 'justify-center'
                  )}
                >
                  {it.icon}
                  {!collapsed && <span className="truncate">{it.label}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button onClick={() => setCollapsed(!collapsed)} className="flex h-10 items-center justify-center gap-2 border-t border-line text-xs text-muted hover:text-fg" aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Recolher</>}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface/60 px-6 backdrop-blur">
          <div className="flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              {dash?.online === false ? <WifiOff className="h-3.5 w-3.5 text-bad" /> : <Wifi className="h-3.5 w-3.5 text-ok" />}
              {dash?.online === false ? 'Sem internet' : 'Online'}
            </span>
            <span>Marketplaces: <strong className="text-fg">{dash?.marketplacesConnected ?? '—'}</strong></span>
            <span>Canais: <strong className="text-fg">{dash?.channelsConnected ?? '—'}</strong></span>
            {!!dash?.unknownStatus && (
              <button onClick={() => go('queue')} className="text-warn hover:underline">
                {dash.unknownStatus} envio(s) com status desconhecido
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs leading-tight">
              <div className="text-muted">Próxima publicação</div>
              <div className="tabular font-medium">{ap?.enabled && ap.nextPublicationAt ? countdown(ap.nextPublicationAt, now) : '—'}</div>
            </div>
            <button
              onClick={toggleAutopilot}
              disabled={busy === 'ap' || !dash}
              className={clsx(
                'flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors',
                ap?.enabled ? 'border border-ok/40 bg-ok/10 text-ok hover:bg-ok/20' : 'bg-brand text-[#06281d] hover:bg-brand-strong hover:text-white'
              )}
            >
              {ap?.enabled ? (
                <>
                  <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-ok" /></span>
                  AutoPilot ativo <Pause className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" /> Iniciar AutoPilot
                </>
              )}
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
