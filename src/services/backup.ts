import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Db } from '../database/db'
import { integrityCheck } from '../database/db'
import { BRAND } from '../shared/brand'

/**
 * Backups consistentes via `VACUUM INTO` (snapshot transacional do SQLite).
 * Credenciais permanecem criptografadas (DPAPI/safeStorage) dentro do backup e podem não
 * ser restauráveis em outro computador/usuário — nesse caso o app pede nova autenticação.
 */
export interface BackupInfo {
  file: string
  name: string
  kind: 'manual' | 'daily' | 'weekly' | 'pre-restore'
  sizeBytes: number
  sha256: string
  createdAt: string
}

const sha256File = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

export function createBackup(db: Db, dir: string, kind: BackupInfo['kind'], now = new Date()): BackupInfo {
  mkdirSync(dir, { recursive: true })
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const name = `${BRAND.technicalName}-${kind}-${stamp}.db`
  const file = join(dir, name)
  const tmp = `${file}.partial`
  if (existsSync(tmp)) rmSync(tmp)
  db.prepare('VACUUM INTO ?').run(tmp)
  verifyBackupFile(tmp)
  renameSync(tmp, file)
  const info: BackupInfo = { file, name, kind, sizeBytes: statSync(file).size, sha256: sha256File(file), createdAt: now.toISOString() }
  writeFileSync(`${file}.sha256`, `${info.sha256}  ${name}\n`)
  db.prepare('INSERT INTO backups (file_path, kind, size_bytes, sha256, status, created_at) VALUES (?,?,?,?,?,?)').run(
    file,
    kind,
    info.sizeBytes,
    info.sha256,
    'ok',
    info.createdAt
  )
  return info
}

/** Abre o arquivo em modo somente leitura e executa integrity_check. Lança erro se inválido. */
export function verifyBackupFile(file: string): void {
  let probe: DatabaseSync | null = null
  try {
    probe = new DatabaseSync(file, { readOnly: true })
    const res = integrityCheck(probe)
    if (!res.ok) throw new Error(`Backup corrompido: ${res.details.join('; ')}`)
    const hasMigrations = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'").get()
    if (!hasMigrations) throw new Error('Arquivo não é um banco do Zaion Affiliate Studio.')
  } catch (e) {
    const msg = (e as Error).message
    throw new Error(msg.startsWith('Backup') || msg.startsWith('Arquivo') ? msg : `Backup inválido ou corrompido: ${msg}`)
  } finally {
    probe?.close()
  }
  const sumFile = `${file}.sha256`
  if (existsSync(sumFile)) {
    const expected = readFileSync(sumFile, 'utf8').split(/\s+/)[0]
    if (expected && expected !== sha256File(file)) throw new Error('Backup corrompido: checksum SHA-256 não confere.')
  }
}

export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((name) => {
      const file = join(dir, name)
      const st = statSync(file)
      const kind = (name.match(/-(manual|daily|weekly|pre-restore)-/)?.[1] ?? 'manual') as BackupInfo['kind']
      const sumFile = `${file}.sha256`
      return {
        file,
        name,
        kind,
        sizeBytes: st.size,
        sha256: existsSync(sumFile) ? (readFileSync(sumFile, 'utf8').split(/\s+/)[0] ?? '') : '',
        createdAt: st.mtime.toISOString()
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function applyRetention(dir: string, keep: number): string[] {
  const removed: string[] = []
  for (const kind of ['daily', 'weekly', 'manual', 'pre-restore'] as const) {
    const items = listBackups(dir).filter((b) => b.kind === kind)
    for (const b of items.slice(Math.max(1, keep))) {
      rmSync(b.file, { force: true })
      rmSync(`${b.file}.sha256`, { force: true })
      removed.push(basename(b.file))
    }
  }
  return removed
}

/**
 * Prepara restauração: valida o backup e o copia para `<db>.restore`.
 * A troca efetiva acontece na próxima inicialização (antes de abrir o banco) via `applyPendingRestore`.
 */
export function stageRestore(backupFile: string, dbPath: string): void {
  verifyBackupFile(backupFile)
  copyFileSync(backupFile, `${dbPath}.restore`)
}

export function applyPendingRestore(dbPath: string, backupDir: string): boolean {
  const pending = `${dbPath}.restore`
  if (!existsSync(pending)) return false
  verifyBackupFile(pending)
  if (existsSync(dbPath)) {
    mkdirSync(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    // VACUUM INTO inclui dados ainda no WAL (cópia simples do .db poderia perdê-los)
    const cur = new DatabaseSync(dbPath)
    try {
      cur.prepare('VACUUM INTO ?').run(join(backupDir, `${BRAND.technicalName}-pre-restore-${stamp}.db`))
    } finally {
      cur.close()
    }
  }
  for (const ext of ['-wal', '-shm']) rmSync(`${dbPath}${ext}`, { force: true })
  renameSync(pending, dbPath)
  return true
}
