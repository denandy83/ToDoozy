import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { migrations } from '../../../main/database/migrations'
import { createRepositories } from '../../../main/repositories'
import { useAuthStore } from '../shared/stores/authStore'
import { getSupabase } from '../lib/supabase'
import { fullPull, pullNewTasks, pullStatuses, pullTaskLabelsForTasks } from './PersonalSyncService'
import { syncProjectDown } from './SyncService'
import { replaySpecialEntry } from './syncQueueReplay'
import { refreshProjectLabels } from './remoteProjectRefresh'
import type { SyncContext } from './syncContext'

vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }))
vi.mock('../shared/stores/logStore', () => ({ logEvent: vi.fn() }))
vi.mock('./syncContext', () => ({ captureSyncContext: vi.fn(async () => context) }))
vi.mock('../shared/stores/labelStore', () => ({ useLabelStore: { getState: () => ({ hydrateLabels: async () => {} }) } }))
vi.mock('../shared/stores/taskStore', () => ({ useTaskStore: { getState: () => ({ hydrateAllTaskLabels: async () => {} }) } }))

let db: DatabaseSync
let repo: ReturnType<typeof createRepositories>
let context: SyncContext
let rows: Record<string, Array<Record<string, unknown>>>
let failedTable: string | null
let pageCounts: Record<string, number>
let projectId: string
let sequence = 0

function parts(value: string): string[] {
  let depth = 0, quoted = false, start = 0
  const result: string[] = []
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '"') quoted = !quoted
    if (quoted) continue
    if (value[index] === '(') depth++
    if (value[index] === ')') depth--
    if (value[index] === ',' && depth === 0) { result.push(value.slice(start, index)); start = index + 1 }
  }
  return [...result, value.slice(start)]
}
function matches(row: Record<string, unknown>, predicate: string): boolean {
  if (predicate.startsWith('and(')) return parts(predicate.slice(4, -1)).every((part) => matches(row, part))
  const [, key, operator, encoded] = predicate.match(/^([^.]+)\.(eq|gt)\.(.*)$/)!
  const value = JSON.parse(encoded)
  return operator === 'eq' ? row[key] === value : String(row[key]) > String(value)
}
function makeClient(): SupabaseClient {
  return { from(table: string) {
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    const order: string[] = []
    let limit = 1000, columns = '*'
    let remove = false
    const chain = {
      delete() { remove = true; return chain },
      select(value = '*') { columns = value; return chain },
      eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return chain },
      is(key: string, value: unknown) { filters.push((row) => (row[key] ?? null) === value); return chain },
      in(key: string, values: unknown[]) { filters.push((row) => values.includes(row[key])); return chain },
      gt(key: string, value: string) { filters.push((row) => String(row[key]) > value); return chain },
      order(key: string) { order.push(key); return chain },
      limit(value: number) { limit = Math.min(value, 1000); return chain },
      or(value: string) { filters.push((row) => parts(value).some((part) => matches(row, part))); return chain },
      single: async () => ({ data: (rows[table] ?? []).find((row) => filters.every((filter) => filter(row))), error: null }),
      then(resolve: (value: unknown) => unknown) {
        if (remove) {
          rows[table] = (rows[table] ?? []).filter((row) => !filters.every((filter) => filter(row)))
          return Promise.resolve(resolve({ data: [], error: null }))
        }
        pageCounts[table] = (pageCounts[table] ?? 0) + 1
        if (failedTable === table && pageCounts[table] === 2) return Promise.resolve(resolve({ data: null, error: { message: 'page failed' } }))
        const data = (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
          .sort((a, b) => { for (const key of order) { if (a[key] !== b[key]) return String(a[key]) < String(b[key]) ? -1 : 1 } return 0 })
          .slice(0, limit).map((row) => columns === '*' ? row : Object.fromEntries(columns.split(',').map((key) => [key.trim(), row[key.trim()]])))
        return Promise.resolve(resolve({ data, error: null }))
      }
    }
    return chain
  }, rpc: async () => ({ data: [], error: null }) } as unknown as SupabaseClient
}
beforeEach(() => {
  projectId = `project-${++sequence}`
  db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)')
  for (const migrate of migrations) migrate(db)
  repo = createRepositories(db)
  repo.users.create({ id: 'u', email: 'u@example.invalid', display_name: null, avatar_url: null })
  repo.projects.create({ id: projectId, owner_id: 'u', name: 'Project' })
  repo.statuses.create({ id: 'open', project_id: projectId, name: 'Open' })
  rows = {}; pageCounts = {}; failedTable = null
  const client = makeClient()
  const api = new Proxy({}, {
    get: (_, ns: keyof typeof repo) => new Proxy({}, {
      get: (_, method: string) => async (...args: unknown[]) => {
        const target = repo[ns] as unknown as Record<string, (...args: unknown[]) => unknown>
        return target[ns === 'tasks' && method === 'applyRemote' ? 'applyRemoteTask' : method](...args)
      }
    })
  })
  context = { api: api as never, client, assertCurrent() {}, isCurrent: async () => true, scope: projectId }
  vi.mocked(getSupabase).mockResolvedValue(client)
  vi.stubGlobal('window', { api })
  vi.stubGlobal('navigator', { onLine: true })
  useAuthStore.setState({ currentUser: { id: 'u' } as never })
})
afterEach(() => { db.close(); vi.unstubAllGlobals() })

