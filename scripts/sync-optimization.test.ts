import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
import type { createRepositories } from '../src/main/repositories'
import type { Project, Task } from '../src/shared/types'

type Stores = {
  useAuthStore: typeof import('../src/renderer/src/shared/stores/authStore').useAuthStore
  useSyncStore: typeof import('../src/renderer/src/shared/stores/syncStore').useSyncStore
  useTaskStore: typeof import('../src/renderer/src/shared/stores/taskStore').useTaskStore
  useProjectStore: typeof import('../src/renderer/src/shared/stores/projectStore').useProjectStore
  useViewStore: typeof import('../src/renderer/src/shared/stores/viewStore').useViewStore
  useTimerStore: typeof import('../src/renderer/src/shared/stores/timerStore').useTimerStore
}
interface Channel {
  topic: string
  closed: boolean
  bindings: Array<{ filter: { table: string } }>
  status(status: string): void
  emit(table: string, event?: string, row?: Record<string, unknown>): void
}
interface Harness {
  repo: ReturnType<typeof createRepositories>
  stores: Stores
  projects: Project[]
  remote: Record<string, Array<Record<string, unknown>>>
  services: {
    personal: typeof import('../src/renderer/src/services/PersonalSyncService')
    shared: typeof import('../src/renderer/src/services/SyncService')
    user: typeof import('../src/renderer/src/services/UserChannelService')
    refresh: typeof import('../src/renderer/src/services/remoteProjectRefresh')
  }
  channels: Channel[]
  requests: Array<{ table: string; method: string; url: string; body: unknown }>
  logs: unknown[]
  context(): Promise<import('../src/renderer/src/services/syncContext').SyncContext>
  run(): Promise<() => void>
  untilIdle(): Promise<void>
  runTimers(): Promise<void>
  runIntervals(): Promise<void>
  changeConnected(value: boolean): void
  setSuspended(value: boolean): void
  setAccount(value: string): void
  beforeRequest(callback: () => Promise<void>): void
  maxConcurrent(): number
  stop(): Promise<void>
}
const require = createRequire(import.meta.url)
const fixture = require('./benchmark-sync.cjs') as {
  makeHarness(options: { projectCount: number; archived?: number; shared?: number; connected?: boolean }): Promise<Harness>
  trafficScenario(options: { projectCount: number; connected: boolean; archived?: number; flaps?: number }): Promise<{ timerRequests: number; activeFallbackIntervals: number; initialRequests: number }>
  eventScenario(options: { projectCount: number; shared: boolean }): Promise<{ requests: number; extraNextTimerRequests: number; remoteWrites: number; requestsByTable: Record<string, number> }>
  behaviorScenarios(): Promise<Array<{ name: string; passed: boolean; error?: string }>>
}
const opened: Harness[] = []
async function make(options: Parameters<typeof fixture.makeHarness>[0]): Promise<Harness> {
  const harness = await fixture.makeHarness(options)
  opened.push(harness)
  return harness
}
afterEach(async () => { for (const harness of opened.splice(0)) await harness.stop() })
function active(h: Harness, topic: string): Channel {
  return h.channels.filter(channel => channel.topic === topic && !channel.closed).at(-1)!
}
const tables = (channel: Channel): string[] => channel.bindings.map(binding => binding.filter.table)
const reads = (h: Harness, table: string): number => h.requests.filter(row => row.method === 'GET' && row.table === table).length
const stamp = '2030-01-01T00:00:00.000Z'

