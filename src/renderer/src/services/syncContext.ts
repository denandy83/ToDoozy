import { hydrationContext } from '../shared/stores/hydrationContext'
import { captureProjectScope } from '../shared/stores/projectScope'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { TodoozyAPI } from '../../../preload/index.d'
import { useAuthStore } from '../shared/stores/authStore'
import { requireSession } from './sessionRecovery'
import { supabaseRequestMetrics } from '../../../shared/supabaseTelemetry'

export interface SyncContext {
  api: TodoozyAPI
  accountContext?: () => Promise<SyncContext>
  apiFor?: (assertCurrent: () => void) => TodoozyAPI
  client: SupabaseClient
  assertCurrent(): void
  isCurrent(): Promise<boolean>
  scope: string
  clientFor?: (assertCurrent: () => void, assertAfter?: () => void) => SupabaseClient
  subscriptionSource?: SyncContext
}

export interface SyncProducer {
  api: TodoozyAPI
  accountContext?: () => Promise<SyncContext>
  apiFor?: (assertCurrent: () => void) => TodoozyAPI
  client(): Promise<SupabaseClient | null>
  clientFor?: (assertCurrent: () => void, assertAfter?: () => void) => SupabaseClient
  assertCurrent(): void
  isCurrent(): Promise<boolean>
  userId: string | undefined
  scope(): Promise<string>
}