it('persists every task and status beyond the API cap before advancing either watermark', async () => {
  const stamp = '2026-01-01T00:00:00.000Z'
  rows.statuses = Array.from({ length: 1101 }, (_, index) => ({ ...repo.statuses.findById('open'), id: `s${String(index).padStart(4, '0')}`, updated_at: stamp }))
  rows.tasks = Array.from({ length: 1101 }, (_, index) => ({ id: `t${String(index).padStart(4, '0')}`, project_id: projectId, owner_id: 'u', title: `Task ${index}`, status_id: 'open', created_at: stamp, updated_at: stamp }))
  expect(await pullNewTasks(projectId, context)).toBe(1101)
  expect(repo.tasks.findAllByProject(projectId)).toHaveLength(1101)
  expect(repo.statuses.findAllByProject(projectId)).toHaveLength(1102)
  expect(pageCounts.tasks).toBe(3)
  expect(pageCounts.statuses).toBe(3)
})
it('does not advance the status watermark when a later page fails', async () => {
  rows.statuses = Array.from({ length: 1001 }, (_, index) => ({ ...repo.statuses.findById('open'), id: `s${String(index).padStart(4, '0')}`, updated_at: '2026-01-01T00:00:00.000Z' }))
  failedTable = 'statuses'
  expect(await pullStatuses(projectId, context)).toBe(0)
  failedTable = null
  expect(await pullStatuses(projectId, context)).toBe(1001)
})
it('fetches every label definition and junction for a task and project', async () => {
  const task = repo.tasks.create({ id: 't', project_id: projectId, owner_id: 'u', title: 'Task', status_id: 'open' })
  rows.user_labels = Array.from({ length: 1101 }, (_, index) => ({ id: `l${String(index).padStart(4, '0')}`, user_id: 'u', name: `Label ${index}`, color: '#ffffff', order_index: 0, created_at: task.created_at, updated_at: task.updated_at }))
  rows.task_labels = rows.user_labels.map(({ id }) => ({ task_id: 't', label_id: id }))
  rows.project_labels = rows.user_labels.map(({ id }) => ({ project_id: projectId, label_id: id, created_at: task.created_at, deleted_at: null }))
  expect(await pullTaskLabelsForTasks(['t'], 'u', context)).toBe(1101)
  expect(repo.tasks.getLabels('t')).toHaveLength(1101)
  await refreshProjectLabels(projectId, context)
  expect(repo.labels.findByProjectId(projectId)).toHaveLength(1101)
})
it.each([0, 1])('imports archive metadata and timestamps on a fresh device: %s', async (archived) => {
  const project = repo.projects.findById(projectId)!
  rows.projects = [{ ...project, id: 'imported', is_archived: archived, updated_at: '2020-01-01T00:00:00.000Z' }]
  rows.project_members = [{ project_id: 'imported', user_id: 'u', role: 'member' }]
  await fullPull('u')
  expect(repo.projects.findById('imported')).toMatchObject({ is_archived: archived, is_shared: 1, updated_at: '2020-01-01T00:00:00.000Z' })
})
it.each([0, 1])('refreshes missed shared archive metadata at startup: %s', async (archived) => {
  rows.projects = [{ ...repo.projects.findById(projectId), is_archived: archived, updated_at: '2099-01-01T00:00:00.000Z' }]
  await syncProjectDown(projectId, 'u')
  expect(repo.projects.findById(projectId)).toMatchObject({ is_archived: archived, is_shared: 1, updated_at: '2099-01-01T00:00:00.000Z' })
})


