import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../src/main/database/migrations'
import { createRepositories } from '../src/main/repositories'
import { createRequire } from 'node:module'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' })
vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document)
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.assign(dom.window.HTMLElement.prototype, { attachEvent: () => {}, detachEvent: () => {} })
afterAll(() => { dom.window.close(); vi.unstubAllGlobals() })
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
type Harness = Awaited<ReturnType<typeof makeHarness>>
const opened: Array<{ h: Harness; root: Root; host: HTMLElement; replacements: DatabaseSync[] }> = []
afterEach(async () => { for (const f of opened.splice(0)) { await act(async () => f.root.unmount()); f.host.remove(); await f.h.stop(); for (const db of f.replacements) db.close() } })
function gate() { let enter!: () => void, release!: () => void; return { entered: new Promise<void>(r => { enter = r }), wait: new Promise<void>(r => { release = r }), enter: () => enter(), release: () => release() } }
async function setup() {
  const h = await makeHarness({ ref: process.env.REVIEW_BASE_REF, projectCount: 1, shared: 1, sharedHook: true, connected: true })
  h.sandbox.document = document
  h.sandbox.requestAnimationFrame = (callback: () => void) => setImmediate(callback)
  h.sandbox.cancelAnimationFrame = clearImmediate
  h.sandbox.window.matchMedia = () => ({ matches: true })
  h.sandbox.window.addEventListener = window.addEventListener.bind(window)
  h.sandbox.window.removeEventListener = window.removeEventListener.bind(window)
  h.services.observeDatabaseScope()
  h.stores.useAuthStore.setState({ isOffline: true })
  h.repo.projects.update('p0', { name: 'PRIVATE PROJECT', description: 'PRIVATE DESCRIPTION' })
  h.repo.labels.create({ id: 'label', user_id: 'u', project_id: 'p0', name: 'LABEL', color: '#123456' })
  h.repo.tasks.create({ id: 'parent', project_id: 'p0', owner_id: 'u', status_id: 's0', title: 'PARENT' })
  h.repo.tasks.create({ id: 'child', project_id: 'p0', owner_id: 'u', status_id: 's0', title: 'CHILD', parent_id: 'parent' })
  h.repo.tasks.addLabel('child', 'label')
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), f = { h, root, host, replacements: [] as DatabaseSync[] }; opened.push(f)
  const user = h.stores.useAuthStore.getState().currentUser
  const data = { statuses: [{ name: 'OPEN', color: '#123456', icon: 'circle', order_index: 0, is_done: 0, is_default: 1 }], labels: [{ name: 'LABEL', color: '#123456', order_index: 0 }], tasks: [{ title: 'DEPLOYED PARENT', description: null, priority: 0, order_index: 0, due_date_offset: null, recurrence_rule: null, labels: ['LABEL'], subtasks: [{ title: 'DEPLOYED CHILD', description: null, priority: 0, order_index: 0, due_date_offset: null, recurrence_rule: null, labels: ['LABEL'], subtasks: [] }] }] }
  return { ...f, user, template: { id: 'template', owner_id: 'u', name: 'PRIVATE TEMPLATE', color: '#123456', data: JSON.stringify(data), created_at: '2026-01-01', updated_at: '2026-01-01', deleted_at: null } }
}
function replaceNative(f: Awaited<ReturnType<typeof setup>>, userId: string): ReturnType<typeof createRepositories> {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON;CREATE TABLE schema_version(version INTEGER PRIMARY KEY)')
  for (const migrate of migrations) migrate(db)
  f.replacements.push(db)
  const repo = createRepositories(db)
  repo.users.create({ id: userId, email: 'current@example.invalid', display_name: 'CURRENT USER' })
  repo.projects.create({ id: 'current-project', owner_id: userId, name: 'PRIVATE B PROJECT' })
  repo.projects.addMember('current-project', userId, 'owner')
  repo.statuses.create({ id: 'current-status', project_id: 'current-project', name: 'CURRENT STATUS', is_default: 1 })
  repo.tasks.create({ id: 'current-task', project_id: 'current-project', owner_id: userId, status_id: 'current-status', title: 'PRIVATE B TASK' })
  for (const [key, value] of Object.entries(repo)) f.h.repo[key] = value
  return repo
}
async function idle(h: Harness): Promise<void> {
  await act(async () => { await h.untilIdle() })
  await act(async () => {
    for (const [id, job] of [...h.timers] as Array<[unknown, { ms: number; fn: () => void }]>) {
      if (job.ms <= 150) { h.timers.delete(id); await job.fn() }
    }
    await h.untilIdle()
  })
}
async function click(label: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === label)
  expect(button).toBeDefined()
  await act(async () => button!.click())
}
type Action = 'copy' | 'delete' | 'deploy' | 'save-new' | 'save-existing'
async function mount(f: Awaited<ReturnType<typeof setup>>, action: Action, close: () => void): Promise<void> {
  if (action === 'save-existing') f.h.repo.projectTemplates.create(f.template)
  const template = action === 'save-new' ? { ...f.template, created_at: '' } : f.template
  function Screen(): ReactElement {
    const content = action === 'copy' || action === 'delete'
      ? createElement(f.h.services.RemovedFromProjectDialog, { removedFromProject: { id: 'p0', name: 'PRIVATE PROJECT' }, currentUser: f.user, onClose: close })
      : createElement(f.h.services.DeployProjectTemplateWizard, { template, currentUser: f.user, mode: action === 'deploy' ? 'deploy' : 'save', onClose: close })
    return createElement('div', null, createElement(f.h.services.ToastContainer), content)
  }
  await act(async () => { f.root.render(createElement(Screen)); await f.h.untilIdle() })
  if (action !== 'copy' && action !== 'delete') await click('Review & Create')
}
const actionLabel = (action: Action): string => action === 'copy' ? 'Keep Copy' : action === 'delete' ? 'Delete' : action === 'deploy' ? 'Create Project' : 'Save Template'
it.each((['copy', 'delete', 'deploy', 'save-new', 'save-existing'] as const).flatMap(action => ['database', 'account'].flatMap(change => [false, true].map(fail => ({ action, change, fail }))))) (
  'retains original $action origin after $change (late rejection=$fail)', async ({ action, change, fail }) => {
    const f = await setup(), close = vi.fn(), pause = gate()
    await mount(f, action, close)
    const point = action === 'copy' ? ['projects', 'findById'] : action === 'delete' ? ['projects', 'delete'] : action === 'deploy' ? ['projects', 'create'] : ['projectTemplates', action === 'save-new' ? 'create' : 'update']
    const original = f.h.repo[point[0]][point[1]].bind(f.h.repo[point[0]])
    let held = false
    f.h.repo[point[0]][point[1]] = async (...args: unknown[]) => {
      const result = original(...args)
      if (!held) { held = true; pause.enter(); await pause.wait; if (fail) throw Error('PRIVATE LATE ERROR') }
      return result
    }
    await click(actionLabel(action)); await pause.entered
    const sameUser = f.h.stores.useAuthStore.getState().currentUser
    const currentRepo = replaceNative(f, change === 'account' ? 'other' : 'u')
    await act(async () => { if (change === 'database') f.h.replaceDatabase(); else f.h.setAccount('other'); await f.h.untilIdle() })
    if (change === 'database') expect(f.h.stores.useAuthStore.getState().currentUser).toBe(sameUser)
    const native = f.h.nativeCalls.length
    pause.release(); await idle(f.h)
    expect(f.h.nativeCalls.slice(native)).toEqual([])
    expect(currentRepo.projects.getProjectsForUser(change === 'account' ? 'other' : 'u').map(p => p.id)).toEqual(['current-project'])
    expect(currentRepo.tasks.findById('current-task')?.title).toBe('PRIVATE B TASK')
    expect(close).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toMatch(/has been kept|Project deleted\.|created from template|template saved|Failed to/)
    expect(f.h.stores.useViewStore.getState().selectedProjectId).toBeNull()
    expect(f.h.stores.useProjectStore.getState().projects).toEqual({})
    expect(f.h.stores.useTemplateStore.getState().projectTemplates).toEqual({})
    expect(f.h.fixtureErrors).toEqual([])
  }, 15000)