it.each(['duplicate', 'template', 'recurrence'].flatMap(kind => [false, true].map(shared => ({ kind, shared }))))('publishes every $kind descendant and its labels with shared=$shared', async ({kind, shared}) => {
  const h = await make({ projectCount: 1, shared: shared ? 1 : 0 })
  h.repo.labels.create({ id: 'label', user_id: 'u', name: 'Synthetic label' })
  const originals: Task[] = []
  for (const [id, parent_id] of [['root', null], ['child', 'root'], ['grandchild', 'child']] as const) {
    const task = h.repo.tasks.create({ id, parent_id, owner_id: 'u', project_id: 'p0', status_id: 's0', title: id, recurrence_rule: id === 'root' ? 'every:1:days' : null, due_date: '2026-10-31' })
    h.repo.tasks.addLabel(id, 'label')
    originals.push(task)
  }
  if (kind === 'duplicate') h.repo.tasks.update('child', { is_archived: 1 })
  h.remote.user_labels.push({ ...h.repo.labels.findById('label') })
  h.remote.project_labels.push({ project_id: 'p0', label_id: 'label', created_at: stamp, deleted_at: null })
  h.remote.tasks.push(...originals.map(row => ({ ...row })))
  h.stores.useTaskStore.setState({ tasks: Object.fromEntries(originals.map(row => [row.id, row])) })
  const store = h.stores.useTaskStore.getState()
  let root: Task | null
  if (kind === 'duplicate') root = await store.duplicateTask('root', 'copy')
  else if (kind === 'template') root = await store.saveTaskAsTemplate('root', 'template')
  else {
    await store.updateTask('root', { status_id: 'done0' })
    const id = h.stores.useTaskStore.getState().lastRecurringClone!.taskId
    root = h.repo.tasks.findById(id)!
  }
  await h.untilIdle()
  const child = h.repo.tasks.findSubtasks(root!.id, true)[0]
  const grandchild = h.repo.tasks.findSubtasks(child.id, true)[0]
  const ids = [root!.id, child.id, grandchild.id]
  for (const id of ids) {
    expect(h.remote.tasks.some(row => row.id === id)).toBe(true)
    expect(h.remote.task_labels.some(row => row.task_id === id && row.label_id === 'label'),JSON.stringify(h.logs)).toBe(true)
    expect(h.stores.useTaskStore.getState().taskLabels[id]?.map(label => label.id)).toEqual(['label'])
  }
  const writes = h.requests.filter(row => row.table === 'tasks' && row.method === 'POST').flatMap(row => (Array.isArray(row.body) ? row.body : [row.body]) as Array<{ id: string }>).map(row => row.id)
  expect(ids.map(id => writes.indexOf(id))).toEqual([...ids.map(id => writes.indexOf(id))].sort((a, b) => a - b))
  expect(h.repo.syncQueue.findAll().filter(entry => entry.table_name === 'tasks' && ids.includes(entry.row_id)), JSON.stringify(h.logs)).toEqual([])
})

it('cancels subtree publication when the originating account changes during the first write', async () => {
  const h = await make({ projectCount: 1, shared: 1 })
  h.repo.tasks.create({ id: 'root', owner_id: 'u', project_id: 'p0', status_id: 's0', title: 'Root' })
  h.repo.tasks.create({ id: 'child', parent_id: 'root', owner_id: 'u', project_id: 'p0', status_id: 's0', title: 'Child' })
  let entered!: () => void, finish!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  h.beforeRequest(() => { entered(); return new Promise(resolve => { finish = resolve }) })
  const pending = h.stores.useTaskStore.getState().duplicateTask('root', 'copy')
  const cancelled = expect(pending).rejects.toThrow(/account|database/i)
  await started
  h.setAccount('other')
  finish()
  await cancelled
  expect(h.remote.tasks.filter(row => row.parent_id === 'copy')).toEqual([])
  expect(h.stores.useTaskStore.getState().tasks).toEqual({})
})

it('fences descendant publication when the database changes but the account ID stays the same', async () => {
  const h = await make({ projectCount: 1, shared: 1 })
  h.repo.tasks.create({ id: 'root', owner_id: 'u', project_id: 'p0', status_id: 's0', title: 'Root' })
  h.repo.tasks.create({ id: 'child', parent_id: 'root', owner_id: 'u', project_id: 'p0', status_id: 's0', title: 'Child' })
  let entered!: () => void, finish!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  h.beforeRequest(() => { entered(); return new Promise(resolve => { finish = resolve }) })
  const pending = h.stores.useTaskStore.getState().duplicateTask('root', 'copy')
  const cancelled = expect(pending).rejects.toThrow(/database/i)
  await started
  h.setAccount('u')
  const current = { id:'new-database-task',owner_id:'u',title:'New database task' } as Task
  h.stores.useTaskStore.setState({ tasks:{[current.id]:current},taskLabels:{} })
  finish()
  await cancelled
  expect(h.remote.tasks.filter(row => row.parent_id === 'copy')).toEqual([])
  expect(h.stores.useTaskStore.getState().tasks).toEqual({[current.id]:current})
  expect(h.stores.useTaskStore.getState().taskLabels).toEqual({})
})