it.each(['fullPull', 'sharedStartup'])('preserves imported status/task tombstones and timestamps through %s', async (mode) => {
  const importedId = mode === 'fullPull' ? 'fresh-import' : projectId
  const stamp = '2020-01-01T00:00:00.000Z', deleted = '2020-01-02T00:00:00.000Z'
  const project = { ...repo.projects.findById(projectId)!, id: importedId }
  const status = { ...repo.statuses.findById('open')!, id: 'imported-open', project_id: importedId, created_at: stamp, updated_at: stamp }
  rows.projects = [project]
  rows.project_members = [{ project_id: importedId, user_id: 'u', role: 'member' }]
  rows.statuses = [status, { ...status, id: 'imported-deleted', deleted_at: deleted, updated_at: deleted }]
  const template = repo.tasks.create({ id: 'template', project_id: projectId, status_id: 'open', owner_id: 'u', title: 'Synthetic template' })
  const task = { ...template, id: 'imported-parent', project_id: importedId, status_id: status.id, created_at: stamp, updated_at: stamp }
  rows.tasks = [
    { ...task, id: 'imported-leaf', parent_id: 'imported-middle' },
    { ...task, id: 'imported-middle', parent_id: task.id },
    { ...task, id: 'imported-deleted-task', status_id: 'imported-deleted', deleted_at: deleted, updated_at: deleted },
    task
  ]
  if (mode === 'fullPull') await fullPull('u')
  else await syncProjectDown(importedId, 'u')
  expect(repo.statuses.findById('imported-deleted')).toMatchObject({ created_at: stamp, updated_at: deleted, deleted_at: deleted })
  expect(repo.statuses.findByProjectId(importedId).map((row) => row.id)).not.toContain('imported-deleted')
  expect(repo.tasks.findById('imported-deleted-task')).toMatchObject({ created_at: stamp, updated_at: deleted, deleted_at: deleted })
  expect(repo.tasks.findById('imported-parent')).toMatchObject({ created_at: stamp, updated_at: stamp, deleted_at: null })
  expect(repo.tasks.findById('imported-leaf')).toMatchObject({ parent_id: 'imported-middle', updated_at: stamp })
})
it('R4/review-1: reads every remote task before project-wide queued label cleanup', async () => {
  repo.labels.create({ id: 'removed-label', user_id: 'u', name: 'Removed' })
  repo.labels.addToProject(projectId, 'removed-label')
  repo.labels.removeFromProject(projectId, 'removed-label')
  rows.tasks = Array.from({ length: 1101 }, (_, index) => ({ id: `cleanup-${String(index).padStart(4, '0')}`, project_id: projectId }))
  rows.task_labels = rows.tasks.map((task) => ({ task_id: task.id, label_id: 'removed-label' }))
  await replaySpecialEntry(context.client, { table_name: 'task_labels', payload: JSON.stringify({ projectId, labelId: 'removed-label' }) } as never, context)
  expect(rows.task_labels).toHaveLength(0)
  expect(pageCounts.tasks).toBe(3)
})
it('R4/review-1: reconciles every remote junction for one queued task', async () => {
  repo.tasks.create({ id: 't', project_id: projectId, status_id: 'open', owner_id: 'u', title: 'Task' })
  rows.task_labels = Array.from({ length: 1101 }, (_, index) => ({ task_id: 't', label_id: `label-${String(index).padStart(4, '0')}` }))
  await replaySpecialEntry(context.client, { table_name: 'task_labels', payload: '{"task_id":"t"}' } as never, context)
  expect(rows.task_labels).toHaveLength(0)
  expect(pageCounts.task_labels).toBe(3)
})
