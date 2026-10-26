import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SyncQueueEntry, Task } from '../../../shared/types'
const pinned = vi.hoisted(() => ({ client: null as unknown, token: null as null | (() => Promise<string>) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn((_url, _key, options) => { pinned.token = options.accessToken; return pinned.client }) }))
vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }))
vi.mock('./sessionRecovery', () => ({ requireSession: vi.fn() }))
vi.mock('../shared/stores/logStore', () => ({ logEvent: vi.fn() }))
import { getSupabase } from '../lib/supabase'
import { requireSession } from './sessionRecovery'
import { processSyncQueue, setOnlineStatus } from './SyncService'
import { replaySpecialEntry } from './syncQueueReplay'
import { writeProjectArchive } from './projectArchiveSync'
import { useAuthStore } from '../shared/stores/authStore'
import { useSyncStore } from '../shared/stores/syncStore'

const entry = (id: string, table: string, payload: Record<string, unknown>): SyncQueueEntry => ({ id, table_name: table, row_id: String(payload.id ?? 't'), operation: 'UPDATE', created_at: '2026-10-25T10:00:00Z', payload: JSON.stringify(payload) })
function clientMock(failure: string | null = null, rows: unknown[] = [{ id: 'p' }]): { client: SupabaseClient; writes: Array<{ table: string; operation: string; payload: unknown }>; filters: Array<unknown[]> } {
  const writes: Array<{ table: string; operation: string; payload: unknown }> = []
  const filters: Array<unknown[]> = []
  const client = { from(table: string) {
    let operation = 'select'
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'in', 'lte', 'order', 'limit', 'or']) chain[method] = (...args: unknown[]) => { filters.push([method, ...args]); return chain }
    for (const method of ['upsert', 'update', 'delete']) chain[method] = (payload: unknown) => { operation = method; writes.push({ table, operation, payload }); return chain }
    chain.then = (resolve: (result: unknown) => unknown) => resolve({ data: rows, error: operation !== 'select' && failure ? { message: failure } : null })
    return chain
  } } as unknown as SupabaseClient
  pinned.client = client
  return { client, writes, filters }
}
let queue: SyncQueueEntry[]
let local: Task | null
beforeEach(() => {
  pinned.token = null
  useAuthStore.setState({ currentUser: { id: 'u' } as never })
  queue = []
  local = { id: 't', project_id: 'p', title: 'latest edit', updated_at: '2026-10-25T12:00:00Z', deleted_at: null } as Task
  vi.mocked(requireSession).mockResolvedValue({ user: { id: 'u' } } as Awaited<ReturnType<typeof requireSession>>)
  vi.stubGlobal('window', { api: {
    auth: { getSupabaseConfig: async () => ({ url: 'https://example.invalid', anonKey: 'synthetic' }) },
    sync: { captureContext: async () => ({ userId: 'u', generation: 1 }), invokeContext: async (_context: unknown, channel: string, args: unknown[]) => { const [ns, method] = channel.split(':'); return (window.api as never as Record<string, Record<string, (...args: unknown[]) => unknown>>)[ns][method](...args) }, getQueue: vi.fn(async () => [...queue]), count: vi.fn(async () => queue.length), dequeue: vi.fn(async (id) => { queue = queue.filter((row) => row.id !== id) }) },
    settings: { findAllByUser: vi.fn(async () => [{ user_id: 'u', key: 'theme', value: 'dark', updated_at: '2026-10-25T12:00:00Z', deleted_at: null }]) },
    tasks: { findAllByProject: vi.fn(async () => []), findById: vi.fn(async () => local), getLabels: vi.fn(async () => []) },
    projects: { findById: vi.fn(async () => ({ id: 'p', is_archived: 0, archive_updated_at: '2026-10-25T13:00:00Z', updated_at: '2026-10-25T13:00:00Z' })) }
  } })
  useSyncStore.setState({ status: 'synced', pendingCount: 0, errorMessage: null })
  setOnlineStatus(true)
})
afterEach(() => vi.unstubAllGlobals())
describe('durable sync retries', () => {
  it('retains Supabase error-valued writes and shows error instead of green', async () => {
    queue = [entry('q', 'tasks', { id: 't', title: 'old' })]
    const mock = clientMock('RLS denied')
    vi.mocked(getSupabase).mockResolvedValue(mock.client)
    expect(await processSyncQueue()).toBe(0)
    expect(queue).toHaveLength(1)
    expect(useSyncStore.getState().status).toBe('error')
  })
  it('coalesces old delete/update entries and pushes the current local row once', async () => {
    queue = [entry('q1', 'tasks', { id: 't', deleted_at: '2026-10-25T10:00:00Z' }), entry('q2', 'tasks', { id: 't', title: 'outdated' })]
    const mock = clientMock()
    vi.mocked(getSupabase).mockResolvedValue(mock.client)
    const a = processSyncQueue(), b = processSyncQueue()
    expect(a).toBe(b)
    expect(await a).toBe(2)
    expect(mock.writes).toEqual([{ table: 'tasks', operation: 'upsert', payload: [local] }])
    expect(queue).toHaveLength(0)
    expect(useSyncStore.getState().status).toBe('synced')
  })
  it('retries composite-key settings as values rather than tombstones', async () => {
    queue = [entry('q', 'user_settings', { id: 'u:theme', user_id: 'u', key: 'theme', value: 'old' })]
    const mock = clientMock()
    vi.mocked(getSupabase).mockResolvedValue(mock.client)
    expect(await processSyncQueue()).toBe(1)
    expect(mock.writes[0]).toMatchObject({ operation: 'upsert', payload: [{ id: 'u:theme', value: 'dark', deleted_at: null }] })
  })
  it('does not dequeue or send anything without a session', async () => {
    queue = [entry('q', 'tasks', { id: 't' })]
    vi.mocked(requireSession).mockResolvedValue(null)
    expect(await processSyncQueue()).toBe(0)
    expect(queue).toHaveLength(1)
    expect(useSyncStore.getState().status).toBe('offline')
  })
  it('retries partial tombstones with a matching incremental-sync timestamp', async () => {
    const mock = clientMock()
    await replaySpecialEntry(mock.client, entry('q', 'statuses', { id: 's', deleted_at: '2026-10-25T10:00:00Z' }))
    expect(mock.writes[0].payload).toEqual({ id: 's', deleted_at: '2026-10-25T10:00:00Z', updated_at: '2026-10-25T10:00:00Z' })
  })
  it('replays a superseded archive command using the current restored state', async () => {
    const mock = clientMock()
    await replaySpecialEntry(mock.client, entry('q', 'projects', { id: 'p', is_archived: 1, archive_with_tasks: true }))
    expect(mock.writes.map((write) => write.payload)).toEqual([{ is_archived: 0, updated_at: '2026-10-25T13:00:00Z', archive_updated_at: '2026-10-25T13:00:00Z' }, { is_archived: 0, updated_at: '2026-10-25T13:00:00Z' }])
  })
  it('removes stale task-label links using the existing remote hard-delete contract', async () => {
    const mock = clientMock(null, [{ label_id: 'removed' }])
    await replaySpecialEntry(mock.client, entry('q', 'task_labels', { task_id: 't' }))
    expect(mock.writes[0].operation).toBe('delete')
    expect(mock.filters).toContainEqual(['in', 'label_id', ['removed']])
  })
  it('treats a zero-row archive RLS denial and task update failure as failures', async () => {
    await expect(writeProjectArchive(clientMock(null, []).client, 'p', 1, 'now', [], 'now')).rejects.toThrow('owner')
    const mock = clientMock('write rejected')
    await expect(writeProjectArchive(mock.client, 'p', 1, 'now', [], 'now')).rejects.toThrow('write rejected')
  })
})