it.each(['copy', 'delete', 'deploy', 'save-new', 'save-existing'] as const)('preserves complete normal %s action', async action => {
  const f = await setup(), close = vi.fn()
  if (action === 'copy') { f.h.repo.projects.removeMember('p0', 'u'); f.h.services.evictProjectData('p0') }
  await mount(f, action, close); await click(actionLabel(action)); await idle(f.h)
  expect(close).toHaveBeenCalledOnce()
  if (action === 'copy' || action === 'deploy') {
    const projects = f.h.repo.projects.getProjectsForUser('u').filter((p: { id: string }) => p.id !== 'p0')
    expect(projects).toHaveLength(1)
    const rows = f.h.repo.tasks.findAllByProject(projects[0].id)
    expect(rows).toHaveLength(2)
    const child = rows.find((row: { parent_id: string | null }) => row.parent_id)
    expect(rows.some((row: { id: string }) => row.id === child.parent_id)).toBe(true)
    expect(f.h.repo.tasks.getLabels(child.id).map((row: { label_id: string }) => row.label_id)).toEqual(['label'])
    expect(f.h.stores.useProjectStore.getState().projects[projects[0].id]).toBeDefined()
  } else if (action.startsWith('save')) expect(f.h.stores.useTemplateStore.getState().projectTemplates.template.name).toBe('PRIVATE TEMPLATE')
  else expect(f.h.repo.projects.findById('p0').deleted_at).not.toBeNull()
  expect(f.h.fixtureErrors).toEqual([])
})
it.each(['copy', 'deploy', 'save-new'] as const)('keeps current %s errors recoverable', async action => {
  const f = await setup(), close = vi.fn()
  await mount(f, action, close)
  const namespace = action === 'save-new' ? 'projectTemplates' : 'projects', method = action === 'copy' ? 'findById' : 'create'
  const original = f.h.repo[namespace][method].bind(f.h.repo[namespace])
  let fail = true
  f.h.repo[namespace][method] = (...args: unknown[]) => { if (fail) throw Error('CURRENT FAILURE'); return original(...args) }
  await click(actionLabel(action)); await idle(f.h)
  expect(close).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('Failed to')
  fail = false
  await click(actionLabel(action)); await idle(f.h)
  expect(close).toHaveBeenCalledOnce()
})
it.each(['member-first', 'discovery-first'].flatMap(order => ['account', 'database'].map(change => ({ order, change }))))('retains removal choice through $order and navigation, hides on $change change', async ({ order, change }) => {
  const f = await setup()
  f.h.stores.useAuthStore.setState({ isOffline: false })
  await f.h.stores.useProjectStore.getState().hydrateProjects('u')
  f.h.stores.useProjectStore.getState().setCurrentProject('p0')
  function Screen(): ReactElement {
    const state = f.h.stores.useProjectStore(), user = f.h.stores.useAuthStore(s => s.currentUser)
    const removal = f.h.services.useSharedProjectRealtime(state.projects[state.currentProjectId] ?? null, user)
    return createElement('div', null, removal.removedFromProject && createElement(f.h.services.RemovedFromProjectDialog, { removedFromProject: removal.removedFromProject, currentUser: user, onClose: () => removal.setRemovedFromProject(null) }))
  }
  await act(async () => { f.root.render(createElement(Screen)); await f.h.untilIdle() })
  const channel = f.h.channels.find((c: { topic: string; closed: boolean }) => c.topic === 'project:p0' && !c.closed)
  f.h.remote.project_members = f.h.remote.project_members.filter((m: { user_id: string; project_id: string }) => m.project_id !== 'p0' || m.user_id !== 'u')
  if (order === 'member-first') await act(async () => { channel.emit('project_members', 'DELETE', { project_id: 'p0', user_id: 'u' }); await f.h.untilIdle() })
  await act(async () => { await f.h.services.shared.discoverRemoteMemberships('u', await f.h.context()); await f.h.untilIdle() })
  if (order === 'discovery-first') channel.emit('project_members', 'DELETE', { project_id: 'p0', user_id: 'u' })
  await idle(f.h)
  expect(f.h.stores.useProjectStore.getState().currentProjectId).toBeNull()
  expect(document.body.textContent).toContain('PRIVATE PROJECT')
  expect(document.body.textContent).toContain('Keep Copy')
  await act(async () => { f.h.stores.useViewStore.setState({ currentView: 'my-day', selectedProjectId: null }); await f.h.untilIdle() })
  expect(document.body.textContent).toContain('Keep Copy')
  expect(f.h.repo.tasks.findById('parent').title).toBe('PARENT')
  await act(async () => { if (change === 'account') f.h.setAccount('other'); else f.h.replaceDatabase(); await f.h.untilIdle() })
  const native = f.h.nativeCalls.length
  channel.emit('project_members', 'DELETE', { project_id: 'p0', user_id: 'u' }); await idle(f.h)
  expect(f.h.nativeCalls.length).toBe(native)
  expect(document.body.textContent).not.toContain('PRIVATE PROJECT')
  expect(document.body.textContent).not.toContain('Keep Copy')
  expect(f.h.fixtureErrors).toEqual([])
})

