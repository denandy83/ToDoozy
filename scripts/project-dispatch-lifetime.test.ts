import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
type Harness = Awaited<ReturnType<typeof makeHarness>>
const opened: Harness[] = []
afterEach(async () => { for (const h of opened.splice(0)) await h.stop() })
function gate() { let enter!: () => void, release!: () => void; return { entered: new Promise<void>(r => { enter = r }), wait: new Promise<void>(r => { release = r }), enter: () => enter(), release: () => release() } }
async function setup(): Promise<Harness> {
  const h = await makeHarness({ ref: process.env.REVIEW_BASE_REF, projectCount: 2, shared: 1, connected: false }); opened.push(h)
  for (const n of [0, 1]) {
    const row = h.repo.tasks.create({ id: 'task'+n, project_id: 'p'+n, owner_id: n ? 'u' : 'other', status_id: 's'+n, title: 'BEFORE '+n, order_index: n ? 88 : 71 })
    h.remote.tasks.push({ ...row })
  }
  await h.stores.useTaskStore.getState().hydrateAllForUser('u')
  return h
}
async function revoke(h: Harness): Promise<void> {
  h.remote.project_members = h.remote.project_members.filter((m: { project_id: string; user_id: string }) => m.project_id !== 'p0' || m.user_id !== 'u')
  await h.services.shared.discoverRemoteMemberships('u', await h.context(), h.repo.projects.findById('p0'))
}
async function pendingRevocation(h: Harness): Promise<{ release(): void; done: Promise<void> }> {
  const pause = gate(), original = h.repo.projects.removeMember.bind(h.repo.projects)
  h.repo.projects.removeMember = async (id: string, userId: string) => {
    if (id === 'p0' && userId === 'u') { pause.enter(); await pause.wait }
    return original(id, userId)
  }
  const done = revoke(h)
  await pause.entered
  return { release: pause.release, done }
}
function holdReply(h: Harness, channel: string | string[], id: string, pause: ReturnType<typeof gate>): void {
  const api = h.sandbox.window.api
  let held = false
  h.sandbox.window.api = new Proxy(api, { get(target, namespace) {
    if (namespace !== 'sync') return Reflect.get(target, namespace)
    return new Proxy(target.sync, { get(sync, method) {
      if (method !== 'invokeContext') return Reflect.get(sync, method)
      return async (origin: unknown, name: string, args: unknown[]) => {
        const result = await sync.invokeContext(origin, name, args)
        if ((Array.isArray(channel) ? channel : [channel]).includes(name) && (args[0] === id || (Array.isArray(args[0]) && args[0].includes(id))) && !held) { held = true; pause.enter(); await pause.wait }
        return result
      }
    } })
  } })
}
function holdAuthentication(h: Harness, pause: ReturnType<typeof gate>): void {
  const original = h.sandbox.runtime.requireSession
  h.sandbox.runtime.requireSession = async () => { pause.enter(); await pause.wait; return original() }
}
function privateCall(call: { args: unknown[] }): boolean { return /"(?:task0|p0|s0|label0)"/.test(JSON.stringify(call.args)) }
it.each([false, true])('fences mixed reorder at native dispatch after uncached ownership lookup (revoked=%s)', async removed => {
  const h = await setup(), pause = gate(), original = h.repo.tasks.findById.bind(h.repo.tasks)
  h.stores.useTaskStore.setState((s: { tasks: Record<string, unknown> }) => ({ tasks: Object.fromEntries(Object.entries(s.tasks).filter(([id]) => id !== 'task1')) }))
  holdReply(h, 'tasks:findById', 'task1', pause)
  const pending = h.stores.useTaskStore.getState().reorderTasks(['task0', 'task1'])
  await pause.entered
  if (removed) await revoke(h)
  const before = original('task0'), mark = h.nativeCalls.length
  pause.release(); await pending; await h.untilIdle()
  expect(original('task0').order_index).toBe(removed ? 71 : 0)
  if (removed) {
    expect(original('task0').updated_at).toBe(before.updated_at)
    expect(h.nativeCalls.slice(mark).filter(privateCall)).toEqual([])
    expect(h.stores.useTaskStore.getState().tasks.task0).toBeUndefined()
    expect(h.remote.tasks[0].order_index).toBe(71)
  } else expect(h.stores.useTaskStore.getState().tasks.task0.order_index).toBe(0)
  expect(original('task1').order_index).toBe(1)
  expect(h.stores.useTaskStore.getState().tasks.task1.order_index).toBe(1)
  expect(h.remote.tasks[1].order_index).toBe(1)
  expect(h.fixtureErrors).toEqual([])
})
function enqueueTasks(h: Harness): void {
  for (const n of [0, 1]) {
    const row = h.repo.tasks.update('task'+n, { title: 'PENDING '+n, order_index: n })
    h.repo.syncQueue.enqueue('tasks', row.id, 'UPDATE', JSON.stringify(row))
  }
}
it.each(['validation', 'authentication', 'HTTP', 'labels'].flatMap(point => [false, true].map(removed => ({ point, removed })))) (
  'retains per-project queue lifetime at $point (revoked=$removed)', async ({ point, removed }) => {
    const h = await setup(), context = await h.context(), pause = gate()
    enqueueTasks(h)
    const removal = removed && (point === 'HTTP' || point === 'authentication') ? await pendingRevocation(h) : null
    if (point === 'validation') holdReply(h, 'projects:findById', 'p1', pause)
    else if (point === 'labels') holdReply(h, 'tasks:getLabelState', 'task1', pause)
    else if (point === 'authentication') holdAuthentication(h, pause)
    else h.beforeRequest(async () => { pause.enter(); await pause.wait })
    const pending = h.services.shared.processSyncQueue(context)
    await pause.entered
    if (removal) { removal.release(); await removal.done }
    else if (removed) await revoke(h)
    const mark = h.nativeCalls.length, requests = h.requests.length, before = h.repo.tasks.findById('task0')
    pause.release(); await pending; await h.untilIdle()
    expect(h.remote.tasks[1].title).toBe('PENDING 1')
    expect(h.repo.syncQueue.findAll().some((entry: { row_id: string }) => entry.row_id === 'task1')).toBe(false)
    expect(h.repo.syncQueue.findAll().some((entry: { row_id: string }) => entry.row_id === 'task0')).toBe(removed)
    if (removed) {
      expect(h.nativeCalls.slice(mark).filter(privateCall)).toEqual([])
      expect(h.repo.tasks.findById('task0')).toEqual(before)
      const privateWrites = h.requests.slice(requests).filter((r: { table: string; method: string; body: unknown }) => r.table === 'tasks' && r.method === 'POST' && JSON.stringify(r.body).includes('task0'))
      expect(privateWrites).toHaveLength(point === 'HTTP' ? 1 : 0)
      if (point === 'validation' || point === 'authentication') expect(h.remote.tasks[0].title).toBe('BEFORE 0')
    } else {
      expect(h.remote.tasks[0].title).toBe('PENDING 0')
      expect(h.requests.filter((r: { table: string; method: string }) => r.table === 'tasks' && r.method === 'POST')).toHaveLength(1)
    }
    expect(h.maxConcurrent()).toBe(1); expect(h.fixtureErrors).toEqual([])
  }, 15000)