import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../../../main/database/migrations'
import { createRepositories } from '../../../main/repositories'
import { syncTaskChange, syncStatusChange } from './SyncService'
import { refreshProjectLabels } from './remoteProjectRefresh'
import { captureSyncContext } from './syncContext'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('queue integration with isolated account databases', () => {
  let databases: DatabaseSync[]
  let repositories: ReturnType<typeof createRepositories>[]
  let active: number
  let generation: number
  let pause: ReturnType<typeof deferred>
  let started: ReturnType<typeof deferred>
  let hold: boolean
  let remote: Record<string, unknown>
  let requests: number
  beforeEach(() => {
    databases = [new DatabaseSync(':memory:'), new DatabaseSync(':memory:')]
    repositories = databases.map((db, index) => {
      db.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)')
      for (const migration of migrations) migration(db)
      const repo = createRepositories(db)
      const user = index ? 'b' : 'u'
      repo.users.create({ id: user, email: `${user}@example.invalid`, display_name: null, avatar_url: null })
      repo.projects.create({ id: 'p', name: 'Shared', owner_id: user })
      repo.statuses.create({ id: 's', project_id: 'p', name: 'Open' })
      if (!index) repo.tasks.create({ id: 't', project_id: 'p', owner_id: user, title: 'T2', status_id: 's' })
      return repo
    })
    active = 0
    generation = 1
    pause = deferred()
    started = deferred()
    hold = true
    remote = {}
    requests = 0
    const client = { from(table: string) {
      let operation = 'select'
      let payload: unknown
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'in', 'is', 'lte', 'order', 'limit', 'or']) chain[method] = () => chain
      for (const method of ['upsert', 'update', 'delete']) chain[method] = (value: unknown) => { operation = method; payload = value; return chain }
      chain.then = (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => (async () => {
        await pinned.token?.()
        requests++
        if (hold) { hold = false; started.resolve(); await pause.promise }
        if (operation !== 'select') remote[table] = structuredClone(payload)
        return { data: table === 'project_labels' ? [{ project_id: 'p', label_id: 'l' }] : table === 'projects' ? [{ id: 'p' }] : table === 'tasks' ? [{ id: 't' }] : [], error: null }
      })().then(resolve, reject)
      return chain
    } } as unknown as SupabaseClient
    pinned.client = client
    vi.mocked(getSupabase).mockResolvedValue(client)
    const api = {
      auth: { getSupabaseConfig: async () => ({ url: 'https://example.invalid', anonKey: 'synthetic' }) },
      sync: {
        captureContext: async () => ({ userId: active ? 'b' : 'u', generation }),
        invokeContext: async (context: { generation: number }, channel: string, args: unknown[]) => {
          if (context.generation !== generation) throw new Error('Sync database changed')
          const [namespace, method] = channel.split(':')
          const repo = repositories[active]
          if (namespace === 'sync') {
            if (method === 'count') return repo.syncQueue.count()
            if (method === 'getQueue') return repo.syncQueue.findAll()
            if (method === 'dequeue') return repo.syncQueue.dequeue(String(args[0]))
          }
          const target = repo[namespace as keyof typeof repo] as unknown as Record<string, (...args: unknown[]) => unknown>
          return target[method](...args)
        },
        count: async () => repositories[active].syncQueue.count()
      }
    }
    vi.stubGlobal('window', { api })
  })
  afterEach(() => { for (const db of databases) db.close() })
  function switchAccount() {
    active = 1
    generation++
    useAuthStore.setState({ currentUser: { id: 'b' } as never })
  }
  it.each(['tasks', 'statuses', 'user_settings'])('replays %s after a newer successful immediate write races the queued snapshot', async (table) => {
    const repo = repositories[0]
    if (table === 'user_settings') repo.settings.set('u', 'theme', 'T2')
    const id = table === 'tasks' ? 't' : table === 'statuses' ? 's' : 'u:theme'
    repo.syncQueue.enqueue(table, id, 'UPDATE', JSON.stringify({ id }))
    const drain = processSyncQueue()
    await started.promise
    if (table === 'tasks') {
      const task = repo.tasks.update('t', { title: 'T3' })!
      await syncTaskChange(task, 'UPDATE')
    } else if (table === 'statuses') {
      const status = repo.statuses.update('s', { name: 'T3' })!
      await syncStatusChange(status, 'UPDATE')
    } else {
      repo.settings.set('u', 'theme', 'T3')
      await (pinned.client as SupabaseClient).from(table).upsert({ user_id: 'u', key: 'theme', value: 'T3' })
    }
    pause.resolve()
    expect(await drain).toBe(1)
    expect(remote[table]).toMatchObject([table === 'tasks' ? { title: 'T3' } : table === 'statuses' ? { name: 'T3' } : { value: 'T3' }])
    expect(repo.syncQueue.count()).toBe(0)
  })
  it('replays task-label intent changed during the remote junction fetch', async () => {
    const repo = repositories[0]
    repo.labels.create({ id: 'a', user_id: 'u', name: 'A', color: '#000000' })
    repo.labels.create({ id: 'b', user_id: 'u', name: 'B', color: '#000000' })
    repo.tasks.addLabel('t', 'a')
    repo.syncQueue.enqueue('task_labels', 't', 'UPDATE', '{"task_id":"t"}')
    const drain = processSyncQueue()
    await started.promise
    repo.tasks.removeLabel('t', 'a')
    repo.tasks.addLabel('t', 'b')
    await (pinned.client as SupabaseClient).from('task_labels').upsert([{ task_id: 't', label_id: 'b', deleted_at: null }])
    pause.resolve()
    expect(await drain).toBe(1)
    expect(remote.task_labels).toEqual([{ task_id: 't', label_id: 'b', deleted_at: null }])
  })
  it('replays project-label removal racing a queued link write', async () => {
    const repo = repositories[0]
    repo.labels.create({ id: 'l', user_id: 'u', name: 'L' })
    repo.labels.addToProject('p', 'l')
    repo.syncQueue.enqueue('project_labels', 'p::l', 'UPDATE', '{"projectId":"p","labelId":"l"}')
    const drain = processSyncQueue()
    await started.promise
    repo.labels.removeFromProject('p', 'l')
    await (pinned.client as SupabaseClient).from('project_labels').upsert({ project_id: 'p', label_id: 'l', deleted_at: 'newer' })
    pause.resolve()
    expect(await drain).toBe(1)
    expect(remote.project_labels).toMatchObject({ project_id: 'p', label_id: 'l', deleted_at: expect.any(String) })
  })
  it('replays restore racing a queued archive and its task cascade', async () => {
    const repo = repositories[0]
    repo.projects.archiveWithTasks('p')
    const drain = processSyncQueue()
    await started.promise
    repo.projects.unarchiveWithTasks('p')
    await writeProjectArchive(pinned.client as SupabaseClient, 'p', 0, 'newer', [repo.tasks.findById('t')!], repo.projects.findById('p')!.archive_updated_at!)
    pause.resolve()
    expect(await drain).toBe(1)
    expect(remote.projects).toMatchObject({ is_archived: 0 })
    expect(remote.tasks).toMatchObject({ is_archived: 0 })
  })
  it.each([0, 1])('preserves a newer per-task archive value after a queued cascade to %s', async (archived) => {
    const repo = repositories[0]
    if (archived) repo.projects.archiveWithTasks('p')
    else repo.projects.unarchiveWithTasks('p')
    repo.tasks.update('t', { is_archived: archived ? 0 : 1 })
    const drain = processSyncQueue()
    await started.promise
    repo.tasks.update('t', { is_archived: archived })
    await syncTaskChange(repo.tasks.findById('t')!, 'UPDATE')
    pause.resolve()
    expect(await drain).toBe(1)
    expect(remote.tasks).toMatchObject({ is_archived: archived })
    expect(repo.syncQueue.count()).toBe(0)
  })
  it.each([0, 1])('replays current per-task intent opposite to cascade %s', async (archived) => {
    hold = false
    const repo = repositories[0]
    if (archived) repo.projects.archiveWithTasks('p')
    else repo.projects.unarchiveWithTasks('p')
    repo.tasks.update('t', { is_archived: archived ? 0 : 1 })
    expect(await processSyncQueue()).toBe(1)
    expect(remote.tasks).toMatchObject({ is_archived: archived ? 0 : 1 })
  })
  it('retains the originating queue after account changes during a network write', async () => {
    repositories[0].syncQueue.enqueue('tasks', 't', 'UPDATE', '{"id":"t"}')
    const drain = processSyncQueue()
    await started.promise
    switchAccount()
    pause.resolve()
    expect(await drain).toBe(0)
    expect(repositories[0].syncQueue.count()).toBe(1)
    expect(repositories[1].tasks.findById('t')).toBeUndefined()
    expect(requests).toBe(1)
  })
  it('stops before a remote tombstone if the database changes during a local read', async () => {
    repositories[0].syncQueue.enqueue('tasks', 't', 'UPDATE', '{"id":"t"}')
    const invoke = window.api.sync.invokeContext
    window.api.sync.invokeContext = async (context, channel, args) => {
      const result = await invoke(context, channel, args)
      if (channel === 'tasks:findById') switchAccount()
      return result
    }
    expect(await processSyncQueue()).toBe(0)
    expect(requests).toBe(0)
    expect(repositories[0].syncQueue.count()).toBe(1)
  })
  it('pins remote credentials to the originating database even before the auth store changes', async () => {
    const context = await captureSyncContext()
    active = 1
    generation++
    await expect(pinned.token!()).rejects.toThrow('database changed')
    await expect(context.api.tasks.findById('t')).rejects.toThrow('database changed')
  })
  it('blocks refresh database mutations after switching accounts during a fetch', async () => {
    const context = await captureSyncContext()
    const refresh = refreshProjectLabels('p', context)
    await started.promise
    switchAccount()
    pause.resolve()
    await expect(refresh).rejects.toThrow('account changed')
    expect(repositories[1].labels.findById('l')).toBeUndefined()
  })
})

