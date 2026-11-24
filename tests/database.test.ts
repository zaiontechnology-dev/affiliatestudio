import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, integrityCheck, transaction } from '../src/database/db'
import { Repository } from '../src/database/repository'
import { SecretStore, TestOnlyCipher, SecretUnavailableError } from '../src/security/secret-store'
import { createBackup, verifyBackupFile, stageRestore, applyPendingRestore, applyRetention, listBackups } from '../src/services/backup'
import { ConnectorRegistry } from '../src/integrations/marketplaces/registry'
import { fixtureProduct, setup } from './helpers'

describe('Banco de dados', () => {
  it('aplica migrations e mantém integridade', () => {
    const db = openDatabase({ path: ':memory:' })
    expect(integrityCheck(db).ok).toBe(true)
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((t) => t.name)
    for (const t of ['products', 'publication_queue', 'campaigns', 'destinations', 'secrets', 'migrations', 'audit_logs', 'backups']) expect(tables).toContain(t)
  })

  it('persiste configurações', () => {
    const env = setup()
    env.repo.updateSettings({ closeBehavior: 'tray', autopilotEnabled: true })
    expect(env.repo.getSettings().closeBehavior).toBe('tray')
    expect(env.repo.getSettings().timezone).toBe('America/Sao_Paulo')
  })

  it('transação faz rollback em erro', () => {
    const env = setup()
    expect(() =>
      transaction(env.db, () => {
        env.repo.upsertProduct(fixtureProduct({ externalId: 'tx.1' }))
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(env.repo.listProducts({ search: 'tx.1' })).toHaveLength(0)
  })

  it('histórico de preço registra apenas observações reais e calcula estatísticas', () => {
    const env = setup()
    const id = env.repo.upsertProduct(fixtureProduct({ priceCents: 1000 }), '2026-11-01T00:00:00.000Z')
    env.repo.upsertProduct(fixtureProduct({ priceCents: 1000 }), '2026-11-01T01:00:00.000Z') // igual e recente: ignorado
    env.repo.upsertProduct(fixtureProduct({ priceCents: 800 }), '2026-11-02T00:00:00.000Z')
    env.repo.upsertProduct(fixtureProduct({ priceCents: null }), '2026-11-03T00:00:00.000Z') // sem preço: não registra
    const st = env.repo.priceStats(id)
    expect(st).toMatchObject({ count: 2, min: 800, max: 1000, current: 800, changePct: -20 })
    expect(env.repo.priceDrops('2026-11-01T12:00:00.000Z', 5)[0]!.dropPct).toBe(20)
  })

  it('chave única impede produto duplicado', () => {
    const env = setup()
    env.repo.upsertProduct(fixtureProduct())
    env.repo.upsertProduct(fixtureProduct({ title: 'novo título' }))
    expect(env.repo.countProducts()).toBe(1)
  })

  it('bloqueio de vendedor oculta produtos', () => {
    const env = setup()
    env.repo.upsertProduct(fixtureProduct({ shopId: '77' }))
    env.repo.blockSeller('shopee', '77', 'Loja', true)
    expect(env.repo.listProducts()).toHaveLength(0)
    expect(env.repo.listProducts({ includeBlocked: true })).toHaveLength(1)
  })

  it('banco indisponível: caminho inválido gera erro tratável', () => {
    expect(() => openDatabase({ path: '/caminho/inexistente/x.db' })).toThrow()
  })
})

describe('Cofre de credenciais', () => {
  it('nunca grava texto puro', () => {
    const db = openDatabase({ path: ':memory:' })
    const s = new SecretStore(db, new TestOnlyCipher())
    s.set('a', { secret: 'MEU-SEGREDO' })
    const raw = db.prepare('SELECT ciphertext FROM secrets').get() as { ciphertext: Uint8Array }
    expect(Buffer.from(raw.ciphertext).toString('utf8')).not.toContain('MEU-SEGREDO')
    expect(s.get('a')).toEqual({ secret: 'MEU-SEGREDO' })
  })

  it('recusa salvar se a criptografia do SO estiver indisponível', () => {
    const s = new SecretStore(openDatabase({ path: ':memory:' }), new TestOnlyCipher(false))
    expect(() => s.set('a', { x: '1' })).toThrow(SecretUnavailableError)
  })

  it('credencial de outro computador exige nova autenticação', () => {
    const db = openDatabase({ path: ':memory:' })
    db.prepare("INSERT INTO secrets (ref, ciphertext, scheme) VALUES ('a', x'00', 'electron-safestorage')").run()
    expect(() => new SecretStore(db, new TestOnlyCipher()).get('a')).toThrow(SecretUnavailableError)
  })
})

describe('Backup e restauração', () => {
  it('cria backup consistente, verifica, restaura e aplica retenção', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zaion-'))
    const dbPath = join(dir, 'zaion-affiliate-studio.db')
    const backups = join(dir, 'backups')
    const db = openDatabase({ path: dbPath })
    const repo = new Repository(db)
    repo.seed(new ConnectorRegistry().list())
    repo.upsertProduct(fixtureProduct())
    const b = createBackup(db, backups, 'manual')
    expect(existsSync(b.file)).toBe(true)
    verifyBackupFile(b.file)

    repo.upsertProduct(fixtureProduct({ externalId: 'depois.1' }))
    expect(repo.countProducts()).toBe(2)
    stageRestore(b.file, dbPath)
    db.close()
    expect(applyPendingRestore(dbPath, backups)).toBe(true)
    const restored = new Repository(openDatabase({ path: dbPath }))
    expect(restored.countProducts()).toBe(1)
    // backup automático pré-restauração foi criado
    expect(listBackups(backups).some((x) => x.kind === 'pre-restore')).toBe(true)

    createBackup(restored.db, backups, 'daily', new Date('2026-01-01'))
    createBackup(restored.db, backups, 'daily', new Date('2026-01-02'))
    createBackup(restored.db, backups, 'daily', new Date('2026-01-03'))
    applyRetention(backups, 2)
    expect(listBackups(backups).filter((x) => x.kind === 'daily')).toHaveLength(2)
  })

  it('backup corrompido é rejeitado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zaion-'))
    const bad = join(dir, 'bad.db')
    writeFileSync(bad, 'isto não é sqlite')
    expect(() => verifyBackupFile(bad)).toThrow(/corrompido|inválido/i)
    expect(() => stageRestore(bad, join(dir, 'x.db'))).toThrow()
  })

  it('checksum adulterado é detectado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zaion-'))
    const db = openDatabase({ path: join(dir, 'a.db') })
    const b = createBackup(db, join(dir, 'bk'), 'manual')
    writeFileSync(`${b.file}.sha256`, `${'0'.repeat(64)}  x\n`)
    expect(() => verifyBackupFile(b.file)).toThrow(/checksum/)
  })
})
