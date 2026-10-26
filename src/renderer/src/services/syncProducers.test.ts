import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { migrations } from '../../../main/database/migrations'
import { createRepositories } from '../../../main/repositories'
import { useAuthStore } from '../shared/stores/authStore'
import { useSyncStore } from '../shared/stores/syncStore'
import { requireSession } from './sessionRecovery'
import { syncTaskChange, syncStatusChange, setOnlineStatus, syncProjectDown } from './SyncService'
import { syncIfShared } from '../shared/stores/taskStore'
import { pullProjectMetadata, pullNewTasks, pullStatuses, pullTaskLabelsForTask, fullPull, pushTask, pushStatus, pushLabel, pushProjectLabel, pushSetting, pushSavedView } from './PersonalSyncService'

const network = vi.hoisted(() => ({ client: null as unknown, token: null as null | (() => Promise<string>) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn((_url, _key, options) => { network.token = options.accessToken; return network.client }) }))
vi.mock('./sessionRecovery', () => ({ requireSession: vi.fn() }))
vi.mock('../shared/stores/logStore', () => ({ logEvent: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
let repos: ReturnType<typeof createRepositories>[]
let databases: DatabaseSync[]
let active: number
let generation: number
let stage: string
let pause: ReturnType<typeof deferred>
let started: ReturnType<typeof deferred>
let writes: number
let enqueues: number
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('navigator', { onLine: true })
  setOnlineStatus(true)
  active = 0; generation = 1; stage = 'auth'; writes = 0; enqueues = 0
  pause = deferred(); started = deferred(); network.token = null
  databases = [new DatabaseSync(':memory:'), new DatabaseSync(':memory:')]
  repos = databases.map((db, index) => {
    db.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)')
    for (const migrate of migrations) migrate(db)
    const repo = createRepositories(db)
    const userId = index ? 'b' : 'a'
    repo.users.create({ id: userId, email: `${userId}@example.invalid`, display_name: null, avatar_url: null })
    repo.projects.create({ id: 'p', name: 'Private project', owner_id: userId })
    repo.statuses.create({ id: 's', project_id: 'p', name: 'Open' })
    repo.labels.create({ id: 'l', user_id: userId, name: 'Private label' })
    if (!index) repo.tasks.create({ id: 't', project_id: 'p', status_id: 's', owner_id: userId, title: 'A secret title', description: 'A secret description' })
    return repo
  })
  useAuthStore.setState({ currentUser: { id: 'a' } as never })
  useSyncStore.setState({ status: 'synced', pendingCount: 0, errorMessage: null })
  vi.stubGlobal('window', { api: {
    auth: { getSupabaseConfig: async () => ({ url: 'https://example.invalid', anonKey: 'synthetic' }) },
    sync: {
      captureContext: async () => ({ userId: active ? 'b' : 'a', generation }),
      count: async () => repos[active].syncQueue.count(),
      invokeContext: async (context: { generation: number; userId: string }, channel: string, args: unknown[]) => {
        if (stage === 'enqueue' && channel === 'sync:enqueue') { started.resolve(); await pause.promise }
        if (context.generation !== generation || context.userId !== (active ? 'b' : 'a')) throw new Error('Sync database changed')
        const [namespace, method] = channel.split(':')
        if (namespace === 'sync') {
          if (method === 'enqueue') { enqueues++; return repos[active].syncQueue.enqueue(...args as Parameters<typeof repos[0]['syncQueue']['enqueue']>) }
          if (method === 'getQueue') return repos[active].syncQueue.findAll()
          if (method === 'dequeue') return repos[active].syncQueue.dequeue(String(args[0]))
          if (method === 'count') return repos[active].syncQueue.count()
        }
        const target = repos[active][namespace as keyof typeof repos[0]] as unknown as Record<string, (...args: unknown[]) => unknown>
        return target[method](...args)
      }
    }
  } })
  vi.mocked(requireSession).mockImplementation(async () => {
    if (stage === 'auth') { started.resolve(); await pause.promise; return null }
    return { user: { id: 'a' }, access_token: 'synthetic-a' } as Session
  })
  network.client = { from(table: string) {
    let operation = 'select'
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'in', 'order', 'limit', 'or', 'lte']) chain[method] = () => chain
    for (const method of ['update', 'upsert', 'delete']) chain[method] = () => { operation = method; return chain }
    chain.maybeSingle = async () => {
      await network.token!()
      started.resolve(); await pause.promise
      return { data: { name: 'A secret project', is_archived: 1, updated_at: '2099-01-01T00:00:00Z' }, error: null }
    }
    chain.single = chain.maybeSingle
    chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (async () => {
      await network.token!()
      if (operation !== 'select') {
        writes++
        if (stage === 'failure') { started.resolve(); await pause.promise }
        return { data: table === 'projects' ? [{ id: 'p' }] : [], error: { message: 'synthetic write failure', code: '503' } }
      }
      if (stage === 'pull') {
        started.resolve(); await pause.promise
        const data = table === 'statuses' ? [{ ...repos[0].statuses.findById('s'), name: 'A secret status', updated_at: '2099-01-01T00:00:00Z' }]
          : table === 'user_labels' ? [{ ...repos[0].labels.findById('l'), name: 'A secret label' }]
          : table === 'task_labels' ? [{ task_id: 't', label_id: 'l' }]
          : table === 'tasks' ? [repos[0].tasks.findById('t')] : []
        return { data, error: null }
      }
      return { data: [], error: null }
    })().then(resolve, reject)
    return chain
  }, rpc: async () => { await network.token!(); return { data: null, error: null } } } as unknown as SupabaseClient
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); for (const db of databases) db.close() })

