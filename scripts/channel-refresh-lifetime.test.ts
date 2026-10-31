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
async function turns(): Promise<void> { for (let i = 0; i < 10; i++) await new Promise(setImmediate) }
async function setup(shared: boolean): Promise<Harness> {
  const h = await makeHarness({ ref: process.env.REVIEW_BASE_REF, projectCount: 2, shared: shared ? 2 : 0, connected: true }); opened.push(h)
  for (const n of [0, 1]) {
    const task = h.repo.tasks.create({ id: 'task'+n, project_id: 'p'+n, owner_id: shared ? 'other' : 'u', status_id: 's'+n, title: 'OLD '+n })
    h.remote.tasks.push({ ...task })
  }
  await h.run(); await h.untilIdle(); await h.runTimers(); await h.untilIdle()
  await h.stores.useTaskStore.getState().hydrateAllForUser('u')
  for (const id of ['p0', 'p1']) await h.stores.useStatusStore.getState().hydrateStatuses(id)
  h.stores.useProjectStore.getState().setCurrentProject('p0')
  for (const n of [0, 1]) {
    const at = '2030-01-01T00:00:00.000Z'
    Object.assign(h.remote.tasks[n], { title: 'FRESH '+n, updated_at: at })
    Object.assign(h.remote.statuses.find((row: { id: string }) => row.id === 's'+n), { name: 'FRESH STATUS '+n, updated_at: at })
    h.remote.user_labels.push({ id: 'label'+n, user_id: 'u', name: 'FRESH LABEL '+n, color: '#123456', order_index: 0, created_at: at, updated_at: at, deleted_at: null })
    h.remote.project_labels.push({ project_id: 'p'+n, label_id: 'label'+n, created_at: at, deleted_at: null })
    h.remote.task_labels.push({ task_id: 'task'+n, label_id: 'label'+n, deleted_at: null })
  }
  h.requests.length = 0; h.nativeCalls.length = 0
  return h
}
function pRequest(row: { url: string }): boolean {
  const values = [...new URL(row.url).searchParams.values()].join(' ')
  return ['p0', 'task0', 'label0'].some(id => values.includes(id))
}
function pNative(row: { args: unknown[] }): boolean {
  const args = JSON.stringify(row.args)
  return ['"p0"', '"task0"', '"s0"', '"label0"'].some(id => args.includes(id))
}
function expectFresh(h: Harness, n: number): void {
  expect(h.repo.tasks.findById('task'+n).title).toBe('FRESH '+n)
  expect(h.stores.useTaskStore.getState().tasks['task'+n].title).toBe('FRESH '+n)
  expect(h.repo.statuses.findById('s'+n).name).toBe('FRESH STATUS '+n)
  expect(h.stores.useStatusStore.getState().statuses['s'+n].name).toBe('FRESH STATUS '+n)
  expect(h.repo.labels.findByTaskId('task'+n).map((row: { id: string }) => row.id)).toEqual(['label'+n])
  expect(h.stores.useTaskStore.getState().taskLabels['task'+n].map((row: { id: string }) => row.id)).toEqual(['label'+n])
}
it.each([false, true].flatMap(shared => ['queued', 'HTTP'].flatMap(point => [false, true].map(cancel => ({ shared, point, cancel }))))) (
  'retains channel lifetime shared=$shared at $point (cancel=$cancel)', async ({ shared, point, cancel }) => {
    const h = await setup(shared), pause = gate()
    const channels = [0, 1].map(n => h.channels.find((row: { topic: string; closed: boolean }) => row.topic === (shared ? 'project:' : 'personal:')+'p'+n && !row.closed))
    const emit = (n: number): void => channels[n].emit('tasks', 'UPDATE', h.remote.tasks[n])
    const pending: Promise<void>[] = []
    let issuedP = 0
    try {
      if (point === 'queued' && shared) { emit(0); emit(1); await turns() }
      else {
        h.beforeRequest(async (row: { url: string }) => { issuedP = pRequest(row) ? 1 : 0; pause.enter(); await pause.wait })
        emit(point === 'queued' ? 1 : 0)
        if (shared) pending.push(h.runTimers())
        await pause.entered
        if (point === 'queued') { emit(0); await turns() }
      }
      if (cancel) await (shared ? h.services.shared.unsubscribeFromProject('p0') : h.services.personal.unsubscribePersonalProject('p0'))
      else h.stores.useProjectStore.getState().setCurrentProject('p1')
      const requestMark = h.requests.length, nativeMark = h.nativeCalls.length
      if (point === 'HTTP') emit(1)
      if (shared) pending.push(h.runTimers())
      await turns(); pause.release(); await Promise.all(pending); await h.untilIdle(); await h.runTimers(); await h.untilIdle()
      expectFresh(h, 1)
      expect(!!h.repo.projects.findById('p0')).toBe(true)
      if (cancel) {
        expect(h.requests.slice(requestMark).filter(pRequest)).toHaveLength(issuedP)
        expect(h.nativeCalls.slice(nativeMark).filter(pNative)).toEqual([])
        expect(h.repo.tasks.findById('task0').title).toBe('OLD 0')
        expect(h.stores.useTaskStore.getState().tasks.task0.title).toBe('OLD 0')
        expect(h.repo.statuses.findById('s0').name).toBe('Open')
        expect(h.repo.labels.findById('label0')).toBeUndefined()
        if (shared) await h.services.shared.subscribeToProject('p0')
        else await h.services.personal.subscribeToPersonalProject('p0', (_event: string, data: { id: string }, origin: unknown) => {
          void h.services.personal.requestProjectRefresh(origin, ['p0'], new Map([['p0', [data.id]]]))
        })
        const fresh = h.channels.findLast((row: { topic: string; closed: boolean }) => row.topic === (shared ? 'project:' : 'personal:')+'p0' && !row.closed)
        expect(fresh).not.toBe(channels[0])
        fresh.emit('tasks', 'UPDATE', h.remote.tasks[0]); await h.runTimers(); await h.untilIdle()
      } else expect(channels[0].closed).toBe(false)
      expectFresh(h, 0); expectFresh(h, 1)
      expect(h.maxConcurrent()).toBe(1)
      expect(h.fixtureErrors).toEqual([])
    } finally { pause.release() }
  }, 15000)

it.each([false, true])('rebinds shared=%s archive/restore through its live metadata event', async shared => {
  const h = await setup(shared)
  for (const archived of [1, 0]) {
    const channel = h.channels.findLast((row: { topic: string; closed: boolean }) => row.topic === (shared ? 'project:' : 'personal:')+'p0' && !row.closed)
    Object.assign(h.remote.projects[0], { is_archived: archived, archive_updated_at: archived ? '2031-01-01T00:00:00.000Z' : '2032-01-01T00:00:00.000Z' })
    channel.emit('projects', 'UPDATE', h.remote.projects[0]); await h.runTimers(); await h.untilIdle()
    const replacement = h.channels.findLast((row: { topic: string; closed: boolean }) => row.topic === channel.topic && !row.closed)
    expect(replacement).not.toBe(channel)
    expect(replacement.bindings.some((binding: { filter: { table: string } }) => binding.filter.table === 'tasks')).toBe(!archived)
  }
  expect(h.fixtureErrors).toEqual([])
})
