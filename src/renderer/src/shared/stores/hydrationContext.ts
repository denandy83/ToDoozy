import type { TodoozyAPI } from '../../../../preload/index.d'
import type { SyncProducer } from '../../services/syncContext'
import { captureProjectScope } from './projectScope'
export { invalidateProjectHydration } from './projectScope'
import { useAuthStore } from './authStore'

export type HydrationOrigin = Pick<SyncProducer, 'api' | 'isCurrent'> & Partial<Pick<SyncProducer, 'assertCurrent'>>

export function hydrationContext(origin?: HydrationOrigin, projectId?: string): {
  api: TodoozyAPI
  isCurrent(): Promise<boolean>
  assertCurrent(): void
  isProjectCurrent(id: string): boolean
} {
  const isProjectCurrent = captureProjectScope()
  const user = useAuthStore.getState().currentUser
  const readDatabaseScope = (): string | null => {
    const value = typeof window === 'undefined' ? null : window.api.sync?.currentContext?.()
    return typeof value === 'string' ? value : null
  }
  let databaseScope = readDatabaseScope()
  const database = origin ? null : window.api.sync.captureContext().then(context => {
    if (typeof window.api.sync.currentContext === 'function') databaseScope ??= JSON.stringify([context.userId, context.generation])
    return context
  })
  void database?.catch(() => {})
  const sameUser = (): boolean => useAuthStore.getState().currentUser?.id === user?.id
  const assertCurrent = (): void => {
    if (!sameUser()) throw new Error('Hydration account changed')
    if (databaseScope !== null && readDatabaseScope() !== databaseScope) throw new Error('Hydration database changed')
    origin?.assertCurrent?.()
    if (projectId && !isProjectCurrent(projectId)) throw new Error('Project hydration invalidated')
  }
  const api = new Proxy({} as TodoozyAPI, {
    get: (_, namespace: string) => new Proxy({}, {
      get: (_, method: string) => async (...args: unknown[]) => {
        assertCurrent()
        try {
          if (origin) {
            const target = Reflect.get(origin.api, namespace)
            const result = await Reflect.apply(Reflect.get(target, method), target, args)
            assertCurrent()
            return result
          }
          const context = await database!
          assertCurrent()
          if (context.userId !== (user?.id ?? null)) throw new Error('Hydration database changed')
          const result = await window.api.sync.invokeContext(context, `${namespace}:${method}`, args)
          assertCurrent()
          return result
        } catch (error) {
          assertCurrent()
          throw error
        }
      }
    })
  })
  const isCurrent = async (): Promise<boolean> => {
    try {
      assertCurrent()
      if (origin) {
        if (!await origin.isCurrent()) return false
      } else {
        const initial = await database!
        assertCurrent()
        const current = await window.api.sync.captureContext()
        assertCurrent()
        if (current.generation !== initial.generation || current.userId !== initial.userId
          || initial.userId !== (user?.id ?? null)) return false
      }
      assertCurrent()
      return true
    } catch { return false }
  }
  return { api, isCurrent, assertCurrent, isProjectCurrent }
}
