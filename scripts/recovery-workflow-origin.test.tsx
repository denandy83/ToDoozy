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
  h.remote.user_labels.push({ ...h.repo.labels.findById('label') })
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

it.each(['Keep Copy','Delete'].flatMap(action=>[false,true].map(overlap=>({action,overlap}))))('replaces a busy $action notice through real AppLayout wiring (overlap=$overlap)',async({action,overlap})=>{
  const f=await setup(),pause=gate(),qPause=gate()
  f.h.stores.useAuthStore.setState({isOffline:false})
  f.h.repo.projects.create({id:'q',owner_id:'other',name:'SECOND REMOVAL'})
  f.h.repo.projects.update('q',{is_shared:1})
  const q=f.h.repo.projects.findById('q')
  f.h.repo.projects.addMember('q','u','member')
  f.h.remote.projects.push({...q});f.h.remote.project_members.push(...f.h.repo.projects.getMembers('q'))
  await f.h.stores.useProjectStore.getState().hydrateProjects('u')
  f.h.stores.useProjectStore.getState().setCurrentProject('p0')
  await act(async()=>{f.root.render(createElement(f.h.services.RemovalApp));await f.h.untilIdle()})
  const pChannel=f.h.channels.find((c:{topic:string;closed:boolean})=>c.topic==='project:p0'&&!c.closed)
  await act(async()=>{pChannel.emit('project_members','DELETE',{project_id:'p0',user_id:'u'});await f.h.untilIdle()})
  const method=action==='Keep Copy'?'create':'delete',original=f.h.repo.projects[method].bind(f.h.repo.projects)
  let held=false
  f.h.repo.projects[method]=async(...args:unknown[])=>{const result=original(...args);if(!held){held=true;pause.enter();await pause.wait}return result}
  await click(action);await pause.entered
  await act(async()=>{f.h.stores.useProjectStore.getState().setCurrentProject('q');await f.h.untilIdle()})
  const channel=f.h.channels.find((c:{topic:string;closed:boolean})=>c.topic==='project:q'&&!c.closed)
  await act(async()=>{channel.emit('project_members','DELETE',{project_id:'q',user_id:'u'});await f.h.untilIdle()})
  expect(document.body.textContent).toContain('SECOND REMOVAL')
  if(!overlap){pause.release();await idle(f.h)}
  expect([...document.querySelectorAll('button')].every(b=>!b.disabled)).toBe(true)
  const remove=f.h.repo.projects.delete.bind(f.h.repo.projects)
  f.h.repo.projects.delete=async(id:string)=>{const value=remove(id);if(id==='q'){qPause.enter();await qPause.wait}return value}
  await click('Delete');await qPause.entered
  pause.release();await idle(f.h)
  expect(document.body.textContent).toContain('SECOND REMOVAL')
  expect([...document.querySelectorAll('button')].every(b=>b.disabled)).toBe(true)
  expect(document.body.textContent).not.toMatch(/has been kept|Project deleted\./)
  qPause.release();await idle(f.h)
  expect(document.body.textContent).not.toContain('SECOND REMOVAL')
  expect(f.h.repo.projects.findById('q').deleted_at).not.toBeNull()
  if(action==='Keep Copy'){
    const copy=f.h.repo.projects.getProjectsForUser('u').find((p:{id:string})=>p.id!=='p0'&&p.id!=='q')
    expect(f.h.repo.tasks.findAllByProject(copy.id)).toHaveLength(2)
  }
  expect(f.h.fixtureErrors).toEqual([])
},15000)