it('discovers missed shared memberships and removes lost access before project sweeps while preserving local owner data', async () => {
  const h = await make({ projectCount: 1, shared: 1 })
  await h.services.user.subscribeToUserChannel('u')
  await h.services.personal.requestSyncCatchUp(await h.context())
  const old = active(h, 'project:p0')
  h.stores.useViewStore.getState().setSelectedProject('p0')
  h.repo.projects.create({ id: 'pending-owner', owner_id: 'u', name: 'Pending local data' })
  h.repo.projects.addMember('pending-owner','u','owner')
  h.repo.statuses.create({ id: 'pending-status', project_id: 'pending-owner', name: 'Open' })
  h.repo.tasks.create({ id: 'pending-task', project_id: 'pending-owner', status_id: 'pending-status', owner_id: 'u', title: 'Pending owner task' })
  h.setSuspended(true)
  old.status('SUBSCRIBED')
  h.remote.project_members = h.remote.project_members.filter(row => row.user_id !== 'u')
  h.remote.projects.push({ ...h.projects[0], id: 'new-project', name: 'New shared project', updated_at: stamp })
  h.remote.project_members.push({ project_id: 'new-project', user_id: 'u', role: 'member' }, { project_id: 'new-project', user_id: 'other', role: 'owner' })
  h.remote.statuses.push({ ...h.repo.statuses.findById('s0'), id: 'new-status', project_id: 'new-project' })
  h.remote.tasks.push({ id: 'new-task', owner_id: 'other', project_id: 'new-project', status_id: 'new-status', title: 'New task', created_at: stamp, updated_at: stamp })
  h.setSuspended(false)
  await h.services.shared.forceReconnectAllShared()
  expect(h.repo.projects.getProjectsForUser('u').map(row => row.id).sort()).toEqual(['new-project', 'pending-owner'])
  expect(h.repo.tasks.findById('new-task')?.title).toBe('New task')
  expect(h.repo.tasks.findById('pending-task')?.title).toBe('Pending owner task')
  expect(old.closed).toBe(true)
  expect(active(h, 'project:new-project')).toBeDefined()
  expect(h.stores.useViewStore.getState().selectedProjectId).not.toBe('p0')
})

it.each([false, true])('rebinds missed archive/restore transitions for shared=%s and retains metadata-only monitoring', async shared => {
  const h = await make({ projectCount: 1, shared: shared ? 1 : 0, archived: 1 })
  await h.services.user.subscribeToUserChannel('u')
  await h.services.personal.requestSyncCatchUp(await h.context())
  const topic = `${shared ? 'project' : 'personal'}:p0`
  const archived = active(h, topic)
  expect(tables(archived)).toEqual(['projects'])
  h.setSuspended(true)
  h.remote.projects[0] = { ...h.remote.projects[0], is_archived: 0, archive_updated_at: stamp, updated_at: stamp }
  archived.status('SUBSCRIBED')
  h.setSuspended(false)
  await h.services.personal.requestSyncCatchUp(await h.context())
  const restored = active(h, topic)
  expect(restored).not.toBe(archived)
  expect(tables(restored)).toContain('tasks')
  expect(tables(restored)).toContain('activity_log')
  h.remote.tasks.push({ id: 'late-task', owner_id: 'u', project_id: 'p0', status_id: 's0', title: 'After restore', created_at: stamp, updated_at: stamp })
  restored.emit('tasks', 'INSERT', h.remote.tasks[0])
  await h.runTimers()
  await h.untilIdle()
  expect(h.repo.tasks.findById('late-task')?.title, JSON.stringify(h.logs)).toBe('After restore')
  const nextStamp = '2030-01-02T00:00:00.000Z'
  h.remote.projects[0] = { ...h.remote.projects[0], is_archived: 1, archive_updated_at: nextStamp, updated_at: nextStamp }
  await h.services.personal.requestSyncCatchUp(await h.context())
  expect(tables(active(h, topic))).toEqual(['projects'])
  h.requests.length = 0
  h.services.refresh.scheduleRemoteProjectRefresh('p0', await h.context())
  await h.runTimers()
  expect(reads(h, 'projects')).toBe(1)
  expect(reads(h, 'tasks')).toBe(0)
  expect(reads(h, 'statuses')).toBe(0)
  expect(reads(h, 'activity_log')).toBe(0)
  expect(reads(h, 'project_labels')).toBe(0)
  await h.services.personal.reconcile('u')
  expect(reads(h, 'tasks')).toBeGreaterThan(0)
  expect(reads(h, 'statuses')).toBeGreaterThan(0)
})

