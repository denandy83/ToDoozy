import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { DndContext } from '@dnd-kit/core'
import { PostgrestClient } from '@supabase/postgrest-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DatabaseSync as SQLite } from 'node:sqlite'
import { migrations } from '../src/main/database/migrations'
import { SettingsRepository } from '../src/main/repositories/SettingsRepository'
import { ThemeRepository } from '../src/main/repositories/ThemeRepository'
import { BUILTIN_THEMES, builtinThemeId } from '../src/shared/themeCatalog'
import type { Setting } from '../src/shared/types'
import { useSettingsStore, selectCurrentTheme } from '../src/renderer/src/shared/stores/settingsStore'
import { useAuthStore } from '../src/renderer/src/shared/stores/authStore'
import { useThemeApplicator } from '../src/renderer/src/shared/hooks/useThemeApplicator'
import { ThemeSettingsContent, type ThemeSettingsHandle } from '../src/renderer/src/features/settings/ThemeSettingsContent'
import { ThemeSettingsModal } from '../src/renderer/src/features/settings/ThemeSettingsModal'
import { Sidebar } from '../src/renderer/src/features/sidebar/Sidebar'
import { ToastContainer } from '../src/renderer/src/shared/components/Toast'
import { serializeThemePair } from '../src/renderer/src/shared/utils/themeIO'
import { SYNC_TABLES } from '../src/renderer/src/services/syncTables'
import type { SyncContext } from '../src/renderer/src/services/syncContext'
import '../src/renderer/src/assets/main.css'

