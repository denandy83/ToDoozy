import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
type Harness = Awaited<ReturnType<typeof makeHarness>>
const opened: Harness[] = []
afterEach(async () => { for (const h of opened.splice(0)) await h.stop() })
function gate() { let enter!: () => void, release!: () => void; return { entered: new Promise<void>(r => { enter = r }), wait: new Promise<void>(r => { release = r }), enter: () => enter(), release: () => release() } }
async function setup(shared: boolean, own = true): Promise<Harness> {
  const h = await makeHarness({ ref: process.env.REVIEW_BASE_REF, projectCount: 2, shared: own ? 0 : 1, connected: true, inspectAuthorization: true }); opened.push(h)
  if (shared && own) {
    h.repo.projects.update('p0', { is_shared: 1 }); h.repo.projects.addMember('p0', 'other', 'member')
    h.remote.projects[0] = { ...h.repo.projects.findById('p0') }
    h.remote.project_members.push({ project_id: 'p0', user_id: 'other', role: 'member', joined_at: '2026-01-01' })
  }
  for (const n of [0, 1]) {
    const row = h.repo.tasks.create({ id: 'task'+n, project_id: 'p'+n, owner_id: own ? 'u' : 'other', status_id: 's'+n, title: 'OLD '+n })
    h.remote.tasks.push({ ...row })
  }
  await h.run(); await h.untilIdle(); await h.runTimers(); await h.untilIdle()
  await h.stores.useTaskStore.getState().hydrateAllForUser('u'); await h.stores.useStatusStore.getState().hydrateStatuses('p0')
  h.stores.useProjectStore.getState().setCurrentProject('p0')
  h.stores.useViewStore.setState({ selectedProjectId: 'p0', currentView: 'project' })
  return h
}
async function drain(h: Harness): Promise<void> { await h.untilIdle(); await h.runTimers(); await h.untilIdle() }
function channel(h: Harness, shared: boolean, id = 'p0'): any { return h.channels.findLast((c: { topic: string; closed: boolean }) => c.topic === (shared ? 'project:' : 'personal:')+id && !c.closed) }
function classify(h: Harness, shared: boolean): void {
  h.remote.project_members = h.remote.project_members.filter((m: { project_id: string; user_id: string }) => m.project_id !== 'p0' || m.user_id !== 'other')
  if (shared) h.remote.project_members.push({ project_id: 'p0', user_id: 'other', role: 'member', joined_at: '2026-01-01' })
  Object.assign(h.remote.projects[0], { name: 'CLASSIFIED', updated_at: '2030-01-01T00:00:00.000Z' })
}
it.each([false, true])('completes actual metadata handoff from shared=%s with live replacement', async fromShared => {
  const h = await setup(fromShared), old = channel(h, fromShared)
  classify(h, !fromShared)
  old.emit('projects', 'UPDATE', h.remote.projects[0]); await drain(h)
  const fresh = channel(h, !fromShared)
  expect(fresh).toBeDefined(); expect(old.closed).toBe(true)
  expect(h.channels.filter((c: { closed: boolean; topic: string }) => !c.closed && ['project:p0', 'personal:p0'].includes(c.topic))).toHaveLength(1)
  expect(h.stores.useProjectStore.getState().projects.p0).toMatchObject({ name: 'CLASSIFIED', is_shared: fromShared ? 0 : 1 })
  const count = h.channels.length
  fresh.emit('projects', 'UPDATE', h.remote.projects[0]); await drain(h)
  expect(h.channels.length).toBe(count)
  Object.assign(h.remote.tasks[0], { title: 'NEW TASK', updated_at: '2031-01-01' })
  fresh.emit('tasks', 'UPDATE', h.remote.tasks[0]); await drain(h)
  expect(h.repo.tasks.findById('task0').title).toBe('NEW TASK')
  expect(h.stores.useTaskStore.getState().tasks.task0.title).toBe('NEW TASK')
  const mark = h.requests.length
  old.emit('tasks', 'UPDATE', h.remote.tasks[0]); await drain(h)
  expect(h.requests.length).toBe(mark)
  Object.assign(h.remote.tasks[1], { title: 'FRESH Q', updated_at: '2031-01-01' })
  channel(h, false, 'p1').emit('tasks', 'UPDATE', h.remote.tasks[1]); await drain(h)
  expect(h.repo.tasks.findById('task1').title).toBe('FRESH Q')
  expect(h.stores.useTaskStore.getState().tasks.task1.title).toBe('FRESH Q')
  expect(h.maxConcurrent()).toBe(1); expect(h.fixtureErrors).toEqual([])
})
it.each(['account', 'database', 'project', 'cancel'])('rejects held handoff after original %s invalidation', async kind => {
  const h = await setup(false), old = channel(h, false), pause = gate()
  classify(h, true)
  h.beforeRequest(async () => { pause.enter(); await pause.wait })
  old.emit('projects', 'UPDATE', h.remote.projects[0]); await pause.entered
  if (kind === 'account') h.setAccount('other')
  else if (kind === 'database') h.replaceDatabase()
  else if (kind === 'project') h.services.evictProjectData('p0')
  else await h.services.personal.unsubscribePersonalProject('p0')
  const native = h.nativeCalls.length
  pause.release(); await drain(h)
  expect(channel(h, true)).toBeUndefined()
  expect(h.nativeCalls.slice(native)).toEqual([])
  expect(h.fixtureErrors).toEqual([])
})
it.each(['access-loss', 'deleted', 'normal'])('completes authoritative %s cleanup from its own channel', async kind => {
  const h = await setup(true, false), old = channel(h, true)
  h.stores.useTaskStore.setState({ selectedTaskIds: new Set(['task0']), lastSelectedTaskId: 'task0', showDetailPanel: true })
  if (kind === 'access-loss') h.remote.project_members = h.remote.project_members.filter((m: { project_id: string; user_id: string }) => m.project_id !== 'p0' || m.user_id !== 'u')
  Object.assign(h.remote.projects[0], { name: 'AUTHORITATIVE', updated_at: '2030-01-01', deleted_at: kind === 'deleted' ? '2030-01-01' : null })
  old.emit('projects', 'UPDATE', h.remote.projects[0]); await drain(h)
  if (kind === 'normal') { expect(old.closed).toBe(false); expect(h.stores.useProjectStore.getState().projects.p0.name).toBe('AUTHORITATIVE') }
  else {
    expect(old.closed).toBe(true)
    expect(h.repo.projects.getMembers('p0').some((m: { user_id: string }) => m.user_id === 'u')).toBe(false)
    expect(h.stores.useProjectStore.getState().projects.p0).toBeUndefined()
    expect(h.stores.useTaskStore.getState().tasks.task0).toBeUndefined()
    expect(h.stores.useTaskStore.getState().showDetailPanel).toBe(false)
    expect(h.stores.useProjectStore.getState().currentProjectId).toBeNull()
    expect(h.stores.useViewStore.getState()).toMatchObject({ currentView: 'my-day', selectedProjectId: null })
    expect(h.repo.tasks.findById('task0').title).toBe('OLD 0')
  }
  expect(h.repo.tasks.findById('task1').title).toBe('OLD 1')
  expect(h.maxConcurrent()).toBe(1); expect(h.fixtureErrors).toEqual([])
})
it.each([false, true].flatMap(cancel => ['from', 'rpc', 'write'].map(method => ({ cancel, method }))))('checks $method transport after authentication wait (cancel=$cancel)', async ({ cancel, method }) => {
  const h = await setup(false), parent = await h.context(), pause = gate()
  let active = true
  const origin = h.services.syncContexts.channelSyncContext(parent, () => active, 'p0')
  h.requests.length = 0
  const authMark = h.authorizations.length
  h.beforeSession(async () => { pause.enter(); await pause.wait })
  const query = method === 'from' ? origin.client.from('tasks').select('*').eq('project_id', 'p0') : method === 'write' ? origin.client.from('tasks').update({ title: 'TRANSPORT WRITE' }).eq('id', 'task0') : origin.client.rpc('get_user_profiles', { p_user_ids: ['u'] })
  const pending = Promise.resolve(query).then(value => ({ value }), error => ({ error }))
  await pause.entered; expect(h.requests).toEqual([])
  if (cancel) active = false
  h.setSession('rotated-synthetic-token')
  pause.release(); const result = await pending; await h.untilIdle()
  expect(h.requests.length).toBe(cancel ? 0 : 1)
  expect(await parent.isCurrent()).toBe(true)
  expect(await origin.isCurrent()).toBe(!cancel)
  expect(h.authorizations.slice(authMark)).toEqual(cancel ? [] : ['Bearer rotated-synthetic-token'])
  if (method === 'write') expect(h.remote.tasks[0].title).toBe(cancel ? 'OLD 0' : 'TRANSPORT WRITE')
  if (!cancel && method === 'from') expect(result).toMatchObject({ value: { data: [expect.objectContaining({ id: 'task0' })] } })
  expect(h.fixtureErrors).toEqual([])
})