it('coalesces App health recovery, channel rejoins and project refresh behind one in-flight sweep', async () => {
  const h = await make({ projectCount: 2, shared: 1 })
  const cleanup = await h.run()
  try {
    await h.untilIdle()
    h.requests.length = 0
    let entered!: () => void, finish!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    h.beforeRequest(() => { entered(); return new Promise(resolve => { finish = resolve }) })
    const first = h.services.personal.requestSyncCatchUp(await h.context())
    await started
    for (const channel of h.channels.filter(channel => !channel.closed)) channel.status('SUBSCRIBED')
    h.changeConnected(false); h.changeConnected(true)
    h.services.refresh.scheduleRemoteProjectRefresh('p0', await h.context())
    const timers = h.runTimers()
    await new Promise(setImmediate)
    expect(reads(h, 'project_members')).toBe(0)
    finish()
    await Promise.all([first, timers]); await h.untilIdle()
    expect(h.maxConcurrent()).toBe(1)
    const ownMembershipReads = h.requests.filter(row => row.table === 'project_members' && new URL(row.url).searchParams.get('user_id') === 'eq.u')
    expect(ownMembershipReads.length).toBeLessThanOrEqual(2)
    expect(ownMembershipReads.length).toBeGreaterThan(0)
  } finally { cleanup() }
})

it('tears down shared channels and rebinds the same project for a different account', async () => {
  const h = await make({ projectCount: 1, shared: 1 })
  const cleanup = await h.run()
  await h.untilIdle()
  const original = active(h, 'project:p0')
  cleanup()
  await h.untilIdle()
  expect(original.closed).toBe(true)
  h.setAccount('other')
  const cleanupNext = await h.run()
  try {
    await h.untilIdle()
    const rebound = active(h, 'project:p0')
    expect(rebound).toBeDefined()
    expect(rebound).not.toBe(original)
    expect(h.stores.useAuthStore.getState().currentUser?.id).toBe('other')
  } finally { cleanupNext() }
})

it('does no healthy fallback work and defers suspended/offline catch-up', async () => {
  const result = await fixture.trafficScenario({ projectCount: 2, connected: true })
  expect(result.initialRequests).toBeGreaterThan(0)
  expect(result.timerRequests).toBe(0)
  expect(result.activeFallbackIntervals).toBe(0)
  for (const result of await fixture.behaviorScenarios()) expect(result.passed, `${result.name}: ${result.error ?? ''}`).toBe(true)
})

it.each([false, true])('keeps a routine task event scoped to one of20 projects with shared=%s', async shared => {
  const result = await fixture.eventScenario({ projectCount: 20, shared })
  expect(result.requests).toBeLessThanOrEqual(7)
  expect(result.requestsByTable['GET projects']).toBe(1)
  expect(result.requestsByTable['GET statuses']).toBe(1)
  expect(result.requestsByTable['GET tasks']).toBe(1)
  expect(result.requestsByTable['GET activity_log']).toBe(1)
  expect(result.requestsByTable['GET project_members']).toBeUndefined()
  expect(result.extraNextTimerRequests).toBe(0)
  expect(result.remoteWrites).toBe(0)
})

