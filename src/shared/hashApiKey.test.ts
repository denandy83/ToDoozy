import { describe, it, expect } from 'vitest'
import { hashApiKey } from './hashApiKey'

// Must match the edge function (supabase/functions/mcp/hash.ts) and the Postgres
// backfill `encode(digest(key, 'sha256'), 'hex')` exactly, or keys generated in
// the app would fail MCP / quick_add_task auth. These are canonical SHA-256 hex
// vectors.
describe('hashApiKey (shared)', () => {
  it('matches the canonical SHA-256 hex for "abc"', async () => {
    expect(await hashApiKey('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('matches the canonical SHA-256 hex for the empty string', async () => {
    expect(await hashApiKey('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
  })

  it('produces a 64-char lowercase hex string', async () => {
    const hash = await hashApiKey(crypto.randomUUID())
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same input', async () => {
    const key = crypto.randomUUID()
    expect(await hashApiKey(key)).toBe(await hashApiKey(key))
  })

  it('produces different hashes for different inputs', async () => {
    expect(await hashApiKey('key-a')).not.toBe(await hashApiKey('key-b'))
  })
})
