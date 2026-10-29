import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useAuthStore, useProjectStore, useTaskStore, useStatusStore, useLabelStore } from '../src/renderer/src/shared/stores'
import { useSettingsStore } from '../src/renderer/src/shared/stores/settingsStore'
import { useViewStore } from '../src/renderer/src/shared/stores/viewStore'
import { useSyncStore } from '../src/renderer/src/shared/stores/syncStore'
import { BUILTIN_THEMES, builtinThemeId } from '../src/shared/themeCatalog'
import type { CreateLabelInput, Label, Project, Status, Task, Theme, User, UpdateTaskInput } from '../src/shared/types'
import '../src/renderer/src/assets/main.css'

const rootElement = document.getElementById('root')!
const root = createRoot(rootElement)
const pause = (ms = 35): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function waitFor(check: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 2000
  while (!check() && performance.now() < deadline) await pause()
  assert(check(), message)
}
const ipc = (window as unknown as { require: (name: string) => { ipcRenderer: { invoke: (channel: string, value: unknown) => Promise<void> } } }).require('electron').ipcRenderer
async function key(keyCode: string, shift = false): Promise<void> {
  await ipc.invoke('verify:keyboard', { keyCode, modifiers: shift ? ['shift'] : [] })
  await pause()
}
async function activate(element: HTMLElement): Promise<void> {
  assert(element, 'Missing activation target')
  element.focus()
  await key('Enter')
}
function button(name: string, scope: ParentNode = rootElement): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((element) => element.textContent?.trim() === name)
  assert(found, `Missing button ${name}`)
  return found
}
const timestamp = '2026-01-01T00:00:00Z'
const projects = ['one', 'two'].map((id, index) => ({ id, name: `Project ${id}`, owner_id: 'synthetic', sidebar_order: index, is_default: index === 0 ? 1 : 0,
  color: '#6366f1', icon: 'folder', is_archived: 0, is_shared: 0, deleted_at: null, area_id: null, created_at: timestamp, updated_at: timestamp }) as Project)
const statuses = projects.map((project) => ({ id: `todo-${project.id}`, project_id: project.id, name: 'Todo', color: '#6366f1', is_default: 1, is_done: 0, order_index: 0,
  created_at: timestamp, updated_at: timestamp, deleted_at: null }) as Status)
const tasks = Object.fromEntries(['first', 'second'].map((id, order_index) => [id, { id, title: id, project_id: 'one', owner_id: 'synthetic', status_id: 'todo-one', order_index,
  priority: 0, is_archived: 0, is_template: 0, is_in_my_day: 1, parent_id: null, assigned_to: null, due_date: null, completed_date: null, recurrence_rule: null,
  description: '- First item\n- Second item', reference_url: null, deleted_at: null, created_at: timestamp, updated_at: timestamp } as Task]))
const labels: Label[] = []
const links = new Map<string, Set<string>>()
const labelWrites: CreateLabelInput[] = []
const assignmentWrites: Array<[string, string]> = []
const preset = BUILTIN_THEMES[0]
const theme: Theme = { id: builtinThemeId(preset.name), name: preset.name, mode: preset.mode, config: JSON.stringify(preset.config), is_builtin: 1, owner_id: null,
  created_at: timestamp, updated_at: timestamp, deleted_at: null }
