import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  session,
  shell,
  Tray
} from 'electron'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createContext, type AppContext } from './context'
import { createApi } from './api'
import { BRAND } from '../shared/brand'
import { applyRetention, createBackup } from '../services/backup'
import { redactString } from '../security/redact'
import { isSafeHttpUrl } from '../core/urls'

app.setAppUserModelId(BRAND.appId)
app.setName(BRAND.name)

let ctx: AppContext | null = null
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let sleepBlockerId: number | null = null
const timers: NodeJS.Timeout[] = []
const startHidden = process.argv.includes('--hidden')

// ───────────── instância única ─────────────
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(bootstrap).catch((e) => fatal(e))
}

function fatal(e: unknown) {
  const msg = redactString((e as Error)?.stack ?? String(e))
  console.error(msg)
  dialog.showErrorBox(`${BRAND.name} — erro ao iniciar`, `Não foi possível iniciar o aplicativo.\n\n${msg}\n\nConsulte TROUBLESHOOTING.md.`)
  app.exit(1)
}

function resource(...p: string[]): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'build')
  return join(base, ...p)
}

function notify(title: string, body: string) {
  try {
    if (!ctx?.repo.getSettings().notificationsEnabled || !Notification.isSupported()) return
    const n = new Notification({ title, body, icon: resource('icon.png') })
    n.on('click', () => showWindow())
    n.show()
  } catch (e) {
    console.error('notify', e)
  }
}

function sendEvent(type: string, payload?: unknown) {
  mainWindow?.webContents.send('zaion:event', { type, payload })
}

