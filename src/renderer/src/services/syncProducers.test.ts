import { useStatusStore } from '../shared/stores/statusStore'
import * as TaskBatch from './TaskBatchSyncManager'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { migrations } from '../../../main/database/migrations'
import { createRepositories } from '../../../main/repositories'
import { useAuthStore } from '../shared/stores/authStore'
import { useSyncStore } from '../shared/stores/syncStore'
import { requireSession } from './sessionRecovery'
import { syncTaskChange, syncStatusChange, setOnlineStatus, syncProjectDown, processSyncQueue } from './SyncService'
import { useTaskStore, syncIfShared } from '../shared/stores/taskStore'
import { pullProjectMetadata, pullNewTasks, pullStatuses, pullTaskLabelsForTask, fullPull, pushTask, pushStatus, pushLabel, pushProjectLabel, pushSetting, pushSavedView } from './PersonalSyncService'

const network = vi.hoisted(() => ({ client: null as unknown, token: null as null | (() => Promise<string>) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn((_url, _key, options) => { network.token = options.accessToken; return network.client }) }))
vi.mock('./sessionRecovery', () => ({ requireSession: vi.fn() }))
vi.mock('../shared/stores/logStore', async (importOriginal) => ({ ...await importOriginal<typeof import('../shared/stores/logStore')>(), logEvent: vi.fn() }))
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

