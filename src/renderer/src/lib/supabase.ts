import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let supabaseClient: SupabaseClient | null = null
let initPromise: Promise<SupabaseClient> | null = null

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