it.each(['Cancel', 'Escape', 'backdrop'])('completes persistent deployment after actual %s close', async route => {
  const f = await setup(), closed = vi.fn(() => f.root.render(null)), pause = gate()
  await mount(f, 'deploy', closed)
  const original = f.h.repo.projects.create.bind(f.h.repo.projects)
  let held = false, created = ''
  f.h.repo.projects.create = async (input: { id: string }) => {
    const row = original(input)
    if (!held) { held = true; created = input.id; pause.enter(); await pause.wait }
    return row
  }
  await click('Create Project'); await pause.entered
  if (route === 'Cancel') await click('Cancel')
  else if (route === 'Escape') await act(async () => { window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  else await act(async () => { (document.querySelector('.ui-modal-backdrop') as HTMLElement).click() })
  await idle(f.h)
  expect(closed).toHaveBeenCalledOnce()
  pause.release(); await idle(f.h)
  expect(f.h.repo.projects.getMembers(created)).toHaveLength(1)
  expect(f.h.repo.statuses.findByProjectId(created)).toHaveLength(1)
  const tasks = f.h.repo.tasks.findAllByProject(created)
  expect(tasks).toHaveLength(2)
  expect(tasks.filter((task: { parent_id: string | null }) => task.parent_id)).toHaveLength(1)
  expect(f.h.stores.useProjectStore.getState().projects[created]).toBeDefined()
  expect(f.h.stores.useTaskStore.getState().tasks[tasks[0].id]).toBeDefined()
  expect(f.h.remote.projects.some((row: { id: string }) => row.id === created)).toBe(true)
  expect(f.h.stores.useViewStore.getState().selectedProjectId).toBeNull()
  expect(document.body.textContent).not.toMatch(/created from template|Failed to create/)
  expect(closed).toHaveBeenCalledOnce()
  expect(f.h.fixtureErrors).toEqual([])
})
it.each(['save-new', 'save-existing'] as const)('completes native/cache/cloud %s after UI unmount', async action => {
  const f = await setup(), closed = vi.fn(() => f.root.render(null)), pause = gate()
  await mount(f, action, closed)
  const method = action === 'save-new' ? 'create' : 'update'
  const original = f.h.repo.projectTemplates[method].bind(f.h.repo.projectTemplates)
  f.h.repo.projectTemplates[method] = async (...args: unknown[]) => { const value = original(...args); pause.enter(); await pause.wait; return value }
  await click('Save Template'); await pause.entered
  await click('Cancel'); await idle(f.h)
  expect(closed).toHaveBeenCalledOnce()
  pause.release(); await idle(f.h)
  expect(f.h.stores.useTemplateStore.getState().projectTemplates.template.name).toBe('PRIVATE TEMPLATE')
  expect(f.h.remote.project_templates.some((row: { id: string }) => row.id === 'template')).toBe(true)
  expect(document.body.textContent).not.toMatch(/template saved|Failed to save/)
  expect(f.h.fixtureErrors).toEqual([])
})
it.each(['database', 'account'])('preserves persistent close origin after subsequent %s replacement', async change => {
  const f = await setup(), closed = vi.fn(() => f.root.render(null)), pause = gate()
  await mount(f, 'deploy', closed)
  const original = f.h.repo.projects.create.bind(f.h.repo.projects)
  f.h.repo.projects.create = async (input: unknown) => { const value = original(input); pause.enter(); await pause.wait; return value }
  await click('Create Project'); await pause.entered
  await click('Cancel'); await idle(f.h)
  const current = replaceNative(f, change === 'account' ? 'other' : 'u')
  if (change === 'account') f.h.setAccount('other'); else f.h.replaceDatabase()
  const mark = f.h.nativeCalls.length
  pause.release(); await idle(f.h)
  expect(f.h.nativeCalls.slice(mark)).toEqual([])
  expect(current.tasks.findById('current-task')?.title).toBe('PRIVATE B TASK')
  expect(closed).toHaveBeenCalledOnce()
  expect(f.h.fixtureErrors).toEqual([])
})
it.each(['Keep Copy', 'Delete', 'rapid duplicates'])('serializes removal decisions against concurrent %s', async second => {
  const f = await setup(), closed = vi.fn(), pause = gate()
  f.h.remote.project_members = f.h.remote.project_members.filter((m: { project_id: string; user_id: string }) => m.project_id !== 'p0' || m.user_id !== 'u')
  await f.h.services.shared.discoverRemoteMemberships('u', await f.h.context())
  f.h.repo.projects.create({ id: 'q', owner_id: 'u', name: 'VALID Q' })
  const q = f.h.repo.projects.findById('q')
  await mount(f, 'copy', closed)
  const original = f.h.repo.projects.create.bind(f.h.repo.projects)
  let created = 0
  f.h.repo.projects.create = async (input: unknown) => { const value = original(input); created++; if (created === 1) { pause.enter(); await pause.wait } return value }
  if (second === 'rapid duplicates') {
    await act(async () => {
      const copy = [...document.querySelectorAll('button')].find(button => button.textContent === 'Keep Copy')!
      const remove = [...document.querySelectorAll('button')].find(button => button.textContent === 'Delete')!
      copy.click(); copy.click(); remove.click()
    })
  } else { await click('Keep Copy'); await pause.entered; await click(second) }
  await pause.entered
  expect(created).toBe(1)
  expect(f.h.repo.projects.findById('p0').deleted_at).toBeNull()
  expect(closed).not.toHaveBeenCalled()
  pause.release(); await idle(f.h)
  const projects = f.h.repo.projects.getProjectsForUser('u').filter((p: { id: string }) => p.id !== 'q')
  expect(projects).toHaveLength(1)
  expect(f.h.repo.projects.getMembers(projects[0].id)).toHaveLength(1)
  expect(f.h.repo.statuses.findByProjectId(projects[0].id)).toHaveLength(2)
  const tasks = f.h.repo.tasks.findAllByProject(projects[0].id)
  expect(tasks).toHaveLength(2)
  const child = tasks.find((row: { parent_id: string | null }) => row.parent_id)
  expect(f.h.repo.tasks.getLabels(child.id).map((row: { label_id: string }) => row.label_id)).toEqual(['label'])
  expect(f.h.repo.projects.findById('q')).toEqual(q)
  expect(closed).toHaveBeenCalledOnce()
  expect(document.body.textContent).not.toContain('Project deleted.')
  expect(f.h.fixtureErrors).toEqual([])
})
it('retains recovery source and releases decision busy state on a current copy failure', async () => {
  const f = await setup(), closed = vi.fn()
  await mount(f, 'copy', closed)
  f.h.repo.statuses.create = () => { throw Error('CURRENT COPY FAILURE') }
  await click('Keep Copy'); await idle(f.h)
  expect(f.h.repo.projects.findById('p0').deleted_at).toBeNull()
  expect(closed).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Failed to keep project copy')
  expect([...document.querySelectorAll('button')].filter(button => ['Keep Copy', 'Delete'].includes(button.textContent ?? '')).every(button => !button.disabled)).toBe(true)
})
