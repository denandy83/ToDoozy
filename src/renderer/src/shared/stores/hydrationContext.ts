import type { TodoozyAPI } from '../../../../preload/index.d'
import { useAuthStore } from './authStore'

export function hydrationContext() {
  const user = useAuthStore.getState().currentUser
  const origin = window.api.sync.captureContext()
  const sameUser = (): boolean => useAuthStore.getState().currentUser === user
  const api = new Proxy({} as TodoozyAPI, {
    get: (_, namespace: string) => new Proxy({}, {
      get: (_, method: string) => async (...args: unknown[]) => {
        const database = await origin
        if (!sameUser()) throw new Error('Hydration account changed')
        return window.api.sync.invokeContext(database, `${namespace}:${method}`, args)
      }
    })
  })
  const isCurrent = async (): Promise<boolean> => {
    if (!sameUser()) return false
    const database = await origin
    const current = await window.api.sync.captureContext()
    return sameUser() && current.generation === database.generation && current.userId === database.userId
      && database.userId === (user?.id ?? null)
  }
  return { api, isCurrent }
}