export function captureSyncProducer(active: () => boolean = () => true): SyncProducer {
  const userId = useAuthStore.getState().currentUser?.id
  const readDatabaseScope = (): string | null => {
    const sync = window.api.sync
    const value = typeof sync.currentContext === 'function' ? sync.currentContext() : null
    return typeof value === 'string' ? value : null
  }
  let databaseScope = readDatabaseScope()
  const database = window.api.sync.captureContext().then(context => {
    // The preload signal is monotonic even if an older IPC reply arrives later.
    if (typeof window.api.sync.currentContext === 'function') databaseScope ??= JSON.stringify([context.userId, context.generation])
    return context
  })
  void database.catch(() => {})
  const assertCurrent = (): void => {
    if (!active()) throw new Error('Sync paused')
    if (!userId || useAuthStore.getState().currentUser?.id !== userId) throw new Error('Sync account changed or signed out')
    if (databaseScope !== null && readDatabaseScope() !== databaseScope) throw new Error('Sync database changed')
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
  const apiFor = (guard: () => void): TodoozyAPI => new Proxy({} as TodoozyAPI, {
    get: (_, namespace: string) => new Proxy({}, {
      get: (_, method: string) => async (...args: unknown[]) => {
        assertCurrent()
        guard()
        const origin = await database
        assertCurrent()
        guard()
        if (origin.userId !== userId) throw new Error('Sync database changed')
        try {
          const result = await window.api.sync.invokeContext(origin, `${namespace}:${method}`, args)
          assertCurrent()
          guard()
          return result
        } catch (error) {
          assertCurrent()
          guard()
          throw error
        }
      }
    })
  })
  const api = apiFor(assertCurrent)
  let createScopedClient: ((guard: () => void, after?: () => void) => SupabaseClient) | undefined
  const clientFor = (guard: () => void, after = guard): SupabaseClient => {
    if (!createScopedClient) throw new Error('Sync client unavailable')
    return createScopedClient(guard, after)
  }
  let authentication: Promise<SupabaseClient | null> | undefined
  const client = (): Promise<SupabaseClient | null> => authentication ??= (async () => {
    await database
    const session = await requireSession()
    await assertDatabase()
    if (!session) return null
    if (session.user.id !== userId) throw new Error('Sync session account changed')
    const config = await window.api.auth.getSupabaseConfig()
    await assertDatabase()
    const transport = supabaseRequestMetrics.wrap(globalThis.fetch, config.url)
    createScopedClient = (guard, after = guard) => createClient(config.url, config.anonKey, {
      global: { fetch: async (input, init) => {
        assertCurrent()
        guard()
        const response = await transport(input, init)
        assertCurrent()
        after()
        return response
      } },
      accessToken: async () => {
        await assertDatabase()
        const current = await requireSession()
        await assertDatabase()
        if (!current || current.user.id !== userId) throw new Error('Sync session account changed or signed out')
        return current.access_token
      },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
    return clientFor(assertCurrent)
  })()
  const scope = async (): Promise<string> => { const origin = await database; return `${origin.userId}:${origin.generation}` }
  const origin: SyncProducer = { api, apiFor, client, clientFor, assertCurrent, isCurrent, userId, scope }
  origin.accountContext = () => syncContextFromProducer(origin)
  return origin
}

export interface ProjectProducer extends SyncProducer {
  includeProject(projectId: string): void
}

export function captureProjectProducer(projectId?: string): ProjectProducer {
  const current = captureProjectScope()
  const projects = new Set(projectId ? [projectId] : [])
  const origin = captureSyncProducer()
  const guard = (): void => { origin.assertCurrent(); if (![...projects].every(current)) throw new Error('Project context changed') }
  let client: Promise<SupabaseClient | null> | undefined
  return {
    ...origin,
    api: origin.apiFor!(guard),
    apiFor: check => origin.apiFor!(() => { guard(); check() }),
    client: () => client ??= (async () => { guard(); const value = await origin.client(); guard(); return value ? origin.clientFor!(guard) : null })(),
    clientFor: check => origin.clientFor!(() => { guard(); check() }),
    isCurrent: async () => await origin.isCurrent() && [...projects].every(current) && (projects.size > 0 || current()),
    assertCurrent: () => {
      guard()
      if (!projects.size && !current()) throw new Error('Project context changed')
    },
    includeProject(id) {
      projects.add(id)
      guard()
    }
  }
}

export async function withSyncProducer(operation: (origin: SyncProducer) => Promise<void>, origin = captureSyncProducer()): Promise<void> {
  try { await operation(origin) } catch (error) {
    if (await origin.isCurrent()) throw error
  }
}

export async function captureSyncContext(active?: () => boolean): Promise<SyncContext> {
  return syncContextFromProducer(captureSyncProducer(active))
}

export async function syncContextFromProducer(origin: SyncProducer): Promise<SyncContext> {
  const client = await origin.client()
  if (!client) throw new Error('Sync signed out')
  await requireProducerCurrent(origin)
  return { accountContext: origin.accountContext, api: origin.api, apiFor: origin.apiFor, client, clientFor: origin.clientFor, assertCurrent: origin.assertCurrent, isCurrent: origin.isCurrent, scope: await origin.scope() }
}

export async function requireProducerCurrent(origin: SyncProducer): Promise<void> {
  if (!await origin.isCurrent()) throw new Error('Sync account or database changed')
  origin.assertCurrent()
}

export function channelSyncContext(parent: SyncContext, active: () => boolean, projectId: string): SyncContext {
  const assertCurrent = (): void => {
    parent.assertCurrent()
    if (!active()) throw new Error('Sync channel cancelled')
  }
  if (!parent.apiFor) throw new Error('Sync native context unavailable')
  const origin = {
    ...parent,
    api: parent.apiFor(assertCurrent),
    assertCurrent,
    isCurrent: async () => active() && await parent.isCurrent() && active()
  }
  const guardQuery = <T extends object>(query: T): T => new Proxy(query, {
    get(target, key) {
      const method = Reflect.get(target, key)
      if (typeof method !== 'function') return method
      if (key === 'then') return (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        return Promise.resolve().then(() => {
          assertCurrent()
          return Reflect.apply(method, target, [(value: unknown) => { assertCurrent(); return value }])
        }).then(resolve, reject)
      }
      return (...args: unknown[]) => {
        assertCurrent()
        const result = Reflect.apply(method, target, args)
        return result && typeof result === 'object' ? guardQuery(result) : result
      }
    }
  })
  if (!parent.clientFor) throw new Error('Sync request context unavailable')
  const client = new Proxy(parent.clientFor(assertCurrent), {
    get(target, key) {
      const method = Reflect.get(target, key)
      if (key !== 'from' && key !== 'rpc') return typeof method === 'function' ? method.bind(target) : method
      return (...args: unknown[]) => { assertCurrent(); return guardQuery(Reflect.apply(method, target, args)) }
    }
  })
  return { ...origin, ...hydrationContext(origin, projectId), client, subscriptionSource: parent.subscriptionSource ?? parent }
}