const producers = ['task', 'status', 'label', 'project-label', 'setting', 'saved-view', 'shared-task', 'shared-status', 'shared-delete-task', 'shared-route']
async function invoke(kind: string) {
  const repo = repos[0]
  if (kind === 'task') return pushTask(repo.tasks.findById('t')!)
  if (kind === 'status') return pushStatus(repo.statuses.findById('s')!)
  if (kind === 'label') return pushLabel(repo.labels.findById('l')!, 'a')
  if (kind === 'project-label') return pushProjectLabel('p', 'l', null)
  if (kind === 'shared-task') return syncTaskChange(repo.tasks.findById('t')!, 'UPDATE')
  if (kind === 'shared-status') return syncStatusChange(repo.statuses.findById('s')!, 'UPDATE')
  if (kind === 'shared-delete-task') { const task=repo.tasks.findById('t')!;repo.tasks.delete('t');return syncTaskChange(task, 'DELETE') }
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

it.each(['task', 'status'].flatMap((kind) => (kind === 'status' ? ['UPDATE'] : ['UPDATE', 'DELETE']).map((operation) => ({ kind, operation }))))(
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

const storeActions = [
  { name: 'create', channel: 'tasks:create', run: () => useTaskStore.getState().createTask({ id: 'new', project_id: 'p', owner_id: 'a', status_id: 's', title: 'A private new task' }) },
  { name: 'update', channel: 'tasks:update', run: () => useTaskStore.getState().updateTask('t', { title: 'A edit' }) },
  { name: 'status await', channel: 'statuses:findById', run: () => useTaskStore.getState().updateTask('t', { status_id: 's2' }) },
  { name: 'archive hydration', channel: 'tasks:findAllByProject', run: () => useTaskStore.getState().updateTask('t', { is_archived: 1 }) },
  { name: 'delete', channel: 'tasks:delete', run: () => useTaskStore.getState().deleteTask('t') },
  { name: 'duplicate', channel: 'tasks:duplicate', run: () => useTaskStore.getState().duplicateTask('t', 'copy') },
  { name: 'template', channel: 'tasks:saveAsTemplate', run: () => useTaskStore.getState().saveTaskAsTemplate('t', 'template') },
  { name: 'reorder', channel: 'tasks:reorder', run: () => useTaskStore.getState().reorderTasks(['t']) },
  { name: 'subtask', channel: 'tasks:create', run: () => useTaskStore.getState().createSubtask('t', { id: 'child', project_id: 'p', owner_id: 'a', status_id: 's', title: 'Private child' }) },
  { name: 'label add', channel: 'tasks:addLabel', run: () => useTaskStore.getState().addLabel('t', 'l') },
  { name: 'label remove', channel: 'tasks:removeLabel', run: () => useTaskStore.getState().removeLabel('t', 'l') },
  { name: 'bulk update', channel: 'tasks:update', run: () => useTaskStore.getState().bulkUpdateTasks(['t'], { title: 'Private bulk' }) },
  { name: 'bulk delete', channel: 'tasks:delete', run: () => useTaskStore.getState().bulkDeleteTasks(['t']) },
  { name: 'bulk labels add', channel: 'tasks:addLabel', run: () => useTaskStore.getState().bulkAddLabel(['t'], 'l') },
  { name: 'bulk labels remove', channel: 'tasks:removeLabel', run: () => useTaskStore.getState().bulkRemoveLabel(['t'], 'l') },
  { name: 'status delete', channel: 'statuses:delete', run: () => useStatusStore.getState().deleteStatus('s') },
  { name: 'status reassignment', channel: 'statuses:reassignAndDelete', run: () => useStatusStore.getState().reassignAndDelete('s', 's2') }
]
it.each(storeActions.flatMap((action) => ['account', 'database'].map((change) => ({ ...action, change }))))(
  'binds actual store $name before its $channel await across $change changes', async ({ channel, run, change }) => {
    stage = 'store'
    const repo = repos[0]
    repo.statuses.create({ id: 's2', project_id: 'p', name: 'Default', is_default: 1 })
    repo.projects.addMember('p', 'a', 'owner')
    repo.tasks.addLabel('t', 'l')
    useTaskStore.setState({ tasks: { t: repo.tasks.findById('t')! }, taskLabels: { t: [repo.labels.findById('l')!] }, error: null, showDetailPanel: false })
    useStatusStore.setState({ statuses: { s: repo.statuses.findById('s')! }, error: null })
    const invoke = window.api.sync.invokeContext
    let held = false
    window.api.sync.invokeContext = async (context, name, args) => {
      const result = await invoke(context, name, args)
      if (!held && name === channel) { held = true; started.resolve(); await pause.promise }
      return result
    }
    const pending = run()
    await started.promise
    active = 1; generation++
    if (change === 'account') useAuthStore.setState({ currentUser: { id: 'b' } as never })
    useTaskStore.setState({ tasks: {}, taskLabels: {}, error: null })
    useStatusStore.setState({ statuses: {}, error: null })
    pause.resolve()
    await pending.catch(() => {})
    await vi.advanceTimersByTimeAsync(1)
    expect(useTaskStore.getState().tasks).toEqual({})
    expect(useTaskStore.getState().taskLabels).toEqual({})
    expect(useTaskStore.getState().error).toBeNull()
    expect(useStatusStore.getState().statuses).toEqual({})
    expect(useStatusStore.getState().error).toBeNull()
    expect(repos[1].tasks.findById('t')).toBeUndefined()
    expect(repos[1].syncQueue.count()).toBe(0)
    expect(writes).toBe(0)
  }
)
it('keeps a buffered detail edit bound to its originating store/database', async () => {
  stage = 'store'
  const row = repos[0].tasks.findById('t')!
  useTaskStore.setState({ tasks: { t: row }, taskLabels: {}, showDetailPanel: true, lastSelectedTaskId: 't' })
  await useTaskStore.getState().updateTask('t', { title: 'A buffered edit' })
  expect(TaskBatch.isPending('t')).toBe(true)
  active = 1; generation++
  useAuthStore.setState({ currentUser: { id: 'b' } as never })
  useTaskStore.setState({ tasks: {}, taskLabels: {} })
  await TaskBatch.flushAll()
  expect(writes).toBe(0)
  expect(repos[1].syncQueue.count()).toBe(0)
})

it.each(['online', 'offline', 'failure'])('propagates shared task-label additions through the actual junction after %s writes', async (mode) => {
  stage = 'labels'
  const repo = repos[0]
  repo.projects.update('p', { is_shared: 1 })
  repo.labels.applyRemoteProjectLabel({project_id:'p',label_id:'l',created_at:'2020-01-01T00:00:00Z',deleted_at:null})
  repo.tasks.addLabel('t', 'l')
  const junction = new Set(['t:remote-only'])
  const calls: string[] = []
  let failAddition = mode === 'failure'
  network.client = { from(table: string) {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'order', 'limit', 'or']) chain[method] = () => chain
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: [{ label_id: 'l' }], error: null })
    chain.upsert = (rows: unknown) => {
      chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (async () => {
        await network.token!()
        calls.push(table)
        if (table === 'task_labels' && failAddition) return { data: null, error: { message: 'synthetic junction failure' } }
        if (table === 'task_labels') for (const row of rows as Array<{task_id:string;label_id:string}>) junction.add(`${row.task_id}:${row.label_id}`)
        return { data: [], error: null }
      })().then(resolve, reject)
      return chain
    }
    return chain
  } } as unknown as SupabaseClient
  setOnlineStatus(mode !== 'offline')
  await syncTaskChange(repo.tasks.findById('t')!, 'UPDATE')
  if (mode === 'online') {await processSyncQueue();expect(repo.syncQueue.count()).toBe(0)}
  else {
    expect(junction.has('t:l')).toBe(false)
    expect(repo.syncQueue.count()).toBeGreaterThan(0)
    failAddition = false
    setOnlineStatus(true)
    expect(await processSyncQueue()).toBeGreaterThan(0)
    expect(repo.syncQueue.count()).toBe(0)
  }
  expect(junction).toEqual(new Set(['t:remote-only', 't:l']))
  expect(calls).toContain('project_labels')
})

