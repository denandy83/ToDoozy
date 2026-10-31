import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { migrations } from '../../../main/database/migrations'
import { createRepositories } from '../../../main/repositories'
import { useAuthStore } from '../shared/stores/authStore'
import { getSupabase } from '../lib/supabase'
import { fullPull, reconcile, requestSyncCatchUp, forceReconnectAllPersonal, subscribeToPersonalProject, unsubscribeAllPersonal, pullNewTasks, pullStatuses, pullTaskLabelsForTasks } from './PersonalSyncService'
import { syncProjectDown, processSyncQueue, setOnlineStatus, subscribeToProject, forceReconnectAllShared, unsubscribeAll } from './SyncService'
import { reconcileTable, SYNC_TABLES } from './syncTables'
import { replaySpecialEntry } from './syncQueueReplay'
import { refreshSearchIndex } from './searchSync'
import { refreshProjectLabels } from './remoteProjectRefresh'
import { captureSyncContext, type SyncContext } from './syncContext'
import { subscribeToUserChannel, forceReconnectUserChannel, unsubscribeUserChannel } from './UserChannelService'
import { useSyncStore } from '../shared/stores/syncStore'
import { isSuspended } from './powerState'

vi.mock('./powerState',()=>({isSuspended:vi.fn(()=>false)}))
vi.mock('./sessionRecovery',()=>({requireSession:vi.fn(async()=>({user:{id:'u'},access_token:'synthetic'}))}))
vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }))
vi.mock('../shared/stores/logStore', async (importOriginal) => ({ ...await importOriginal<typeof import('../shared/stores/logStore')>(), logEvent: vi.fn() }))
vi.mock('./syncContext', async(importOriginal) => ({ ...await importOriginal<typeof import('./syncContext')>(), captureSyncContext: vi.fn(async () => context) }))
vi.mock('../shared/stores/labelStore', () => ({ useLabelStore: { getState: () => ({ hydrateAllLabels: async () => {}, hydrateLabels: async () => {} }) } }))
vi.mock('../shared/stores/taskStore', () => ({ useTaskStore: { getState: () => ({ hydrateAllTaskLabels: async () => {}, hydrateAllForUser: async () => {}, hydrateAllForProject: async () => {} }) } }))

