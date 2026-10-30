import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { TodoozyAPI } from '../../../preload/index.d'
import { useAuthStore } from '../shared/stores/authStore'
import { requireSession } from './sessionRecovery'
import { supabaseRequestMetrics } from '../../../shared/supabaseTelemetry'

export interface SyncContext {
  api: TodoozyAPI
  client: SupabaseClient
  assertCurrent(): void
  isCurrent(): Promise<boolean>
  scope: string
}

export interface SyncProducer {
  api: TodoozyAPI
  client(): Promise<SupabaseClient | null>
  assertCurrent(): void
  isCurrent(): Promise<boolean>
  userId: string | undefined
  scope(): Promise<string>
}

export function captureSyncProducer(active: () => boolean = () => true): SyncProducer {
  const userId = useAuthStore.getState().currentUser?.id
  const database = window.api.sync.captureContext()
  const assertCurrent = (): void => {
    if (!active()) throw new Error('Sync paused')
    if (!userId || useAuthStore.getState().currentUser?.id !== userId) throw new Error('Sync account changed or signed out')
  }
  const assertDatabase = async (): Promise<void> => {
    assertCurrent()
    const [origin, current] = await Promise.all([database, window.api.sync.captureContext()])
    assertCurrent()
    if (origin.userId !== userId || current.userId !== origin.userId || current.generation !== origin.generation) throw new Error('Sync database changed')
  }
  const isCurrent = async (): Promise<boolean> => {
    try { await assertDatabase(); return true } catch { return false }
  }
  const api = new Proxy({} as TodoozyAPI, {
    get: (_, namespace: string) => new Proxy({}, {
      get: (_, method: string) => async (...args: unknown[]) => {
        const origin = await database
        assertCurrent()
        if (origin.userId !== userId) throw new Error('Sync database changed')
        return window.api.sync.invokeContext(origin, `${namespace}:${method}`, args)
      }
    })
  })
  let authentication: Promise<SupabaseClient | null> | undefined
  const client = (): Promise<SupabaseClient | null> => authentication ??= (async () => {
    await database
    const session = await requireSession()
    await assertDatabase()
    if (!session) return null
    if (session.user.id !== userId) throw new Error('Sync session account changed')
    const config = await window.api.auth.getSupabaseConfig()
    await assertDatabase()
    return createClient(config.url, config.anonKey, {
      global: { fetch: supabaseRequestMetrics.wrap(globalThis.fetch, config.url) },
      accessToken: async () => { await assertDatabase(); return session.access_token },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
  })()
  const scope = async (): Promise<string> => { const origin = await database; return `${origin.userId}:${origin.generation}` }
  return { api, client, assertCurrent, isCurrent, userId, scope }
}

export async function withSyncProducer(operation: (origin: SyncProducer) => Promise<void>, origin = captureSyncProducer()): Promise<void> {
  try { await operation(origin) } catch (error) {
    if (await origin.isCurrent()) throw error
  }
}

export async function captureSyncContext(active?: () => boolean): Promise<SyncContext> {
  const origin = captureSyncProducer(active)
  const client = await origin.client()
  if (!client) throw new Error('Sync signed out')
  return { api: origin.api, client, assertCurrent: origin.assertCurrent, isCurrent: origin.isCurrent, scope: await origin.scope() }
}

export async function requireProducerCurrent(origin: SyncProducer): Promise<void> {
  if (!await origin.isCurrent()) throw new Error('Sync account or database changed')
}
