import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { migrations } from '../../../main/database/migrations'
import { createRepositories } from '../../../main/repositories'
import { useAuthStore } from '../shared/stores/authStore'
import { requireSession } from './sessionRecovery'
import { pushProjectArchive } from './PersonalSyncService'
import { processSyncQueue, setOnlineStatus } from './SyncService'

const network = vi.hoisted(() => ({ client: null as unknown, token: null as null | (() => Promise<string>) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn((_url, _key, options) => { network.token = options.accessToken; return network.client }) }))
vi.mock('./sessionRecovery', () => ({ requireSession: vi.fn() }))
vi.mock('../shared/stores/logStore', () => ({ logEvent: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }))
let db: DatabaseSync
let repo: ReturnType<typeof createRepositories>
let remote: Record<string, Array<Record<string, unknown>>>
const t10 = '2026-01-01T10:00:00.000Z', t20 = '2026-01-01T20:00:00.000Z', t30 = '2026-01-02T06:00:00.000Z', t40 = '2026-01-02T16:00:00.000Z'
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)')
  for (const migrate of migrations) migrate(db)
  repo = createRepositories(db)
  repo.users.create({ id: 'u', email: 'u@example.invalid', display_name: null, avatar_url: null })
  repo.projects.create({ id: 'p', name: 'Project', owner_id: 'u' })
  repo.statuses.create({ id: 's', project_id: 'p', name: 'Open' })
  for (const id of ['normal', 'divergent', 'newer-remote']) repo.tasks.create({ id, project_id: 'p', owner_id: 'u', status_id: 's', title: id })
  useAuthStore.setState({ currentUser: { id: 'u' } as never })
  vi.mocked(requireSession).mockResolvedValue({ user: { id: 'u' }, access_token: 'synthetic-u' } as Session)
  setOnlineStatus(true)
  vi.stubGlobal('window', { api: {
    auth: { getSupabaseConfig: async () => ({ url: 'https://example.invalid', anonKey: 'synthetic' }) },
    sync: {
      captureContext: async () => ({ userId: 'u', generation: 1 }), count: async () => repo.syncQueue.count(),
      invokeContext: async (_context: unknown, channel: string, args: unknown[]) => {
        const [namespace, method] = channel.split(':')
        const target = namespace === 'sync' ? repo.syncQueue : repo[namespace as keyof typeof repo]
        const mapped = namespace === 'sync' && method === 'getQueue' ? 'findAll' : method
        return (target as unknown as Record<string, (...args: unknown[]) => unknown>)[mapped](...args)
      }
    }
  } })
  network.client = { from(table: string) {
    let patch: Record<string, unknown> = {}
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    const chain = {
      update(value: Record<string, unknown>) { patch = value; return chain },
      eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return chain },
      is(key: string, value: unknown) { filters.push((row) => (row[key] ?? null) === value); return chain },
      lte(key: string, value: unknown) { filters.push((row) => String(row[key]) <= String(value)); return chain },
      select() { return chain },
      order() { return chain },
      limit() { return chain },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return (async () => {
          await network.token!()
          const data = remote[table].filter((row) => filters.every((filter) => filter(row)))
          for (const row of data) Object.assign(row, patch)
          return { data, error: null }
        })().then(resolve, reject)
      }
    }
    return chain
  } } as unknown as SupabaseClient
})
afterEach(() => { db.close(); vi.unstubAllGlobals() })
it.each([0, 1].flatMap((archived) => ['immediate', 'queue'].map((path) => ({ archived, path }))))(
  'preserves task intent at T20 after cascade T10 and rename T30: $archived/$path', async ({ archived, path }) => {
    if (archived) repo.projects.archiveWithTasks('p')
    else repo.projects.unarchiveWithTasks('p')
    db.prepare('UPDATE tasks SET updated_at=?').run(t10)
    repo.tasks.update('divergent', { is_archived: archived ? 0 : 1 })
    db.prepare('UPDATE tasks SET updated_at=? WHERE id=?').run(t20, 'divergent')
    repo.projects.update('p', { name: 'Renamed' })
    db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(t30, 'p')
    remote = { projects: [{ id: 'p', is_archived: archived ? 0 : 1, updated_at: t10 }], tasks: [
      { id: 'normal', project_id: 'p', is_archived: archived ? 0 : 1, updated_at: t10 },
      { id: 'divergent', project_id: 'p', is_archived: archived ? 0 : 1, updated_at: t20 },
      { id: 'newer-remote', project_id: 'p', is_archived: archived ? 0 : 1, updated_at: t40 },
      { id: 'cloud-only', project_id: 'p', is_archived: archived ? 0 : 1, updated_at: t10 }
    ] }
    if (path === 'queue') {
      repo.syncQueue.enqueue('projects', 'p', 'UPDATE', '{"id":"p","archive_with_tasks":true}')
      expect(await processSyncQueue()).toBe(1)
      expect(repo.syncQueue.count()).toBe(0)
    } else await pushProjectArchive('p', archived)
    expect(remote.projects[0]).toMatchObject({ is_archived: archived, updated_at: t30 })
    expect(remote.tasks.find((row) => row.id === 'cloud-only')).toMatchObject({ is_archived: archived, updated_at: t30 })
    expect(remote.tasks.find((row) => row.id === 'normal')).toMatchObject({ is_archived: archived, updated_at: t10 })
    expect(remote.tasks.find((row) => row.id === 'divergent')).toMatchObject({ is_archived: archived ? 0 : 1, updated_at: t20 })
    expect(remote.tasks.find((row) => row.id === 'newer-remote')).toMatchObject({ is_archived: archived ? 0 : 1, updated_at: t40 })
  }
)