it.each(['online', 'offline', 'failure', 'removed'].flatMap((mode) => ['single', 'bulk'].flatMap((path) => ['existing', 'adopted'].map((resolution) => ({ mode, path, resolution })))))('keeps consolidated additions durable: $mode/$path/$resolution', async ({ mode, path, resolution }) => {
  stage = 'labels'
  const repo = repos[0]
  repo.projects.update('p', { is_shared: 1 })
  const name = resolution === 'existing' ? 'Private label' : 'New foreign label'
  repo.labels.create({ id: 'foreign', user_id: 'other', name })
  const canonical = { ...repo.labels.findById('l')!, id: 'c', name }
  if (path === 'bulk') {
    repo.projects.create({ id: 'p2', name: 'Second', owner_id: 'a' })
    repo.projects.update('p2', { is_shared: 1 })
    repo.statuses.create({ id: 's2', project_id: 'p2', name: 'Open' })
    repo.tasks.create({ id: 't2', project_id: 'p2', status_id: 's2', owner_id: 'a', title: 'Second task' })
  }
  useTaskStore.setState({ tasks: { t: repo.tasks.findById('t')!, ...(path === 'bulk' ? { t2: repo.tasks.findById('t2')! } : {}) }, taskLabels: {}, showDetailPanel: false })
  const palette = new Set<string>(), junction = new Set(['t:remote-only'])
  let fail = mode === 'failure'
  network.client = { from(table: string) {
    let payload: unknown, operation = 'select'
    const filters: Array<(row: Record<string,unknown>)=>boolean> = []
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'order', 'limit', 'or', 'ilike']) chain[method] = () => chain
    chain.eq = (key: string, value: unknown) => { filters.push((row)=>row[key]===value); return chain }
    chain.is = (key: string, value: unknown) => { filters.push((row)=>(row[key]??null)===value); return chain }
    chain.in = (key: string, values: unknown[]) => { filters.push((row)=>values.includes(row[key])); return chain }
    chain.maybeSingle = async () => {
      if (mode === 'removed') {
        const local = repo.labels.findByName('a', name)
        if (local) { repo.labels.removeFromProject('p', local.id); if (path === 'bulk') repo.labels.removeFromProject('p2', local.id) }
      }
      return { data: canonical, error: null }
    }
    chain.upsert = (value: unknown) => { payload = value; operation = 'upsert'; return chain }
    chain.delete = () => { operation = 'delete'; return chain }
    chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (async () => {
      await network.token!()
      const rows: Array<Record<string,unknown>> = table==='user_labels' ? [canonical,{id:'remote-only',name:'Unrelated'}]
        : [...(table==='project_labels'?palette:junction)].map((pair)=>{
          const [parent,label_id]=pair.split(':')
          return table==='project_labels'?{project_id:parent,label_id,created_at:'2000-01-01T00:00:00.000Z',deleted_at:null}:{task_id:parent,label_id,deleted_at:null}
        })
      const selected=rows.filter((row)=>filters.every((filter)=>filter(row)))
      if (operation === 'select') return { data: selected, error: null }
      if (operation === 'delete') {
        if(table!=='task_labels') throw new Error('Unsupported fixture deletion')
        for(const row of selected) junction.delete(`${row.task_id}:${row.label_id}`)
        return {data:[],error:null}
      }
      if (table === 'project_labels' && fail) return { data: null, error: { message: 'synthetic palette failure' } }
      const values = Array.isArray(payload) ? payload : [payload]
      if (table === 'user_labels' && values.some((row) => row.id !== 'c')) return { data: null, error: { message: 'canonical conflict', code: '23505' } }
      if (table === 'project_labels') for (const row of values) { if (row.deleted_at) palette.delete(`${row.project_id}:${row.label_id}`); else palette.add(`${row.project_id}:${row.label_id}`) }
      if (table === 'task_labels') for (const row of values) junction.add(`${row.task_id}:${row.label_id}`)
      return { data: [], error: null }
    })().then(resolve, reject)
    return chain
  } } as unknown as SupabaseClient
  if (mode === 'offline') { setOnlineStatus(false); vi.mocked(requireSession).mockResolvedValue(null) }
  if (path === 'single') await useTaskStore.getState().addLabel('t', 'foreign')
  else await useTaskStore.getState().bulkAddLabel(['t', 't2'], 'foreign')
  await vi.advanceTimersByTimeAsync(1)
  if (mode === 'offline' || mode === 'failure') {
    expect(repo.syncQueue.count()).toBeGreaterThan(0)
    fail = false
    vi.mocked(requireSession).mockResolvedValue({ user: { id: 'a' }, access_token: 'synthetic-a' } as Session)
    setOnlineStatus(true)
    await processSyncQueue()
  }
  for(let drain=0;drain<4 && repo.syncQueue.count();drain++) await processSyncQueue()
  expect(palette).toEqual(new Set(mode === 'removed' ? [] : path === 'bulk' ? ['p:c', 'p2:c'] : ['p:c']))
  expect(junction).toEqual(new Set(mode === 'removed' ? ['t:remote-only'] : path === 'bulk' ? ['t:remote-only', 't:c', 't2:c'] : ['t:remote-only', 't:c']))
  expect(repo.syncQueue.count()).toBe(0)
})

