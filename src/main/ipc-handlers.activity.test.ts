import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { migrations } from './database/migrations'
import { createRepositories } from './repositories'
import type { TodoozyAPI } from '../preload/index.d'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  database: null as unknown as DatabaseSync
}))
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => harness.handlers.set(channel, fn) }, safeStorage: {}, BrowserWindow: {}, dialog: {}, shell: {}, app: {} }))
vi.mock('keytar', () => ({ default: {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./database', () => ({ getDatabase: () => harness.database, switchDatabase: vi.fn(), getDatabasePath: vi.fn() }))
vi.mock('./quick-add', () => ({ hideQuickAddWindow: vi.fn() }))
vi.mock('./index', () => ({ registerQuickAddShortcut: vi.fn(), registerAppToggleShortcut: vi.fn(), getMainWindow: vi.fn() }))
vi.mock('./tray', () => ({ setTrayUserId: vi.fn(), refreshTray: vi.fn(), setTimerState: vi.fn(), clearTimerState: vi.fn() }))
vi.mock('../renderer/src/services/PersonalSyncService', () => ({ pushTask: vi.fn(), deleteTaskFromSupabase: vi.fn(), pushProjectLabel: vi.fn() }))
vi.mock('../renderer/src/shared/stores/savedViewStore', () => ({ useSavedViewStore: { getState: () => ({ scheduleRecount: vi.fn() }) } }))
import { registerIpcHandlers } from './ipc-handlers'
import { useTaskStore } from '../renderer/src/shared/stores/taskStore'
import { useAuthStore } from '../renderer/src/shared/stores/authStore'
import { captureSyncProducer } from '../renderer/src/services/syncContext'

let databases: DatabaseSync[]
let repositories: ReturnType<typeof createRepositories>[]
const invoke = async (channel: string, ...args: unknown[]) => harness.handlers.get(channel)!({}, ...args)
beforeEach(async () => {
  databases = [new DatabaseSync(':memory:'), new DatabaseSync(':memory:')]
  repositories = databases.map((db) => {
    db.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)')
    for (const migrate of migrations) migrate(db)
    const repo = createRepositories(db)
    repo.users.create({ id: 'a', email: 'a@example.invalid', display_name: null, avatar_url: null })
    repo.projects.create({ id: 'p', name: 'Project', owner_id: 'a' })
    repo.statuses.create({ id: 's', project_id: 'p', name: 'Open' })
    repo.statuses.create({ id: 's2', project_id: 'p', name: 'Other' })
    repo.labels.create({ id: 'l', user_id: 'a', name: 'Label' })
    return repo
  })
  harness.database = databases[0]
  harness.handlers.clear()
  registerIpcHandlers()
  await invoke('auth:switchDatabase', 'a')
  const api = new Proxy({}, { get: (_, namespace: string) => new Proxy({}, { get: (_, method: string) => (...args: unknown[]) => invoke(`${namespace}:${method}`, ...args) }) })
  vi.stubGlobal('window', { api: api as TodoozyAPI })
  useAuthStore.setState({ currentUser: { id: 'a' } as never })
  useTaskStore.setState({ tasks: {}, taskLabels: {}, showDetailPanel: false })
})
afterEach(async () => { await new Promise((done) => setTimeout(done, 0)); vi.unstubAllGlobals(); databases.forEach((db) => db.close()) })
it('logs actual task-store activity through the registered bound IPC boundary', async () => {
  const store = useTaskStore.getState()
  await store.createTask({ id: 't', project_id: 'p', status_id: 's', owner_id: 'a', title: 'Task' })
  await store.updateTask('t', { title: 'Edited', status_id: 's2', priority: 2, due_date: '2026-01-01', assigned_to: 'a', recurrence_rule: 'FREQ=DAILY', reference_url: 'https://example.invalid', is_in_my_day: 1 })
  await store.addLabel('t', 'l')
  await store.removeLabel('t', 'l')
  await store.createSubtask('t', { id: 'child', project_id: 'p', status_id: 's', owner_id: 'a', title: 'Child' })
  await store.updateTask('t', { is_archived: 1 })
  await store.updateTask('t', { is_archived: 0 })
  await store.deleteTask('child')
  await new Promise((done) => setTimeout(done, 0))
  expect(repositories[0].activityLog.findByTaskId('t').map((row) => row.action)).toEqual(expect.arrayContaining(['created', 'title_changed', 'status_changed', 'priority_changed', 'due_date_changed', 'assigned', 'recurrence_changed', 'reference_url_changed', 'pinned_to_my_day', 'label_added', 'label_removed', 'archived', 'unarchived']))
  expect(repositories[0].activityLog.findByTaskId('child').map((row) => row.action)).toEqual(expect.arrayContaining(['created', 'deleted']))
})
it.each(['account', 'database'])('rejects stale activity after a %s switch without reaching another database', async (change) => {
  const origin = captureSyncProducer()
  const context = await window.api.sync.captureContext()
  harness.database = databases[1]
  await invoke('auth:switchDatabase', change === 'account' ? 'b' : 'a')
  const create = vi.spyOn(repositories[1].activityLog, 'create')
  await expect(origin.api.activityLog.create({ id: 'log', task_id: 't', user_id: 'a', action: 'created' })).rejects.toThrow('database changed')
  await expect(invoke('sync:invokeContext', context, 'activityLog:create', [])).rejects.toThrow('database changed')
  expect(create).not.toHaveBeenCalled()
  expect(databases[1].prepare('SELECT count(*) AS n FROM activity_log').get()?.n).toBe(0)
})
it('does not permit unrelated activity channels through the guarded registry', async () => {
  const context = await window.api.sync.captureContext()
  await expect(invoke('sync:invokeContext', context, 'activityLog:deleteByTaskId', ['t'])).rejects.toThrow('Unsupported')
})
