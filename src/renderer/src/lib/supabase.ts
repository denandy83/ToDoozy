import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logEvent } from '../shared/stores/logStore'

let supabaseClient: SupabaseClient | null = null
let initPromise: Promise<SupabaseClient> | null = null

// Realtime debug counters — instrumentation only (no behavior change).
let setAuthCount = 0
let setAuthDedupedCount = 0

function attachRealtimeInstrumentation(client: SupabaseClient): void {
  // NOTE: supabase-js realtime-js has no public onOpen/onClose/onError methods —
  // we push callbacks directly into the internal stateChangeCallbacks arrays.
  // onHeartbeat and setAuth ARE public.
  const rt = client.realtime as unknown as {
    stateChangeCallbacks: {
      open: Array<(data?: unknown) => void>
      close: Array<(data?: unknown) => void>
      error: Array<(data?: unknown) => void>
      message: Array<(data?: unknown) => void>
    }
    onHeartbeat: (cb: (status: string) => void) => unknown
    setAuth: (token?: string) => unknown
    channels: unknown[]
    endPoint?: string
  }

  rt.stateChangeCallbacks.open.push(() => {
    logEvent('info', 'realtime', 'WS open', `endpoint=${rt.endPoint ?? '(unknown)'} channels=${rt.channels.length}`)
  })
  rt.stateChangeCallbacks.close.push((evt?: unknown) => {
    const e = evt as { code?: number; reason?: string; wasClean?: boolean } | undefined
    const code = e?.code ?? '(none)'
    const reason = e?.reason || '(none)'
    const clean = e?.wasClean ?? false
    logEvent('warn', 'realtime', `WS close code=${code}`, `reason=${reason} wasClean=${clean} channels=${rt.channels.length}`)
  })
  rt.stateChangeCallbacks.error.push((err?: unknown) => {
    const msg = err instanceof Error ? err.message : (typeof err === 'string' ? err : JSON.stringify(err))
    logEvent('error', 'realtime', 'WS error', msg)
  })

  rt.onHeartbeat((status) => {
    if (status !== 'ok' && status !== 'sent') {
      logEvent('warn', 'realtime', `heartbeat ${status}`, `channels=${rt.channels.length}`)
    }
  })

  // setAuth dedupe — root-cause fix for JWT-refresh storms.
  // supabase-js fires setAuth on every channel join; with N parallel subscribes that's an N×N
  // push fanout over the WS. When the token hasn't actually changed, skip the redundant push.
  // Real token refreshes (different string) still propagate on the first call.
  const origSetAuth = rt.setAuth.bind(rt)
  let lastSetAuthToken: string | null | undefined = undefined
  rt.setAuth = (token?: string): unknown => {
    setAuthCount += 1
    if (lastSetAuthToken !== undefined && token === lastSetAuthToken) {
      setAuthDedupedCount += 1
      if (setAuthDedupedCount === 1 || setAuthDedupedCount % 10 === 0) {
        logEvent('info', 'realtime', `setAuth deduped #${setAuthDedupedCount}`, `skipped push, channels=${rt.channels.length}`)
      }
      return Promise.resolve()
    }
    lastSetAuthToken = token ?? null
    if (setAuthCount === 1 || setAuthCount % 5 === 0) {
      logEvent('info', 'realtime', `setAuth #${setAuthCount} (push)`, `channels=${rt.channels.length}`)
    }
    return origSetAuth(token)
  }
}

function attachAuthInstrumentation(client: SupabaseClient): void {
  client.auth.onAuthStateChange((event, session) => {
    const expiresAt = session?.expires_at
    const expInfo = expiresAt
      ? `expires_at=${new Date(expiresAt * 1000).toISOString()}`
      : '(no session)'
    logEvent('info', 'realtime', `auth: ${event}`, expInfo)
  })
}

export async function getSupabase(): Promise<SupabaseClient> {
  if (supabaseClient) return supabaseClient
  if (initPromise) return initPromise

  initPromise = (async () => {
    const config = await window.api.auth.getSupabaseConfig()
    if (!config.url || !config.anonKey) {
      throw new Error('Supabase configuration is missing. Check .env file.')
    }
    supabaseClient = createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false, // We handle persistence via safeStorage
        detectSessionInUrl: false
      }
    })
    attachRealtimeInstrumentation(supabaseClient)
    attachAuthInstrumentation(supabaseClient)
    return supabaseClient
  })()

  return initPromise
}

/** Parse tokens from an OAuth callback URL (hash fragment or query params) */
export function parseAuthTokensFromUrl(url: string): {
  accessToken: string
  refreshToken: string
} | null {
  // Try hash fragment first (implicit flow)
  const hashParams = new URLSearchParams(url.split('#')[1] ?? '')
  const accessToken = hashParams.get('access_token')
  const refreshToken = hashParams.get('refresh_token')
  if (accessToken && refreshToken) {
    return { accessToken, refreshToken }
  }

  // Try query params (PKCE flow returns code, not tokens directly)
  const queryParams = new URLSearchParams(url.split('?')[1] ?? '')
  const code = queryParams.get('code')
  if (code) {
    // For PKCE, the code will be exchanged by the caller
    return null
  }

  return null
}