it.each(['assignment', 'project-label', 'status-delete'].flatMap(kind => ['authentication', 'HTTP'].map(point => ({ kind, point })))) (
  'fences special $kind replay at $point and keeps Q progressing', async ({ kind, point }) => {
    const h = await setup(), context = await h.context(), pause = gate()
    const removal = await pendingRevocation(h)
    let table = 'task_labels', id = 'task0'
    if (kind === 'assignment') {
      h.repo.labels.create({ id: 'label0', user_id: 'u', project_id: 'p0', name: 'LABEL' })
      h.repo.tasks.addLabel('task0', 'label0')
      for (const entry of h.repo.syncQueue.findAll()) if (entry.table_name === 'project_labels') h.repo.syncQueue.dequeue(entry.id)
      h.remote.user_labels.push({ ...h.repo.labels.findById('label0') })
      h.remote.project_labels.push({ project_id: 'p0', label_id: 'label0', deleted_at: null })
    } else if (kind === 'project-label') {
      table = 'project_labels'; id = 'p0::label0'
      h.repo.labels.create({ id: 'label0', user_id: 'u', project_id: 'p0', name: 'LABEL' })
      h.repo.syncQueue.enqueue(table, id, 'UPDATE', JSON.stringify({ projectId: 'p0', labelId: 'label0', addition: true }))
    } else {
      table = 'statuses'; id = 'custom0'
      h.repo.statuses.create({ id, project_id: 'p0', name: 'CUSTOM' })
      h.repo.tasks.update('task0', { status_id: id })
      h.remote.statuses.push({ ...h.repo.statuses.findById(id) })
      h.remote.tasks[0] = { ...h.repo.tasks.findById('task0') }
      h.repo.statuses.reassignAndDelete(id, 's0')
    }
    const q = h.repo.tasks.update('task1', { title: 'VALID Q' })
    h.repo.syncQueue.enqueue('tasks', 'task1', 'UPDATE', JSON.stringify(q))
    if (point === 'authentication' && kind === 'assignment') {
      const qEntry = h.repo.syncQueue.findAll().find((entry: { row_id: string }) => entry.row_id === 'task1')
      const original = h.repo.syncQueue.dequeue.bind(h.repo.syncQueue)
      h.repo.syncQueue.dequeue = (entryId: string) => {
        const result = original(entryId)
        if (entryId === qEntry.id) holdAuthentication(h, pause)
        return result
      }
    } else if (point === 'authentication') holdAuthentication(h, pause)
    else {
      const hold = async (request: { url: string }): Promise<void> => {
        if (kind !== 'assignment' || ['task0', 'p0', 'label0'].some(id => request.url.includes(id))) { pause.enter(); await pause.wait }
        else h.beforeRequest(hold)
      }
      h.beforeRequest(hold)
    }
    const pending = h.services.shared.processSyncQueue(context)
    await pause.entered; removal.release(); await removal.done
    const mark = h.nativeCalls.length
    pause.release(); await pending; await h.untilIdle()
    expect(h.repo.syncQueue.findAll().some((entry: { table_name: string; row_id: string }) => entry.table_name === table && entry.row_id === id)).toBe(true)
    expect(h.repo.syncQueue.findAll().some((entry: { row_id: string }) => entry.row_id === 'task1')).toBe(false)
    expect(h.remote.tasks[1].title).toBe('VALID Q')
    expect(h.nativeCalls.slice(mark).filter(privateCall)).toEqual([])
    expect(h.fixtureErrors).toEqual([])
  }, 15000)

