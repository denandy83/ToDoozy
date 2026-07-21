// SHA-256 hashing for API keys (story #98).
//
// The `api_keys` table stores only `key_hash` — the SHA-256 digest of the raw
// key as lowercase hex — never the plaintext. This helper computes that hash so
// `authenticateRequest` can look a presented key up by hash instead of matching
// the (now removed) plaintext column.
//
// PARITY CONTRACT: the output MUST be byte-for-byte identical to
//   • Postgres `encode(digest(key, 'sha256'), 'hex')` (the backfill migration), and
//   • the renderer's key-creation path (src/shared/hashApiKey.ts),
// otherwise existing keys would stop authenticating after the backfill. All
// three are plain SHA-256 → lowercase hex, so they agree by construction; the
// colocated test pins the known vectors.
//
// Intentionally dependency-free (no `npm:`/`Deno` imports) — uses only Web
// Crypto, present in Deno, Node 20+, and browsers — so the pure logic is
// unit-testable under vitest (Node), matching scoping.ts / requestContext.ts.

/** Hash an API key with SHA-256 and return it as a 64-char lowercase hex string. */
export async function hashApiKey(apiKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(apiKey)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