const node = window as unknown as { require(name: string): unknown }
const { DatabaseSync } = node.require('node:sqlite') as typeof import('node:sqlite')
const { ipcRenderer } = node.require('electron') as typeof import('electron')
const element = document.getElementById('root')!
const root = createRoot(element)
const pause = (ms = 25): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function waitFor(check: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 2500
  while (!check() && performance.now() < deadline) await pause()
  assert(check(), message)
}
async function activate(target: HTMLElement): Promise<void> {
  assert(target, 'Missing control')
  target.focus()
  await ipcRenderer.invoke('verify:keyboard', 'Enter')
  await pause()
}
function button(name: string): HTMLButtonElement {
  const target = [...element.querySelectorAll('button')].find((item) => item.textContent?.trim() === name)
  assert(target, `Missing ${name} button`)
  return target
}
async function choose(value: string): Promise<void> {
  const select = element.querySelector<HTMLSelectElement>('select[aria-label="Theme"]')!
  assert(select, 'Missing actual theme picker')
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await pause()
}
function gate(): { wait: Promise<void>; release: () => void; entered: boolean } {
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  return { wait, release, entered: false }
}
let database: SQLite
let settings: SettingsRepository
let themes: ThemeRepository
let generation = 0
let userId = 'synthetic'
let heldMode: ReturnType<typeof gate> | null = null
let heldDelete: ReturnType<typeof gate> | null = null
let selectionWrites: Array<string | null> = []
let cloudRow: Record<string, unknown>
const forest = builtinThemeId('Forest Dark')
const ocean = builtinThemeId('Ocean Blue Dark')
const older = '2026-10-29T09:00:00.000Z'
const api = {
  auth: { getSupabaseConfig: async () => ({ url: '', anonKey: '' }), getSavedEmail: async () => null },
  settings: {
    get: async (user: string, key: string) => settings.get(user, key),
    getAll: async (user: string) => settings.getAll(user),
    findRaw: async (user: string, key: string) => settings.findRaw(user, key),
    findAllByUser: async (user: string, options: object) => settings.findAllByUser(user, options),
    set: async (user: string, key: string, value: string | null) => {
      settings.set(user, key, value)
      if (key === 'theme_id') selectionWrites.push(value)
      if (key === 'theme_mode' && heldMode) { const hold = heldMode; heldMode = null; hold.entered = true; await hold.wait }
    },
    applyRemote: async (row: Setting) => settings.applyRemote(row),
    canRewriteThemeReference: async (user: string, from: string | null, to: string | null, stamp: string) => settings.canRewriteThemeReference(user, from, to, stamp),
    themeReferenceSource: async (user: string, value: string | null, stamp: string) => settings.themeReferenceSource(user, value, stamp)
  },
  themes: new Proxy({}, { get: (_, method: keyof ThemeRepository) => async (...args: unknown[]) => {
    if (method === 'delete' && heldDelete) { const hold = heldDelete; heldDelete = null; hold.entered = true; await hold.wait }
    return (themes[method] as (...values: unknown[]) => unknown).apply(themes, args)
  } }),
  savedViews: { findByUserId: async () => [], countMatching: async () => 0 },
  projectAreas: { findByUserId: async () => [] },
  fs: {
    showOpenDialog: async () => ({ canceled: false, filePaths: ['synthetic-theme.json'] }),
    readFile: async () => ({ ok: true, contents: serializeThemePair('Imported', BUILTIN_THEMES[0].config, BUILTIN_THEMES[1].config) })
  },
  sync: {
    captureContext: async () => ({ userId: userId || null, generation }),
    invokeContext: async (scope: { userId: string | null; generation: number }, channel: string, args: unknown[]) => {
      assert(scope.generation === generation && scope.userId === (userId || null), 'Stale synthetic database')
      const [namespace, method] = channel.split(':')
      return (api as unknown as Record<string, Record<string, (...values: unknown[]) => unknown>>)[namespace][method](...args)
    },
    enqueue: async () => {}, count: async () => 0
  }
}
const client = new PostgrestClient('https://example.invalid', { fetch: async (input, init) => {
  const url = new URL(String(input))
  let rows = url.pathname.endsWith('/user_settings') ? [cloudRow] : []
  rows = rows.filter((row) => [...url.searchParams].every(([key, filter]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(key)) return true
    const split = filter.indexOf('.')
    const operation = filter.slice(0, split)
    const value = filter.slice(split + 1)
    return operation === 'is' ? (row[key] ?? null) === null : key.endsWith('_at') ? Date.parse(String(row[key])) === Date.parse(value) : String(row[key]) === value
  }))
  if (init?.method === 'PATCH' && rows.length) cloudRow = { ...cloudRow, ...JSON.parse(String(init.body)) }
  const headers = { 'Content-Type': 'application/json' }
  return new Response(JSON.stringify(new Headers(init?.headers).get('Accept') === 'application/vnd.pgrst.object+json' ? rows[0] ?? null : rows), { headers })
} }) as unknown as SupabaseClient
function context(): SyncContext {
  const captured = generation
  const isCurrent = async (): Promise<boolean> => captured === generation
  return { api: window.api, client, isCurrent, assertCurrent: () => assert(captured === generation, 'Stale sync'), scope: String(captured) }
}
function Projection(): null { useThemeApplicator(); return null }
async function initialize(global = false, custom = false): Promise<void> {
  flushSync(() => root.render(null))
  database?.close()
  database = new DatabaseSync(':memory:')
  generation++
  userId = global ? '' : 'synthetic'
  for (const migrate of migrations) migrate(database)
  settings = new SettingsRepository(database)
  themes = new ThemeRepository(database)
  let selected = forest
  if (custom) {
    themes.create({ id: 'genuine-custom', name: 'Aviobook Dark', mode: 'dark', config: JSON.stringify(BUILTIN_THEMES[0].config), owner_id: userId })
    selected = 'genuine-custom'
  }
  settings.applyRemote({ user_id: userId, key: 'theme_id', value: selected, updated_at: older, deleted_at: null })
  Object.assign(window, { api })
  useAuthStore.setState({ currentUser: global ? null : { id: userId } as never })
  useSettingsStore.getState().setUserId(userId)
  await useSettingsStore.getState().hydrateSettings()
  await useSettingsStore.getState().hydrateThemes()
  useSettingsStore.setState((state) => ({ settings: { ...state.settings, unrelated: 'optimistic' } }))
  selectionWrites = []
  heldMode = null
  heldDelete = null
}
function assertAccepted(value: string, stamp: string): void {
  const state = useSettingsStore.getState()
  assert(settings.findRaw(userId, 'theme_id')?.value === value && settings.findRaw(userId, 'theme_id')?.updated_at === stamp, 'SQLite selection regressed')
  assert(state.settings.theme_id === value && state.currentThemeId === value, 'Handler overwrote accepted store selection')
  assert(state.settings.unrelated === 'optimistic', 'Unrelated preference was cleared')
  assert(state.themes[value]?.config === themes.findById(value)?.config && selectCurrentTheme(state)?.id === value, 'Theme map/selector disagrees with SQLite')
}
async function verify(): Promise<string> {
  const ref = createRef<ThemeSettingsHandle>()
  const cases = ['content apply', 'modal apply', 'content mode', 'sidebar mode', 'content create', 'modal create', 'content import', 'delete race', 'delete fallback', 'global apply']
  for (const action of cases) {
    const deleting = action.startsWith('delete')
    await initialize(action === 'global apply', deleting)
    flushSync(() => root.render(<><Projection /><ToastContainer />{action.startsWith('modal')
      ? <ThemeSettingsModal open onClose={() => {}} />
      : action === 'sidebar mode' ? <DndContext><Sidebar viewCounts={{ 'my-day': 0, archive: 0, templates: 0 }} projectCounts={{}} projects={[]} onSettings={() => {}} onHelp={() => {}} /></DndContext>
      : <ThemeSettingsContent ref={ref} />}</>))
    await pause()
    const hold = gate()
    if (deleting) heldDelete = hold
    else if (action !== 'global apply') heldMode = hold
    let completion: Promise<void> | undefined
    if (action.endsWith('apply')) {
      await choose(ocean)
      if (action === 'modal apply') await activate(button('Apply Theme'))
      else completion = ref.current!.apply()
    } else if (action.endsWith('create')) {
      if (action === 'content create') await choose('__new__')
      const input = element.querySelector<HTMLInputElement>(action === 'content create' ? '[placeholder="Theme name..."]' : '[placeholder="Custom theme name..."]')!
      input.focus()
      await ipcRenderer.invoke('verify:text', 'Fresh Family')
      await pause()
      await activate(button(action === 'content create' ? 'Create' : 'Save As'))
    } else if (action === 'content import') await activate(element.querySelector<HTMLElement>('[aria-label="Import theme"]')!)
    else if (deleting) {
      await activate(element.querySelector<HTMLElement>('[title="Delete this custom theme"]')!)
      await activate(button('Delete'))
    } else await activate(action === 'sidebar mode' ? element.querySelector<HTMLElement>('[title="Switch to light mode"]')! : button('light'))
    if (action === 'global apply') {
      await completion
      assertAccepted(ocean, settings.findRaw(userId, 'theme_id')!.updated_at)
      continue
    }
    await waitFor(() => hold.entered, `${action}: save did not reach held boundary`)
    if (action.endsWith('apply')) assert(settings.get(userId, 'theme_id') === ocean, `${action}: Ocean was not actually applied`)
    if (action.endsWith('mode')) assert(settings.get(userId, 'theme_id') === builtinThemeId('Forest Light'), `${action}: mode counterpart was not actually applied`)
    const writes = selectionWrites.length
    if (action !== 'delete fallback') {
      const stamp = new Date(Math.max(Date.now(), Date.parse(settings.findRaw(userId, 'theme_id')!.updated_at)) + 1000).toISOString()
      const selected: Setting = { user_id: userId, key: 'theme_id', value: forest, updated_at: stamp, deleted_at: null }
      cloudRow = SYNC_TABLES.settings!.toRemote(selected) as Record<string, unknown>
      await SYNC_TABLES.settings!.localApplyRemote(cloudRow, window.api, context())
      hold.release()
      await completion
      await pause()
      assertAccepted(forest, stamp)
      assert(selectionWrites.length === writes, `${action}: late callback persisted a stale selection`)
      await SYNC_TABLES.settings!.remoteUpsert(settings.findRaw(userId, 'theme_id')!, context())
      assert(cloudRow.value === forest && cloudRow.updated_at === stamp, `${action}: cloud choice regressed`)
    } else {
      hold.release()
      await waitFor(() => useSettingsStore.getState().currentThemeId === builtinThemeId('Standard Dark'), 'Deleting the current theme lost its ordinary fallback')
      assertAccepted(builtinThemeId('Standard Dark'), settings.findRaw(userId, 'theme_id')!.updated_at)
    }
  }
  flushSync(() => root.unmount())
  database.close()
  return 'Theme handler races passed: both editors Apply/create, content mode/import/delete, sidebar toggle, current-delete fallback and global Apply; actual store, SQLite, selector and conditional cloud writer remain coherent'
}
Object.assign(window, { popupMotionResult: verify() })
