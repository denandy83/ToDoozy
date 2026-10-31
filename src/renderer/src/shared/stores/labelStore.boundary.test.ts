import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { migrations } from '../../../../main/database/migrations'
import { createRepositories } from '../../../../main/repositories'
import { useAuthStore } from './authStore'
import { useLabelStore } from './labelStore'
import { useTaskStore } from './taskStore'
import type { Label } from '../../../../shared/types'
import * as sync from '../../services/PersonalSyncService'

vi.mock('../../services/PersonalSyncService', () => ({ pushLabel: vi.fn(async () => {}), pushProjectLabel: vi.fn(async () => {}), deleteLabelFromSupabase: vi.fn(async () => {}), pushRemoveLabelFromProject: vi.fn(async () => {}) }))
let dbs: DatabaseSync[]
let repos: ReturnType<typeof createRepositories>[]
let active: number
let generation: number
let held: string
let rejectReply: boolean
let release: () => void
let started: Promise<void>
let calls: Array<{ database: number; method: string }>
beforeEach(() => {
  active = 0; generation = 1; held = ''; rejectReply = false; calls = []
  let entered!: () => void
  started = new Promise(resolve => { entered = resolve })
  const pending = new Promise<void>(resolve => { release = resolve })
  dbs = [new DatabaseSync(':memory:'), new DatabaseSync(':memory:')]
  repos = dbs.map((db, index) => {
    db.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
    for (const migrate of migrations) migrate(db)
    const repo = createRepositories(db)
    for (const id of ['a', 'b', 'other']) repo.users.create({ id, email: `${id}@example.invalid`, display_name: null, avatar_url: null })
    repo.projects.create({ id: 'p', owner_id: index ? 'b' : 'a', name: 'Project' })
    repo.statuses.create({ id: 's', project_id: 'p', name: 'Open' })
    repo.tasks.create({ id: 't', owner_id: index ? 'b' : 'a', project_id: 'p', status_id: 's', title: 'Private' })
    for (const id of ['l1','l2']) {
      repo.labels.create({ id, user_id: id === 'l2' ? 'other' : index ? 'b' : 'a', name: index ? 'B private' : 'A private', project_id: 'p' })
      repo.tasks.applyRemoteTaskLabels('t', ['l1','l2'])
    }
    return repo
  })
  useAuthStore.setState({ currentUser: { id: 'a' } as never })
  useLabelStore.setState({ labels: Object.fromEntries(repos[0].labels.findByProjectId('p').map(label => [label.id, label])), projectLabels: { p: new Set(['l1','l2']) }, error: null, loading: false })
  vi.clearAllMocks()
  vi.stubGlobal('window', { api: { sync: {
    captureContext: async () => ({ userId: useAuthStore.getState().currentUser?.id, generation }),
    invokeContext: async (origin: { userId: string; generation: number }, channel: string, args: unknown[]) => {
      if (origin.userId !== useAuthStore.getState().currentUser?.id || origin.generation !== generation) throw Error('Database changed')
      const [, method] = channel.split(':')
      calls.push({ database: active, method })
      const repo = repos[active]
      const operations = repo.labels as unknown as Record<string, (...values: unknown[]) => unknown>
      const result = operations[method === 'findAll' ? 'findAllForUser' : method](...args)
      if (held === method) {
        held = ''
        entered(); await pending
        if (rejectReply) throw Error('Synthetic native failure')
      }
      return result
    }
  } } })
})
afterEach(async () => { await new Promise(setImmediate); vi.unstubAllGlobals(); dbs.forEach(db => db.close()) })
const operations = [
  { name: 'create', method: 'create', run: () => useLabelStore.getState().createLabel({ id: 'new', user_id: 'a', project_id: 'p', name: 'New A' }) },
  { name: 'create refresh', method: 'findAll', run: () => useLabelStore.getState().createLabel({ id: 'new', user_id: 'a', name: 'New A' }) },
  { name: 'update', method: 'update', run: () => useLabelStore.getState().updateLabel('l1', { name: 'A changed' }) },
  { name: 'delete', method: 'delete', run: () => useLabelStore.getState().deleteLabel('l1') },
  { name: 'unlink lookup', method: 'findById', run: () => { useLabelStore.setState(state => ({ labels: { l2: state.labels.l2 } })); return useLabelStore.getState().removeFromProject('p', 'l1') } },
  { name: 'unlink batch', method: 'removeFromProject', run: () => useLabelStore.getState().removeFromProject('p', 'l1') },
  { name: 'attach', method: 'addToProject', run: () => useLabelStore.getState().addToProject('p', 'l1') },
  { name: 'reorder', method: 'reorder', run: () => useLabelStore.getState().reorderLabels(['l2','l1']) }
]
it.each(operations.flatMap(operation => ['account','database'].flatMap(change => [false,true].map(failure => ({ ...operation, change, failure })))))('fences held $name after $change replacement (failure=$failure)', async ({ method, run, change, failure }) => {
  held = method; rejectReply = failure
  const operation = run()
  const rejected = expect(operation).rejects.toThrow(/account|database/i)
  await started
  active = 1; generation++
  if (change === 'database') dbs[1].exec("UPDATE labels SET user_id='a' WHERE user_id='b'; UPDATE projects SET owner_id='a'; UPDATE tasks SET owner_id='a'")
  if (change === 'account') useAuthStore.setState({ currentUser: { id: 'b' } as never })
  const label = repos[1].labels.findById('l1')!
  useLabelStore.setState({ labels: { l1: label }, projectLabels: { p: new Set(['l1']) }, error: 'B error', loading: true })
  useTaskStore.setState({ tasks: { t: repos[1].tasks.findById('t')! }, taskLabels: { t: [label] } })
  const before = useLabelStore.getState(), tasks = useTaskStore.getState()
  release(); await rejected
  expect(useLabelStore.getState()).toBe(before)
  expect(useTaskStore.getState()).toBe(tasks)
  expect(calls.every(call => call.database === 0)).toBe(true)
  for (const callback of Object.values(sync)) expect(callback).not.toHaveBeenCalled()
})
it.each(operations)('preserves same-account $name behavior and producer identity', async ({ run }) => {
  await run()
  await new Promise(setImmediate)
  const pushes = Object.values(sync).flatMap(callback => vi.mocked(callback).mock.calls as unknown[][])
  expect(pushes.length).toBeGreaterThan(0)
  for (const args of pushes) {
    const origin = args.at(-1) as { userId: string; isCurrent(): Promise<boolean> }
    expect(origin.userId).toBe('a')
    expect(await origin.isCurrent()).toBe(true)
  }
  expect(useLabelStore.getState().error).toBeNull()
  expect(Object.values(useLabelStore.getState().labels).every((label: Label) => ['a','other'].includes(label.user_id ?? ''))).toBe(true)
})
