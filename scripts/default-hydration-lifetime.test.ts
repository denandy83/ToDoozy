import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
type Harness = Awaited<ReturnType<typeof makeHarness>>
const opened: Harness[] = []
afterEach(async () => { for (const h of opened.splice(0)) await h.stop() })
function gate() {
  let enter!: () => void, release!: () => void
  return { entered: new Promise<void>(resolve => { enter = resolve }), wait: new Promise<void>(resolve => { release = resolve }), enter: () => enter(), release: () => release() }
}
it.each(['tasks', 'notifications'].flatMap(kind => ['initial', 'final'].flatMap(point => [false, true].map(change => ({ kind, point, change }))))) (
  'guards default $kind hydration at $point context reply (replacement=$change)', async ({ kind, point, change }) => {
    const h = await makeHarness({ ref: process.env.REVIEW_BASE_REF, projectCount: 1, connected: true }); opened.push(h)
    h.services.observeDatabaseScope()
    h.repo.tasks.create({ id: 'old', project_id: 'p0', owner_id: 'u', status_id: 's0', title: 'PRIVATE OLD TASK' })
    h.repo.notifications.create({ id: 'old', type: 'assignment', message: 'PRIVATE OLD MESSAGE' })
    const api = h.sandbox.window.api, pause = gate()
    let captures = 0, held = false, cold = point === 'initial'
    h.sandbox.window.api = new Proxy(api, { get(target, namespace) {
      if (namespace !== 'sync') return Reflect.get(target, namespace)
      return new Proxy(target.sync, { get(sync, method) {
        if (method === 'currentContext') return () => cold ? null : sync.currentContext()
        if (method !== 'captureContext') return Reflect.get(sync, method)
        return async () => {
          const snapshot = await sync.captureContext()
          captures++
          const shouldHold = !held && captures === (point === 'initial' ? 1 : kind === 'tasks' ? 3 : 2)
          if (shouldHold) { held = true; pause.enter(); await pause.wait }
          cold = false
          return snapshot
        }
      } })
    } })
    const hydrate = (): Promise<void> => kind === 'tasks' ? h.stores.useTaskStore.getState().hydrateTasks('p0') : h.stores.useNotificationStore.getState().hydrate()
    const pending = hydrate().catch((error: unknown) => error)
    await pause.entered
    try {
      if (change) {
        h.repo.tasks.hardDelete('old'); h.repo.notifications.deleteAll()
        h.repo.tasks.create({ id: 'current', project_id: 'p0', owner_id: 'u', status_id: 's0', title: 'CURRENT TASK' })
        h.repo.notifications.create({ id: 'current', type: 'assignment', message: 'CURRENT MESSAGE' })
        cold = false; h.replaceDatabase()
        await hydrate()
      } else h.stores.useAuthStore.setState({ currentUser: { ...h.stores.useAuthStore.getState().currentUser } })
      const mark = h.nativeCalls.length
      pause.release(); await pending; await h.untilIdle()
      const state = kind === 'tasks' ? h.stores.useTaskStore.getState() : h.stores.useNotificationStore.getState()
      const rows = kind === 'tasks' ? Object.values(state.tasks) : state.notifications
      expect(rows.map((row: { id: string }) => row.id)).toEqual([change ? 'current' : 'old'])
      if (kind === 'tasks') expect(state.error).toBeNull()
      if (change) expect(h.nativeCalls.slice(mark)).toEqual([])
      expect(h.fixtureErrors).toEqual([])
    } finally { pause.release() }
  }, 15000)

it('hydrates anonymous offline settings with a cold native scope', async () => {
  const h = await makeHarness({ ref: process.env.REVIEW_BASE_REF, projectCount: 0, connected: true }); opened.push(h)
  h.setAccount(null); h.stores.useAuthStore.setState({ isOffline: true })
  h.stores.useSettingsStore.getState().setUserId('offline')
  h.repo.settings.set('offline', 'marker', 'LOCAL SETTINGS')
  const api = h.sandbox.window.api
  let known = false
  h.sandbox.window.api = new Proxy(api, { get(target, namespace) {
    if (namespace !== 'sync') return Reflect.get(target, namespace)
    return new Proxy(target.sync, { get(sync, method) {
      if (method === 'currentContext') return () => known ? sync.currentContext() : null
      if (method === 'captureContext') return async () => { const result = await sync.captureContext(); known = true; return result }
      if (method === 'invokeContext') return async (context: { userId: string | null; generation: number }, channel: string, args: unknown[]) => {
        expect(context.userId).toBeNull()
        expect(JSON.stringify([context.userId, context.generation])).toBe(sync.currentContext())
        const [ns, op] = channel.split(':')
        return api[ns][op](...args)
      }
      return Reflect.get(sync, method)
    } })
  } })
  await h.stores.useSettingsStore.getState().hydrateSettings()
  expect(h.stores.useSettingsStore.getState().settings.marker).toBe('LOCAL SETTINGS')
  expect(h.stores.useSettingsStore.getState().error).toBeNull()
  expect(h.requests).toEqual([])
  expect(h.fixtureErrors).toEqual([])
})
