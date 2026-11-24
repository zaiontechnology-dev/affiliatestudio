import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { Shell, NAV, type Route } from './components/Shell'
import { FeedbackProvider, Loading } from './components/ui'
import { call } from './lib/api'
import { setTimezone } from './lib/format'
import { ActivityCenter, Dashboard } from './pages/overview'
import { Catalog, Garimpo, LinkGenerator, OfferScorePage, PriceRadar } from './pages/offers'
import { Accounts, Destinations, Marketplaces, TelegramPage, WhatsAppPage } from './pages/integrations'
import { AutopilotPage, CalendarPage, Campaigns, Queue, SmartCopy, Templates } from './pages/automation'
import { Analytics, Commissions, HistoryPage, Reports } from './pages/performance'
import { About, AiPage, BackupPage, LogsPage, SettingsPage } from './pages/system'

const ROUTES = new Set(NAV.flatMap((g) => g.items.map((i) => i.route)))

function applyTheme(theme: AppSettings['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export function App() {
  const [route, setRoute] = useState<Route>(() => {
    const h = window.location.hash.slice(1) as Route
    return ROUTES.has(h) ? h : 'dashboard'
  })
  const [info, setInfo] = useState<{ categories: string[]; templateVariables: string[] } | null>(null)

  useEffect(() => {
    void call<{ categories: string[]; templateVariables: string[] }>('app.info').then(setInfo)
    void call<AppSettings>('settings.get').then((s) => {
      applyTheme(s.theme)
      setTimezone(s.timezone)
    })
  }, [])

  const go = useCallback((r: Route) => {
    setRoute(r)
    window.location.hash = r
  }, [])

  if (!info) return <Loading label="Iniciando Zaion Affiliate Studio…" />
  const cats = info.categories

  const page = (() => {
    switch (route) {
      case 'dashboard': return <Dashboard go={go} />
      case 'activity': return <ActivityCenter />
      case 'garimpo': return <Garimpo go={go} categories={cats} />
      case 'score': return <OfferScorePage />
      case 'radar': return <PriceRadar />
      case 'catalog': return <Catalog categories={cats} />
      case 'favorites': return <Catalog favoritesOnly categories={cats} />
      case 'links': return <LinkGenerator />
      case 'marketplaces': return <Marketplaces />
      case 'accounts': return <Accounts />
      case 'whatsapp': return <WhatsAppPage go={go} />
      case 'telegram': return <TelegramPage go={go} />
      case 'destinations': return <Destinations categories={cats} />
      case 'autopilot': return <AutopilotPage go={go} />
      case 'campaigns': return <Campaigns categories={cats} />
      case 'queue': return <Queue />
      case 'calendar': return <CalendarPage />
      case 'smartcopy': return <SmartCopy go={go} />
      case 'templates': return <Templates variables={info.templateVariables} />
      case 'analytics': return <Analytics />
      case 'reports': return <Reports />
      case 'commissions': return <Commissions />
      case 'history': return <HistoryPage />
      case 'settings': return <SettingsPage onTheme={applyTheme} />
      case 'ai': return <AiPage />
      case 'logs': return <LogsPage />
      case 'backup': return <BackupPage />
      case 'about': return <About />
    }
  })()

  return (
    <FeedbackProvider>
      <Shell route={route} go={go}>
        <div key={route}>{page}</div>
      </Shell>
    </FeedbackProvider>
  )
}