it.each(['foreign','collision','download-fresh','download-legacy','cached-legacy','owned'].flatMap(mode=>['copy','leave'].map(entry=>({mode,entry}))))('recovers $mode label identities through actual $entry and role-checked replay',async({mode,entry})=>{
  const collision=mode==='collision'
  const {makeLabelAuthorizationDatabase,labelId}=await import('./label-authorization-fixture')
  const {readFileSync}=await import('node:fs')
  const {createHash}=await import('node:crypto')
  const pg=await makeLabelAuthorizationDatabase(),f=await setup()
  const mapping=new Map<string,string>([['u',labelId(1)],['other',labelId(2)],['p0',labelId(11)]])
  const encode=(value:string):string=>{
    if(/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value))return value
    let uuid=mapping.get(value)
    if(!uuid){const hash=createHash('md5').update(value).digest('hex');uuid=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;mapping.set(value,uuid)}
    return uuid
  }
  const convert=(row:Record<string,unknown>):Record<string,unknown>=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='string'&&(key==='id'||key.endsWith('_id'))?encode(value):value]))
  const labelWrites:Array<{table:string;body:Record<string,unknown>[]}>=[]
  try{
    f.h.remote.user_labels = f.h.remote.user_labels.filter((label:{id:string})=>label.id!=='label')
    f.h.repo.labels.hardDelete('label')
    f.h.repo.labels.create({id:'label',user_id:mode==='owned'||mode.endsWith('legacy')?'u':'other',project_id:'p0',name:'FOREIGN FAMILY',color:'#123456'})
    f.h.repo.tasks.addLabel('child','label')
    const source=f.h.repo.labels.findById('label')
    f.h.remote.user_labels.push({...source,user_id:mode==='owned'?'u':'other',updated_at:'2099-01-01T00:00:00.000Z'})
    f.h.remote.tasks.push(...f.h.repo.tasks.findAllByProject('p0'))
    f.h.remote.project_labels.push({project_id:'p0',label_id:'label',created_at:source.created_at,deleted_at:null})
    f.h.remote.task_labels.push({task_id:'child',label_id:'label',deleted_at:null})
    if(collision){
      f.h.repo.labels.create({id:'owned-family',user_id:'u',name:'foreign family',color:'#ABCDEF'})
      f.h.remote.user_labels.push({...f.h.repo.labels.findById('owned-family')})
      f.h.repo.projects.create({id:'q',owner_id:'u',name:'UNRELATED Q'})
      f.h.repo.projects.addMember('q','u','owner')
      f.h.repo.labels.addToProject('q','owned-family')
    }
    const transport=f.h.sandbox.fetch
    await pg.exec(readFileSync(new URL('../supabase/migrations/20261031102321_label_junction_authorization.sql',import.meta.url),'utf8'))
    f.h.sandbox.fetch=async(input:string,init:{method?:string;body?:string}={})=>{
      const parsed=new URL(input),table=parsed.pathname.split('/').at(-1)!,method=init.method??'GET'
      if(!['user_labels','project_labels','task_labels'].includes(table))return transport(input,init)
      for(const row of f.h.remote.projects)await pg.query('INSERT INTO projects(id,owner_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[encode(row.id),encode(row.owner_id??'u')])
      await pg.exec('DELETE FROM project_members')
      for(const row of f.h.remote.project_members)await pg.query('INSERT INTO project_members VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[encode(row.project_id),encode(row.user_id),row.role])
      for(const row of f.h.remote.tasks)await pg.query('INSERT INTO tasks(id,project_id,deleted_at) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[encode(row.id),encode(row.project_id),row.deleted_at??null])
      for(const row of f.h.remote.user_labels)await pg.query('INSERT INTO user_labels(id,user_id,name,color) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[encode(row.id),encode(row.user_id),row.name,row.color])
      for(const row of f.h.remote.project_labels)await pg.query('INSERT INTO project_labels(project_id,label_id,created_at,deleted_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[encode(row.project_id),encode(row.label_id),row.created_at??new Date().toISOString(),row.deleted_at??null])
      for(const row of f.h.remote.task_labels)await pg.query('INSERT INTO task_labels(task_id,label_id,deleted_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[encode(row.task_id),encode(row.label_id),row.deleted_at??null])
      await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[labelId(1)])
      await pg.exec('SET ROLE authenticated')
      try{
        if(method==='POST'){
          const body=JSON.parse(init.body!),rows=Array.isArray(body)?body:[body]
          labelWrites.push({table,body:rows})
          for(const row of rows){
            const converted=convert(row),columns=Object.keys(converted),keys=table==='user_labels'?['id']:table==='project_labels'?['project_id','label_id']:['task_id','label_id']
            const updates=columns.filter(k=>!keys.includes(k)).map(k=>`${k}=excluded.${k}`).join(',')
            await pg.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(${keys.join(',')}) DO ${updates?'UPDATE SET '+updates:'NOTHING'}`,Object.values(converted))
          }
        }
        const visible=await pg.query(`SELECT ${table==='user_labels'?'id':table==='project_labels'?'project_id,label_id':'task_id,label_id'} FROM ${table}`)
        await pg.exec('RESET ROLE')
        const response=await transport(input,init)
        if(method!=='GET')return response
        const data=await response.json()
        const keys=table==='user_labels'?['id']:table==='project_labels'?['project_id','label_id']:['task_id','label_id']
        return new Response(JSON.stringify(data.filter((r:Record<string,unknown>)=>visible.rows.some((row:Record<string,unknown>)=>keys.filter(k=>k in r).every(k=>row[k]===encode(String(r[k])))))),{headers:{'Content-Type':'application/json'}})
      }catch(error){return new Response(JSON.stringify({message:String(error),code:'42501'}),{status:403,headers:{'Content-Type':'application/json'}})}
      finally{await pg.exec('RESET ROLE')}
    }
    const ownedBefore=collision?{...f.h.repo.labels.findById('owned-family')}:null
    if(mode==='download-fresh')f.h.repo.labels.hardDelete('label')
    if(mode.startsWith('download')){
      await f.h.services.shared.syncProjectDown('p0','u',await f.h.context())
      expect(f.h.repo.labels.findById('label')?.user_id).toBe('other')
    }
    if(entry==='copy'){
      f.h.remote.project_members=f.h.remote.project_members.filter((m:{project_id:string;user_id:string})=>m.project_id!=='p0'||m.user_id!=='u')
      await f.h.services.shared.discoverRemoteMemberships('u',await f.h.context())
      await mount(f,'copy',vi.fn());await click('Keep Copy');await idle(f.h)
    }else{
      f.h.stores.useAuthStore.setState({isOffline:false})
      const project=f.h.repo.projects.findById('p0')
      await act(async()=>{f.root.render(createElement(f.h.services.MemberSettings,{project,onToast:()=>{}}));await f.h.untilIdle()})
      await click('Leave Project');await click('Keep Copy');await idle(f.h)
    }
    const copy=f.h.repo.projects.getProjectsForUser('u').find((p:{id:string})=>p.id!=='p0'&&p.id!=='q')
    const palette=f.h.repo.labels.findByProjectId(copy.id)
    expect(palette).toHaveLength(1);expect(palette[0].user_id).toBe('u');if(mode==='owned')expect(palette[0].id).toBe('label');else expect(palette[0].id).not.toBe('label')
    expect(palette[0].id).toBe(collision?'owned-family':palette[0].id)
    if(collision)expect(f.h.repo.labels.findById('owned-family')).toEqual(ownedBefore)
    else expect(palette[0].color).toBe(source.color)
    const copied=f.h.repo.tasks.findAllByProject(copy.id)
    expect(copied).toHaveLength(2)
    const child=copied.find((t:{parent_id:string|null})=>t.parent_id)
    expect(f.h.repo.tasks.getLabels(child.id).map((l:{label_id:string})=>l.label_id)).toEqual([palette[0].id])
    if(!mode.endsWith('legacy'))expect(f.h.repo.labels.findById('label')).toMatchObject({id:source.id,user_id:source.user_id,name:source.name,color:source.color})
    f.h.stores.useAuthStore.setState({isOffline:false})
    await f.h.services.personal.fullUpload('u',await f.h.context())
    await f.h.services.shared.processSyncQueue(await f.h.context());await idle(f.h)
    expect(labelWrites.some(w=>w.table==='user_labels'&&w.body.some(l=>l.id===palette[0].id&&l.user_id==='u'))).toBe(true)
    if(mode!=='owned')expect(labelWrites.filter(w=>w.table==='user_labels').flatMap(w=>w.body).some(l=>l.id==='label')).toBe(false)
    expect((await pg.query('SELECT label_id FROM project_labels WHERE project_id=$1',[encode(copy.id)])).rows).toEqual([{label_id:encode(palette[0].id)}])
    expect((await pg.query('SELECT label_id FROM task_labels WHERE task_id=$1',[encode(child.id)])).rows).toEqual([{label_id:encode(palette[0].id)}])
    expect(f.h.fixtureErrors).toEqual([])
  }finally{await pg.close()}
},20000)

it.each(['normal','create','statuses','ack','unmount','account','database','failure','delete'])('finishes Settings Leave recovery with its original account scope (%s)',async point=>{
  const f=await setup(),pause=gate(),toasts:string[]=[]
  f.h.stores.useAuthStore.setState({isOffline:false})
  await f.h.stores.useProjectStore.getState().hydrateProjects('u')
  f.h.stores.useProjectStore.getState().setCurrentProject('p0')
  const project=f.h.repo.projects.findById('p0')
  await act(async()=>{f.root.render(createElement('div',null,createElement(f.h.services.MemberSettings,{project,onToast:(message:string)=>toasts.push(message)}),createElement(f.h.services.RemovalApp)));await f.h.untilIdle()})
  const expectedStatuses=f.h.repo.statuses.findByProjectId('p0').map((s:{name:string;color:string})=>({name:s.name,color:s.color}))
  await click('Leave Project')
  const api=f.h.sandbox.window.api
  let held=false
  let duringRemoval:unknown=null
  f.h.sandbox.window.api=new Proxy(api,{get(target,namespace){
    if(namespace!=='sync')return target[namespace]
    return new Proxy(target.sync,{get(sync,method){
      if(method!=='invokeContext')return sync[method]
      return async(origin:unknown,channel:string,args:unknown[])=>{
        const result=await sync.invokeContext(origin,channel,args)
        const matched=point==='statuses'?channel==='statuses:findByProjectId'&&args[0]==='p0':channel==='projects:create'
        if(point!=='normal'&&point!=='delete'&&matched&&!held){held=true;pause.enter();await pause.wait;if(point==='failure')throw Error('COPY FAILED')}
        return result
      }
    }})
  }})
  if(point==='ack'){
    const fetch=f.h.sandbox.fetch
    f.h.sandbox.fetch=async(url:string,init:RequestInit)=>{
      const result=await fetch(url,init)
      if(new URL(url).pathname.endsWith('/project_members')&&init.method==='DELETE'&&!held){held=true;pause.enter();await pause.wait}
      return result
    }
  }
  await click(point==='delete'?'Delete':'Keep Copy')
  if(point!=='normal'&&point!=='delete'){
    await pause.entered
    await act(async()=>{await f.h.services.shared.discoverRemoteMemberships('u',await f.h.context(),project);await f.h.untilIdle()})
    duringRemoval=f.h.stores.useProjectStore.getState().removal
    if(point==='unmount')await act(async()=>f.root.render(null))
    if(point==='account'||point==='database'){
      const current=replaceNative(f,point==='account'?'other':'u')
      await act(async()=>{if(point==='account')f.h.setAccount('other');else f.h.replaceDatabase();f.root.render(null);await f.h.untilIdle()})
      const mark=f.h.nativeCalls.length
      pause.release();await idle(f.h)
      expect(f.h.nativeCalls.slice(mark)).toEqual([])
      expect(current.tasks.findById('current-task').title).toBe('PRIVATE B TASK')
      expect(toasts).toEqual([]);return
    }
    pause.release();await idle(f.h)
  }else await idle(f.h)
  expect(f.h.remote.project_members.some((m:{project_id:string;user_id:string})=>m.project_id==='p0'&&m.user_id==='u')).toBe(false)
  if(point==='failure'){
    expect(f.h.repo.projects.findById('p0').deleted_at).toBeNull()
    expect(f.h.repo.tasks.findById('child').title).toBe('CHILD')
    expect(f.h.stores.useProjectStore.getState().removal?.id).toBe('p0')
  }else{
    expect(f.h.repo.projects.findById('p0').deleted_at).not.toBeNull()
    if(point!=='delete'){
      const copy=f.h.repo.projects.getProjectsForUser('u').find((p:{id:string})=>p.id!=='p0')
      expect(copy).toBeDefined()
      expect(f.h.repo.projects.getMembers(copy.id)).toHaveLength(1)
      expect(f.h.repo.statuses.findByProjectId(copy.id).map((s:{name:string;color:string})=>({name:s.name,color:s.color}))).toEqual(expectedStatuses)
      const tasks=f.h.repo.tasks.findAllByProject(copy.id)
      expect(tasks).toHaveLength(2)
      expect(tasks.find((t:{parent_id:string|null})=>t.parent_id)).toBeDefined()
      expect(f.h.repo.tasks.getLabels(tasks.find((t:{parent_id:string|null})=>t.parent_id).id)).toHaveLength(1)
    }
    expect(f.h.stores.useProjectStore.getState().removal).toBeNull()
    expect(toasts).toHaveLength(point==='unmount'?0:1)
  }
  expect(duringRemoval).toBeNull()
  expect(f.h.fixtureErrors).toEqual([])
},15000)

it('requires an acknowledged remote removal before changing another member locally',async()=>{
  const f=await setup(),fetch=f.h.sandbox.fetch
  f.h.sandbox.fetch=async(url:string,init:RequestInit)=>new URL(url).pathname.endsWith('/project_members')&&init.method==='DELETE'
    ?new Response('[]',{headers:{'Content-Type':'application/json'}}):fetch(url,init)
  const origin=f.h.services.syncContexts.captureProjectProducer('p0')
  await expect(f.h.services.shared.removeSharedMember('p0','other',origin)).rejects.toThrow(/not acknowledged/)
  expect(f.h.repo.projects.getMembers('p0').some((m:{user_id:string})=>m.user_id==='other')).toBe(true)
})

it('retains a denied self-leave and allows a manual retry without publishing a false removal',async()=>{
  const f=await setup(),messages:string[]=[]
  f.h.stores.useAuthStore.setState({isOffline:false})
  const project=f.h.repo.projects.findById('p0')
  await act(async()=>{f.root.render(createElement(f.h.services.MemberSettings,{project,onToast:(message:string)=>messages.push(message)}));await f.h.untilIdle()})
  await click('Leave Project')
  const fetch=f.h.sandbox.fetch
  f.h.sandbox.fetch=async(url:string,init:RequestInit)=>new URL(url).pathname.endsWith('/project_members')&&init.method==='DELETE'
    ?new Response(JSON.stringify({message:'DENIED',code:'42501'}),{status:403,headers:{'Content-Type':'application/json'}}):fetch(url,init)
  await click('Keep Copy');await idle(f.h)
  expect(f.h.repo.projects.getProjectsForUser('u').map((p:{id:string})=>p.id)).toEqual(['p0'])
  expect(f.h.repo.projects.findById('p0').deleted_at).toBeNull()
  expect(f.h.stores.useProjectStore.getState().removal).toBeNull()
  expect(messages).toEqual(['Failed to leave project'])
  f.h.sandbox.fetch=fetch
  await click('Keep Copy');await idle(f.h)
  const copy=f.h.repo.projects.getProjectsForUser('u').find((p:{id:string})=>p.id!=='p0')
  expect(f.h.repo.tasks.findAllByProject(copy.id)).toHaveLength(2)
  expect(messages.at(-1)).toContain('A local copy has been kept')
  expect(f.h.fixtureErrors).toEqual([])
})
