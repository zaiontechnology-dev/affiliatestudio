import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { openDatabase, type Db } from '../database/db'
import { Repository } from '../database/repository'
import { SecretStore, type Cipher } from '../security/secret-store'
import { ConnectorRegistry } from '../integrations/marketplaces/registry'
import { TelegramProvider } from '../integrations/channels/telegram/telegram-provider'
import { WhatsAppAssistedProvider, WhatsAppCloudProvider } from '../integrations/channels/whatsapp/whatsapp-providers'
import type { DistributionProvider } from '../integrations/channels/types'
import { Autopilot, type Notifier } from '../automation/autopilot'
import { applyPendingRestore } from '../services/backup'
import { BRAND } from '../shared/brand'
import type { ChannelId } from '../shared/types'

/** Cifra baseada no Electron safeStorage (Windows: DPAPI do usuário atual). */
class SafeStorageCipher implements Cipher {
  readonly scheme = 'electron-safestorage'
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }
  encrypt(plain: string): Buffer {
    return safeStorage.encryptString(plain)
  }
  decrypt(data: Buffer): string {
    return safeStorage.decryptString(data)
  }
}

export interface AppContext {
  paths: { userData: string; db: string; backups: string; logs: string; exports: string }
  db: Db
  repo: Repository
  secrets: SecretStore
  connectors: ConnectorRegistry
  providers: Record<ChannelId, DistributionProvider>
  autopilot: Autopilot
}

/**
 * Diretório de dados:
 *  - Instalado: %APPDATA%\Zaion Affiliate Studio (separado dos arquivos de instalação; preservado em atualizações).
 *  - Portátil: pasta "ZaionData" ao lado do executável (variável PORTABLE_EXECUTABLE_DIR do electron-builder).
 *    Credenciais continuam protegidas pela DPAPI e só abrem no mesmo usuário do Windows.
 */
export function resolveUserData(): string {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  if (portableDir) {
    const dir = join(portableDir, 'ZaionData')
    mkdirSync(dir, { recursive: true })
    app.setPath('userData', dir)
  }
  return app.getPath('userData')
}

export function createContext(notifier: Notifier): AppContext {
  const userData = resolveUserData()
  const paths = {
    userData,
    db: join(userData, BRAND.dbFile),
    backups: join(userData, 'backups'),
    logs: join(userData, 'logs'),
    exports: join(userData, 'exports')
  }
  for (const p of [paths.backups, paths.logs, paths.exports]) mkdirSync(p, { recursive: true })

  applyPendingRestore(paths.db, paths.backups)
  const db = openDatabase({ path: paths.db })
  const repo = new Repository(db)
  const connectors = new ConnectorRegistry()
  repo.seed(connectors.list())
  const secrets = new SecretStore(db, new SafeStorageCipher())
  const providers: Record<ChannelId, DistributionProvider> = {
    telegram: new TelegramProvider(),
    whatsapp_assisted: new WhatsAppAssistedProvider(),
    whatsapp_cloud: new WhatsAppCloudProvider()
  }
  const autopilot = new Autopilot({ repo, secrets, connectors, providers, notifier })
  return { paths, db, repo, secrets, connectors, providers, autopilot }
}
