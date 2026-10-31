import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
import type { createRepositories } from '../src/main/repositories'
import type { useProjectStore } from '../src/renderer/src/shared/stores/projectStore'
import type { useTaskStore } from '../src/renderer/src/shared/stores/taskStore'
import type { useLabelStore } from '../src/renderer/src/shared/stores/labelStore'

interface Harness {
  repo: ReturnType<typeof createRepositories>
  stores: { useProjectStore: typeof useProjectStore; useTaskStore: typeof useTaskStore; useLabelStore: typeof useLabelStore }
  sandbox: { window: { api: unknown } }
  remote: Record<string, Array<Record<string, unknown>>>
  services: { personal: typeof import('../src/renderer/src/services/PersonalSyncService'); shared: typeof import('../src/renderer/src/services/SyncService') }
  requests: Array<{ table: string; method: string; body: unknown }>
  authorizations: string[]
  nativeCalls: unknown[]
  setAccount(user: string): void
  setSession(token: string, user?: string): void
  context(): Promise<import('../src/renderer/src/services/syncContext').SyncContext>
  beforeRequest(callback: () => Promise<void>): void
  untilIdle(): Promise<void>
  stop(): Promise<void>
}
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs') as { makeHarness(options: { projectCount: number; inspectAuthorization: boolean }): Promise<Harness> }
const opened: Harness[] = []
async function make(): Promise<Harness> {
  const h = await makeHarness({ projectCount: 2, inspectAuthorization: true }); opened.push(h)
  h.repo.users.create({ id: 'third', email: 'third@example.invalid', display_name: null, avatar_url: null })
  h.repo.projects.addMember('p1', 'other', 'member')
  await h.stores.useProjectStore.getState().hydrateProjects('u')
  return h
}
afterEach(async () => { for (const h of opened.splice(0)) await h.stop() })
const mutations = [
  { name: 'create', hold: 'create', run: (h: Harness) => h.stores.useProjectStore.getState().createProject({ id: 'created', owner_id: 'u', name: 'Old private project' }) },
  { name: 'update', hold: 'update', run: (h: Harness) => h.stores.useProjectStore.getState().updateProject('p1', { name: 'Old private update' }) },
  { name: 'delete', hold: 'delete', run: (h: Harness) => h.stores.useProjectStore.getState().deleteProject('p1') },
  { name: 'add member', hold: 'addMember', run: (h: Harness) => h.stores.useProjectStore.getState().addMember('p1', 'third', 'member') },
  { name: 'remove member', hold: 'removeMember', run: (h: Harness) => h.stores.useProjectStore.getState().removeMember('p1', 'other') },
  { name: 'archive', hold: 'archiveWithTasks', run: (h: Harness) => h.stores.useProjectStore.getState().archiveProject('p1') },
  { name: 'restore', hold: 'unarchiveWithTasks', run: (h: Harness) => h.stores.useProjectStore.getState().unarchiveProject('p1') }
]
const heldPaths = [...mutations,
  ...mutations.filter(row => ['add member', 'remove member'].includes(row.name)).map(row => ({ ...row, name: row.name + ' hydration', hold: 'getMembers' })),
  ...mutations.filter(row => ['archive', 'restore'].includes(row.name)).map(row => ({ ...row, name: row.name + ' lookup', hold: 'findById' }))
]
it.each(heldPaths.flatMap(row => ['account', 'database'].flatMap(change => [false, true].map(fail => ({ ...row, change, fail })))))(
  'cancels $name success/error after $change replacement (failure=$fail)', async ({ name, hold, run, change, fail }) => {
    const a = await make(), b = await make()
    const user = change === 'account' ? 'other' : 'u'
    b.setAccount(user); b.setSession('synthetic-new-account', user)
    const replacement = { ...b.repo.projects.findById('p1')!, owner_id: user, name: 'New cache project' }
    if (hold === 'findById') a.stores.useProjectStore.setState({ projects: {} })
    let entered!: () => void, release!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const pending = new Promise<void>(resolve => { release = resolve })
    const methods = a.repo.projects as unknown as Record<string, (...args: unknown[]) => unknown>
    const original = methods[hold].bind(a.repo.projects)
    methods[hold] = async (...args) => {
      const result = original(...args)
      entered(); await pending
      if (fail) throw new Error('Old private native error')
      return result
    }
    const outcome = run(a).then(value => ({ value, error: null }), error => ({ value: null, error: String(error) }))
    await started
    a.setAccount(user); a.setSession('synthetic-new-account', user); a.sandbox.window.api = b.sandbox.window.api
    a.stores.useProjectStore.setState({ projects: { p1: replacement }, members: { p1: b.repo.projects.getMembers('p1') }, currentProjectId: 'p1', error: 'New error', loading: true })
    const before = a.stores.useProjectStore.getState(), calls = b.nativeCalls.length
    a.requests.length = 0; a.authorizations.length = 0
    release(); const result = await outcome; await a.untilIdle()
    expect(a.stores.useProjectStore.getState()).toBe(before)
    expect(b.nativeCalls).toHaveLength(calls)
    expect(a.requests).toEqual([]); expect(a.authorizations).toEqual([])
    expect(result.value).toBeNull()
    if (!name.startsWith('archive') && !name.startsWith('restore')) expect(result.error).toMatch(/account|database/i)
    else expect(result.error).toBeNull()
    expect(JSON.stringify(result)).not.toContain('Old private')
  }
)
it.each(mutations.flatMap(row => [false, true].map(fail => ({ ...row, fail }))))('preserves same-context $name (failure=$fail)', async ({ name, hold, run, fail }) => {
  const h = await make()
  if (name === 'restore') h.repo.projects.archiveWithTasks('p1')
  if (fail) (h.repo.projects as unknown as Record<string, () => never>)[hold] = () => { throw new Error('Current native error') }
  const result = run(h)
  if (fail) await expect(result).rejects.toThrow('Current native error')
  else {
    const value = await result; await h.untilIdle()
    if (name === 'create') expect(value).toMatchObject({ id: 'created', name: 'Old private project' })
    if (['update', 'archive', 'restore'].includes(name)) expect(value).toMatchObject({ id: 'p1' })
    if (['delete', 'remove member'].includes(name)) expect(value).toBe(true)
    if (name === 'add member') expect(h.stores.useProjectStore.getState().members.p1.some(member => member.user_id === 'third')).toBe(true)
    expect(h.authorizations.every(value => value === 'Bearer synthetic')).toBe(true)
    if (['create', 'update', 'delete', 'archive', 'restore'].includes(name)) expect(h.authorizations.length).toBeGreaterThan(0)
  }
})
it.each(['local', 'full-local', 'project-hydration', 'remote-scoped', 'remote-full', 'revoked-full'].flatMap(path => [false, true].map(selected => ({ path, selected }))))(
  'evicts removed project tasks and labels through $path selected=$selected', async ({ path, selected }) => {
    const h = await make()
    const label = h.repo.labels.create({ id: 'label', user_id: 'u', name: 'Synthetic' })
    for (const pid of ['p0', 'p1']) h.repo.tasks.create({ id: `t-${pid}`, owner_id: 'u', project_id: pid, status_id: pid === 'p0' ? 's0' : 's1', title: pid, due_date: '2026-01-16', is_in_my_day: 1 })
    h.repo.tasks.addLabel('t-p1', label.id)
    await h.stores.useTaskStore.getState().hydrateAllForUser('u')
    h.stores.useLabelStore.setState({ projectLabels: { p1: new Set([label.id]) } })
    h.stores.useProjectStore.setState({ currentProjectId: selected ? 'p1' : 'p0' })
    const pending = { ...h.stores.useTaskStore.getState().tasks['t-p0'], title: 'Valid pending edit' }
    h.stores.useTaskStore.setState(state => ({ tasks: { ...state.tasks, 't-p0': pending } }))
    if (path === 'local') await h.stores.useProjectStore.getState().deleteProject('p1')
    else if (path.startsWith('remote') || path === 'revoked-full') {
      h.remote.tasks.push({ ...h.repo.tasks.findById('t-p1') })
      if (path === 'revoked-full') {
        h.repo.projects.applyRemote({ ...h.repo.projects.findById('p1')!, owner_id: 'other', is_shared: 1, updated_at: '2030-01-01T00:00:00Z' })
        Object.assign(h.remote.projects.find(project => project.id === 'p1')!, { owner_id: 'other', is_shared: 1, updated_at: '2030-01-01T00:00:00Z' })
        h.remote.project_members = h.remote.project_members.filter(member => member.project_id !== 'p1' || member.user_id !== 'u')
      } else Object.assign(h.remote.projects.find(project => project.id === 'p1')!, { deleted_at: '2099-01-01T00:00:00Z', updated_at: '2099-01-01T00:00:00Z' })
      const context = await h.context()
      if (path === 'remote-scoped') await h.services.personal.requestProjectRefresh(context, ['p1'])
      else await h.services.personal.requestSyncCatchUp(context)
    } else {
      h.repo.projects.delete('p1')
      if (path === 'full-local') await h.stores.useTaskStore.getState().hydrateAllForUser('u')
      else await h.stores.useProjectStore.getState().hydrateProjects('u')
    }
    await h.untilIdle()
    expect(h.stores.useTaskStore.getState().tasks['t-p1']).toBeUndefined()
    expect(h.stores.useTaskStore.getState().taskLabels['t-p1']).toBeUndefined()
    expect(h.stores.useLabelStore.getState().projectLabels.p1).toBeUndefined()
    expect(h.repo.projects.findById('p1')).not.toBeNull()
    expect(h.repo.tasks.findById('t-p1')).not.toBeNull()
    if (path === 'local' || path === 'project-hydration' || path === 'remote-scoped') expect(h.stores.useTaskStore.getState().tasks['t-p0']).toBe(pending)
  }
)
it('keeps locally owned pending projects and tasks without membership during full hydration', async () => {
  const h = await make()
  h.repo.projects.removeMember('p1', 'u')
  h.repo.tasks.create({ id: 'pending', owner_id: 'u', project_id: 'p1', status_id: 's1', title: 'Owner pending task' })
  await h.stores.useProjectStore.getState().hydrateProjects('u')
  await h.stores.useTaskStore.getState().hydrateAllForUser('u')
  expect(h.stores.useProjectStore.getState().projects.p1).toBeDefined()
  expect(h.stores.useTaskStore.getState().tasks.pending).toBeDefined()
})