const taskLabels = (id: string): Label[] => labels.filter((label) => links.get(id)?.has(label.id))
const api = {
  tray: { onNavigateToTask: () => () => {}, onNavigateToMyDay: () => () => {} },
  notifications: { onNavigateToTask: () => () => {}, findAll: async () => [], getUnreadCount: async () => 0 },
  auth: { getSavedEmail: async () => null, getSupabaseConfig: async () => { throw new Error('Synthetic session has no network configuration') } },
  labels: {
    findAll: async () => labels, findByProjectId: async () => labels, findByTaskId: async (id: string) => taskLabels(id),
    findTaskLabelsByProject: async () => Object.keys(tasks).flatMap((task_id) => taskLabels(task_id).map((label) => ({ ...label, task_id }))),
    findById: async (id: string) => labels.find((label) => label.id === id) ?? null,
    findByName: async (_user: string, name: string) => labels.find((label) => label.name === name) ?? null,
    create: async (input: CreateLabelInput) => { labelWrites.push(input); const label = { ...input, order_index: labels.length, created_at: timestamp, updated_at: timestamp, deleted_at: null } as Label; labels.push(label); return label }
  },
  statuses: { findByProjectId: async (id: string) => statuses.filter((status) => status.project_id === id) },
  tasks: {
    findById: async (id: string) => tasks[id],
    update: async (id: string, input: UpdateTaskInput) => { tasks[id] = { ...tasks[id], ...input }; return tasks[id] },
    addLabel: async (taskId: string, labelId: string) => { assignmentWrites.push([taskId, labelId]); links.set(taskId, new Set([...(links.get(taskId) ?? []), labelId])) },
    getLabels: async (id: string) => [...(links.get(id) ?? [])].map((label_id) => ({ task_id: id, label_id }))
  },
  projects: { findById: async (id: string) => projects.find((project) => project.id === id), getMembers: async () => [{ user_id: 'member-one' }, { user_id: 'member-two' }] },
  users: { findById: async (id: string) => ({ id, display_name: id, email: `${id}@example.invalid` }) },
  attachments: { findByTaskId: async () => [] },
  activityLog: { findByTaskId: async () => [], create: async () => {} },
  sync: {
    captureContext: async () => ({ userId: 'synthetic', generation: 1 }), enqueue: async () => {}, count: async () => 0,
    invokeContext: async (_context: unknown, channel: string, args: unknown[]) => {
      const [namespace, method] = channel.split(':')
      const operation = (api as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>)[namespace]?.[method]
      assert(operation, `Unexpected synthetic IPC call: ${channel}`)
      return operation(...args)
    }
  }
}
function selectionUnchanged(id = 'first'): void {
  assert(useTaskStore.getState().selectedTaskIds.size === 1 && useTaskStore.getState().selectedTaskIds.has(id), 'Nested Tab changed task selection')
  assert(useViewStore.getState().selectedProjectId === 'one' || useViewStore.getState().currentView === 'my-day', 'Nested Tab changed project')
}
function panel(): HTMLElement {
  const element = rootElement.querySelector<HTMLElement>('[data-detail-panel]')
  assert(element, 'Actual DetailPanel is missing')
  return element
}
async function verifyLabelPalette(position: 'side' | 'bottom', reduced: boolean): Promise<void> {
  useViewStore.setState({ detailPanelPosition: position, detailPanelSize: 650 })
  useTaskStore.getState().setCurrentTask('first')
  await waitFor(() => Boolean(rootElement.querySelector(`[data-detail-panel][data-edge="${position}"]`)), `${position} panel did not mount`)
  const add = panel().querySelector<HTMLButtonElement>('[aria-label="Add label"]')!
  if (reduced) {
    add.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    add.click()
    await pause()
  } else await activate(add)
  const search = panel().querySelector<HTMLInputElement>('[placeholder="Search labels..."]')!
  assert(document.activeElement === search, 'Detail label picker did not focus search')
  assert(search.closest<HTMLElement>('.ui-surface')?.dataset.instant === 'true', 'Palette did not honor keyboard/reduced motion')
  await activate(button('New label...', panel()))
  const name = panel().querySelector<HTMLInputElement>('[placeholder="Label name"]')!
  assert(document.activeElement === name, 'New label did not focus its name input')
  const labelName = `${position}-${reduced ? 'reduced' : 'keyboard'}`
  await ipc.invoke('verify:text', labelName)
  await pause()
  const swatches = [...panel().querySelectorAll<HTMLButtonElement>('.ui-color-swatch')]
  for (const swatch of swatches) {
    await key('Tab')
    assert(document.activeElement === swatch, `${labelName}: Tab skipped ${swatch.getAttribute('aria-label')}`)
    selectionUnchanged()
  }
  const custom = panel().querySelector<HTMLInputElement>('.ui-color-swatches input[type="color"]')!
  const create = button('Create', panel())
  await key('Tab')
  assert(document.activeElement === custom, `${labelName}: custom input unreachable`)
  await key('Tab')
  assert(document.activeElement === create, `${labelName}: Create unreachable`)
  await key('Tab')
  assert(document.activeElement === name, `${labelName}: picker focus trap did not wrap forward`)
  await key('Tab', true)
  assert(document.activeElement === create, `${labelName}: picker focus trap did not wrap backward`)
  await key('Tab', true)
  assert(document.activeElement === custom, `${labelName}: reverse Tab skipped custom input`)
  for (const swatch of [...swatches].reverse()) {
    await key('Tab', true)
    assert(document.activeElement === swatch, `${labelName}: Shift+Tab skipped a swatch`)
  }
  await key('Tab', true)
  assert(document.activeElement === name, `${labelName}: reverse Tab skipped name input`)
  await activate(panel().querySelector<HTMLButtonElement>('[aria-label="Sage"]')!)
  assert(labelWrites.length === (position === 'side' ? 0 : 1), 'Swatch Enter submitted the label')
  await activate(create)
  await waitFor(() => assignmentWrites.length === labelWrites.length && labels.some((label) => label.name === labelName), 'Create did not persist and assign the label')
  const saved = labels.find((label) => label.name === labelName)!
  assert(saved.color === '#b6d9c7' && links.get('first')?.has(saved.id), 'Label persistence lost the chosen color or task')
  await key('Escape')
  await waitFor(() => !panel().querySelector('[placeholder="Search labels..."]') && document.activeElement === add, 'Picker Escape did not restore Add label focus')
  assert(useTaskStore.getState().showDetailPanel, 'Picker Escape closed DetailPanel')

  const handled = (event: KeyboardEvent): void => { if (event.key === 'Tab') event.preventDefault() }
  add.addEventListener('keydown', handled)
  await key('Tab')
  assert(document.activeElement === add, 'Detail navigation ignored defaultPrevented')
  add.removeEventListener('keydown', handled)
  await key('Tab')
  assert(document.activeElement?.closest('[data-detail-field]')?.textContent?.includes('Due Date'), 'Ordinary detail Tab did not reach Due Date')
  await key('Tab', true)
  assert(document.activeElement?.closest('[data-detail-field]') === add.closest('[data-detail-field]'), 'Ordinary detail Shift+Tab did not return to labels')

  const heading = panel().querySelector<HTMLButtonElement>('button[title="Heading"]')!
  await activate(heading)
  const headingMenu = button('Heading 1', panel()).closest<HTMLElement>('.ui-surface')!
  assert(headingMenu !== panel() && headingMenu.dataset.instant === 'true', 'Heading menu was not hosted in DetailPanel')
  const headingButtons = headingMenu.querySelectorAll<HTMLButtonElement>('button')
  headingButtons[0].focus()
  await key('Tab')
  assert(document.activeElement === headingButtons[1], 'Editor heading menu lost native Tab')
  await key('Tab', true)
  assert(document.activeElement === headingButtons[0], 'Editor heading menu lost native Shift+Tab')
  selectionUnchanged()
  await activate(heading)

  const editor = panel().querySelector<HTMLElement>('[contenteditable="true"]')!
  const secondItem = editor.querySelectorAll('li p')[1].firstChild!
  editor.focus()
  const range = document.createRange()
  range.setStart(secondItem, 0)
  range.collapse(true)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  const tiptap = (editor as HTMLElement & { editor: import('@tiptap/core').Editor }).editor
  const expectedPosition = tiptap.view.posAtDOM(secondItem, 0)
  await new Promise(requestAnimationFrame)
  await waitFor(() => tiptap.view.hasFocus() && tiptap.state.selection.empty && tiptap.state.selection.from === expectedPosition, 'Synthetic selection did not reach ProseMirror').catch((error) => {
    throw new Error(`${error.message}: expected=${expectedPosition}, actual=${tiptap.state.selection.from}, focused=${tiptap.view.hasFocus()}, domOffset=${window.getSelection()?.anchorOffset}, domTarget=${window.getSelection()?.anchorNode === secondItem}`)
  })
  await key('Tab')
  assert(editor.querySelector('li li') && document.activeElement === editor, 'Editor Tab indentation was overridden')
  await key('Tab', true)
  assert(!editor.querySelector('li li') && document.activeElement === editor, 'Editor Shift+Tab outdent was overridden')
  await key('Escape')
  assert(useTaskStore.getState().showDetailPanel, 'Editor Escape closed the panel')
  add.focus()
  await key('Escape')
  await waitFor(() => !rootElement.querySelector('[data-detail-panel]') && document.activeElement?.getAttribute('data-task-id') === 'first', 'Panel Escape did not restore its task row')
}

