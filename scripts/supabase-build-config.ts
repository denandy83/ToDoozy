/** Client settings are embedded in the app. Never accept a server-side key. */
export function requireSupabaseBuildConfig(env: Record<string, string | undefined>): {
  url: string
  anonKey: string
} {
  const url = env.SUPABASE_URL?.trim() ?? ''
  const anonKey = env.SUPABASE_ANON_KEY?.trim() ?? ''
  if (!url || !anonKey) {
    throw new Error('Build requires SUPABASE_URL and SUPABASE_ANON_KEY. See .env.example.')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('SUPABASE_URL must be an HTTPS project URL or a local Supabase URL.')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
      parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('SUPABASE_URL must be an HTTPS project URL or a local Supabase URL.')
  }
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(anonKey)
  if (!publicKey && anonKey.split('.').length === 3) {
    try {
      publicKey = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url').toString()).role === 'anon'
    } catch {
      // An invalid JWT is not a client key.
    }
  }
  if (!publicKey) {
    throw new Error('SUPABASE_ANON_KEY must be a publishable key or legacy anon key. Server keys must never be embedded in the app.')
  }
  return { url: parsed.origin, anonKey }
}
