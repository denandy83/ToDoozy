/**
 * Session recovery — guards every Supabase write behind a live session check
 * and auto-retries session restoration when the app is in offline-fallback mode.
 *
 * Why this exists: with `persistSession: false` (we manage tokens via safeStorage),
 * the in-memory session can disappear when `setSession` fails on cold start
 * (network blip, expired refresh token). The app then runs in zombie mode —
 * `currentUser` is set from local SQLite, channels join the WebSocket without auth,
 * and every push hits RLS 42501 because `auth.uid()` is null.
 *
 * This module:
 *   1. `requireSession()` — single canonical "do we have auth right now?" check
 *      that every push function calls before issuing an upsert.
 *   2. `tryRestoreSession()` — re-attempts `setSession` from stored tokens with
 *      exponential backoff. Used both at boot (3 attempts before falling back)
 *      and in the recovery timer (every 30s while offline).
 *   3. `startRecoveryTimer()` / `stopRecoveryTimer()` — owned by authStore.
 *      While `isOffline === true`, ticks every 30s; on success, clears the
 *      offline flag and triggers a queue drain + reconcile to push the
 *      changes that piled up during the dead-session window.
 */
import type { Session } from '@supabase/supabase-js'
import { getSupabase, safeSetSession } from '../lib/supabase'
import { logEvent } from '../shared/stores/logStore'

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000]
const RECOVERY_INTERVAL_MS = 30_000

// Error codes that mean the stored token is permanently dead server-side.
// Retrying is pointless — only a fresh sign-in mints a new refresh_token chain.
// Source: Supabase auth error codes + community-documented patterns.
const PERMANENT_ERROR_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'bad_jwt',
  'user_not_found'
])

// Message-level fallbacks for older supabase-js versions that don't always
// populate `error.code`. These match the surface text of the same conditions.
const PERMANENT_ERROR_MESSAGE_PATTERNS = [
  /refresh token not found/i,
  /invalid refresh token/i,
  /already used/i,
  /session not found/i,
  /user not found/i
]

function isPermanentAuthError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code && PERMANENT_ERROR_CODES.has(err.code)) return true
  if (err.message) {
    for (const pat of PERMANENT_ERROR_MESSAGE_PATTERNS) {
      if (pat.test(err.message)) return true
    }
  }
  return false
}

let recoveryTimer: ReturnType<typeof setInterval> | null = null
let recoveryInFlight = false
let permanentlyDead = false

/**
 * Returns the current Supabase session if one exists, or null.
 * Push functions use this as a guard — no session means the request would
 * be anonymous and rejected by RLS, so we skip cleanly instead of erroring.
 */
export async function requireSession(): Promise<Session | null> {
  try {
    const supabase = await getSupabase()
    const { data: { session } } = await supabase.auth.getSession()
    return session
  } catch {
    return null
  }
}

/**
 * Try to restore a Supabase session from the tokens persisted in safeStorage.
 * Returns true on success. Caller is responsible for updating the auth store
 * with the recovered user (we only re-establish the session on the client).
 *
 * `attempts` controls retry count; each retry uses the next entry from
 * RETRY_DELAYS_MS as a backoff before retrying.
 *
 * If the failure is a permanent auth error (refresh_token_not_found, etc.),
 * we clear the stored tokens and stop retrying — only a fresh sign-in fixes
 * a permanently dead refresh chain.
 */
export async function tryRestoreSession(attempts = 1): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      const delay = RETRY_DELAYS_MS[Math.min(i - 1, RETRY_DELAYS_MS.length - 1)]
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    const stored = await window.api.auth.getSession()
    if (!stored) return false
    let parsed: { access_token: string; refresh_token: string }
    try {
      parsed = JSON.parse(stored)
    } catch {
      return false
    }
    try {
      const { session, error } = await safeSetSession({
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token
      })
      if (!error && session) {
        return true
      }
      logEvent('warn', 'sync', `Session restore attempt ${i + 1}/${attempts} failed`, error?.message ?? 'no session returned')
      if (isPermanentAuthError(error)) {
        logEvent('warn', 'sync', 'Refresh token permanently dead — clearing stored tokens', error?.code ?? error?.message ?? '')
        permanentlyDead = true
        await window.api.auth.clearSession()
        // No point retrying with garbage. Fail fast so caller can prompt re-login.
        return false
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      logEvent('warn', 'sync', `Session restore attempt ${i + 1}/${attempts} threw`, msg)
    }
  }
  return false
}

interface RecoveryHandlers {
  onRecovered: () => void | Promise<void>
}

/**
 * Start the auto-retry timer. Authstore calls this when `isOffline` flips true.
 * On successful restore, the `onRecovered` handler runs (clears isOffline,
 * triggers a reconcile, drains the queue) and the timer stops.
 *
 * If `tryRestoreSession` flags the token as permanently dead, the timer also
 * stops — there's nothing to recover. The user must re-authenticate via the
 * SessionBanner's "Sign in again" action.
 */
export function startRecoveryTimer(handlers: RecoveryHandlers): void {
  if (recoveryTimer) return
  if (permanentlyDead) {
    logEvent('info', 'sync', 'Skipping recovery timer — refresh token already known dead')
    return
  }
  logEvent('info', 'sync', 'Session recovery timer started', `interval=${RECOVERY_INTERVAL_MS / 1000}s`)
  recoveryTimer = setInterval(async () => {
    if (recoveryInFlight) return
    recoveryInFlight = true
    try {
      const restored = await tryRestoreSession(1)
      if (restored) {
        logEvent('info', 'sync', 'Session recovered — resuming sync')
        stopRecoveryTimer()
        await handlers.onRecovered()
      } else if (permanentlyDead) {
        logEvent('warn', 'sync', 'Stopping recovery timer — token permanently dead, sign-in required')
        stopRecoveryTimer()
      }
    } finally {
      recoveryInFlight = false
    }
  }, RECOVERY_INTERVAL_MS)
}

export function stopRecoveryTimer(): void {
  if (recoveryTimer) {
    clearInterval(recoveryTimer)
    recoveryTimer = null
    logEvent('info', 'sync', 'Session recovery timer stopped')
  }
}

/** Reset the permanently-dead flag (call on successful sign-in). */
export function resetPermanentlyDeadFlag(): void {
  permanentlyDead = false
}

export function isPermanentlyDead(): boolean {
  return permanentlyDead
}
