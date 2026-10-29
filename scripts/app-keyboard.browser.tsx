import { useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useProjectStore, useTaskStore, useStatusStore, useAuthStore } from '../src/renderer/src/shared/stores'
import { useSettingsStore } from '../src/renderer/src/shared/stores/settingsStore'
import { useViewStore } from '../src/renderer/src/shared/stores/viewStore'
import { useSavedViewStore } from '../src/renderer/src/shared/stores/savedViewStore'
import { ProjectGeneralSettings } from '../src/renderer/src/features/projects/ProjectGeneralSettings'
import { StatusEditRow } from '../src/renderer/src/features/projects/StatusEditRow'
import { NewProjectModal } from '../src/renderer/src/features/projects/NewProjectModal'
import { BUILTIN_THEMES, builtinThemeId } from '../src/shared/themeCatalog'
import type { LabelUsageInfo, Project, SavedView, Theme, UpdateThemeInput } from '../src/shared/types'
import '../src/renderer/src/assets/main.css'

const container = document.getElementById('root')!
const root = createRoot(container)
const pause = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 2000
  while (!condition() && performance.now() < deadline) await pause(25)
  assert(condition(), message)
}
const ipc = (window as unknown as { require: (name: string) => { ipcRenderer: { invoke: (channel: string, value: unknown) => Promise<void> } } }).require('electron').ipcRenderer
async function key(keyCode: string, shift = false): Promise<void> {
  await ipc.invoke('verify:keyboard', { keyCode, modifiers: shift ? ['shift'] : [] })
  await pause()
}
async function click(element: HTMLElement): Promise<void> {
  assert(element, 'Missing click target')
  element.focus()
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  element.click()
  await pause()
}
function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  const element = [...scope.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
  assert(element, `Missing button: ${label}`)
  return element
}
const project = (id: string, sidebar_order: number): Project => ({ id, name: `Project ${id}`, sidebar_order, owner_id: 'synthetic', color: '#6366f1', icon: 'folder', is_default: sidebar_order === 0 ? 1 : 0,
  is_archived: 0, is_shared: 0, deleted_at: null, area_id: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }) as Project
const projects = [project('one', 0), project('two', 1)]
const preset = BUILTIN_THEMES[0]
let theme: Theme = { id: builtinThemeId(preset.name), name: preset.name, mode: preset.mode, config: JSON.stringify(preset.config), is_builtin: 1, owner_id: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null }
const label = { id: 'synthetic-label', name: 'Synthetic label', color: '#6366f1', user_id: '', task_count: 0, project_count: 1, order_index: 0 } as LabelUsageInfo
const themeWrites: Array<{ id: string; input: UpdateThemeInput }> = []
const settingsWrites: Array<[string, string | null]> = []
const api = {
  tray: { onNavigateToTask: () => () => {}, onNavigateToMyDay: () => () => {} },
  notifications: { onNavigateToTask: () => () => {}, findAll: async () => [], getUnreadCount: async () => 0 },
  auth: { getSavedEmail: async () => null },
  labels: { findTaskLabelsByProject: async () => [], findAllWithUsage: async () => [label], findAll: async () => [label] },
  statuses: { findByProjectId: async () => [] },
  themes: { list: async () => [theme], update: async (id: string, input: UpdateThemeInput) => { themeWrites.push({ id, input }); theme = { ...theme, ...input }; return theme } },
  settings: { get: async (_user: string, name: string) => useSettingsStore.getState().settings[name] ?? (name === 'theme_id' ? theme.id : null) },
  fs: { showOpenDialog: async () => ({ canceled: false, filePaths: ['synthetic-invalid-theme.json'] }), readFile: async () => ({ ok: true, contents: '{ invalid json' }) },
  sync: {
    captureContext: async () => ({ userId: null, generation: 1 }),
    invokeContext: async (_context: unknown, channel: string, args: unknown[]) => {
      const [namespace, method] = channel.split(':')
      const operation = (api as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>)[namespace]?.[method]
      assert(operation, `Unexpected synthetic IPC call: ${channel}`)
      return operation(...args)
    }
  }
}
function unchanged(message: string): void {
  assert(useViewStore.getState().selectedProjectId === 'one', message)
  assert(useTaskStore.getState().selectedTaskIds.size === 0, 'Keyboard regression requires no selected task')
}
function ExtraProjectModal(): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return <NewProjectModal open={open} onClose={() => setOpen(false)} />
}

