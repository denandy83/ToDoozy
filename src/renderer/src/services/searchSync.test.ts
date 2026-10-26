vi.mock('./syncContext', () => ({ captureSyncContext: vi.fn(async () => {
  const id = useAuthStore.getState().currentUser?.id
  const api = window.api
  const client = await getSupabase()
  return { api, client, scope: id, assertCurrent() {}, isCurrent: async () => useAuthStore.getState().currentUser?.id === id }
}) }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }))
vi.mock('../shared/stores/logStore', () => ({ logEvent: vi.fn() }))
vi.mock('./PersonalSyncService', () => ({ pullTaskLabelsForTasks: vi.fn(async () => 0) }))
import { getSupabase } from '../lib/supabase'
import { useAuthStore } from '../shared/stores/authStore'
import { useTaskStore } from '../shared/stores/taskStore'
import { useStatusStore } from '../shared/stores/statusStore'
import { refreshSearchIndex } from './searchSync'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { User } from '../../../shared/types'

let seq = 0
let userId: string
let applied: Array<{ id: string; title?: string }>
let pages: Array<Array<Record<string, unknown>>>
let queries: Array<{ table: string; cursor?: string }>
beforeEach(() => {
  userId = `search-user-${++seq}`
  useAuthStore.setState({ currentUser: { id: userId } as User })
  applied = []; pages = []; queries = []
  vi.stubGlobal('window', { api: {
    projects: { getProjectsForUser: vi.fn(async () => [{ id: 'unopened-personal' }]) },
    statuses: { applyRemote: vi.fn(async () => {}) },
    tasks: { applyRemote: vi.fn(async (row) => { applied.push(row) }) }
  } })
  useTaskStore.setState({ hydrateAllForUser: vi.fn(async () => {}) })
  useStatusStore.setState({ hydrateStatuses: vi.fn(async () => {}) })
  const client = { from(table: string) {
    const record: { table: string; cursor?: string } = { table }; queries.push(record)
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'in', 'order', 'gt', 'limit']) chain[method] = () => chain
    chain.or = (cursor: string) => { record.cursor = cursor; return chain }
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: table === 'tasks' ? pages.shift() ?? [] : [], error: null })
    return chain
  } } as unknown as SupabaseClient
  vi.mocked(getSupabase).mockResolvedValue(client)
})
describe('searching unopened projects', () => {
  it('loads parents before nested matches and refreshes the global index', async () => {
    pages = [[{ id: 'grandchild', parent_id: 'child', updated_at: '2026-10-25T10:00:00Z' }, { id: 'child', parent_id: 'parent', updated_at: '2026-10-25T10:00:00Z' }, { id: 'parent', parent_id: null, updated_at: '2026-10-25T10:00:00Z' }]]
    await refreshSearchIndex(userId)
    expect(applied.map((row) => row.id)).toEqual(['parent', 'child', 'grandchild'])
    expect(useTaskStore.getState().hydrateAllForUser).toHaveBeenCalledWith(userId)
  })
  it('uses a row cursor and keeps the newest copy when a task moves during pagination', async () => {
    const first = Array.from({ length: 500 }, (_, n) => ({ id: `t${String(n).padStart(3, '0')}`, title: 'original', updated_at: '2026-10-25T10:00:00Z' }))
    pages = [first, [{ id: 't500', title: 'previously skipped', updated_at: '2026-10-25T10:00:00Z' }, { id: 't000', title: 'edited during fetch', updated_at: '2026-10-25T11:00:00Z' }]]
    await refreshSearchIndex(userId)
    expect(queries.filter((query) => query.table === 'tasks')[1].cursor).toContain('id.gt.t499')
    expect(applied).toHaveLength(501)
    expect(applied.find((row) => row.id === 't000')?.title).toBe('edited during fetch')
    expect(applied.some((row) => row.id === 't500')).toBe(true)
  })
  it('does not apply old-account rows after the account changes during a fetch', async () => {
    vi.mocked(getSupabase).mockImplementation(async () => {
      useAuthStore.setState({ currentUser: { id: 'different-user' } as User })
      return {} as SupabaseClient
    })
    await refreshSearchIndex(userId)
    expect(applied).toEqual([])
    expect(queries).toEqual([])
  })
})
