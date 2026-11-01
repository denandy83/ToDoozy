import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
import type { SyncContext } from '../src/renderer/src/services/syncContext'

const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
const opened: Awaited<ReturnType<typeof makeHarness>>[] = []
afterEach(async () => { for (const h of opened.splice(0)) await h.stop() })
function gate() {
  let enter!: () => void, release!: () => void
  return { entered: new Promise<void>(resolve => { enter = resolve }), wait: new Promise<void>(resolve => { release = resolve }), enter: () => enter(), release: () => release() }
}
const stamp = '2030-01-01T00:00:00.000Z'
async function setup() {
  const h = await makeHarness({ projectCount: 2, shared: 2, connected: false }); opened.push(h)
  for (const n of [0, 1]) {
    const task = h.repo.tasks.create({ id: 't'+n, project_id: 'p'+n, owner_id: 'u', status_id: 's'+n, title: 'OLD '+n })
    h.remote.tasks.push({ ...task })
  }
  await h.stores.useTaskStore.getState().hydrateAllForUser('u')
  for (const id of ['p0', 'p1']) await h.stores.useStatusStore.getState().hydrateStatuses(id)
  const origins = new Map<string, SyncContext>()
  h.services.shared.setRealtimeCallback((_table: string, _event: string, payload: { project_id: string }, origin: SyncContext) => { origins.set(payload.project_id, origin) })
  const channels = new Map<string, { emit(table: string, event: string, row: unknown): void }>()
  for (const id of ['p0', 'p1']) {
    await h.services.shared.subscribeToProject(id)
    const channel = h.channels.find((row: { topic: string; closed: boolean }) => row.topic === 'project:'+id && !row.closed)
    channels.set(id, channel)
    channel.emit('project_members', 'INSERT', { project_id: id, user_id: 'u' })
  }
  await h.untilIdle()
  expect(origins.size).toBe(2)
  return { h, origins, channels }
}
function changeRemote(h: Awaited<ReturnType<typeof makeHarness>>, n: number, title = 'FRESH '+n, at = stamp) {
  const projectId = 'p'+n, taskId = 't'+n, labelId = 'label'+n
  Object.assign(h.remote.projects[n], { name: title+' PROJECT', updated_at: at })
  Object.assign(h.remote.tasks[n], { title, updated_at: at })
  Object.assign(h.remote.statuses.find((row: { id: string }) => row.id === 's'+n), { name: title+' STATUS', updated_at: at })
  const label = { id: labelId, user_id: 'u', name: title+' LABEL', color: '#123456', order_index: 0, created_at: at, updated_at: at, deleted_at: null }
  const old = h.remote.user_labels.find((row: { id: string }) => row.id === labelId)
  if (old) Object.assign(old, label)
  else {
    h.remote.user_labels.push(label)
    h.remote.project_labels.push({ project_id: projectId, label_id: labelId, created_at: at, deleted_at: null })
    h.remote.task_labels.push({ task_id: taskId, label_id: labelId, deleted_at: null })
  }
}
async function evict(h: Awaited<ReturnType<typeof makeHarness>>) {
  await h.services.shared.unsubscribeFromProject('p0')
  h.services.evictProjectData('p0')
  h.stores.useProjectStore.setState((state: { projects: Record<string, unknown>; members: Record<string, unknown> }) => ({
    projects: Object.fromEntries(Object.entries(state.projects).filter(([id]) => id !== 'p0')),
    members: Object.fromEntries(Object.entries(state.members).filter(([id]) => id !== 'p0'))
  }))
}
function expectFreshQ(h: Awaited<ReturnType<typeof makeHarness>>, title = 'FRESH 1') {
  expect(h.repo.tasks.findById('t1').title).toBe(title)
  expect(h.stores.useTaskStore.getState().tasks.t1.title).toBe(title)
  expect(h.repo.statuses.findById('s1').name).toBe(title+' STATUS')
  expect(h.stores.useStatusStore.getState().statuses.s1.name).toBe(title+' STATUS')
  expect(h.repo.labels.findById('label1').name).toBe(title+' LABEL')
  expect(h.stores.useLabelStore.getState().labels.label1.name).toBe(title+' LABEL')
  expect(h.repo.labels.findByTaskId('t1').map((row: { id: string }) => row.id)).toEqual(['label1'])
  expect(h.stores.useTaskStore.getState().taskLabels.t1.map((row: { id: string }) => row.id)).toEqual(['label1'])
  expect(h.repo.projects.findById('p1').name).toBe(title+' PROJECT')
  expect(h.stores.useProjectStore.getState().projects.p1.name).toBe(title+' PROJECT')
  expect(h.stores.useTaskStore.getState().tasks.t0).toBeUndefined()
  expect(h.stores.useStatusStore.getState().statuses.s0).toBeUndefined()
  expect(h.stores.useLabelStore.getState().projectLabels.p0).toBeUndefined()
  expect(h.stores.useProjectStore.getState().projects.p0).toBeUndefined()
  expect(h.requests.filter((row: { method: string; url: string }) => row.method !== 'GET' && !row.url.includes('/rpc/'))).toEqual([])
  expect(h.maxConcurrent()).toBe(1)
  expect(h.fixtureErrors).toEqual([])
}