let db: DatabaseSync
let repo: ReturnType<typeof createRepositories>
let context: SyncContext
let rows: Record<string, Array<Record<string, unknown>>>
let rejectedStatus: string | null
let failedTable: string | null
let pageCounts: Record<string, number>
let projectId: string
let sequence = 0
let channels: Array<{ state: string; status: (status:string) => void }>
let beforeQuery: (() => Promise<void>) | null

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
  const [, key, operator, encoded] = predicate.match(/^([^.]+)\.(eq|gt|lte|is)\.(.*)$/)!
  let value: unknown
  try { value = JSON.parse(encoded) } catch { value = encoded }
  if (operator === 'is') return (row[key] ?? null) === value
  if (operator === 'lte') return String(row[key]) <= String(value)
  return operator === 'eq' ? row[key] === value : String(row[key]) > String(value)
}
function makeClient(): SupabaseClient {
  return {
    channel() {
      const channel={state:'joined',status:(_status:string)=>{},on(){return channel},subscribe(callback:(status:string)=>void){channel.status=callback;channels.push(channel);return channel}}
      return channel
    }, removeChannel:async()=>{},
    from(table: string) {
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    const order: string[] = []
    let limit = 1000, columns = '*'
    let values: Array<Record<string, unknown>> | null = null
    let patch: Record<string, unknown> | null = null
    let remove = false
    const chain = {
      upsert(rows: Record<string, unknown> | Array<Record<string, unknown>>) { values = Array.isArray(rows) ? rows : [rows]; return chain },
      update(value: Record<string, unknown>) { patch = value; return chain },
      lte(key: string, value: string) { filters.push((row) => String(row[key]) <= value); return chain },
      delete() { remove = true; return chain },
      select(value = '*') { columns = value; return chain },
      eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return chain },
      is(key: string, value: unknown) { filters.push((row) => (row[key] ?? null) === value); return chain },
      in(key: string, values: unknown[]) { filters.push((row) => values.includes(row[key])); return chain },
      gt(key: string, value: string) { filters.push((row) => String(row[key]) > value); return chain },
      order(key: string) { order.push(key); return chain },
      limit(value: number) { limit = Math.min(value, 1000); return chain },
      or(value: string) { filters.push((row) => parts(value).some((part) => matches(row, part))); return chain },
      maybeSingle: async () => ({ data: (rows[table] ?? []).find((row) => filters.every((filter) => filter(row))), error: null }),
      single: async () => ({ data: (rows[table] ?? []).find((row) => filters.every((filter) => filter(row))), error: null }),
      async then(resolve: (value: unknown) => unknown) {
        if(beforeQuery){const callback=beforeQuery;beforeQuery=null;await callback()}
        if (values) {
          if (table === 'tasks' && rejectedStatus && values.some((row) => row.status_id === rejectedStatus)) return Promise.resolve(resolve({ data: null, error: { message: 'Status must be active and belong to the task project' } }))
          for (const value of values) {
            const keys=table==='task_labels'?['task_id','label_id']:table==='project_labels'?['project_id','label_id']:['id']
            const existing = (rows[table] ?? []).find((row) => keys.every((key)=>row[key]===value[key]))
            if (existing && (table.endsWith('_labels') || Date.parse(String(value.updated_at)) >= Date.parse(String(existing.updated_at)))) Object.assign(existing, value)
            else if (!existing) (rows[table] ??= []).push({ ...value })
          }
          return Promise.resolve(resolve({ data: [], error: null }))
        }
        if (patch) {
          const selected = (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
          if (table !== 'projects') for (const row of selected) Object.assign(row, patch)
          return Promise.resolve(resolve({ data: selected, error: null }))
        }
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
  vi.mocked(captureSyncContext).mockClear()
  projectId = `project-${++sequence}`
  db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)')
  for (const migrate of migrations) migrate(db)
  repo = createRepositories(db)
  repo.users.create({ id: 'u', email: 'u@example.invalid', display_name: null, avatar_url: null })
  repo.projects.create({ id: projectId, owner_id: 'u', name: 'Project' })
  repo.statuses.create({ id: 'open', project_id: projectId, name: 'Open' })
  channels=[];beforeQuery=null;vi.mocked(isSuspended).mockReturnValue(false)
  rows = {}; pageCounts = {}; failedTable = null; rejectedStatus = null
  const client = makeClient()
  const api = new Proxy({}, {
    get: (_, ns: keyof typeof repo) => new Proxy({}, {
      get: (_, method: string) => async (...args: unknown[]) => {
        if (String(ns) === 'sync') {
          if (method === 'captureContext') return {userId:'u',generation:sequence}
          if (method === 'invokeContext') {const [,channel,values]=args;const [namespace,operation]=String(channel).split(':');return (api as Record<string,Record<string,(...args:unknown[])=>unknown>>)[namespace][operation](...values as unknown[])}
          if (method === 'getQueue') return repo.syncQueue.findAll()
          if (method === 'count') return repo.syncQueue.count()
          if (method === 'dequeue') return repo.syncQueue.dequeue(String(args[0]))
        }
        const target = repo[ns] as unknown as Record<string, (...args: unknown[]) => unknown>
        return target[ns === 'tasks' && method === 'applyRemote' ? 'applyRemoteTask' : method](...args)
      }
    })
  })
  context = { api: api as never, client, assertCurrent() { /* The fixture uses one fixed account and database. */ }, isCurrent: async () => true, scope: projectId }
  vi.mocked(getSupabase).mockResolvedValue(client)
  vi.stubGlobal('window', { api })
  vi.stubGlobal('navigator', { onLine: true })
  useAuthStore.setState({ currentUser: { id: 'u' } as never, isOffline:false })
})
afterEach(async () => { await unsubscribeAllPersonal();await unsubscribeAll();await unsubscribeUserChannel();db.close();vi.unstubAllGlobals() })

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

it.each([0, 1].flatMap((archived) => ['startup', 'search', 'full', 'incremental'].map((path) => ({ archived, path }))))(
  'R15: original remote version cannot resurrect a local tombstone via $path archive=$archived', async ({ archived, path }) => {
    const t1 = '2026-01-01T01:00:00.000Z', t5 = '2026-01-01T05:00:00.000Z', t10 = '2026-01-01T10:00:00.000Z'
    const task = repo.tasks.create({ id: 'deleted', project_id: projectId, owner_id: 'u', title: 'Deleted', status_id: 'open' })
    db.prepare('UPDATE tasks SET deleted_at=?,updated_at=? WHERE id=?').run(t5,t5,task.id)
    db.prepare('UPDATE projects SET is_archived=?,archive_updated_at=?,updated_at=? WHERE id=?').run(archived,t10,t10,projectId)
    rows.projects = [{ ...repo.projects.findById(projectId) }]
    rows.project_members = [{ project_id: projectId, user_id: 'u' }]
    rows.tasks = [{ ...task, is_archived: archived ? 0 : 1, updated_at: t1, deleted_at: null }]
    if (path !== 'full') repo.projects.addMember(projectId,'u','owner')
    if (path === 'startup') await syncProjectDown(projectId,'u')
    else if (path === 'search') await refreshSearchIndex('u')
    else if (path === 'full') {
      const importedId = `${projectId}-imported`
      rows.projects = [{ ...rows.projects[0], id: importedId }]
      rows.project_members = [{ project_id: importedId, user_id: 'u' }]
      rows.statuses = [{ ...repo.statuses.findById('open'), id: 'full-open', project_id: importedId }]
      rows.tasks = [{ ...rows.tasks[0], project_id: importedId, status_id: 'full-open' }]
      await fullPull('u')
      expect(repo.projects.findById(importedId)?.archive_updated_at).toBe(t10)
    } else await pullNewTasks(projectId,context)
    expect(repo.tasks.findById(task.id)).toMatchObject({ deleted_at: t5, updated_at: t5 })
  }
)

it.each([0, 1].flatMap((archived) => ['startup', 'search', 'full', 'incremental'].map((path) => ({ archived, path }))))(
  'preserves newer metadata during $path archive inheritance=$archived', async ({ archived, path }) => {
    const t1 = '2026-01-01T01:00:00.000Z', t8 = '2026-01-01T08:00:00.000Z', t10 = '2026-01-01T10:00:00.000Z'
    const task = repo.tasks.create({ id: 'edited', project_id: projectId, owner_id: 'u', title: 'New', description: 'New description', status_id: 'open' })
    db.prepare('UPDATE tasks SET updated_at=? WHERE id=?').run(t8, task.id)
    db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(t8, projectId)
    rows.projects = [{ ...repo.projects.findById(projectId), is_archived: archived, archive_updated_at: t10, updated_at: t1, name: 'Old name' }]
    rows.project_members = [{ project_id: projectId, user_id: 'u' }]
    rows.tasks = [{ ...task, title: 'Old', description: 'Old description', is_archived: archived ? 0 : 1, updated_at: t1 }]
    repo.projects.addMember(projectId, 'u', 'owner')
    if (path === 'startup') await syncProjectDown(projectId, 'u')
    else if (path === 'search') await refreshSearchIndex('u')
    else if (path === 'full') {
      const imported = `${projectId}-imported`
      rows.projects = [{ ...rows.projects[0], id: imported }]
      rows.project_members = [{ project_id: imported, user_id: 'u' }]
      rows.statuses = [{ ...repo.statuses.findById('open'), id: 'full-open', project_id: imported }]
      rows.tasks = [{ ...rows.tasks[0], project_id: imported, status_id: 'full-open' }]
      await fullPull('u')
      expect(repo.projects.findById(imported)?.archive_updated_at).toBe(t10)
    } else {
      repo.projects.applyRemote(rows.projects[0] as never)
      await pullNewTasks(projectId, context)
    }
    expect(repo.tasks.findById(task.id)).toMatchObject({ title: 'New', description: 'New description', status_id: 'open', updated_at: t8, is_archived: path === 'full' ? task.is_archived : archived })
    if (path !== 'full') expect(repo.projects.findById(projectId)).toMatchObject({ name: 'Project', updated_at: t8, archive_updated_at: t10 })
    const current = repo.tasks.findById(task.id)!
    repo.tasks.applyRemoteTask({ ...current, title: 'Later metadata', updated_at: '2026-01-01T09:00:00.000Z' })
    expect(repo.tasks.findById(task.id)?.title).toBe('Later metadata')
  }
)

it.each([0, 1])('converges rejected equal-version archive=%s before queue completion and subsequent pull', async (state) => {
  setOnlineStatus(true)
  const t10 = '2026-01-01T10:00:00.000Z', t11 = '2026-01-01T11:00:00.000Z'
  db.prepare('UPDATE projects SET updated_at=?,archive_updated_at=?,is_archived=? WHERE id=?').run(t10, t10, state, projectId)
  for (const id of ['affected', 'later', 'deleted']) {
    repo.tasks.create({ id, project_id: projectId, owner_id: 'u', status_id: 'open', title: id })
    db.prepare('UPDATE tasks SET updated_at=?,archive_updated_at=?,is_archived=?,deleted_at=? WHERE id=?').run(id === 'later' ? t11 : t10, id === 'later' ? t11 : t10, state, id === 'deleted' ? t10 : null, id)
  }
  repo.syncQueue.enqueue('projects', projectId, 'UPDATE', JSON.stringify({ id: projectId, archive_with_tasks: true, is_archived: state }))
  rows.projects = [{ ...repo.projects.findById(projectId), is_archived: 1 - state }]
  rows.tasks = [{ ...repo.tasks.findById('affected'), is_archived: 1 - state }, { ...repo.tasks.findById('later') }]
  expect(await processSyncQueue(context)).toBe(1)
  expect(repo.syncQueue.count()).toBe(0)
  expect(repo.tasks.findById('affected')).toMatchObject({ is_archived: 1 - state, updated_at: t10 })
  expect(repo.tasks.findById('later')).toMatchObject({ is_archived: state, updated_at: t11 })
  expect(repo.tasks.findById('deleted')).toMatchObject({ is_archived: state, deleted_at: t10 })
  await pullNewTasks(projectId, context)
  expect(repo.tasks.findById('affected')?.is_archived).toBe(1 - state)
  expect(repo.tasks.findById('later')?.is_archived).toBe(state)
})

it.each([0, 1])('reconciles archive=%s beyond a metadata high-water without losing newer metadata', async (state) => {
  const t1 = '2026-01-01T01:00:00.000Z', t8 = '2026-01-01T08:00:00.000Z', t10 = '2026-01-01T10:00:00.000Z'
  db.prepare('UPDATE projects SET name=?,updated_at=? WHERE id=?').run('Local newer', t8, projectId)
  rows.projects = [{ ...repo.projects.findById(projectId), name: 'Remote old', updated_at: t1, archive_updated_at: t10, is_archived: state }]
  repo.syncMeta.setHighWater('u', 'u', 'projects', '2026-01-02T00:00:00.000Z')
  const result = await reconcileTable(SYNC_TABLES.projects as Parameters<typeof reconcileTable>[0], 'u', 'u')
  expect(result.skipped).toBe(false)
  expect(result.failed).toBe(0)
  expect(repo.projects.findById(projectId)).toMatchObject({ name: 'Local newer', updated_at: t8, archive_updated_at: t10, is_archived: state })
  expect(rows.projects[0]).toMatchObject({ name: 'Local newer', updated_at: t8, archive_updated_at: t10, is_archived: state })
})

it('pulls persisted reorder versions for tasks already present on the recipient', async () => {
  const initial = '2026-01-01T00:00:00.000Z'
  for (const id of ['first', 'second']) {
    repo.tasks.create({ id, project_id: projectId, owner_id: 'u', status_id: 'open', title: id })
    db.prepare('UPDATE tasks SET updated_at=?,order_index=? WHERE id=?').run(initial, id === 'first' ? 0 : 1, id)
  }
  repo.tasks.reorder(['second', 'first'])
  rows.tasks = ['first', 'second'].map((id) => ({ ...repo.tasks.findById(id) }))
  for (const id of ['first', 'second']) db.prepare('UPDATE tasks SET updated_at=?,order_index=? WHERE id=?').run(initial, id === 'first' ? 0 : 1, id)
  expect(await pullNewTasks(projectId, context)).toBe(2)
  expect(repo.tasks.findById('first')?.order_index).toBe(1)
  expect(repo.tasks.findById('second')?.order_index).toBe(0)
})

it.each([0, 1])('discovers independent archive=%s changes below a later metadata watermark and converges equal conflicts', async (state) => {
  const stamp = '2026-01-01T01:00:00.000Z', archive = '2026-01-01T12:00:00.000Z'
  const original = repo.tasks.create({ id: 'choice', project_id: projectId, owner_id: 'u', status_id: 'open', title: 'Choice' })
  db.prepare('UPDATE tasks SET updated_at=? WHERE id=?').run(stamp, original.id)
  rows.tasks = [{ ...repo.tasks.findById('choice') }, { ...original, id: 'later-metadata', updated_at: '2026-01-03T00:00:00.000Z' }]
  await pullNewTasks(projectId, context)
  rows.tasks[0] = { ...rows.tasks[0], is_archived: state, archive_updated_at: archive }
  await pullNewTasks(projectId, context)
  expect(repo.tasks.findById('choice')).toMatchObject({ is_archived: state, archive_updated_at: archive, updated_at: stamp })
  db.prepare('UPDATE tasks SET is_archived=? WHERE id=?').run(1-state, 'choice')
  await pullNewTasks(projectId, context)
  expect(repo.tasks.findById('choice')?.is_archived).toBe(state)
})

it('refreshes shared task/status metadata during public reconcile before replaying retained archive intent',async()=>{
  setOnlineStatus(true)
  repo.projects.addMember(projectId,'u','owner')
  repo.projects.update(projectId,{is_shared:1})
  const task=repo.tasks.create({id:'recover',project_id:projectId,owner_id:'u',status_id:'open',title:'Local'})
  db.prepare('UPDATE tasks SET updated_at=?,archive_updated_at=?,is_archived=1 WHERE id=?').run('2099-01-01T08:00:00.000Z','2099-01-01T12:00:00.000Z',task.id)
  rows.projects=[{...repo.projects.findById(projectId)}]
  rows.statuses=[{...repo.statuses.findById('open'),updated_at:'2099-01-01T09:00:00.000Z',deleted_at:'2099-01-01T09:00:00.000Z'},{...repo.statuses.findById('open'),id:'replacement',name:'Replacement',updated_at:'2099-01-01T09:00:00.000Z'}]
  rows.tasks=[{...repo.tasks.findById(task.id),title:'Cloud newer metadata',status_id:'replacement',updated_at:'2099-01-01T09:00:00.000Z',archive_updated_at:'2099-01-01T10:00:00.000Z',is_archived:0}]
  rejectedStatus='open'
  repo.syncQueue.enqueue('tasks',task.id,'UPDATE',JSON.stringify(repo.tasks.findById(task.id)))
  expect(await processSyncQueue(context)).toBe(0)
  expect(repo.syncQueue.count()).toBe(1)
  const personal=repo.projects.create({id:'personal-label-project',owner_id:'u',name:'Personal'})
  repo.projects.addMember(personal.id,'u','owner')
  rows.projects.push({...personal})
  rows.project_labels=[];rows.user_labels=[]
  for(const project_id of [projectId,personal.id]) {
    const label=repo.labels.create({id:project_id+'-label',user_id:'u',name:project_id+' Label'})
    repo.labels.applyRemoteProjectLabel({project_id,label_id:label.id,created_at:'2020-01-01T00:00:00Z',deleted_at:'2020-01-01T10:00:00Z'})
    rows.user_labels.push({...label})
    rows.project_labels.push({project_id,label_id:label.id,created_at:'2020-01-01T20:00:00Z',deleted_at:null})
  }
  const canonical=repo.labels.create({id:'displayed-canonical',user_id:'u',name:'Canonical removal'})
  repo.labels.applyRemoteProjectLabel({project_id:projectId,label_id:canonical.id,created_at:'2020-01-01T00:00:00Z',deleted_at:null})
  repo.tasks.applyRemoteTaskLabels(task.id,[canonical.id])
  rows.user_labels.push({...canonical},{...canonical,id:'foreign-assignment',user_id:'other'})
  rows.project_labels.push({project_id:projectId,label_id:canonical.id,created_at:'2020-01-01T00:00:00Z',deleted_at:null},{project_id:projectId,label_id:'foreign-assignment',created_at:'2020-01-01T00:00:00Z',deleted_at:null})
  rows.task_labels=[{task_id:task.id,label_id:'foreign-assignment',deleted_at:null}]
  repo.tasks.removeLabel(task.id,canonical.id)
  await reconcile('u')
  expect(repo.tasks.getLabels(task.id)).toEqual([])
  expect(rows.task_labels).toEqual([])
  expect(rows.project_labels.filter((row)=>row.label_id===canonical.id || row.label_id==='foreign-assignment').every((row)=>row.deleted_at===null)).toBe(true)
  expect(rows.user_labels.find((row)=>row.id==='foreign-assignment')?.user_id).toBe('other')
  for(const project_id of [projectId,personal.id]) {
    expect(repo.labels.findByProjectId(project_id).map((row)=>row.id).sort()).toEqual((project_id===projectId?[project_id+'-label',canonical.id,'foreign-assignment']:[project_id+'-label']).sort())
    expect(rows.project_labels.find((row)=>row.project_id===project_id)).toMatchObject({deleted_at:null,created_at:'2020-01-01T20:00:00Z'})
  }
  expect(repo.syncQueue.count()).toBe(0)
  expect(rows.tasks[0]).toMatchObject({title:'Cloud newer metadata',status_id:'replacement',is_archived:1,archive_updated_at:'2099-01-01T12:00:00.000Z'})
  expect(repo.tasks.findById(task.id)).toMatchObject({status_id:'replacement',is_archived:1})
})

it.each(['startup','realtime'])('preserves pending project label removal through actual %s imports',async(path)=>{
  repo.projects.addMember(projectId,'u','owner')
  repo.labels.create({id:'pending-label',user_id:'u',name:'Pending'})
  repo.labels.addToProject(projectId,'pending-label')
  const task=repo.tasks.create({id:'label-task',project_id:projectId,owner_id:'u',status_id:'open',title:'Task'})
  repo.tasks.addLabel(task.id,'pending-label')
  repo.labels.removeFromProject(projectId,'pending-label')
  const current=db.prepare('SELECT created_at,deleted_at FROM project_labels WHERE project_id=? AND label_id=?').get(projectId,'pending-label')!
  rows.projects=[{...repo.projects.findById(projectId)}]
  rows.statuses=[{...repo.statuses.findById('open')}]
  rows.tasks=[{...task}]
  rows.user_labels=[{...repo.labels.findById('pending-label')}]
  rows.project_labels=[{project_id:projectId,label_id:'pending-label',created_at:'2020-01-01T00:00:00.000Z',deleted_at:null}]
  rows.task_labels=[{task_id:task.id,label_id:'pending-label',deleted_at:null}]
  if(path==='startup') await syncProjectDown(projectId,'u')
  else await refreshProjectLabels(projectId,context)
  expect(db.prepare('SELECT deleted_at FROM project_labels WHERE project_id=? AND label_id=?').get(projectId,'pending-label')?.deleted_at).toBe(current.deleted_at)
  expect(repo.labels.findByTaskId(task.id)).toEqual([])
  expect(repo.syncQueue.findAll().filter((entry)=>JSON.parse(entry.payload).remove_project_label)).toHaveLength(1)
  expect(repo.syncQueue.findAll().filter((entry)=>JSON.parse(entry.payload).assignment_intent)).toHaveLength(1)
})

it.each(['complete','second-page-failure'])('converges a 502-to-501 assignment snapshot only after a full read (%s)',async(mode)=>{
  const task=repo.tasks.create({id:'paged-labels',project_id:projectId,owner_id:'u',status_id:'open',title:'Paged'})
  const ids=Array.from({length:502},(_,index)=>'page-label-'+String(index).padStart(4,'0'))
  rows.user_labels=[]
  for(const id of ids) {
    const label=repo.labels.create({id,user_id:'u',name:id})
    rows.user_labels.push({...label})
    repo.labels.applyRemoteProjectLabel({project_id:projectId,label_id:id,created_at:task.created_at,deleted_at:null})
  }
  repo.tasks.applyRemoteTaskLabels(task.id,ids)
  rows.task_labels=ids.slice(0,501).map((label_id)=>({task_id:task.id,label_id,deleted_at:null}))
  if(mode==='second-page-failure') failedTable='task_labels'
  await pullTaskLabelsForTasks([task.id],'u',context)
  expect(pageCounts.task_labels).toBe(2)
  expect(repo.tasks.getLabels(task.id)).toHaveLength(mode==='complete'?501:502)
  expect(repo.labels.findByProjectId(projectId)).toHaveLength(502)
})

it.each([0,1])('keeps clock-ahead family removal through public reconciliation and later re-add (shared=%s)',async(shared)=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2020-01-01T00:00:00Z')
  try {
    repo.projects.addMember(projectId,'u','owner')
    repo.projects.update(projectId,{is_shared:shared})
    const task=repo.tasks.create({id:'clock-reconcile',project_id:projectId,owner_id:'u',status_id:'open',title:'Clock'})
    const label=repo.labels.create({id:'clock-reconcile-label',user_id:'u',name:'Clock'})
    const link={project_id:projectId,label_id:label.id,created_at:'2031-01-01T00:00:00.000Z',deleted_at:null}
    repo.labels.applyRemoteProjectLabel(link);repo.tasks.applyRemoteTaskLabels(task.id,[label.id])
    rows.projects=[{...repo.projects.findById(projectId)}];rows.statuses=[{...repo.statuses.findById('open')}]
    rows.tasks=[{...task}];rows.user_labels=[{...label}];rows.project_labels=[{...link}]
    rows.task_labels=[{task_id:task.id,label_id:label.id,deleted_at:null}]
    expect(repo.labels.removeFromProject(projectId,label.id)).toBe(true)
    setOnlineStatus(true)
    await processSyncQueue(context);await reconcile('u');await processSyncQueue(context)
    expect(repo.syncQueue.count()).toBe(0)
    expect(rows.project_labels[0].deleted_at).toBe('2031-01-01T00:00:00.001Z')
    expect(rows.task_labels).toEqual([]);expect(repo.labels.findByTaskId(task.id)).toEqual([])
    repo.tasks.addLabel(task.id,label.id)
    await processSyncQueue(context);await reconcile('u');await processSyncQueue(context)
    expect(repo.syncQueue.count()).toBe(0)
    expect(rows.project_labels[0]).toMatchObject({deleted_at:null,created_at:'2031-01-01T00:00:00.002Z'})
    expect(rows.task_labels).toEqual([{task_id:task.id,label_id:label.id,deleted_at:null}])
    expect(repo.labels.findByTaskId(task.id).map((row)=>row.id)).toEqual([label.id])
  } finally {vi.useRealTimers()}
})

it('reconciles shared and user data on resume even when every channel rejoined while suspended',async()=>{
  repo.projects.addMember(projectId,'u','owner')
  repo.projects.update(projectId,{is_shared:1})
  rows.projects=[{...repo.projects.findById(projectId)}]
  rows.statuses=[{...repo.statuses.findById('open')}]
  await subscribeToProject(projectId)
  await subscribeToUserChannel('u')
  vi.mocked(isSuspended).mockReturnValue(true)
  for(const channel of channels)channel.status('SUBSCRIBED')
  await Promise.resolve();await Promise.resolve()
  expect(useSyncStore.getState().realtimeConnected).toBe(true)
  rows.tasks=[{id:'missed-shared',project_id:projectId,status_id:'open',owner_id:'u',title:'Missed shared task',created_at:'2026-10-31T00:00:00Z',updated_at:'2026-10-31T00:00:00Z'}]
  rows.user_labels=[{id:'missed-label',user_id:'u',name:'Missed label',color:'#fff',order_index:0,created_at:'2026-10-31T00:00:00Z',updated_at:'2026-10-31T00:00:00Z'}]
  const channelCount=channels.length
  vi.mocked(isSuspended).mockReturnValue(false)
  await Promise.all([forceReconnectAllShared(),forceReconnectUserChannel()])
  expect(channels).toHaveLength(channelCount)
  expect(repo.tasks.findById('missed-shared')?.title).toBe('Missed shared task')
  expect(repo.labels.findById('missed-label')?.name).toBe('Missed label')
})

it('retries personal catch-up on an already joined channel and coalesces concurrent sweeps',async()=>{
  repo.projects.addMember(projectId,'u','owner')
  rows.projects=[{...repo.projects.findById(projectId)}]
  rows.statuses=[{...repo.statuses.findById('open')}]
  await subscribeToPersonalProject(projectId,()=>{})
  vi.mocked(isSuspended).mockReturnValue(true)
  channels[0].status('SUBSCRIBED')
  vi.mocked(isSuspended).mockReturnValue(false)
  let finish!:()=>void,entered!:()=>void
  const started=new Promise<void>(resolve=>{entered=resolve})
  beforeQuery=()=>{entered();return new Promise(resolve=>{finish=resolve})}
  const first=forceReconnectAllPersonal();await started
  const rest=Array.from({length:5},()=>requestSyncCatchUp(context))
  await Promise.resolve();await Promise.resolve()
  rows.tasks=[{id:'missed-personal',project_id:projectId,status_id:'open',owner_id:'u',title:'Missed personal task',created_at:'2026-10-31T00:00:00Z',updated_at:'2026-10-31T00:00:00Z'}]
  finish();await Promise.all([first,...rest])
  expect(repo.tasks.findById('missed-personal')?.title).toBe('Missed personal task')
  expect(pageCounts.tasks).toBeLessThanOrEqual(2)
})

it('keeps routine archived catch-up metadata-only and preserves explicit full reconciliation',async()=>{
  repo.projects.addMember(projectId,'u','owner')
  repo.projects.update(projectId,{is_archived:1})
  rows.projects=[{...repo.projects.findById(projectId)}]
  rows.statuses=[{...repo.statuses.findById('open')}]
  rows.tasks=[{id:'archived-missed',project_id:projectId,status_id:'open',owner_id:'u',title:'Archived task',is_archived:1,created_at:'2026-10-31T00:00:00Z',updated_at:'2026-10-31T00:00:00Z'}]
  await requestSyncCatchUp(context)
  expect(pageCounts.tasks??0).toBe(0);expect(pageCounts.statuses??0).toBe(0);expect(pageCounts.activity_log??0).toBe(0)
  expect(repo.tasks.findById('archived-missed')).toBeUndefined()
  await reconcile('u')
  expect(repo.tasks.findById('archived-missed')?.title).toBe('Archived task')
})

it('does no catch-up while suspended, offline or from an expired account context',async()=>{
  vi.mocked(isSuspended).mockReturnValue(true)
  await requestSyncCatchUp(context)
  vi.mocked(isSuspended).mockReturnValue(false)
  vi.stubGlobal('navigator',{onLine:false});await requestSyncCatchUp(context)
  vi.stubGlobal('navigator',{onLine:true})
  context.isCurrent=async()=>false;await requestSyncCatchUp(context)
  expect(pageCounts).toEqual({})
  expect(vi.mocked(captureSyncContext)).not.toHaveBeenCalled()
})

it.each(['existing', 'remote-only', 'mixed'])('reconciles ancestor order for %s restored trees in a single pass', async mode => {
  const base = repo.tasks.create({ id: 'root', owner_id: 'u', project_id: projectId, status_id: 'open', title: 'Root' })
  const child = repo.tasks.create({ ...base, id: 'child', parent_id: 'root' })
  const grandchild = repo.tasks.create({ ...base, id: 'grandchild', parent_id: 'child' })
  const leaf = repo.tasks.create({ ...base, id: 'leaf', parent_id: 'grandchild' })
  rows.tasks = [leaf, grandchild, child, base].map(task => ({ ...task, updated_at: '2030-01-01T00:00:00.000Z', deleted_at: null }))
  repo.tasks.delete('child')
  db.prepare("UPDATE tasks SET updated_at='2027-01-01T00:00:00Z' WHERE id != 'root'").run()
  repo.tasks.delete('root')
  db.prepare("UPDATE tasks SET updated_at='2028-01-01T00:00:00Z' WHERE id='root'").run()
  if (mode !== 'existing') {
    repo.tasks.hardDelete(mode === 'mixed' ? 'child' : 'root')
  }
  const result = await reconcileTable(SYNC_TABLES.tasks as Parameters<typeof reconcileTable>[0], projectId, 'u', context)
  expect(result.failed).toBe(0)
  expect(repo.tasks.findAllByProject(projectId).map(task => task.id).sort()).toEqual(['child', 'grandchild', 'leaf', 'root'])
  for (const task of repo.tasks.findAllByProject(projectId)) expect(task.updated_at).toBe('2030-01-01T00:00:00.000Z')
})
