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
import { getSupabase } from '../lib/supabase'
import { logEvent } from '../shared/stores/logStore'

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000]
const RECOVERY_INTERVAL_MS = 30_000

let recoveryTimer: ReturnType<typeof setInterval> | null = null
let recoveryInFlight = false

async function persistTokens(session: Session): Promise<void> {
  await window.api.auth.storeSession(JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token
  }))
}

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
      const supabase = await getSupabase()
      const { data, error } = await supabase.auth.setSession({
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token
      })
      if (!error && data.session && data.user) {
        await persistTokens(data.session)
        return true
      }
      logEvent('warn', 'sync', `Session restore attempt ${i + 1}/${attempts} failed`, error?.message ?? 'no session returned')
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
 */
export function startRecoveryTimer(handlers: RecoveryHandlers): void {
  if (recoveryTimer) return
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
