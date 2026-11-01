import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const { nativeUiFixture } = require('./native-ui-scope-fixture.cjs')
const dom = new JSDOM('<html><body></body></html>', { url: 'http://127.0.0.1/' })
vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document)
vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
Object.assign(dom.window, { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const opened: Array<{ h: Awaited<ReturnType<typeof nativeUiFixture>>; root: Root; host: HTMLDivElement; directory: string }> = []
afterEach(async () => { for (const f of opened.splice(0)) { await act(async () => f.root.unmount()); f.host.remove(); f.h.stop(); rmSync(f.directory, { recursive: true, force: true }) } })
afterAll(() => { dom.window.close(); vi.unstubAllGlobals() })
const settle = async (): Promise<void> => { for (let i = 0; i < 15; i++) await new Promise(resolve => setTimeout(resolve, 0)) }
function gate() { let enter!: () => void, release!: () => void; return { entered: new Promise<void>(r => { enter = r }), wait: new Promise<void>(r => { release = r }), enter: () => enter(), release: () => release() } }
async function setup() {
  const h = await nativeUiFixture({ ui: true }); h.switchTo('a')
  const api = h.apiFor(h.runtime.mainWindow)
  h.sandbox.window = Object.assign(dom.window, { api }); h.sandbox.document = document
  h.sandbox.ResizeObserver = globalThis.ResizeObserver
  h.sandbox.HTMLElement = dom.window.HTMLElement
  const s = h.services, repo = s.repositories.get('a'), db = s.databases.get('a')
  repo.users.create({ id: 'b', email: 'b@example.invalid' })
  db.prepare('UPDATE projects SET owner_id=? WHERE id=?').run('b', 'p-a')
  repo.projects.addMember('p-a', 'a', 'member'); repo.projects.addMember('p-a', 'b', 'owner')
  s.useAuthStore.setState({ currentUser: repo.users.findById('a'), isAuthenticated: true, isOffline: true })
  s.useProjectStore.setState({ projects: { 'p-a': repo.projects.findById('p-a') } })
  s.useTaskStore.setState({ tasks: { 't-a': repo.tasks.findById('t-a') } })
  s.useViewStore.setState({ currentView: 'templates', selectedProjectId: null })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), directory = mkdtempSync(join(tmpdir(), 'todoozy-boundary-'))
  const file = join(directory, 'synthetic.bin'), bytes = Buffer.from([0, 1, 255, 128, 65])
  writeFileSync(file, bytes)
  const f = { h, root, host, directory, file, bytes, repo, db, s, api }; opened.push(f); return f
}
async function mount(f: Awaited<ReturnType<typeof setup>>, component: unknown, props: object = {}): Promise<void> {
  await act(async () => { f.root.render(createElement('div', null, createElement(f.s.ToastContainer), createElement(component as typeof f.s.DetailAttachments, props))); await settle() })
}
async function click(f: Awaited<ReturnType<typeof setup>>, selector: string): Promise<void> {
  const button = f.host.querySelector<HTMLButtonElement>(selector); expect(button).not.toBeNull()
  await act(async () => { button!.click(); await settle() })
}
async function invalidate(f: Awaited<ReturnType<typeof setup>>, change: string): Promise<void> {
  await act(async () => {
    if (change === 'revoke' || change === 'copy') { f.repo.projects.removeMember('p-a', 'a'); f.s.evictProjectData('p-a') }
    else if (change === 'project-delete') await f.s.useProjectStore.getState().deleteProject('p-a')
    else if (change === 'task-delete') f.repo.tasks.delete('t-a')
    else { f.h.switchTo(change === 'database' ? 'a' : 'b'); f.s.useAuthStore.setState({ currentUser: f.s.repositories.get(change === 'database' ? 'a' : 'b').users.findById(change === 'database' ? 'a' : 'b') }) }
    await settle()
  })
}

it.each(['normal', 'revoke', 'project-delete', 'task-delete', 'account', 'database', 'unmounted-revoke', 'copy'])(
  'binds the actual attachment picker and native SQLite to task/project lifetime (%s)', async change => {
    const f = await setup(), pause = gate()
    f.h.runtime.electron.dialog.showOpenDialog = async () => { pause.enter(); await pause.wait; return { canceled: false, filePaths: [f.file] } }
    await mount(f, f.s.DetailAttachments, { taskId: 't-a' }); await click(f, 'button[title="Attach files"]'); await pause.entered
    if (change === 'unmounted-revoke') { await act(async () => f.root.unmount()); f.root = createRoot(f.host); opened.find(item => item.h === f.h)!.root = f.root; await invalidate(f, 'revoke') }
    else if (change !== 'normal') await invalidate(f, change)
    if (change === 'copy') {
      await mount(f, f.s.RemovedFromProjectDialog, { removedFromProject: { id: 'p-a', name: 'REMOVED' }, currentUser: f.repo.users.findById('a'), onClose: () => {} })
      const keep = [...f.host.querySelectorAll('button')].find(button => button.textContent === 'Keep Copy')!
      await act(async () => { keep.click(); await settle() })
    }
    pause.release(); await act(async () => { await settle() })
    const rows = f.db.prepare('SELECT * FROM attachments').all()
    if (change === 'normal') {
      expect(rows).toHaveLength(1)
      expect(Buffer.from(rows[0].file_data)).toEqual(f.bytes)
      expect(Object.keys(f.s.useAttachmentStore.getState().attachments)).toHaveLength(1)
    } else {
      expect(rows).toEqual([])
      expect(f.s.useAttachmentStore.getState().attachments).toEqual({})
      expect(f.repo.tasks.findById('t-a')).toBeDefined()
    }
  }, 20000)

it.each(['normal', 'revoke', 'project-delete', 'task-delete', 'account', 'database'])(
  'keeps actual attachment Undo bytes and eligibility (%s)', async change => {
    const f = await setup()
    f.repo.attachments.create({ id: 'file', task_id: 't-a', filename: 'synthetic.bin', mime_type: 'application/octet-stream', size_bytes: f.bytes.length, file_data: f.bytes })
    await mount(f, f.s.DetailAttachments, { taskId: 't-a' }); await click(f, 'button[aria-label="Remove synthetic.bin"]')
    const removed = f.db.prepare('SELECT deleted_at,file_data FROM attachments WHERE id=?').get('file')
    expect(removed.deleted_at).toBeTruthy(); expect(Buffer.from(removed.file_data)).toEqual(f.bytes)
    if (change !== 'normal') await invalidate(f, change)
    const undo = [...f.host.querySelectorAll('button')].find(button => button.textContent === 'Undo')!
    expect(undo).toBeDefined(); await act(async () => { undo.click(); await settle() })
    const row = f.db.prepare('SELECT deleted_at,file_data FROM attachments WHERE id=?').get('file')
    expect(Buffer.from(row.file_data)).toEqual(f.bytes)
    if (change === 'normal') { expect(row.deleted_at).toBeNull(); expect(f.s.useAttachmentStore.getState().attachments.file).toBeDefined() }
    else { expect(row.deleted_at).toBeTruthy(); expect(f.s.useAttachmentStore.getState().attachments.file).toBeUndefined() }
  }, 20000)

it.each(['normal', 'revoke', 'project-delete', 'account', 'database'].flatMap(change => [null, 'target'].map(areaId => ({ change, areaId }))))(
  'retains project lifetime through delayed area assignment ($change, area=$areaId)', async ({ change, areaId }) => {
    const f = await setup(), pause = gate()
    for (const id of ['initial', 'target']) f.repo.projectAreas.create({ id, user_id: 'a', name: id })
    f.repo.projectAreas.assignProject('p-a', 'initial')
    const sync = f.api.sync
    let held = false
    f.h.sandbox.window.api = new Proxy(f.api, { get(target, namespace) {
      if (namespace !== 'sync') return target[namespace]
      return { ...sync, captureContext: async () => { const value = await sync.captureContext(); if (!held) { held = true; pause.enter(); await pause.wait } return value } }
    } })
    const pending = f.s.useProjectAreaStore.getState().assignProject('p-a', areaId).catch((error: unknown) => error)
    await pause.entered
    if (change !== 'normal') await invalidate(f, change)
    const before = { ...f.repo.projects.findById('p-a') }
    pause.release(); const result = await pending; await settle()
    if (change === 'normal') { expect(result).toBeUndefined(); expect(f.repo.projects.findById('p-a').area_id).toBe(areaId) }
    else expect(f.repo.projects.findById('p-a')).toEqual(before)
  }, 20000)

it.each(['normal', 'failure', 'stale-success', 'stale-failure'])(
  'handles full AppLayout notification hydration (%s)', async mode => {
    const f = await setup()
    const pause = mode.startsWith('stale') ? f.h.hold('notifications:findAll') : null
    f.repo.notifications.create({ id: 'notice-a', message: 'PRIVATE A', type: 'info' })
    if (mode === 'failure') f.h.runtime.failChannel = 'notifications:findAll'
    const errors: unknown[] = [], onError = (error: unknown): void => { errors.push(error) }
    process.on('unhandledRejection', onError)
    try {
      await mount(f, f.s.AppLayout)
      if (mode.startsWith('stale')) {
        await pause!.entered; await invalidate(f, 'account')
        f.s.repositories.get('b').notifications.create({ id: 'notice-b', message: 'CURRENT B', type: 'info' })
        f.s.useNotificationStore.setState({ notifications: [{ id: 'notice-b', message: 'CURRENT B', read: 0 }], unreadCount: 1 })
        await act(async () => { f.root.render(createElement(f.s.AppLayout, { key: f.h.runtime.scope })); await settle() })
        if (mode === 'stale-failure') pause!.fail(); pause!.release(); await act(async () => { await settle() })
      }
      expect(errors).toEqual([])
      if (mode === 'normal') expect(f.s.useNotificationStore.getState().notifications.map((row: { message: string }) => row.message)).toEqual(['PRIVATE A'])
      else { expect(JSON.stringify(f.s.useNotificationStore.getState().notifications)).not.toContain('PRIVATE'); if (mode.startsWith('stale')) expect(f.s.useNotificationStore.getState().notifications.map((row: { message: string }) => row.message)).toEqual(['CURRENT B']) }
      expect(f.host.textContent).not.toContain('PRIVATE READ ERROR')
    } finally { process.off('unhandledRejection', onError) }
  }, 20000)

it.each(['normal', 'revoke', 'project-delete'])('handles the mounted Settings folder drop lifetime (%s)', async change => {
  const f = await setup(), pause = gate()
  for (const id of ['initial', 'target']) f.repo.projectAreas.create({ id, user_id: 'a', name: id })
  f.repo.projectAreas.assignProject('p-a', 'initial')
  f.s.useProjectAreaStore.setState({ areas: f.repo.projectAreas.findByUserId('a') })
  const project = f.repo.projects.findById('p-a')
  await mount(f, f.s.ProjectsSettingsContent, { projects: [project], selectedProject: project, selectedProjectId: project.id, statuses: f.repo.statuses.findByProjectId(project.id), onProjectChange: () => {}, onClose: () => {} })
  const sidebar = [...f.host.querySelectorAll('button')].find(button => button.textContent?.includes('Sidebar & Folders'))!
  expect(sidebar).toBeDefined(); await act(async () => { sidebar.click(); await settle() })
  const sync = f.api.sync; let held = false
  f.h.sandbox.window.api = new Proxy(f.api, { get(target, namespace) {
    if (namespace !== 'sync') return target[namespace]
    return { ...sync, captureContext: async () => { const value = await sync.captureContext(); if (!held) { held = true; pause.enter(); await pause.wait } return value } }
  } })
  let operation!: Promise<void>
  await act(async () => { operation = f.h.runtime.drag.onDragEnd({ active: { id: 'p-a' }, over: { id: 'area:target' } }); await settle() })
  await pause.entered
  if (change !== 'normal') await invalidate(f, change)
  const before = { ...f.repo.projects.findById('p-a') }
  pause.release(); await act(async () => { await operation; await settle() })
  if (change === 'normal') expect(f.repo.projects.findById('p-a').area_id).toBeNull()
  else expect(f.repo.projects.findById('p-a')).toEqual(before)
}, 20000)

it.each(['revoke', 'project-delete', 'task-delete'])('denies native attachment operations on retained ineligible tasks (%s)', async change => {
  const f = await setup()
  f.repo.attachments.create({ id: 'retained', task_id: 't-a', filename: 'synthetic.bin', mime_type: 'application/octet-stream', size_bytes: f.bytes.length, file_data: f.bytes })
  f.repo.attachments.delete('retained')
  await invalidate(f, change)
  expect(f.h.invoke('attachments:findByTaskId', 't-a')).toEqual([])
  expect(f.h.invoke('attachments:restore', 'retained')).toBeUndefined()
  expect(f.h.invoke('attachments:delete', 'retained')).toBe(false)
  expect(() => f.h.invoke('attachments:createFromFile', 't-a', f.file)).toThrow(/unavailable/)
  const rows = f.db.prepare('SELECT id,deleted_at,file_data FROM attachments').all()
  expect(rows).toHaveLength(1); expect(rows[0].deleted_at).toBeTruthy(); expect(Buffer.from(rows[0].file_data)).toEqual(f.bytes)
}, 20000)

it('retains a successful native attachment write without publishing its delayed revoked reply', async () => {
  const f = await setup(), pause = f.h.hold('attachments:createFromFile')
  f.h.runtime.electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f.file] })
  await mount(f, f.s.DetailAttachments, { taskId: 't-a' }); await click(f, 'button[title="Attach files"]'); await pause.entered
  expect(f.db.prepare('SELECT id FROM attachments').all()).toHaveLength(1)
  await invalidate(f, 'revoke'); pause.release(); await act(async () => { await settle() })
  expect(f.s.useAttachmentStore.getState().attachments).toEqual({})
  expect(f.db.prepare('SELECT id FROM attachments').all()).toHaveLength(1)
}, 20000)