it.each(['online', 'offline'])('does not revive a removed remote palette during a generic %s title edit', async (mode) => {
  stage = 'labels'
  const repo = repos[0]
  repo.projects.update('p', { is_shared: 1 })
  repo.labels.applyRemoteProjectLabel({project_id:'p',label_id:'l',created_at:'2020-01-01T00:00:00Z',deleted_at:null})
  repo.tasks.applyRemoteTaskLabels('t',['l'])
  useTaskStore.setState({ tasks: { t: repo.tasks.findById('t')! }, taskLabels: { t: [repo.labels.findById('l')!] }, showDetailPanel: false })
  const writes: string[] = []
  network.client = { from(table: string) {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'order', 'limit', 'or']) chain[method] = () => chain
    chain.upsert = () => { writes.push(table); return chain }
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null })
    return chain
  } } as unknown as SupabaseClient
  setOnlineStatus(mode === 'online')
  await useTaskStore.getState().updateTask('t', { title: 'Fresh title' })
  await vi.advanceTimersByTimeAsync(1)
  setOnlineStatus(true)
  await processSyncQueue()
  expect(writes).toContain('tasks')
  expect(writes).not.toContain('project_labels')
  expect(writes).not.toContain('task_labels')
  expect(repo.syncQueue.count()).toBe(0)
})

