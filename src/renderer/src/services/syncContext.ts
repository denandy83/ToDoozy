import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { TodoozyAPI } from '../../../preload/index.d'
import { useAuthStore } from '../shared/stores/authStore'
import { requireSession } from './sessionRecovery'

export interface SyncContext {
  api: TodoozyAPI
  client: SupabaseClient
  assertCurrent(): void
}

export async function captureSyncContext(): Promise<SyncContext> {
  const userId = useAuthStore.getState().currentUser?.id
  const database = await window.api.sync.captureContext()
  const session = await requireSession()
  const config = await window.api.auth.getSupabaseConfig()
  const assertCurrent = (): void => {
    if (!userId || useAuthStore.getState().currentUser?.id !== userId || database.userId !== userId || session?.user.id !== userId) throw new Error('Sync account changed or signed out')
  }
  assertCurrent()
  const client = createClient(config.url, config.anonKey, {
    accessToken: async () => {
      assertCurrent()
      const current = await window.api.sync.captureContext()
      assertCurrent()
      if (current.generation !== database.generation || current.userId !== database.userId) throw new Error('Sync database changed')
      return session!.access_token
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const api = new Proxy({} as TodoozyAPI, {
    get: (_, namespace: string) => new Proxy({}, {
      get: (_, method: string) => (...args: unknown[]) => {
        assertCurrent()
        return window.api.sync.invokeContext(database, `${namespace}:${method}`, args)
      }
    })
  })
  return { api, client, assertCurrent }
}