it('retains unresolved project tombstones while replaying a valid Q row', async () => {
  const h = await setup()
  h.repo.syncQueue.enqueue('tasks', 'unknown-task', 'DELETE', JSON.stringify({ id: 'unknown-task', deleted_at: '2030-01-01' }))
  const q = h.repo.tasks.update('task1', { title: 'VALID Q' })
  h.repo.syncQueue.enqueue('tasks', q.id, 'UPDATE', JSON.stringify(q))
  await h.services.shared.processSyncQueue(await h.context())
  expect(h.repo.syncQueue.findAll().map((entry: { row_id: string }) => entry.row_id)).toEqual(['unknown-task'])
  expect(h.requests.some((r: { url: string; body: unknown }) => r.url.includes('unknown-task') || JSON.stringify(r.body).includes('unknown-task'))).toBe(false)
  expect(h.remote.tasks[1].title).toBe('VALID Q')
  expect(h.fixtureErrors).toEqual([])
})

it('preserves a newer native edit while a reorder write reply is held', async () => {
  const h = await setup(), pause = gate()
  holdReply(h, ['tasks:update', 'tasks:reorder'], 'task1', pause)
  const pending = h.stores.useTaskStore.getState().reorderTasks(['task1'])
  await pause.entered
  const current = h.repo.tasks.update('task1', { title: 'NEWER LOCAL EDIT' })
  h.stores.useTaskStore.setState((s: { tasks: Record<string, unknown> }) => ({ tasks: { ...s.tasks, task1: current } }))
  pause.release(); await pending; await h.untilIdle()
  expect(h.stores.useTaskStore.getState().tasks.task1.title).toBe('NEWER LOCAL EDIT')
  expect(h.remote.tasks[1].title).toBe('NEWER LOCAL EDIT')
  expect(h.fixtureErrors).toEqual([])
})
