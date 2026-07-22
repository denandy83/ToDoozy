import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  storeSession,
  loadSession,
  clearSession,
  type SafeStorageLike,
  type SessionFs,
  type SessionLogger,
  type SessionStoreDeps
} from './sessionStore'

const TOKEN_PATH = '/fake/userData/.auth-session'
const SESSION_JSON = JSON.stringify({ access_token: 'at-123', refresh_token: 'rt-456' })
// safeStorage encryption is reversible binary; simulate with a byte-shifted buffer
// that is NOT valid JSON so the plaintext detector treats it as an encrypted blob.
const ENC_PREFIX = 0x01

function fakeEncrypt(plain: string): Buffer {
  const body = Buffer.from(plain, 'utf-8').map((b) => (b + 1) & 0xff)
  return Buffer.concat([Buffer.from([ENC_PREFIX]), body])
}
function fakeDecrypt(buf: Buffer): string {
  if (buf[0] !== ENC_PREFIX) throw new Error('not encrypted by this fake')
  const body = buf.subarray(1).map((b) => (b - 1) & 0xff)
  return Buffer.from(body).toString('utf-8')
}

/** In-memory filesystem keyed by path. */
function createFakeFs(): SessionFs & { store: Map<string, Buffer> } {
  const store = new Map<string, Buffer>()
  return {
    store,
    existsSync: (p) => store.has(p),
    readFileSync: (p) => {
      const v = store.get(p)
      if (!v) throw new Error(`ENOENT: ${p}`)
      return v
    },
    writeFileSync: (p, data) => {
      store.set(p, typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data))
    },
    unlinkSync: (p) => {
      store.delete(p)
    }
  }
}

function createSafeStorage(available: boolean): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => fakeEncrypt(s),
    decryptString: (b) => fakeDecrypt(b)
  }
}

describe('sessionStore', () => {
  let fs: SessionFs & { store: Map<string, Buffer> }
  let logger: SessionLogger

  beforeEach(() => {
    fs = createFakeFs()
    logger = { warn: vi.fn(), error: vi.fn() }
  })

  function deps(available: boolean): SessionStoreDeps {
    return { safeStorage: createSafeStorage(available), fs, tokenPath: TOKEN_PATH, logger }
  }

  describe('encryption available', () => {
    it('round-trips: store then load returns the original session', () => {
      const res = storeSession(SESSION_JSON, deps(true))
      expect(res).toEqual({ persisted: true, encryptionUnavailable: false })

      // Stored bytes must NOT be the raw plaintext JSON
      const onDisk = fs.store.get(TOKEN_PATH)!
      expect(onDisk.toString('utf-8')).not.toContain('access_token')

      const loaded = loadSession(deps(true))
      expect(loaded).toBe(SESSION_JSON)
    })

    it('load returns null when no file exists', () => {
      expect(loadSession(deps(true))).toBeNull()
    })

    it('returns null and logs when an encrypted file is corrupt', () => {
      // A non-JSON, non-decryptable blob (bad prefix)
      fs.store.set(TOKEN_PATH, Buffer.from([0xff, 0xfe, 0xfd]))
      expect(loadSession(deps(true))).toBeNull()
      expect(logger.error).toHaveBeenCalled()
    })
  })

  describe('encryption unavailable', () => {
    it('does NOT write anything and reports encryptionUnavailable', () => {
      const res = storeSession(SESSION_JSON, deps(false))
      expect(res).toEqual({ persisted: false, encryptionUnavailable: true })
      expect(fs.store.has(TOKEN_PATH)).toBe(false)
      expect(logger.warn).toHaveBeenCalled()
    })

    it('never leaves plaintext tokens on disk across a store attempt', () => {
      storeSession(SESSION_JSON, deps(false))
      for (const buf of fs.store.values()) {
        expect(buf.toString('utf-8')).not.toContain('access_token')
        expect(buf.toString('utf-8')).not.toContain('refresh_token')
      }
    })
  })

  describe('legacy plaintext migration on read', () => {
    it('migrates a legacy plaintext file to encrypted when encryption is available', () => {
      // Simulate an old build that wrote raw JSON
      fs.store.set(TOKEN_PATH, Buffer.from(SESSION_JSON, 'utf-8'))

      const loaded = loadSession(deps(true))
      expect(loaded).toBe(SESSION_JSON)

      // File must now be encrypted (not the raw JSON)
      const onDisk = fs.store.get(TOKEN_PATH)!
      expect(onDisk.toString('utf-8')).not.toContain('access_token')
      // And it must decrypt back to the original
      expect(fakeDecrypt(onDisk)).toBe(SESSION_JSON)
      expect(logger.warn).toHaveBeenCalled()

      // A subsequent load (still encrypted) round-trips
      expect(loadSession(deps(true))).toBe(SESSION_JSON)
    })

    it('deletes a legacy plaintext file after use when encryption is unavailable', () => {
      fs.store.set(TOKEN_PATH, Buffer.from(SESSION_JSON, 'utf-8'))

      const loaded = loadSession(deps(false))
      // Returned for one-time use this session…
      expect(loaded).toBe(SESSION_JSON)
      // …but the plaintext file is gone
      expect(fs.store.has(TOKEN_PATH)).toBe(false)
      expect(logger.warn).toHaveBeenCalled()
    })
  })

  describe('encrypted file but encryption became unavailable', () => {
    it('returns null and leaves the encrypted file intact', () => {
      storeSession(SESSION_JSON, deps(true))
      const before = fs.store.get(TOKEN_PATH)

      const loaded = loadSession(deps(false))
      expect(loaded).toBeNull()
      expect(fs.store.get(TOKEN_PATH)).toBe(before)
      expect(logger.warn).toHaveBeenCalled()
    })
  })

  describe('clearSession', () => {
    it('removes the session file', () => {
      storeSession(SESSION_JSON, deps(true))
      expect(fs.store.has(TOKEN_PATH)).toBe(true)
      clearSession({ fs, tokenPath: TOKEN_PATH, logger })
      expect(fs.store.has(TOKEN_PATH)).toBe(false)
    })

    it('is a no-op when no file exists', () => {
      clearSession({ fs, tokenPath: TOKEN_PATH, logger })
      expect(logger.error).not.toHaveBeenCalled()
    })
  })
})