async function verify(): Promise<string> {
  Object.assign(window, { api })
  useAuthStore.setState({ currentUser: null })
  useProjectStore.setState({ projects: Object.fromEntries(projects.map((item) => [item.id, item])), currentProjectId: 'one' })
  useTaskStore.setState({ tasks: {}, selectedTaskIds: new Set(), showDetailPanel: false })
  useStatusStore.setState({ statuses: {} })
  useViewStore.setState({ currentView: 'project', selectedProjectId: 'one', layoutMode: 'list' })
  useSettingsStore.setState({ themes: { [theme.id]: theme }, currentThemeId: theme.id, settings: {},
    setSetting: async (name, value) => {
      settingsWrites.push([name, value])
      useSettingsStore.setState((state) => ({ settings: { ...state.settings, [name]: value } }))
    }
  })
  useSavedViewStore.setState({ views: [{ id: 'synthetic-view', name: 'Synthetic saved view', color: '#6366f1', filter_config: '{}', order_index: 0 } as SavedView] })
  const { AppLayout } = await import('../src/renderer/src/AppLayout')
  const render = async (extra: ReactNode = null): Promise<void> => { flushSync(() => root.render(<><AppLayout />{extra}</>)); await pause(80) }
  await render()
  document.body.tabIndex = -1
  document.body.focus()
  await key('Tab')
  assert(useViewStore.getState().selectedProjectId === 'two', 'Main-view Tab stopped cycling projects')
  document.body.focus()
  await key('Tab', true)
  unchanged('Main-view Shift+Tab stopped cycling projects')

  const openSettings = async (): Promise<HTMLElement> => {
    await click(container.querySelector<HTMLButtonElement>('aside button[title="Settings"]')!)
    await waitFor(() => Boolean(container.querySelector('[role="dialog"][aria-label="Settings"]')), 'Settings did not open')
    return container.querySelector<HTMLElement>('[role="dialog"][aria-label="Settings"]')!
  }
  const settings = await openSettings()
  await click(button('Appearance', settings))
  const trigger = settings.querySelector<HTMLButtonElement>('[aria-label="Edit accent color"]')!
  assert(trigger, 'Actual theme color control did not render')
  trigger.focus()
  await key('Enter')
  const palette = (): HTMLElement | null => document.querySelector('[role="dialog"][aria-label="Accent colors"]')
  await waitFor(() => Boolean(palette()), 'Actual theme palette did not open')
  const popup = palette()!
  const close = popup.querySelector<HTMLButtonElement>('[aria-label="Close color choices"]')!
  assert(document.activeElement === close, 'Theme palette did not automatically focus Close')
  assert(popup.dataset.instant === 'true', 'Keyboard-opened theme palette was animated')
  const choices = [...popup.querySelectorAll<HTMLButtonElement>('.ui-color-swatch')]
  for (const choice of choices) {
    await key('Tab')
    assert(document.activeElement === choice, `Tab did not reach ${choice.getAttribute('aria-label')}`)
    unchanged('Theme palette Tab switched projects')
  }
  const custom = popup.querySelector<HTMLInputElement>('input[type="color"]')!
  await key('Tab')
  assert(document.activeElement === custom, 'Tab did not reach the custom theme color input')
  await key('Tab')
  assert(document.activeElement === close, 'Theme popup focus trap did not wrap')
  await key('Tab')
  await key('Tab', true)
  assert(document.activeElement === close, 'Shift+Tab did not return to the popup Close control')
  unchanged('Theme popup Shift+Tab switched projects')
  const sage = popup.querySelector<HTMLButtonElement>('[aria-label="Sage"]')!
  sage.focus()
  await key('Enter')
  assert(sage.getAttribute('aria-pressed') === 'true' && document.documentElement.style.getPropertyValue('--color-accent') === '#b6d9c7', 'Native Enter did not activate the theme swatch')
  await key('Escape')
  await waitFor(() => !palette() && document.activeElement === trigger, 'Theme popup Escape did not restore focus')
  assert(settings.isConnected, 'Popup Escape closed its parent Settings modal')
  await click(button('Apply Theme', settings))
  await waitFor(() => themeWrites.length === 1, 'Theme selection did not reach persistence')
  assert(themeWrites[0].id === theme.id && JSON.parse(themeWrites[0].input.config!).accent === '#b6d9c7', 'Theme persistence used a different swatch color')
  assert(settingsWrites.some(([name, value]) => name === 'theme_id' && value === theme.id), 'Theme selection was not saved')

  const importButton = settings.querySelector<HTMLButtonElement>('[aria-label="Import theme"]')!
  await click(importButton)
  await waitFor(() => Boolean(settings.querySelector('[role="dialog"][aria-label="Import failed"]')), 'Nested import-error modal did not open')
  const nested = settings.querySelector<HTMLElement>('[role="dialog"][aria-label="Import failed"]')!
  const nestedClose = nested.querySelector<HTMLButtonElement>('[aria-label="Close"]')!
  nestedClose.focus()
  await key('Tab')
  assert(document.activeElement === button('Close', nested), 'Tab did not advance within the nested modal')
  unchanged('Nested modal Tab switched projects')
  await key('Tab', true)
  assert(document.activeElement === nestedClose, 'Nested modal Shift+Tab did not wrap')
  unchanged('Nested modal Shift+Tab switched projects')
  await key('Enter')
  await waitFor(() => !nested.isConnected && document.activeElement === importButton, 'Nested modal close did not restore focus')
  assert(settings.isConnected, 'Nested close removed parent Settings')

  await click(button('Labels', settings))
  const labelTrigger = settings.querySelector<HTMLButtonElement>('[aria-label="Change label color"]')
  if (!labelTrigger) {
    await click(button('Add Label', settings))
  }
  const labelColor = settings.querySelector<HTMLButtonElement>('[aria-label="Change label color"]')!
  assert(labelColor, 'Label palette trigger is missing')
  labelColor.focus()
  await key('Enter')
  const labelSwatches = [...settings.querySelectorAll<HTMLButtonElement>('.ui-color-swatch')]
  assert(labelSwatches.length === choices.length, 'Actual label palette is missing choices')
  labelSwatches[0].focus()
  await key('Tab')
  assert(document.activeElement === labelSwatches[1], 'Tab did not advance through the label popup')
  unchanged('Label palette Tab switched projects')
  await key('Escape')
  await click(settings.querySelector<HTMLButtonElement>(':scope > [aria-label="Close"]')!)
  await waitFor(() => !settings.isConnected, 'Settings did not close')

  const sidebarAdd = container.querySelector<HTMLButtonElement>('aside [aria-label="New project"]')!
  await click(sidebarAdd)
  const sidebarPalette = container.querySelector<HTMLElement>('aside .ui-color-swatches')!
  assert(sidebarPalette, 'Sidebar inline project palette did not open')
  const sidebarChoices = sidebarPalette.querySelectorAll<HTMLButtonElement>('.ui-color-swatch')
  sidebarChoices[0].focus()
  await key('Tab')
  assert(document.activeElement === sidebarChoices[1], 'Sidebar inline palette lost native Tab')
  await key('Tab', true)
  assert(document.activeElement === sidebarChoices[0], 'Sidebar inline palette lost native Shift+Tab')
  unchanged('Sidebar inline project palette switched projects')
  container.querySelector<HTMLInputElement>('aside input[placeholder="Project name..."]')!.focus()
  await key('Escape')

  await render(<div id="project-palette"><ProjectGeneralSettings project={projects[0]} onClose={() => {}} addToast={() => {}} /></div>)
  const projectChoices = container.querySelectorAll<HTMLButtonElement>('#project-palette .ui-color-swatch')
  projectChoices[0].focus()
  await key('Tab')
  assert(document.activeElement === projectChoices[1], 'Inline project colors lost native Tab')
  unchanged('Inline project palette switched projects')

  const statusWrites: string[] = []
  await render(<div id="status-palette"><StatusEditRow initialName="Synthetic status" initialColor="#6366f1" initialIsDone={false}
    onSave={(_name, color) => statusWrites.push(color)} onCancel={() => {}} /></div>)
  const statusChoices = container.querySelectorAll<HTMLButtonElement>('#status-palette .ui-color-swatch')
  statusChoices[0].focus()
  await key('Tab')
  assert(document.activeElement === statusChoices[1], 'Inline status colors lost native Tab')
  unchanged('Inline status palette switched projects')
  container.querySelector<HTMLButtonElement>('#status-palette [aria-label="Sage"]')!.focus()
  await key('Enter')
  container.querySelector<HTMLButtonElement>('#status-palette button[type="submit"]')!.focus()
  await key('Enter')
  assert(statusWrites.join(',') === '#b6d9c7', 'Status palette activation/submission changed')

  await render()
  const mainTrigger = container.querySelector<HTMLButtonElement>('button[title="Change view color"]')!
  mainTrigger.focus()
  await render(<ExtraProjectModal />)
  const modal = container.querySelector<HTMLElement>('[role="dialog"][aria-label="New Project"]')!
  const modalChoices = modal.querySelectorAll<HTMLButtonElement>('.ui-color-swatch')
  modalChoices[0].focus()
  await key('Tab')
  assert(document.activeElement === modalChoices[1], 'New project dialog colors lost native Tab')
  unchanged('New project dialog palette switched projects')
  await key('Escape')
  await waitFor(() => !modal.isConnected && document.activeElement === mainTrigger, 'New project Escape did not restore focus')
  await render()

  const savedView = [...container.querySelectorAll('aside span')].find((element) => element.textContent === 'Synthetic saved view')!
  savedView.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 250 }))
  await pause(180)
  const savedChoices = container.querySelectorAll<HTMLButtonElement>('[aria-label="Saved view colors"] .ui-color-swatch')
  savedChoices[0].focus()
  await key('Tab')
  assert(document.activeElement === savedChoices[1], 'Saved-view palette lost native Tab')
  unchanged('Saved-view palette Tab switched projects')
  await click(document.body)
  document.body.focus()
  await key('Tab')
  assert(useViewStore.getState().selectedProjectId === 'two', 'Main project cycling did not resume after closing palettes')
  document.body.focus()
  await key('Tab', true)
  unchanged('Main project cycling did not resume in reverse')
  flushSync(() => root.unmount())
  return `AppLayout keyboard behavior passed: two projects/no task, ${choices.length} actual theme swatches, native Tab/Shift+Tab, nested Settings dialogs, theme persistence, label/project/status/sidebar palettes, Escape/focus restoration, keyboard-immediate motion, and main-view project cycling`
}

Object.assign(window, { popupMotionResult: verify() })