async function verifyListMenus(view: 'project' | 'my-day'): Promise<void> {
  useViewStore.setState({ currentView: view, selectedProjectId: 'one' })
  useTaskStore.setState({ selectedTaskIds: new Set(['first']), lastSelectedTaskId: 'first', showDetailPanel: false })
  await pause(100)
  const row = rootElement.querySelector<HTMLElement>('[data-task-id="first"]')!
  row.focus()
  await key('Tab')
  assert(useTaskStore.getState().selectedTaskIds.has('second'), `${view}: ordinary task Tab did not advance`)
  await key('Tab', true)
  selectionUnchanged()
  const blockTab = (event: KeyboardEvent): void => { if (event.key === 'Tab') event.preventDefault() }
  window.addEventListener('keydown', blockTab, true)
  row.focus()
  await key('Tab')
  selectionUnchanged()
  window.removeEventListener('keydown', blockTab, true)
  const filter = button('Filter')
  filter.focus()
  filter.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  filter.click()
  await pause()
  const menu = button('Due Date').closest<HTMLElement>('.ui-surface')!
  const choices = menu.querySelectorAll<HTMLButtonElement>('button')
  assert(choices.length > 1 && menu.closest('[tabindex="-1"]'), `${view}: missing actual list-hosted filter menu`)
  for (const selected of [true, false]) {
    if (!selected) {
      useLabelStore.setState({ sortRules: [{ field: 'title', direction: 'asc' }] })
      useTaskStore.setState({ tasks: {}, selectedTaskIds: new Set(), lastSelectedTaskId: null })
      await pause(100)
    }
    const liveChoices = button('Due Date').closest<HTMLElement>('.ui-surface')!.querySelectorAll<HTMLButtonElement>('button')
    liveChoices[0].focus()
    const ids = [...useTaskStore.getState().selectedTaskIds].join(',')
    assert(selected ? ids === 'first' : ids === '', `${view}: incorrect selection precondition`)
    await key('Tab')
    assert(document.activeElement === liveChoices[1] && [...useTaskStore.getState().selectedTaskIds].join(',') === ids, `${view}/${selected}: capture handler intercepted menu Tab`)
    await key('Tab', true)
    assert(document.activeElement === liveChoices[0] && [...useTaskStore.getState().selectedTaskIds].join(',') === ids, `${view}: capture handler intercepted menu Shift+Tab`)
  }
  await key('Escape')
  await pause()
  useTaskStore.setState({ tasks: { ...tasks }, selectedTaskIds: new Set(['first']), lastSelectedTaskId: 'first' })
  await pause()
  rootElement.querySelector<HTMLElement>('[data-task-id="first"]')!.focus()
  await key('Tab')
  assert(useTaskStore.getState().selectedTaskIds.has('second'), `${view}: task cycling did not resume after menu close`)
}

