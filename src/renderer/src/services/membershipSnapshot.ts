import { captureProjectScope } from '../shared/stores/projectScope'
import type { SyncContext, SyncProducer } from './syncContext'

let revision = 0
const latest = new Map<string, number>()
const snapshots = new WeakSet<object>()

export function membershipSnapshot(options: { readOnly?: boolean } = {}): <T extends SyncContext | SyncProducer>(projectId: string, origin: T) => Promise<T> {
  const captured = ++revision
  const projectCurrent = captureProjectScope()
  return async <T extends SyncContext | SyncProducer>(projectId: string, origin: T): Promise<T> => {
    if (snapshots.has(origin)) return origin
    const scope = typeof origin.scope === 'string' ? origin.scope : await origin.scope()
    const key = JSON.stringify([scope, projectId])
    // A settings view follows authoritative writers; reading must not cancel them.
    if (!options.readOnly && projectCurrent(projectId) && await origin.isCurrent()) latest.set(key, Math.max(captured, latest.get(key) ?? 0))
    const assertCurrent = (): void => {
      origin.assertCurrent()
      const superseded = options.readOnly ? (latest.get(key) ?? 0) > captured : latest.get(key) !== captured
      if (!projectCurrent(projectId) || superseded) throw new Error('Membership snapshot superseded')
    }
    const isCurrent = async (): Promise<boolean> => {
      try { assertCurrent(); const valid = await origin.isCurrent(); assertCurrent(); return valid } catch { return false }
    }
    const api = new Proxy(origin.api, {
      get: (target, namespace) => new Proxy(Reflect.get(target, namespace), {
        get: (methods, method) => async (...args: unknown[]) => {
          assertCurrent()
          const result = await Reflect.apply(Reflect.get(methods, method), methods, args)
          assertCurrent()
          return result
        }
      })
    })
    const snapshot = { ...origin, api, assertCurrent, isCurrent }
    snapshots.add(snapshot)
    return snapshot
  }
}

export async function invalidateMembershipSnapshots(projectId: string, origin: SyncContext | SyncProducer): Promise<void> {
  await membershipSnapshot()(projectId, origin)
}
