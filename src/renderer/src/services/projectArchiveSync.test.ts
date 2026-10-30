import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { migrations } from '../../../main/database/migrations'
import { createRepositories } from '../../../main/repositories'
import { useAuthStore } from '../shared/stores/authStore'
import { requireSession } from './sessionRecovery'
import { pushProjectArchive, pullNewTasks } from './PersonalSyncService'
import { processSyncQueue, setOnlineStatus, syncProjectDown } from './SyncService'

const network = vi.hoisted(() => ({ client: null as unknown, token: null as null | (() => Promise<string>) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn((_url, _key, options) => { network.token = options.accessToken; return network.client }) }))
vi.mock('./sessionRecovery', () => ({ requireSession: vi.fn() }))
vi.mock('../shared/stores/logStore', async (importOriginal) => ({ ...await importOriginal<typeof import('../shared/stores/logStore')>(), logEvent: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }))
let db: DatabaseSync
let repo: ReturnType<typeof createRepositories>
let remote: Record<string, Array<Record<string, unknown>>>
let batches: Array<{ patch: Record<string, unknown>; ids: unknown[] }>
let reads: number
let failBatch: number
let generation = 0
let onProjectWrite: (() => Promise<void>) | null
const t0 = '2026-01-01T00:00:00.000Z', t5 = '2026-01-01T05:00:00.000Z', t10 = '2026-01-01T10:00:00.000Z', t20 = '2026-01-01T20:00:00.000Z', t30 = '2026-01-02T06:00:00.000Z'
function split(value: string): string[] {
  let depth = 0, quoted = false, start = 0
  const result: string[] = []
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '"') quoted = !quoted
    if (quoted) continue
    if (value[index] === '(') depth++
    if (value[index] === ')') depth--
    if (value[index] === ',' && !depth) { result.push(value.slice(start, index)); start = index + 1 }
  }
  return [...result, value.slice(start)]
}
function matches(row: Record<string, unknown>, filter: string): boolean {
  if (filter.startsWith('and(')) return split(filter.slice(4, -1)).every((part) => matches(row, part))
  const [, key, op, encoded] = filter.match(/^([^.]+)\.(eq|gt|lte|is)\.(.*)$/)!
  let value: unknown
  try { value = JSON.parse(encoded) } catch { value = encoded }
  if (op === 'is') return (row[key] ?? null) === value
  if (op === 'lte') return String(row[key]) <= String(value)
  return op === 'eq' ? row[key] === value : String(row[key]) > String(value)
}
beforeEach(() => {
  generation++
  vi.stubGlobal('navigator', { onLine: true })
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t0)
  db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)')
  for (const migrate of migrations) migrate(db)
  repo = createRepositories(db)
  repo.users.create({ id: 'u', email: 'u@example.invalid', display_name: null, avatar_url: null })
  repo.projects.create({ id: 'p', name: 'Project', owner_id: 'u' })
  repo.statuses.create({ id: 's', project_id: 'p', name: 'Open' })
  useAuthStore.setState({ currentUser: { id: 'u' } as never })
  vi.mocked(requireSession).mockResolvedValue({ user: { id: 'u' }, access_token: 'synthetic-u' } as Session)
  setOnlineStatus(true)
  batches = []; reads = 0; failBatch = 0; onProjectWrite = null
  remote = { projects: [{ ...repo.projects.findById('p'), updated_at: t5 }], statuses: [{ ...repo.statuses.findById('s') }], tasks: [] }
  vi.stubGlobal('window', { api: {
    auth: { getSupabaseConfig: async () => ({ url: 'https://example.invalid', anonKey: 'synthetic' }) },
    sync: {
      captureContext: async () => ({ userId: 'u', generation }), count: async () => repo.syncQueue.count(),
      invokeContext: async (_context: unknown, channel: string, args: unknown[]) => {
        const [namespace, method] = channel.split(':')
        const target = namespace === 'sync' ? repo.syncQueue : repo[namespace as keyof typeof repo]
        const mapped = namespace === 'sync' && method === 'getQueue' ? 'findAll' : namespace === 'tasks' && method === 'applyRemote' ? 'applyRemoteTask' : method
        return (target as unknown as Record<string, (...args: unknown[]) => unknown>)[mapped](...args)
      }
    }
  } })
  network.client = { from(table: string) {
    let patch: Record<string, unknown> | null = null, limit = 1000, columns = '*'
    let upserts: Array<Record<string, unknown>> | null = null
    let ids: unknown[] = []
    const orders: string[] = []
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    const execute = async () => {
      await network.token!()
      if (upserts) {
        for (const row of upserts) {
          const existing = remote[table]?.find((item) => item.id === row.id)
          if (existing && Date.parse(String(existing.updated_at)) > Date.parse(String(row.updated_at))) continue
          const project = remote.projects[0]
          const inherited = table === 'tasks' && project.archive_updated_at && Date.parse(String(row.archive_updated_at ?? '1970-01-01')) <= Date.parse(String(project.archive_updated_at))
            ? { is_archived: project.is_archived, archive_updated_at: project.archive_updated_at } : {}
          if (existing) Object.assign(existing, row, inherited)
          else (remote[table] ??= []).push({ ...row, ...inherited })
        }
        return { data: [], error: null }
      }
      if (table === 'projects' && patch && onProjectWrite) { const hook = onProjectWrite; onProjectWrite = null; await hook() }
      if (table === 'tasks' && !patch) reads++
      if (table === 'tasks' && patch) {
        batches.push({ patch: { ...patch }, ids })
        if (failBatch === batches.length) return { data: null, error: { message: 'synthetic batch failure' } }
      }
      const data = (remote[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
        .sort((a, b) => { for (const key of orders) if (a[key] !== b[key]) return String(a[key]) < String(b[key]) ? -1 : 1; return 0 })
        .slice(0, limit)
      if (patch) for (const row of data) {
        const archive = row.archive_updated_at && Date.parse(String(row.archive_updated_at)) >= Date.parse(String(patch.archive_updated_at))
          ? { is_archived: row.is_archived, archive_updated_at: row.archive_updated_at } : {}
        Object.assign(row, patch, table === 'projects' ? archive : {})
      }
      return { data: data.map((row) => columns === '*' ? { ...row } : Object.fromEntries(columns.split(',').map((key) => [key.trim(), row[key.trim()]]))), error: null }
    }
    const chain = {
      upsert(value: Record<string, unknown> | Array<Record<string, unknown>>) { upserts = Array.isArray(value) ? value : [value]; return chain },
      update(value: Record<string, unknown>) { patch = value; return chain },
      eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return chain },
      is(key: string, value: unknown) { filters.push((row) => (row[key] ?? null) === value); return chain },
      lte(key: string, value: unknown) { filters.push((row) => String(row[key]) <= String(value)); return chain },
      gt(key: string, value: unknown) { filters.push((row) => String(row[key]) > String(value)); return chain },
      in(key: string, values: unknown[]) { ids = values; filters.push((row) => values.includes(row[key])); return chain },
      select(value = '*') { columns = value; return chain },
      order(key: string) { orders.push(key); return chain },
      limit(value: number) { limit = Math.min(1000, value); return chain },
      or(value: string) { filters.push((row) => split(value).some((part) => matches(row, part))); return chain },
      maybeSingle: async () => { const value = await execute(); return { ...value, data: value.data?.[0] ?? null } },
      single: async () => { const value = await execute(); return { ...value, data: value.data?.[0] ?? null } },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return execute().then(resolve, reject) }
    }
    return chain
  }, rpc: async () => ({ data: [], error: null }) } as unknown as SupabaseClient
})
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.useRealTimers() })
function task(id: string, archived: number, stamp: string) {
  return { id, project_id: 'p', owner_id: 'u', status_id: 's', title: id, is_archived: archived, archive_updated_at: stamp, created_at: t0, updated_at: stamp, deleted_at: null }
}
function action(archived: number) {
  if (archived) repo.projects.archiveWithTasks('p')
  else repo.projects.unarchiveWithTasks('p')
}
it.each([0, 1].flatMap((archived) => ['immediate', 'queue'].map((path) => ({ archived, path }))))(
  'R9/F1: preserves later local and remote-only choices across rename: $archived/$path', async ({ archived, path }) => {
    repo.tasks.create({ id: 'local', project_id: 'p', owner_id: 'u', status_id: 's', title: 'Local' })
    vi.setSystemTime(t10); action(archived)
    vi.setSystemTime(t20); repo.tasks.update('local', { is_archived: archived ? 0 : 1 })
    vi.setSystemTime(t30); repo.projects.update('p', { name: 'Renamed' })
    remote.tasks = [task('old-cloud', archived ? 0 : 1, t5), task('later-cloud', archived ? 0 : 1, t20), task('local', archived ? 0 : 1, t20)]
    expect(repo.projects.findById('p')?.archive_updated_at).toBe(t10)
    if (path === 'queue') expect(await processSyncQueue()).toBe(1)
    else await pushProjectArchive()
    expect(repo.syncQueue.count()).toBe(0)
    expect(remote.tasks.find((row) => row.id === 'old-cloud')).toMatchObject({ is_archived: archived, updated_at: t5 })
    for (const id of ['later-cloud', 'local']) expect(remote.tasks.find((row) => row.id === id)).toMatchObject({ is_archived: archived ? 0 : 1, updated_at: t20 })
  }
)
it.each([0, 1].flatMap((archived) => ['pull', 'startup'].map((path) => ({ archived, path }))))(
  'F2: older unseen rows imported during pending cascade inherit its state without promoting metadata: $archived/$path', async ({ archived, path }) => {
    vi.setSystemTime(t10); action(archived)
    remote.tasks = [task('unseen', archived ? 0 : 1, t5), task('later-choice', archived ? 0 : 1, t20)]
    if (path === 'pull') expect(await pullNewTasks('p')).toBe(2)
    else await syncProjectDown('p', 'u')
    expect(repo.tasks.findById('unseen')).toMatchObject({ is_archived: archived, updated_at: t5 })
    expect(repo.tasks.findById('later-choice')).toMatchObject({ is_archived: archived ? 0 : 1, updated_at: t20 })
    expect(await processSyncQueue()).toBe(1)
    expect(remote.tasks.find((row) => row.id === 'unseen')).toMatchObject({ is_archived: archived, updated_at: t5 })
    expect(remote.tasks.find((row) => row.id === 'later-choice')).toMatchObject({ is_archived: archived ? 0 : 1, updated_at: t20 })
  }
)
it.each([0, 1])('pages and batches 1101 rows, preserving intent through a partial failure/retry: %s', async (archived) => {
  vi.setSystemTime(t10); action(archived)
  remote.tasks = Array.from({ length: 1101 }, (_, index) => task(`task-${String(index).padStart(4, '0')}`, archived ? 0 : 1, t5))
  failBatch = 2
  expect(await processSyncQueue()).toBe(0)
  expect(repo.syncQueue.count()).toBe(1)
  expect(batches[0].ids).toHaveLength(200)
  failBatch = 0
  expect(await processSyncQueue()).toBe(1)
  expect(remote.tasks.every((row) => row.is_archived === archived && row.updated_at === t5)).toBe(true)
  expect(batches).toHaveLength(8)
  expect(batches.every((batch) => batch.ids.length <= 200)).toBe(true)
  expect(reads).toBe(6)
})
it('rechecks a new action racing a queued write and ignores delayed older producer delivery', async () => {
  vi.setSystemTime(t10); action(0)
  remote.tasks = [task('unseen', 1, t5)]
  onProjectWrite = async () => { vi.setSystemTime(t20); action(1); vi.setSystemTime(t30); repo.projects.update('p', { name: 'Renamed' }) }
  expect(await processSyncQueue()).toBe(1)
  expect(remote.tasks[0]).toMatchObject({ is_archived: 1, updated_at: t5 })
  expect(repo.syncQueue.count()).toBe(1)
  expect(await processSyncQueue()).toBe(1)
  const written = batches.length
  await pushProjectArchive()
  expect(batches).toHaveLength(written)
  expect(repo.syncQueue.count()).toBe(0)
})
it('adopts a newer remote owner action instead of replaying an older local command', async () => {
  vi.setSystemTime(t10); action(0)
  remote.projects[0] = { ...remote.projects[0], is_archived: 1, archive_updated_at: t20, updated_at: t20 }
  remote.tasks = [task('unseen', 1, t20)]
  expect(await processSyncQueue()).toBe(1)
  expect(repo.projects.findById('p')).toMatchObject({ is_archived: 1, archive_updated_at: t20 })
  expect(remote.tasks[0]).toMatchObject({ is_archived: 1, updated_at: t20 })
})
it('owner denial stops before task reads or writes', async () => {
  vi.setSystemTime(t10); action(1); remote.projects = []
  expect(await processSyncQueue()).toBe(0)
  expect(reads).toBe(0)
  expect(batches).toHaveLength(0)
  expect(repo.syncQueue.count()).toBe(1)
})

