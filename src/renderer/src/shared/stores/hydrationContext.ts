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
  const database = origin ? null : window.api.sync.captureContext()
  const sameUser = (): boolean => useAuthStore.getState().currentUser === user
  const assertCurrent = (): void => {
    if (origin ? useAuthStore.getState().currentUser?.id !== user?.id : !sameUser()) throw new Error('Hydration account changed')
    origin?.assertCurrent?.()
    if (projectId && !isProjectCurrent(projectId)) throw new Error('Project hydration invalidated')
  }
  const api = origin?.api ?? new Proxy({} as TodoozyAPI, {
    get: (_, namespace: string) => new Proxy({}, {
      get: (_, method: string) => async (...args: unknown[]) => {
        const context = await database!
        assertCurrent()
        return window.api.sync.invokeContext(context, `${namespace}:${method}`, args)
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
        const current = await window.api.sync.captureContext()
        if (current.generation !== initial.generation || current.userId !== initial.userId
          || initial.userId !== (user?.id ?? null)) return false
      }
      assertCurrent()
      return true
    } catch { return false }
  }
  return { api, isCurrent, assertCurrent, isProjectCurrent }
}