// ───────────── janela ─────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: BRAND.name,
    backgroundColor: '#0B1120',
    icon: resource('icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })
  Menu.setApplicationMenu(null)

  // Navegação restrita: nunca carrega conteúdo externo dentro do app.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeHttpUrl(url) && url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })

  mainWindow.on('close', async (e) => {
    if (quitting || !ctx) return
    const behavior = ctx.repo.getSettings().closeBehavior
    if (behavior === 'quit') {
      quitting = true
      return
    }
    e.preventDefault()
    if (behavior === 'tray') {
      mainWindow?.hide()
      return
    }
    const r = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      title: BRAND.name,
      message: 'Deseja manter o Zaion funcionando em segundo plano?',
      detail: 'Minimizado na bandeja, o AutoPilot continua executando as campanhas ativas. Encerrado, nenhuma automação é executada.',
      buttons: ['Minimizar para a bandeja', 'Encerrar completamente', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: 'Lembrar minha escolha',
      checkboxChecked: false
    })
    if (r.response === 2) return
    if (r.checkboxChecked) ctx.repo.updateSettings({ closeBehavior: r.response === 0 ? 'tray' : 'quit' })
    if (r.response === 0) mainWindow?.hide()
    else {
      quitting = true
      app.quit()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function isAppUrl(url: string): boolean {
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) return url.startsWith(process.env.ELECTRON_RENDERER_URL)
  return url.startsWith(pathToFileURL(join(__dirname, '../renderer/')).toString())
}

function showWindow() {
  if (!mainWindow) createWindow()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
}

// ───────────── bandeja ─────────────
function buildTray() {
  const iconPath = resource(process.platform === 'win32' ? 'tray.ico' : 'tray.png')
  const img = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  tray = new Tray(img)
  tray.setToolTip(`${BRAND.name} — ${BRAND.slogan}`)
  tray.on('double-click', () => showWindow())
  refreshTray()
}

function refreshTray() {
  if (!tray || !ctx) return
  const on = ctx.repo.getSettings().autopilotEnabled
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: BRAND.name, enabled: false },
      { label: on ? '● AutoPilot ativo' : '○ AutoPilot pausado', enabled: false },
      { type: 'separator' },
      { label: 'Abrir painel', click: () => showWindow() },
      { label: on ? 'Pausar AutoPilot' : 'Iniciar AutoPilot', click: () => setAutopilot(!on) },
      { type: 'separator' },
      {
        label: 'Encerrar completamente',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

function setAutopilot(on: boolean) {
  if (!ctx) return
  ctx.repo.updateSettings({ autopilotEnabled: on })
  ctx.repo.audit(on ? 'autopilot.start' : 'autopilot.pause', 'settings', undefined, undefined, 'tray')
  applySettings()
  sendEvent('settings')
}

// ───────────── configurações do sistema ─────────────
function applySettings() {
  if (!ctx) return
  const s = ctx.repo.getSettings()
  if (app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR) {
    app.setLoginItemSettings({ openAtLogin: s.autoLaunch, args: ['--hidden'] })
  }
  const activeCampaigns = ctx.repo.listCampaigns().some((c) => c.status === 'active')
  const shouldBlock = s.preventSleepWhileActive && s.autopilotEnabled && activeCampaigns
  // 'prevent-app-suspension' impede a suspensão apenas enquanto o app roda; não altera o plano de energia do Windows.
  if (shouldBlock && sleepBlockerId === null) sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension')
  if (!shouldBlock && sleepBlockerId !== null) {
    powerSaveBlocker.stop(sleepBlockerId)
    sleepBlockerId = null
  }
  refreshTray()
}

// ───────────── tarefas periódicas ─────────────
function scheduleJobs() {
  if (!ctx) return
  const c = ctx
  const every = (ms: number, fn: () => unknown) => {
    const t = setInterval(() => {
      Promise.resolve()
        .then(fn)
        .catch((e) => c.repo.log('error', 'scheduler', redactString((e as Error).message)))
    }, ms)
    timers.push(t)
  }

  // ciclo do AutoPilot
  every(30_000, async () => {
    if (!net.isOnline()) return
    await c.autopilot.tick()
    sendEvent('tick')
  })

  // backups automáticos + retenção + limpeza de logs (verificação horária)
  const backupCheck = () => {
    const s = c.repo.getSettings()
    const last = c.repo.getKv<Record<string, string>>('lastBackups', {})
    const now = Date.now()
    const due = (k: string, ms: number) => !last[k] || now - Date.parse(last[k]!) > ms
    if (s.backupDailyEnabled && due('daily', 24 * 3600_000)) {
      createBackup(c.db, c.paths.backups, 'daily')
      last.daily = new Date().toISOString()
    }
    if (s.backupWeeklyEnabled && due('weekly', 7 * 24 * 3600_000)) {
      createBackup(c.db, c.paths.backups, 'weekly')
      last.weekly = new Date().toISOString()
    }
    c.repo.setKv('lastBackups', last)
    applyRetention(c.paths.backups, s.backupRetention)
    c.repo.pruneLogs(60)
  }
  setTimeout(() => {
    try {
      backupCheck()
    } catch (e) {
      c.repo.log('error', 'backup', (e as Error).message)
    }
  }, 60_000)
  every(3600_000, backupCheck)

  // Price Radar (favoritos) a cada 6h e conversões a cada 12h — somente com integrações conectadas
  every(6 * 3600_000, () => (net.isOnline() ? c.autopilot.refreshFavorites(50) : null))
  every(12 * 3600_000, () => (net.isOnline() ? c.autopilot.syncConversions(14) : null))
}

// ───────────── bootstrap ─────────────
async function bootstrap() {
  ctx = createContext({
    notify,
    assisted: (item) => {
      clipboard.writeText(item.messageText)
    }
  })
  const c = ctx
  const rec = c.autopilot.recover()
  if (rec.unknown) notify('Publicações com status desconhecido', `${rec.unknown} envio(s) foram interrompidos. Verifique na fila.`)
  if (rec.expired) notify('Publicações expiradas', `${rec.expired} publicação(ões) perderam o horário enquanto o computador estava desligado.`)
  c.repo.log('info', 'app', `Aplicativo iniciado (v${app.getVersion()}).`)

  // CSP também via cabeçalho (além da meta tag do index.html)
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          app.isPackaged
            ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
            : "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* ws://localhost:*; img-src 'self' data: https:"
        ]
      }
    })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  const api = createApi(c, {
    onSettingsChanged: () => applySettings(),
    copyToClipboard: (t) => clipboard.writeText(t),
    openExternal: async (url) => {
      if (url.startsWith('file://')) await shell.openPath(url.replace('file://', ''))
      else if (isSafeHttpUrl(url)) await shell.openExternal(url)
    },
    showSaveDialog: async (defaultPath, filters) => {
      const r = await dialog.showSaveDialog(mainWindow!, { defaultPath, filters })
      return r.canceled ? null : (r.filePath ?? null)
    },
    showOpenDialog: async (filters) => {
      const r = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], filters })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    readTextFile: (p) => readFileSync(p, 'utf8'),
    isOnline: () => net.isOnline(),
    gpuInfo: async () => {
      try {
        const info = (await app.getGPUInfo('basic')) as { gpuDevice?: Array<{ vendorId?: number; deviceId?: number; active?: boolean }> }
        const g = info.gpuDevice?.find((d) => d.active) ?? info.gpuDevice?.[0]
        return g ? `vendor 0x${(g.vendorId ?? 0).toString(16)} / device 0x${(g.deviceId ?? 0).toString(16)}` : null
      } catch {
        return null
      }
    },
    appVersion: () => app.getVersion()
  })

  ipcMain.handle('zaion:call', (event, method: unknown, args: unknown) => {
    // aceita chamadas apenas da janela principal do app
    if (!mainWindow || event.sender !== mainWindow.webContents || !isAppUrl(event.senderFrame?.url ?? '')) {
      return { ok: false, error: 'Origem não autorizada.' }
    }
    if (typeof method !== 'string') return { ok: false, error: 'Método inválido.' }
    return api.call(method, args)
  })

  createWindow()
  buildTray()
  applySettings()
  scheduleJobs()

  powerMonitor.on('resume', () => {
    if (!c.autopilot.busy) {
      const r = c.autopilot.recover()
      if (r.expired) notify('Publicações expiradas', `${r.expired} publicação(ões) perderam o horário durante a suspensão.`)
    }
    sendEvent('tick')
  })
}

app.on('before-quit', () => {
  quitting = true
  for (const t of timers) clearInterval(t)
  if (sleepBlockerId !== null) powerSaveBlocker.stop(sleepBlockerId)
  try {
    ctx?.repo.log('info', 'app', 'Aplicativo encerrado.')
    ctx?.db.close()
  } catch {
    /* encerramento */
  }
})

app.on('window-all-closed', () => {
  // permanece na bandeja
})

process.on('uncaughtException', (e) => {
  try {
    ctx?.repo.log('error', 'app', `Exceção não tratada: ${redactString(e.message)}`)
  } catch {
    console.error(e)
  }
})
process.on('unhandledRejection', (e) => {
  try {
    ctx?.repo.log('error', 'app', `Promise rejeitada: ${redactString(String((e as Error)?.message ?? e))}`)
  } catch {
    console.error(e)
  }
})