it.each([0, 1].flatMap((state) => ['queue-first', 'pull-first'].map((ordering) => ({ state, ordering }))))(
  'preserves pending metadata across remote archive=$state/$ordering', async ({ state, ordering }) => {
    const t8 = '2026-01-01T08:00:00.000Z'
    repo.tasks.applyRemoteTask({ ...task('pending', 1 - state, t8), title: 'New', description: 'New description' } as never)
    remote.tasks = [{ ...task('pending', state, t5), title: 'Old', description: 'Old description' }]
    remote.projects[0] = { ...remote.projects[0], is_archived: state, archive_updated_at: t10 }
    repo.syncQueue.enqueue('tasks', 'pending', 'UPDATE', JSON.stringify({ id: 'pending' }))
    if (ordering === 'pull-first') await syncProjectDown('p', 'u')
    expect(await processSyncQueue()).toBe(1)
    await pullNewTasks('p')
    expect(repo.tasks.findById('pending')).toMatchObject({ title: 'New', description: 'New description', is_archived: state, updated_at: t8 })
    expect(remote.tasks[0]).toMatchObject({ title: 'New', description: 'New description', is_archived: state, updated_at: t8 })
  }
)
it.each([0, 1])('local archive=%s does not promote metadata over a newer cloud edit', async (state) => {
  const t8 = '2026-01-01T08:00:00.000Z', t9 = '2026-01-01T09:00:00.000Z'
  repo.tasks.applyRemoteTask({ ...task('pending', 1 - state, t8), title: 'Local' } as never)
  remote.tasks = [{ ...task('pending', 1 - state, t9), title: 'Cloud newer' }]
  vi.setSystemTime(t10); action(state)
  expect(repo.tasks.findById('pending')?.updated_at).toBe(t8)
  expect(repo.projects.findById('p')?.updated_at).toBe(t0)
  await processSyncQueue()
  await pullNewTasks('p')
  expect(repo.tasks.findById('pending')).toMatchObject({ title: 'Cloud newer', is_archived: state, updated_at: t9 })
})
