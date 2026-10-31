import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
import type { SyncProducer } from '../src/renderer/src/services/syncContext'
import type { useAuthStore } from '../src/renderer/src/shared/stores/authStore'

interface Harness {
  sandbox: { fetch: typeof fetch }
  stores: { useAuthStore: typeof useAuthStore }
  services: { shared: typeof import('../src/renderer/src/services/SyncService') }
  producer(): SyncProducer
  setAccount(id: string): void
  stop(): Promise<void>
}
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs') as { makeHarness(options: { projectCount: number }): Promise<Harness> }
const opened: Harness[] = []
async function harness(reply: (body: Record<string, unknown>) => Promise<Response>): Promise<Harness> {
  const h = await makeHarness({ projectCount: 0 })
  h.sandbox.fetch = async (url, init) => {
    const parsed = new URL(String(url))
    expect(parsed.hostname).toBe('127.0.0.1')
    expect(parsed.pathname).toBe('/rest/v1/rpc/decline_invite')
    expect(init?.method).toBe('POST')
    return reply(JSON.parse(String(init?.body)))
  }
  opened.push(h)
  return h
}
afterEach(async () => { for (const h of opened.splice(0)) await h.stop() })
const response = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
it.each(['declined','dismissed'])('requires explicit %s acknowledgement through the actual SDK', async result => {
  const h = await harness(async body => {
    expect(body).toEqual({ invite_token: 'synthetic-token' })
    return response(result)
  })
  await expect(h.services.shared.declineInvite('synthetic-token')).resolves.toBeUndefined()
})
it.each([null, [], {}, false])('refuses ambiguous decline acknowledgement %j', async value => {
  const h = await harness(async () => response(value))
  await expect(h.services.shared.declineInvite('synthetic-token')).rejects.toThrow(/not acknowledged/)
})
it('propagates a backend denial instead of reporting success', async () => {
  const h = await harness(async () => response({ code: '42501', message: 'Recipient denied' },403))
  await expect(h.services.shared.declineInvite('synthetic-token')).rejects.toThrow('Recipient denied')
})
it.each(['account','generation'])('cancels a held decline response after %s changes', async kind => {
  let release!: () => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const wait = new Promise<void>(resolve => { release = resolve })
  const h = await harness(async () => { entered(); await wait; return response({ message:'A private error' },403) })
  const result = h.services.shared.declineInvite('synthetic-token').catch(error => error)
  await started
  h.setAccount(kind === 'account' ? 'other' : 'u')
  release()
  const error = await result
  expect(String(error)).toMatch(/account|database|scope/i)
  expect(String(error)).not.toContain('A private error')
})
