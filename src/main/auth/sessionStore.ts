/**
 * Session token persistence — encryption-only, never plaintext.
 *
 * The auth session ({ access_token, refresh_token }) is only ever written to
 * disk encrypted via Electron's `safeStorage` (OS keychain / DPAPI / libsecret).
 * When encryption is unavailable we DO NOT fall back to writing the tokens in
 * plaintext — the session simply won't persist across restarts and the caller
 * surfaces a warning to the user.
 *
 * A legacy plaintext `.auth-session` file (written by older builds) is migrated
 * to an encrypted file when encryption is available, or deleted after use when
 * it is not — so tokens never linger on disk unprotected.
 *
 * Dependencies are injected so the store/load pair is fully unit-testable
 * without an Electron runtime.
 */

/** Minimal surface of Electron's `safeStorage` we depend on. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** Minimal `fs` surface used for session persistence. */
export interface SessionFs {
  existsSync(path: string): boolean
  readFileSync(path: string): Buffer
  writeFileSync(path: string, data: Buffer | string): void
  unlinkSync(path: string): void
}

/** Logger surface (satisfied by the global `console`). */
export interface SessionLogger {
  warn(message: string): void
  error(message: string, err: unknown): void
}

export interface SessionStoreDeps {
  safeStorage: SafeStorageLike
  fs: SessionFs
  tokenPath: string
  logger: SessionLogger
}

export interface StoreSessionResult {
  /** True when the session was written to disk (always encrypted). */
  persisted: boolean
  /** True when persistence was skipped because OS encryption is unavailable. */
  encryptionUnavailable: boolean
}

const ENCRYPTION_UNAVAILABLE_WARNING =
  'safeStorage encryption is unavailable — the auth session will NOT be persisted to disk. ' +
  'You will need to sign in again after restarting the app.'

/**
 * Detect a legacy plaintext session file. An encrypted `safeStorage` blob is
 * opaque binary and will not parse as a JSON object with token fields, so a
 * successful parse here reliably identifies an unencrypted session written by
 * an older build. Returns the plaintext JSON string when detected, else null.
 */
function readPlaintextSession(raw: Buffer): string | null {
  const text = raw.toString('utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    ('access_token' in parsed || 'refresh_token' in parsed)
  ) {
    return text
  }
  return null
}

/**
 * Persist the session JSON. Writes an encrypted file when OS encryption is
 * available; otherwise does nothing (never writes plaintext) and reports that
 * the caller should warn the user.
 */
export function storeSession(sessionJson: string, deps: SessionStoreDeps): StoreSessionResult {
  const { safeStorage, fs, tokenPath, logger } = deps
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn(ENCRYPTION_UNAVAILABLE_WARNING)
    return { persisted: false, encryptionUnavailable: true }
  }
  const encrypted = safeStorage.encryptString(sessionJson)
  fs.writeFileSync(tokenPath, encrypted)
  return { persisted: true, encryptionUnavailable: false }
}

/**
 * Load a previously persisted session.
 *
 * - Encrypted file + encryption available → decrypt and return.
 * - Legacy plaintext file + encryption available → migrate (re-encrypt on disk)
 *   and return the tokens.
 * - Legacy plaintext file + encryption unavailable → delete the file (never
 *   leave plaintext tokens on disk) and return the tokens for one-time use.
 * - Encrypted file + encryption unavailable, or unreadable data → return null.
 */
export function loadSession(deps: SessionStoreDeps): string | null {
  const { safeStorage, fs, tokenPath, logger } = deps
  if (!fs.existsSync(tokenPath)) return null

  let raw: Buffer
  try {
    raw = fs.readFileSync(tokenPath)
  } catch (err) {
    logger.error('Failed to read stored session file:', err)
    return null
  }

  const plaintext = readPlaintextSession(raw)
  if (plaintext !== null) {
    // Legacy unencrypted session from an older build.
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const encrypted = safeStorage.encryptString(plaintext)
        fs.writeFileSync(tokenPath, encrypted)
        logger.warn('Migrated legacy plaintext session file to encrypted storage.')
      } catch (err) {
        logger.error('Failed to migrate legacy plaintext session to encrypted storage:', err)
      }
      return plaintext
    }
    // Cannot secure it — remove it so tokens don't linger on disk unprotected.
    try {
      fs.unlinkSync(tokenPath)
    } catch (err) {
      logger.error('Failed to remove legacy plaintext session file:', err)
    }
    logger.warn(
      'Removed legacy plaintext session file (OS encryption unavailable); session will not persist.'
    )
    return plaintext
  }

  // Encrypted blob.
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn('Stored session is encrypted but OS encryption is unavailable; cannot restore it.')
    return null
  }
  try {
    return safeStorage.decryptString(raw)
  } catch (err) {
    logger.error('Failed to decrypt stored session:', err)
    return null
  }
}

/** Remove any persisted session file. */
export function clearSession(deps: Pick<SessionStoreDeps, 'fs' | 'tokenPath' | 'logger'>): void {
  const { fs, tokenPath, logger } = deps
  if (!fs.existsSync(tokenPath)) return
  try {
    fs.unlinkSync(tokenPath)
  } catch (err) {
    logger.error('Failed to clear stored session:', err)
  }
}
