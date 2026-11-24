import type { Db } from '../database/db'
import { nowIso } from '../database/db'

/**
 * Cofre de credenciais.
 * Em produção o Cipher é o Electron safeStorage (no Windows: DPAPI, atrelado ao usuário do Windows).
 * Nunca há fallback para texto puro: se a criptografia do sistema não estiver disponível, a gravação falha.
 */
export interface Cipher {
  readonly scheme: string
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export class SecretUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretUnavailableError'
  }
}

export class SecretStore {
  constructor(
    private readonly db: Db,
    private readonly cipher: Cipher
  ) {}

  isAvailable(): boolean {
    return this.cipher.isAvailable()
  }

  set(ref: string, value: Record<string, string>): void {
    if (!this.cipher.isAvailable()) {
      throw new SecretUnavailableError(
        'A criptografia do sistema operacional não está disponível. As credenciais não foram salvas.'
      )
    }
    const ciphertext = this.cipher.encrypt(JSON.stringify(value))
    this.db
      .prepare(
        `INSERT INTO secrets (ref, ciphertext, scheme, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(ref) DO UPDATE SET ciphertext = excluded.ciphertext, scheme = excluded.scheme, updated_at = excluded.updated_at`
      )
      .run(ref, ciphertext, this.cipher.scheme, nowIso())
  }

  /** Retorna null se não existir. Lança SecretUnavailableError se não puder ser descriptografado (ex.: backup restaurado em outro PC). */
  get(ref: string): Record<string, string> | null {
    const row = this.db.prepare('SELECT ciphertext, scheme FROM secrets WHERE ref = ?').get(ref) as
      | { ciphertext: Uint8Array; scheme: string }
      | undefined
    if (!row) return null
    if (row.scheme !== this.cipher.scheme) {
      throw new SecretUnavailableError('Credencial protegida por outro mecanismo. Autentique novamente.')
    }
    try {
      return JSON.parse(this.cipher.decrypt(Buffer.from(row.ciphertext))) as Record<string, string>
    } catch {
      throw new SecretUnavailableError(
        'Não foi possível descriptografar a credencial (outro computador ou usuário do Windows?). Autentique novamente.'
      )
    }
  }

  has(ref: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM secrets WHERE ref = ?').get(ref)
  }

  delete(ref: string): void {
    this.db.prepare('DELETE FROM secrets WHERE ref = ?').run(ref)
  }
}

/** Cifra usada SOMENTE em testes automatizados. Não oferece proteção real. */
export class TestOnlyCipher implements Cipher {
  readonly scheme = 'test-only'
  constructor(private available = true) {}
  isAvailable(): boolean {
    return this.available
  }
  encrypt(plain: string): Buffer {
    return Buffer.from(Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a))
  }
  decrypt(data: Buffer): string {
    return Buffer.from(data.map((b) => b ^ 0x5a)).toString('utf8')
  }
}