it.each(['tasks', 'statuses', 'user_settings'])('replays 500 current %s values in bounded batches and retains only failed batches', async (table) => {
  const values = new Map(Array.from({ length: 500 }, (_, index) => {
    const id = table === 'user_settings' ? `u:key${index}` : `id-${index}`
    return [id, { ...local, id, title: 'Current', name: 'Current', key: `key${index}`, value: 'Current', user_id: 'u' }]
  }))
  queue = [...values.keys()].map((id) => ({ ...entry(`q-${id}`, table, { id }), row_id: id }))
  if (table === 'tasks') vi.mocked(window.api.tasks.findById).mockImplementation(async (id) => values.get(id) as Task)
  if (table === 'statuses') (window.api as unknown as { statuses: unknown }).statuses = { findById: async (id: string) => values.get(id) }
  if (table === 'user_settings') vi.mocked(window.api.settings.findAllByUser).mockResolvedValue([...values.values()] as never)
  let calls = 0, fail = true
  const sizes: number[] = []
  const client = { from() {
    return { upsert: async (rows: unknown[]) => { sizes.push(rows.length); calls++; return { data: null, error: fail && calls === 2 ? { message: 'Batch failed' } : null } } }
  } } as unknown as SupabaseClient
  pinned.client = client
  expect(await processSyncQueue()).toBe(300)
  expect(sizes).toEqual([200, 200, 100])
  expect(queue).toHaveLength(200)
  fail = false
  expect(await processSyncQueue()).toBe(200)
  expect(queue).toHaveLength(0)
  expect(sizes).toEqual([200, 200, 100, 200])
})
