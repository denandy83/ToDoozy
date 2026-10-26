import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SyncQueueEntry, Task } from '../../../shared/types'
vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }))
vi.mock('./sessionRecovery', () => ({ requireSession: vi.fn() }))
vi.mock('../shared/stores/logStore', () => ({ logEvent: vi.fn() }))
import { getSupabase } from '../lib/supabase'
import { requireSession } from './sessionRecovery'
import { processSyncQueue, setOnlineStatus } from './SyncService'
import { replaySpecialEntry } from './syncQueueReplay'
import { writeProjectArchive } from './projectArchiveSync'
import { useSyncStore } from '../shared/stores/syncStore'

const entry = (id: string, table: string, payload: Record<string, unknown>): SyncQueueEntry => ({ id, table_name: table, row_id: String(payload.id ?? 't'), operation: 'UPDATE', created_at: '2026-10-25T10:00:00Z', payload: JSON.stringify(payload) })
function clientMock(failure: string | null = null, rows: unknown[] = [{ id: 'p' }]): { client: SupabaseClient; writes: Array<{ table: string; operation: string; payload: unknown }>; filters: Array<unknown[]> } {
  const writes: Array<{ table: string; operation: string; payload: unknown }> = []
  const filters: Array<unknown[]> = []
  const client = { from(table: string) {
    let operation = 'select'
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'in']) chain[method] = (...args: unknown[]) => { filters.push([method, ...args]); return chain }
    for (const method of ['upsert', 'update', 'delete']) chain[method] = (payload: unknown) => { operation = method; writes.push({ table, operation, payload }); return chain }
    chain.then = (resolve: (result: unknown) => unknown) => resolve({ data: rows, error: operation !== 'select' && failure ? { message: failure } : null })
    return chain
  } } as unknown as SupabaseClient
  return { client, writes, filters }
}
let queue: SyncQueueEntry[]
let local: Task | null
beforeEach(() => {
  queue = []
  local = { id: 't', project_id: 'p', title: 'latest edit', updated_at: '2026-10-25T12:00:00Z', deleted_at: null } as Task
  vi.mocked(requireSession).mockResolvedValue({ user: { id: 'u' } } as Awaited<ReturnType<typeof requireSession>>)
  vi.stubGlobal('window', { api: {
    sync: { getQueue: vi.fn(async () => [...queue]), count: vi.fn(async () => queue.length), dequeue: vi.fn(async (id) => { queue = queue.filter((row) => row.id !== id) }) },
    settings: { findAllByUser: vi.fn(async () => [{ user_id: 'u', key: 'theme', value: 'dark', updated_at: '2026-10-25T12:00:00Z', deleted_at: null }]) },
    tasks: { findById: vi.fn(async () => local), getLabels: vi.fn(async () => []) },
    projects: { findById: vi.fn(async () => ({ id: 'p', is_archived: 0, updated_at: '2026-10-25T13:00:00Z' })) }
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
    expect(mock.writes.map((write) => write.payload)).toEqual([{ is_archived: 0, updated_at: '2026-10-25T13:00:00Z' }, { is_archived: 0, updated_at: '2026-10-25T13:00:00Z' }])
  })
  it('removes stale task-label links using the existing remote hard-delete contract', async () => {
    const mock = clientMock(null, [{ label_id: 'removed' }])
    await replaySpecialEntry(mock.client, entry('q', 'task_labels', { task_id: 't' }))
    expect(mock.writes[0].operation).toBe('delete')
    expect(mock.filters).toContainEqual(['in', 'label_id', ['removed']])
  })
  it('treats a zero-row archive RLS denial and task update failure as failures', async () => {
    await expect(writeProjectArchive(clientMock(null, []).client, 'p', 1, 'now')).rejects.toThrow('owner')
    const mock = clientMock('write rejected')
    await expect(writeProjectArchive(mock.client, 'p', 1, 'now')).rejects.toThrow('write rejected')
  })
})