it('updates self and peer appearance through SDK and native paths, rejecting missing rows', async () => {
  const h = await make()
  h.remote.project_members.push({ project_id: 'p1', user_id: 'other', role: 'member' })
  for (const user of ['u', 'other']) {
    await h.services.shared.updateSharedMemberDisplay('p1', user, '#123456', 'XY')
    h.repo.projects.updateMember('p1', user, { display_color: '#123456', display_initials: 'XY' })
    expect(h.remote.project_members.find(row => row.project_id === 'p1' && row.user_id === user)).toMatchObject({ display_color: '#123456', display_initials: 'XY' })
    expect(h.repo.projects.getMembers('p1').find(row => row.user_id === user)).toMatchObject({ display_color: '#123456', display_initials: 'XY' })
  }
  await expect(h.services.shared.updateSharedMemberDisplay('p1', 'missing', null, null)).rejects.toThrow(/not updated/)
  expect(() => h.repo.projects.updateMember('p1', 'missing', { display_initials: 'XX' })).toThrow(/not found/)
})

it.each(['archive', 'restore'].flatMap(name => ['account', 'database'].map(change => ({ name, change }))))('suppresses $name return after the final cloud continuation crosses $change', async ({ name, change }) => {
  const a = await make(), b = await make()
  if (name === 'restore') a.repo.projects.archiveWithTasks('p1')
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  a.beforeRequest(() => { entered(); return new Promise<void>(resolve => { release = resolve }) })
  const run = name === 'archive' ? a.stores.useProjectStore.getState().archiveProject('p1') : a.stores.useProjectStore.getState().unarchiveProject('p1')
  await started
  const user = change === 'account' ? 'other' : 'u'
  b.setAccount(user); b.setSession('synthetic-new-account', user)
  a.setAccount(user); a.setSession('synthetic-new-account', user); a.sandbox.window.api = b.sandbox.window.api
  a.stores.useProjectStore.setState({ projects: { p1: { ...b.repo.projects.findById('p1')!, name: 'Replacement' } }, error: null })
  const before = a.stores.useProjectStore.getState()
  release(); expect(await run).toBeNull(); await a.untilIdle()
  expect(a.stores.useProjectStore.getState()).toBe(before)
  expect(a.authorizations).not.toContain('Bearer synthetic-new-account')
})

it('evicts detached peer label caches while preserving own labels and references in another project', async () => {
  const h = await make()
  const labels = ['own', 'peer-only', 'peer-retained'].map(id => h.repo.labels.create({ id, user_id: id === 'own' ? 'u' : 'other', name: id, project_id: 'p1' }))
  h.stores.useLabelStore.setState({ labels: Object.fromEntries(labels.map(label => [label.id, label])), projectLabels: { p1: new Set(labels.map(label => label.id)), p0: new Set(['peer-retained']) } })
  await h.stores.useProjectStore.getState().deleteProject('p1')
  expect(Object.keys(h.stores.useLabelStore.getState().labels).sort()).toEqual(['own', 'peer-retained'])
  expect(h.repo.labels.findById('peer-only')).toBeDefined()
})