it.each(['tasks', 'statuses', 'activity_log', 'project_labels'].flatMap(table => ['P first', 'Q first'].flatMap(order => ['timer', 'HTTP'].map(boundary => ({ table, order, boundary })))))(
  'keeps both origins for $table ($order, eviction at $boundary)', async ({ table, order, boundary }) => {
    const { h, channels } = await setup(), pause = gate()
    changeRemote(h, 0); changeRemote(h, 1)
    for (const id of order === 'P first' ? ['p0', 'p1'] : ['p1', 'p0']) channels.get(id)!.emit(table, 'UPDATE', { id: id === 'p0' ? 't0' : 't1', project_id: id, task_id: id === 'p0' ? 't0' : 't1' })
    let draining: Promise<void> | undefined
    if (boundary === 'HTTP') {
      h.beforeRequest(async () => { pause.enter(); await pause.wait })
      draining = h.runTimers()
      await pause.entered
    }
    await evict(h)
    if (draining) { pause.release(); await draining } else await h.runTimers()
    await h.untilIdle()
    expectFreshQ(h)
    expect(h.repo.tasks.findById('t0').title).toBe('OLD 0')
  })

it.each(['P first', 'Q first'])('retains per-project pending followups behind a held Q job ($order)', async order => {
  const { h, origins } = await setup(), pause = gate()
  changeRemote(h, 1, 'INTERMEDIATE')
  const original = h.repo.tasks.applyRemoteTask.bind(h.repo.tasks); let held = false
  h.repo.tasks.applyRemoteTask = async (input: { id: string }) => {
    const row = original(input)
    if (input.id === 't1' && !held) { held = true; pause.enter(); await pause.wait }
    return row
  }
  const first = h.services.personal.requestProjectRefresh(origins.get('p1'), ['p1'], new Map([['p1', ['t1']]]))
  await pause.entered
  changeRemote(h, 0); changeRemote(h, 1, 'LATEST Q', '2030-01-02T00:00:00.000Z')
  const pending: Promise<void>[] = []
  for (const id of order === 'P first' ? ['p0', 'p1'] : ['p1', 'p0']) pending.push(h.services.personal.requestProjectRefresh(origins.get(id), [id], new Map([[id, [id === 'p0' ? 't0' : 't1']]])))
  await h.untilIdle(); await evict(h)
  pause.release(); await Promise.all([first, ...pending]); await h.untilIdle()
  expectFreshQ(h, 'LATEST Q')
  expect(h.repo.tasks.findById('t0').title).toBe('OLD 0')
})

