import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, type Migration } from './migrations'

export type Db = DatabaseSync

export interface OpenOptions {
  path: string // ':memory:' para testes
  migrations?: Migration[]
}

export function openDatabase({ path, migrations = MIGRATIONS }: OpenOptions): Db {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON;')
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec('PRAGMA synchronous = NORMAL;')
  }
  db.exec('PRAGMA busy_timeout = 5000;')
  migrate(db, migrations)
  return db
}

export function migrate(db: Db, migrations: Migration[] = MIGRATIONS): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`)
  const applied = new Set(
    (db.prepare('SELECT version FROM migrations').all() as Array<{ version: number }>).map((r) => r.version)
  )
  const done: number[] = []
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue
    transaction(db, () => {
      db.exec(m.sql)
      db.prepare('INSERT INTO migrations (version, name) VALUES (?, ?)').run(m.version, m.name)
    })
    done.push(m.version)
  }
  return done
}

let txDepth = new WeakMap<Db, number>()

/** Transação com suporte a aninhamento via SAVEPOINT. */
export function transaction<T>(db: Db, fn: () => T): T {
  const depth = txDepth.get(db) ?? 0
  const sp = `sp_${depth}`
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`)
  txDepth.set(db, depth + 1)
  try {
    const result = fn()
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`)
    return result
  } catch (err) {
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`)
    throw err
  } finally {
    txDepth.set(db, depth)
  }
}

export function resetTxState(): void {
  txDepth = new WeakMap()
}

export function integrityCheck(db: Db): { ok: boolean; details: string[] } {
  const rows = db.prepare('PRAGMA integrity_check').all() as Array<Record<string, string>>
  const details = rows.map((r) => Object.values(r)[0] ?? '')
  const fk = db.prepare('PRAGMA foreign_key_check').all()
  if (fk.length) details.push(`foreign_key_check: ${fk.length} violação(ões)`)
  return { ok: details.length === 1 && details[0] === 'ok', details }
}

export const nowIso = (d: Date = new Date()): string => d.toISOString()

export function json<T>(s: string | null | undefined, fallback: T): T {
  if (s === null || s === undefined || s === '') return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export const boolOrNull = (v: unknown): boolean | null => (v === null || v === undefined ? null : Number(v) === 1)
export const intOrNull = (v: boolean | null | undefined): number | null => (v === null || v === undefined ? null : v ? 1 : 0)