it.each(['other', 'u'])('drains new recovery after an old scoped pull loses its account/database context (%s)', async nextAccount => {
  const h = await make({ projectCount: 1 })
  const cleanup = await h.run()
  try {
    await h.untilIdle()
    let entered!: () => void, finish!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    h.beforeRequest(() => { entered(); return new Promise(resolve => { finish = resolve }) })
    const old = h.services.personal.requestProjectRefresh(await h.context(), ['p0'])
    void old.catch(() => {})
    await started
    h.setAccount(nextAccount)
    h.remote.user_labels.push({ id: 'new-context-label', user_id: nextAccount, name: 'New context data', color: '#123456', order_index: 0, created_at: stamp, updated_at: stamp, deleted_at: null })
    const current = h.services.personal.requestSyncCatchUp(await h.context())
    void current.catch(() => {})
    for (let i = 0; i < 5; i++) await new Promise(setImmediate)
    finish()
    const results = await Promise.allSettled([old, current])
    await h.untilIdle()
    expect(results[1].status, JSON.stringify(results)).toBe('fulfilled')
    expect(h.repo.labels.findById('new-context-label')?.name).toBe('New context data')
    expect(h.maxConcurrent()).toBe(1)
  } finally { cleanup() }
})

it.each([10830, 172830])('consumes all %s elapsed seconds across valid perpetual timer phases', async elapsed => {
  const h = await make({ projectCount: 1 })
  h.repo.tasks.create({ id: 'synthetic-task', project_id: 'p0', owner_id: 'u', status_id: 's0', title: 'Synthetic timer task' })
  const timer = h.stores.useTimerStore.getState()
  timer.startTimer({ taskId: 'synthetic-task', taskTitle: 'Synthetic timer', minutes: 1, breakMinutes: 1, reps: 1, isPerpetual: true, autoBreak: true, soundEnabled: false, notificationEnabled: false, userId: 'u', longBreakInterval: 0 })
  timer.tick(elapsed)
  const state = h.stores.useTimerStore.getState()
  expect(state.isPaused).toBe(false)
  expect(state.phase).toBe('work')
  expect(state.remainingSeconds).toBe(30)
  expect(state.currentRep).toBe(Math.floor(elapsed / 120) + 1)
  expect(state.sessionsCompleted).toBe(Math.floor(elapsed / 120))
  expect(state.totalFocusSecondsToday).toBe(Math.floor(elapsed / 120) * 60)
  state.stop()
})

it('stops finite timers normally and guards only zero-progress perpetual transitions', async () => {
  const h = await make({ projectCount: 1 })
  h.repo.tasks.create({ id: 'synthetic-task', project_id: 'p0', owner_id: 'u', status_id: 's0', title: 'Synthetic timer task' })
  const timer = h.stores.useTimerStore.getState()
  const params = { taskId: 'synthetic-task', taskTitle: 'Synthetic timer', minutes: 1, breakMinutes: 1, reps: 3, isPerpetual: false, autoBreak: true, soundEnabled: false, notificationEnabled: false, userId: 'u' }
  timer.startTimer(params); timer.tick(3600)
  expect(h.stores.useTimerStore.getState().isRunning).toBe(false)
  timer.startTimer({ ...params, minutes: 0, breakMinutes: 0, isPerpetual: true }); timer.tick(3600)
  expect(h.stores.useTimerStore.getState().isPaused).toBe(true)
  timer.stop()
})

it('retains long-break cadence across hundreds of delayed timer repetitions', async () => {
  const h = await make({ projectCount: 1 })
  h.repo.tasks.create({ id:'synthetic-task',project_id:'p0',owner_id:'u',status_id:'s0',title:'Synthetic timer task' })
  const timer = h.stores.useTimerStore.getState()
  timer.startTimer({ taskId:'synthetic-task',taskTitle:'Synthetic timer',minutes:1,breakMinutes:1,longBreakMinutes:5,longBreakInterval:3,reps:1,isPerpetual:true,autoBreak:true,soundEnabled:false,notificationEnabled:false,userId:'u' })
  // Each three-repetition block consumes 3*60 work + 2*60 short + 300 long = 600 seconds.
  timer.tick(200*600 + 60 + 20)
  const state = h.stores.useTimerStore.getState()
  expect(state.isRunning).toBe(true)
  expect(state.isPaused).toBe(false)
  expect(state.phase).toBe('break')
  expect(state.isLongBreak).toBe(false)
  expect(state.remainingSeconds).toBe(40)
  expect(state.currentRep).toBe(601)
  expect(state.sessionsCompleted).toBe(601)
  expect(state.totalFocusSecondsToday).toBe(601*60)
  timer.stop()
})