import { captureSyncContext } from './syncContext'
import { reconcileTable, SYNC_TABLES } from './syncTables'
it.each(['account', 'database'])('keeps actual reconcile descriptor operations in their originating %s context', async (change) => {
  stage = 'reconcile'
  repos[0].projects.update('p', { name: 'A private project', description: 'A private description' })
  repos[1].users.create({ id: 'a', email: 'a-in-b@example.invalid', display_name: null, avatar_url: null })
  const row = repos[0].projects.findById('p')!
  network.client = { from() {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'order', 'limit', 'or']) chain[method] = () => chain
    chain.maybeSingle = async () => ({ data: { updated_at: row.updated_at }, error: null })
    chain.upsert = () => { writes++; return chain }
    chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (async () => {
      await network.token!()
      started.resolve(); await pause.promise
      return { data: [row], error: null }
    })().then(resolve, reject)
    return chain
  } } as unknown as SupabaseClient
  const context = await captureSyncContext()
  const operation = reconcileTable(SYNC_TABLES.projects as Parameters<typeof reconcileTable>[0], 'a', 'a', context)
  await started.promise
  active = 1; generation++
  if (change === 'account') useAuthStore.setState({ currentUser: { id: 'b' } as never })
  pause.resolve()
  await operation.catch(() => {})
  expect(repos[1].projects.findById('p')).toMatchObject({ name: 'Private project', description: null, owner_id: 'b' })
  expect(repos[1].syncMeta.getHighWater('a', 'a', 'projects')).toBeNull()
  expect(writes).toBe(0)
})
it('uploads actual persisted reorder versions from the store', async () => {
  stage = 'reorder'
  const repo = repos[0]
  repo.projects.update('p', { is_shared: 1 })
  repo.tasks.create({ id: 't2', project_id: 'p', status_id: 's', owner_id: 'a', title: 'Second' })
  const before = repo.tasks.findById('t')!.updated_at
  useTaskStore.setState({ tasks: { t: repo.tasks.findById('t')!, t2: repo.tasks.findById('t2')! }, taskLabels: {}, showDetailPanel: false })
  const sent: Array<Record<string, unknown>> = []
  network.client = { from() { return { upsert: async (row: Record<string, unknown>) => { sent.push(row); return { data: [], error: null } } } } } as unknown as SupabaseClient
  await useTaskStore.getState().reorderTasks(['t2', 't'])
  await vi.advanceTimersByTimeAsync(1)
  expect(sent).toHaveLength(2)
  for (const row of sent) {
    const persisted = repo.tasks.findById(String(row.id))!
    expect(row).toMatchObject({ id: persisted.id, title: persisted.title, project_id: persisted.project_id, status_id: persisted.status_id, order_index: persisted.order_index, updated_at: persisted.updated_at, archive_updated_at: persisted.archive_updated_at })
  }
  expect(Date.parse(useTaskStore.getState().tasks.t.updated_at)).toBeGreaterThan(Date.parse(before))
})