it('accepts a fresh rejoined P origin while its older queued origin remains canceled', async () => {
  const { h, origins } = await setup(), pause = gate()
  h.beforeRequest(async () => { pause.enter(); await pause.wait })
  const first = h.services.personal.requestProjectRefresh(origins.get('p1'), ['p1'])
  await pause.entered
  const stale = h.services.personal.requestProjectRefresh(origins.get('p0'), ['p0'])
  for (let i = 0; i < 5; i++) await new Promise(setImmediate)
  await evict(h)
  changeRemote(h, 0, 'REJOINED')
  await h.services.shared.subscribeToProject('p0')
  const fresh = h.channels.filter((row: { topic: string; closed: boolean }) => row.topic === 'project:p0' && !row.closed).at(-1)
  fresh.emit('project_members', 'INSERT', { project_id: 'p0', user_id: 'u' })
  for (let i = 0; i < 5; i++) await new Promise(setImmediate)
  const follow = h.services.personal.requestProjectRefresh(origins.get('p0'), ['p0'], new Map([['p0', ['t0']]]))
  pause.release(); await Promise.all([first, stale, follow]); await h.untilIdle()
  expect(h.repo.tasks.findById('t0').title).toBe('REJOINED')
  expect(h.stores.useTaskStore.getState().tasks.t0.title).toBe('REJOINED')
  expect(h.maxConcurrent()).toBe(1)
  expect(h.fixtureErrors).toEqual([])
})

async function flushDebounce(h: Awaited<ReturnType<typeof makeHarness>>): Promise<void> {
  const jobs = [...h.timers].filter(([, job]: [unknown, { ms: number }]) => job.ms === 250)
  for (const [id, job] of jobs) { h.timers.delete(id); void job.fn() }
  for (let i = 0; i < 5; i++) await new Promise(setImmediate)
}
function requestCounts(h: Awaited<ReturnType<typeof makeHarness>>): Record<string, number> {
  return h.requests.filter((row: { method: string }) => row.method === 'GET').reduce((counts: Record<string, number>, row: { table: string }) => { counts[row.table] = (counts[row.table] ?? 0) + 1; return counts }, {})
}
async function batchedFollowups(batches: number, invalidate = false, firstProject = 'p0') {
  const { h, channels } = await setup(), pause = gate()
  changeRemote(h, 0); changeRemote(h, 1)
  const tasks: string[] = []
  for (let i = 0; i < 3; i++) {
    const task = h.repo.tasks.create({ id: 'batch-'+i, project_id: 'p1', owner_id: 'u', status_id: 's1', title: 'UNCHANGED '+i })
    h.remote.tasks.push({ ...task }); tasks.push(task.id)
  }
  h.beforeRequest(async () => { pause.enter(); await pause.wait })
  channels.get(firstProject)!.emit('tasks', 'UPDATE', { id: firstProject === 'p0' ? 't0' : 't1', project_id: firstProject })
  await flushDebounce(h); await pause.entered
  for (let i = 0; i < batches; i++) {
    const ids = batches === 1 ? tasks : [tasks[i % tasks.length]]
    for (const id of ids) {
      h.remote.task_labels.push({ task_id: id, label_id: 'label1', deleted_at: null })
      channels.get('p1')!.emit('tasks', 'UPDATE', { id, project_id: 'p1' })
    }
    if (invalidate) channels.get('p0')!.emit('tasks', 'UPDATE', { id: 't0', project_id: 'p0' })
    await flushDebounce(h)
  }
  if (invalidate) await evict(h)
  pause.release(); await h.untilIdle()
  if (invalidate) expectFreshQ(h)
  else {
    expect(h.stores.useTaskStore.getState().tasks.t0.title).toBe(firstProject === 'p0' ? 'FRESH 0' : 'OLD 0')
    expect(h.stores.useTaskStore.getState().tasks.t1.title).toBe('FRESH 1')
  }
  for (const id of tasks) {
    expect(h.repo.labels.findByTaskId(id).map((row: { id: string }) => row.id)).toEqual(['label1'])
    expect(h.stores.useTaskStore.getState().taskLabels[id].map((row: { id: string }) => row.id)).toEqual(['label1'])
  }
  expect(h.maxConcurrent()).toBe(1)
  expect(h.fixtureErrors).toEqual([])
  return requestCounts(h)
}
it('coalesces separate debounce batches from the same channel into one complete pending followup', async () => {
  const control = await batchedFollowups(1, false, 'p1')
  const staggered = await batchedFollowups(3, false, 'p1')
  expect(staggered).toEqual(control)
  expect(staggered.projects).toBe(2)
})
it.each(['p0', 'p1'])('preserves independent origins while coalescing staggered batches behind %s', async firstProject => {
  const control = await batchedFollowups(1, true, firstProject)
  const staggered = await batchedFollowups(3, true, firstProject)
  expect(staggered).toEqual(control)
})