it.each(['normal-area', 'normal-project', 'unrelated-revoke', 'project-revoke', 'project-delete', 'native-failure', 'account', 'database'])(
  'reports mounted sidebar reorder completion within the original account/database (%s)', async mode => {
    const f = await setup()
    f.repo.projects.update('p-a', { sidebar_order: 10 })
    for (const [id, sidebar_order] of [['first', 20], ['second', 30]] as const) f.repo.projectAreas.create({ id, user_id: 'a', name: id, sidebar_order })
    f.repo.projects.create({ id: 'unrelated', owner_id: 'b', name: 'UNRELATED PROJECT' })
    f.repo.projects.addMember('unrelated', 'a', 'member')
    f.s.useProjectAreaStore.setState({ areas: f.repo.projectAreas.findByUserId('a') })
    const project = f.repo.projects.findById('p-a')
    await mount(f, f.s.ProjectsSettingsContent, { projects: [project], selectedProject: project, selectedProjectId: project.id, statuses: f.repo.statuses.findByProjectId(project.id), onProjectChange: () => {}, onClose: () => {} })
    const sidebar = [...f.host.querySelectorAll('button')].find(button => button.textContent?.includes('Sidebar & Folders'))!
    await act(async () => { sidebar.click(); await settle() })
    const pause = mode.startsWith('normal') ? null : f.h.hold('projectAreas:update')
    const originalScope = f.h.runtime.scope
    const bBefore = { ...f.s.repositories.get('b').projects.findById('p-b') }
    let operation!: Promise<void>
    await act(async () => {
      operation = f.h.runtime.drag.onDragEnd({ active: { id: mode === 'normal-project' ? 'p-a' : 'area:second' }, over: { id: mode === 'normal-project' ? 'area:second' : 'p-a' } })
      await settle()
    })
    if (pause) {
      await pause.entered
      expect(f.repo.projectAreas.findById('second').sidebar_order).toBe(0)
      expect(f.repo.syncQueue.findAll().some((row: { table_name: string; row_id: string }) => row.table_name === 'user_project_areas' && row.row_id === 'second')).toBe(true)
      expect(f.repo.projects.findById('p-a').sidebar_order).toBe(10)
      expect(f.repo.projectAreas.findById('first').sidebar_order).toBe(20)
      if (mode === 'unrelated-revoke') {
        await act(async () => { f.repo.projects.removeMember('unrelated', 'a'); f.s.evictProjectData('unrelated'); await settle() })
        expect(f.h.runtime.scope).toBe(originalScope)
      } else if (mode === 'project-revoke') await invalidate(f, 'revoke')
      else if (mode === 'project-delete') await invalidate(f, 'project-delete')
      else if (mode === 'native-failure') pause.fail()
      else await invalidate(f, mode)
      const retained = { ...f.repo.projects.findById('p-a') }
      pause.release(); await act(async () => { await operation; await settle() })
      expect(f.repo.projectAreas.findById('second').sidebar_order).toBe(0)
      expect(f.repo.projectAreas.findById('first').sidebar_order).toBe(20)
      expect(f.repo.projects.findById('p-a')).toEqual(retained)
      expect(f.s.repositories.get('b').projects.findById('p-b')).toEqual(bBefore)
      if (mode === 'account' || mode === 'database') expect(f.host.textContent).not.toContain('Could not')
      else expect(f.host.textContent).toContain('Could not finish reordering the sidebar. Some changes may be saved.')
    } else {
      await act(async () => { await operation; await settle() })
      expect(f.repo.projects.findById('p-a').sidebar_order).toBe(1)
      expect(f.repo.projectAreas.findById('first').sidebar_order).toBe(mode === 'normal-project' ? 0 : 2)
      expect(f.repo.projectAreas.findById('second').sidebar_order).toBe(mode === 'normal-project' ? 2 : 0)
      expect(f.host.textContent).not.toContain('Could not')
    }
  }, 20000)
