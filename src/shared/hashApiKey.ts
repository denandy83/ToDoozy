// SHA-256 hashing for API keys (story #98) — renderer/shared copy.
//
// The `api_keys` table stores only a SHA-256 hash of the raw key. When the
// Integrations settings tab generates a key it must persist ONLY this hash and
// surface the plaintext to the user once (it is never stored server-side).
//
// PARITY CONTRACT: the output MUST equal Postgres
// `encode(digest(key, 'sha256'), 'hex')` (backfill migration) and the edge
// function's supabase/functions/mcp/hash.ts, so keys created here authenticate
// against the MCP server and the quick_add_task RPC. All three are plain
// SHA-256 → lowercase hex; the colocated test pins the known vectors.
//
// Uses Web Crypto (`crypto.subtle`), available in the Electron renderer and
// under vitest (Node 20+). This lives in src/shared so it is typechecked and
// importable by the renderer; the edge function keeps its own dependency-free
// copy because it cannot import across the src/ boundary in its Deno bundle.

/** Hash an API key with SHA-256 and return it as a 64-char lowercase hex string. */
export async function hashApiKey(apiKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(apiKey)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