const producers = ['task', 'status', 'label', 'project-label', 'setting', 'saved-view', 'shared-task', 'shared-status', 'shared-delete-task', 'shared-delete-status', 'shared-route']
async function invoke(kind: string) {
  const repo = repos[0]
  if (kind === 'task') return pushTask(repo.tasks.findById('t')!)
  if (kind === 'status') return pushStatus(repo.statuses.findById('s')!)
  if (kind === 'label') return pushLabel(repo.labels.findById('l')!, 'a')
  if (kind === 'project-label') return pushProjectLabel('p', 'l', null)
  if (kind === 'shared-task') return syncTaskChange(repo.tasks.findById('t')!, 'UPDATE')
  if (kind === 'shared-status') return syncStatusChange(repo.statuses.findById('s')!, 'UPDATE')
  if (kind === 'shared-delete-task') return syncTaskChange(repo.tasks.findById('t')!, 'DELETE')
  if (kind === 'shared-delete-status') return syncStatusChange(repo.statuses.findById('s')!, 'DELETE')
  if (kind === 'shared-route') { repo.projects.update('p', { is_shared: 1 }); return syncIfShared(repo.tasks.findById('t')!, 'UPDATE') }
  if (kind === 'saved-view') return pushSavedView({ id: 'v', user_id: 'a', name: 'A secret view', filter_config: '{}', project_id: 'p', sidebar_order: 0, color: null })
  pushSetting('theme', 'A secret setting', 'a')
  await vi.advanceTimersByTimeAsync(5000)
}
it.each(producers.flatMap((kind) => ['auth', 'failure', 'enqueue'].flatMap((phase) => ['account', 'database'].map((change) => ({ kind, phase, change })))))(
  'isolates $kind during $phase across a $change switch', async ({ kind, phase, change }) => {
    stage = phase
    const operation = invoke(kind)
    await started.promise
    active = 1; generation++
    if (change === 'account') useAuthStore.setState({ currentUser: { id: 'b' } as never })
    useSyncStore.setState({ status: 'synced', pendingCount: 0, errorMessage: null })
    pause.resolve()
    await operation
    await vi.advanceTimersByTimeAsync(1)
    expect(repos[0].syncQueue.count()).toBe(0)
    expect(repos[1].syncQueue.count()).toBe(0)
    expect(enqueues).toBe(0)
    expect(repos[1].tasks.findById('t')).toBeUndefined()
    expect(useSyncStore.getState().errorMessage).toBeNull()
    if (phase === 'auth') expect(writes).toBe(0)
  }
)
it.each(producers.filter((kind) => kind !== 'saved-view'))('retains ordinary offline %s writes in the originating queue', async (kind) => {
  pause.resolve()
  await invoke(kind)
  await vi.advanceTimersByTimeAsync(1)
  expect(repos[0].syncQueue.count()).toBeGreaterThan(0)
  expect(repos[1].syncQueue.count()).toBe(0)
})

it.each(['metadata', 'tasks', 'statuses', 'task-labels', 'startup', 'fullPull'].flatMap((kind) => ['account', 'database'].map((change) => ({ kind, change }))))(
  'binds implicit-context $kind pulls before a $change switch', async ({ kind, change }) => {
    stage = 'pull'
    const operation = kind === 'metadata' ? pullProjectMetadata('p') : kind === 'tasks' ? pullNewTasks('p') : kind === 'statuses' ? pullStatuses('p')
      : kind === 'task-labels' ? pullTaskLabelsForTask('t') : kind === 'startup' ? syncProjectDown('p', 'a') : fullPull('a')
    await started.promise
    active = 1; generation++
    if (change === 'account') useAuthStore.setState({ currentUser: { id: 'b' } as never })
    useSyncStore.setState({ status: 'synced', pendingCount: 0, errorMessage: null })
    pause.resolve()
    await operation.catch(() => {})
    expect(repos[1].tasks.findById('t')).toBeUndefined()
    expect(repos[1].statuses.findById('s')?.name).toBe('Open')
    expect(repos[1].labels.findById('l')?.name).toBe('Private label')
    expect(repos[1].projects.findById('p')?.is_archived).toBe(0)
    expect(repos[1].syncQueue.count()).toBe(0)
    expect(useSyncStore.getState().errorMessage).toBeNull()
  }
)

it.each(['task', 'status'].flatMap((kind) => ['UPDATE', 'DELETE'].map((operation) => ({ kind, operation }))))(
  'isolates the shared offline $kind/$operation enqueue before main-process execution', async ({ kind, operation }) => {
    setOnlineStatus(false); stage = 'enqueue'
    const pending = kind === 'task' ? syncTaskChange(repos[0].tasks.findById('t')!, operation as 'UPDATE' | 'DELETE')
      : syncStatusChange(repos[0].statuses.findById('s')!, operation as 'UPDATE' | 'DELETE')
    await started.promise
    active = 1; generation++
    useAuthStore.setState({ currentUser: { id: 'b' } as never })
    pause.resolve(); await pending
    expect(repos[0].syncQueue.count()).toBe(0)
    expect(repos[1].syncQueue.count()).toBe(0)
    expect(writes).toBe(0)
  }
)