async function verify(): Promise<string> {
  Object.assign(window, { api })
  useAuthStore.setState({ currentUser: { id: 'synthetic', email: 'synthetic@example.invalid', display_name: 'Synthetic' } as User })
  useProjectStore.setState({ projects: Object.fromEntries(projects.map((project) => [project.id, project])), currentProjectId: 'one' })
  useTaskStore.setState({ tasks: { ...tasks }, selectedTaskIds: new Set(['first']), lastSelectedTaskId: 'first', taskLabels: {}, showDetailPanel: false })
  useStatusStore.setState({ statuses: Object.fromEntries(statuses.map((status) => [status.id, status])) })
  useLabelStore.setState({ labels: {}, projectLabels: {} })
  useViewStore.setState({ currentView: 'project', selectedProjectId: 'one', layoutMode: 'list' })
  useSettingsStore.setState({ themes: { [theme.id]: theme }, currentThemeId: theme.id, settings: {}, setSetting: async (name, value) => { useSettingsStore.setState((state) => ({ settings: { ...state.settings, [name]: value } })) } })
  const { AppLayout } = await import('../src/renderer/src/AppLayout')
  flushSync(() => root.render(<AppLayout />))
  await pause(150)
  await verifyLabelPalette('side', false)
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = ((query) => query.includes('prefers-reduced-motion') ? { matches: true } : matchMedia(query)) as typeof window.matchMedia
  await verifyLabelPalette('bottom', true)
  window.matchMedia = matchMedia
  assert(labelWrites.length === 2 && assignmentWrites.length === 2, 'Label creation duplicated writes')
  await verifyListMenus('project')
  await verifyListMenus('my-day')
  const projectTrigger = rootElement.querySelector<HTMLButtonElement>('[title="Select project for new task"]')!
  projectTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  projectTrigger.click()
  await pause()
  const projectMenu = projectTrigger.parentElement!.querySelector<HTMLElement>('.ui-surface')!
  const projectChoices = projectMenu.querySelectorAll<HTMLButtonElement>('button')
  projectChoices[0].focus()
  await key('Tab')
  assert(document.activeElement === projectChoices[1], 'My Day project menu lost native Tab')
  await key('Tab', true)
  assert(document.activeElement === projectChoices[0], 'My Day project menu lost native Shift+Tab')
  assert(useTaskStore.getState().selectedTaskIds.has('second'), 'My Day project menu changed task selection')
  await key('Escape')

  useViewStore.setState({ currentView: 'my-day', selectedProjectId: 'two' })
  useProjectStore.setState({ projects: { ...useProjectStore.getState().projects, one: { ...projects[0], is_shared: 1 } } })
  useSyncStore.setState({ status: 'synced' })
  useTaskStore.getState().setCurrentTask('first')
  await pause(150)
  const assign = panel().querySelector<HTMLButtonElement>('[title="Assign to member"]')!
  await activate(assign)
  const assigneeMenu = assign.parentElement!.querySelector<HTMLElement>('.ui-surface')!
  assert(assigneeMenu?.textContent?.includes('member-one'), 'Actual assignee menu did not load members')
  const members = assigneeMenu.querySelectorAll<HTMLButtonElement>('button')
  members[0].focus()
  await key('Tab')
  assert(document.activeElement === members[1], 'Assignee menu lost native Tab')
  await key('Tab', true)
  assert(document.activeElement === members[0], 'Assignee menu lost native Shift+Tab')
  await key('Escape')
  assert(useTaskStore.getState().showDetailPanel && !assigneeMenu.isConnected, 'Assignee Escape closed the panel')
  useTaskStore.setState({ showDetailPanel: false })
  useProjectStore.setState({ projects: Object.fromEntries(projects.map((project) => [project.id, project])) })
  useViewStore.setState({ currentView: 'project', selectedProjectId: 'one' })
  await pause(180)
  useTaskStore.setState({ tasks: {}, selectedTaskIds: new Set(), lastSelectedTaskId: null })
  await pause(100)
  assert(useTaskStore.getState().selectedTaskIds.size === 0, 'Project cycling requires no selected task')
  document.body.tabIndex = -1
  document.body.focus()
  await key('Tab')
  assert(useViewStore.getState().selectedProjectId === 'two', 'Unselected main-view Tab stopped cycling projects')
  document.body.focus()
  await key('Tab', true)
  assert(useViewStore.getState().selectedProjectId === 'one', 'Unselected main-view Shift+Tab stopped cycling projects')
  flushSync(() => root.unmount())
  return 'Detail keyboard behavior passed: full AppLayout, side/bottom label palettes and persistence, all swatches/Create in both directions, handled editor Tab, sibling menus, selected/unselected list and My Day menus, ordinary field/task/project cycling, Escape/focus restoration, keyboard and reduced motion'
}

Object.assign(window, { popupMotionResult: verify() })