import { pushRemoveLabelFromProject } from './PersonalSyncService'
it.each(['online', 'offline', 'failure', 'readd', 'racing-readd', 'sibling-readd'])('keeps cloud-only project label removals durable: %s', async (mode) => {
  stage = 'removal'
  const repo = repos[0]
  repo.projects.update('p', { is_shared: 1 })
  repo.labels.addToProject('p', 'l')
  repo.labels.removeFromProject('p', 'l')
  repo.labels.create({ id: 'known', user_id: 'other', name: 'Private label' })
  repo.labels.applyRemoteProjectLabel({project_id:'p',label_id:'known',created_at:'2020-01-01T00:00:00Z',deleted_at:null})
  if(mode==='sibling-readd') repo.labels.removeFromProject('p','known')
  const palette = new Map<string, string | null>([['l', null], ['known', null], ['cloud-only', null], ['unrelated', null]])
  const pairs = new Set(['t:l', 't:known', 'remote:cloud-only', 'remote:unrelated'])
  let fail = mode === 'failure' || mode === 'readd'
  let raced = false
  network.client = { from(table: string) {
    let operation = 'select', payload: unknown
    let taskIds: string[] = [], labelIds: string[] = []
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'order', 'limit', 'or']) chain[method] = () => chain
    chain.in = (key: string, ids: string[]) => { if (key === 'task_id') taskIds = ids; else labelIds = ids; return chain }
    chain.upsert = (rows: unknown) => { payload = rows; operation = 'upsert'; return chain }
    chain.delete = () => { operation = 'delete'; return chain }
    chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (async () => {
      await network.token!()
      if (operation === 'upsert') {
        if (fail) return { data: null, error: { message: 'synthetic removal failure' } }
        if(table==='task_labels') for(const row of (Array.isArray(payload)?payload:[payload]) as Array<{task_id:string;label_id:string}>) pairs.add(`${row.task_id}:${row.label_id}`)
        if(table==='project_labels') for (const row of (Array.isArray(payload)?payload:[payload]) as Array<{ label_id: string; deleted_at: string }>) palette.set(row.label_id, row.deleted_at)
        if(table==='project_labels' && mode==='sibling-readd' && !raced && repo.syncQueue.findAll().filter((entry)=>entry.table_name==='task_labels').length===1) {raced=true;repo.labels.addToProject('p','l');repo.tasks.addLabel('t','l')}
        if (table==='project_labels' && mode === 'racing-readd' && !raced) { raced = true; repo.labels.addToProject('p', 'l') }
      } else if (operation === 'delete') {
        for (const task of taskIds) for (const label of labelIds) pairs.delete(`${task}:${label}`)
      }
      return { data: table === 'project_labels' ? [...palette].map(([label_id, deleted_at]) => ({ label_id, deleted_at, user_labels: { name: label_id === 'unrelated' ? 'Unrelated' : 'Private label' } })) : table === 'tasks' ? [{ id: 't' }, { id: 'remote' }] : [], error: null }
    })().then(resolve, reject)
    return chain
  } } as unknown as SupabaseClient
  if (mode === 'offline') vi.mocked(requireSession).mockResolvedValue(null)
  await pushRemoveLabelFromProject('p', 'l')
  if (mode === 'offline' || mode === 'failure' || mode === 'readd') {
    expect(repo.syncQueue.count()).toBeGreaterThan(0)
    if (mode === 'readd') repo.labels.addToProject('p', 'l')
    fail = false
    vi.mocked(requireSession).mockResolvedValue({ user: { id: 'a' }, access_token: 'synthetic-a' } as Session)
    await processSyncQueue()
  }
  await processSyncQueue()
  expect(repo.syncQueue.count()).toBe(0)
  expect(palette.get('unrelated')).toBeNull()
  if (mode === 'readd' || mode === 'racing-readd' || mode === 'sibling-readd') {
    expect(palette.get('l')).toBeNull()
    expect(pairs.has('t:l')).toBe(true)
  } else {
    for (const id of ['l', 'known', 'cloud-only']) expect(palette.get(id)).toEqual(expect.any(String))
    expect(pairs).toEqual(new Set(['remote:unrelated']))
  }
})
