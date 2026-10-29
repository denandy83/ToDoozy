import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { PostgrestClient } from '@supabase/postgrest-js'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { migrations } from '../../../main/database/migrations'
import { repairBuiltinThemes } from '../../../main/database/themeRepair'
import { SettingsRepository } from '../../../main/repositories/SettingsRepository'
import { ThemeRepository } from '../../../main/repositories/ThemeRepository'
import { BUILTIN_THEMES, builtinThemeId, canSyncTheme } from '../../../shared/themeCatalog'
import type { Setting, SyncQueueEntry, Theme } from '../../../shared/types'
import type { SyncContext } from './syncContext'

const network = vi.hoisted(() => ({ client: null as unknown, token: null as null | (() => Promise<string>) }))
const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), database: null as unknown as DatabaseSync }))
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler) }, safeStorage: {}, BrowserWindow: {}, dialog: {}, shell: {}, app: {} }))
vi.mock('keytar', () => ({ default: {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../../../main/database', () => ({ getDatabase: () => ipc.database, switchDatabase: vi.fn(), getDatabasePath: vi.fn() }))
vi.mock('../../../main/quick-add', () => ({ hideQuickAddWindow: vi.fn() }))
vi.mock('../../../main/index', () => ({ registerQuickAddShortcut: vi.fn(), registerAppToggleShortcut: vi.fn(), getMainWindow: vi.fn() }))
vi.mock('../../../main/tray', () => ({ setTrayUserId: vi.fn(), refreshTray: vi.fn(), setTimerState: vi.fn(), clearTimerState: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn((_url, _key, options) => { network.token = options.accessToken; return network.client }) }))
vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn(async () => network.client), safeRefresh: vi.fn() }))
vi.mock('./sessionRecovery', () => ({ requireSession: vi.fn(async () => ({ user: { id: 'user-1' } }) as Session) }))
vi.mock('../shared/stores/logStore', () => ({ logEvent: vi.fn() }))
import { fullPull, fullUpload, pushSetting, pushTheme, deleteThemeFromSupabase, deleteSettingFromSupabase } from './PersonalSyncService'
import { processSyncQueue, setOnlineStatus } from './SyncService'
import { requireSession } from './sessionRecovery'
import { reconcileTable, SYNC_TABLES, type SyncTableDescriptor, type RemoteSetting, type RemoteTheme } from './syncTables'
import { useAuthStore } from '../shared/stores/authStore'
import { useSyncStore } from '../shared/stores/syncStore'
import { useSettingsStore, selectCurrentTheme } from '../shared/stores/settingsStore'
import { registerIpcHandlers } from '../../../main/ipc-handlers'

const databases: DatabaseSync[] = []
const settingsTable = SYNC_TABLES.settings! as SyncTableDescriptor<Setting, RemoteSetting>
const themesTable = SYNC_TABLES.themes! as SyncTableDescriptor<Theme, RemoteTheme>
let databaseGeneration = 0
const userId = 'user-1'
const older = '2026-10-29T09:00:00.000Z'
const newer = '2026-10-29T10:00:00.000Z'
const upgrade = '2026-10-29T11:00:00.000Z'
const aliasId = 'legacy-copy'
const canonical = builtinThemeId('Standard Dark')
function selection(value: string | null, updated_at: string, deleted_at: string | null = null): Setting {
  return { user_id: userId, key: 'theme_id', value, updated_at, deleted_at }
}
function database(cold = false): { db: DatabaseSync; settings: SettingsRepository; themes: ThemeRepository } {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  for (const migration of migrations.slice(0, 30)) migration(db)
  const themes = new ThemeRepository(db)
  const settings = new SettingsRepository(db)
  if (!cold) for (const theme of [
    { id: aliasId, name: 'Standard Dark', is_builtin: 0 },
    { id: 'named-custom', name: 'Soft Sage Dark', is_builtin: 0 }
  ]) db.prepare('INSERT INTO themes (id,name,mode,config,is_builtin,owner_id,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,NULL)')
    .run(theme.id, theme.name, 'dark', JSON.stringify(BUILTIN_THEMES[0].config), theme.is_builtin, userId, older, older)
  return { db, settings, themes }
}
function cloud() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>()
  const writes: Array<{ table: string; payload: Record<string, unknown> }> = []
  let beforeWrite: (() => void) | undefined
  let writeTable = 'user_settings'
  let afterRead: (() => void) | undefined
  let readTable = 'user_settings'
  let failMutation = false
  let failTable = 'user_settings'
  const tableRows = (table: string): Map<string, Record<string, unknown>> => {
    if (!tables.has(table)) tables.set(table, new Map())
    return tables.get(table)!
  }
  const client = new PostgrestClient('https://example.invalid', { fetch: async (input, init) => {
    await network.token?.()
    const url = new URL(String(input))
    const table = url.pathname.split('/').at(-1)!
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    const mutation = method === 'POST' || method === 'PATCH'
    const selectionMutation = mutation && table === 'user_settings' && JSON.parse(String(init?.body)).key === 'theme_id'
    const themeMutation = mutation && table === 'user_themes' && JSON.parse(String(init?.body)).id === aliasId
    if (mutation && table === writeTable && beforeWrite && (themeMutation || selectionMutation)) { const hook = beforeWrite; beforeWrite = undefined; hook() }
    if (mutation && table === failTable && failMutation && (themeMutation || selectionMutation)) {
      failMutation = false
      return new Response(JSON.stringify({ message: 'Synthetic transport failure', code: 'write_failed' }), { status: 400 })
    }
    const matches = (row: Record<string, unknown>): boolean => [...url.searchParams].every(([key, condition]) => {
      if (['select', 'order', 'limit', 'on_conflict'].includes(key)) return true
      const split = condition.indexOf('.')
      const operation = condition.slice(0, split)
      const value = condition.slice(split + 1)
      if (operation === 'is') return (row[key] ?? null) === (value === 'null' ? null : value)
      const a = key.endsWith('_at') ? Date.parse(String(row[key])) : row[key]
      const b = key.endsWith('_at') ? Date.parse(value) : value
      if (operation === 'eq') return a === b
      if (operation === 'gt') return Date.parse(String(row[key])) > Date.parse(value)
      if (operation === 'in') return value.slice(1, -1).split(',').includes(String(row[key]))
      throw new Error(`Unsupported synthetic filter ${operation}`)
    })
    let rows = [...tableRows(table).values()].filter(matches)
    if (method === 'POST') {
      rows = []
      const payload = JSON.parse(String(init?.body))
      for (const row of Array.isArray(payload) ? payload : [payload]) {
        if (tableRows(table).has(String(row.id)) && headers.get('Prefer')?.includes('resolution=ignore-duplicates')) continue
        tableRows(table).set(String(row.id), structuredClone(row))
        writes.push({ table, payload: structuredClone(row) })
        rows.push(row)
      }
    } else if (method === 'PATCH') {
      const payload = JSON.parse(String(init?.body))
      rows = rows.map((row) => ({ ...row, ...payload }))
      for (const row of rows) {
        tableRows(table).set(String(row.id), structuredClone(row))
        writes.push({ table, payload: structuredClone(row) })
      }
    }
    const order = url.searchParams.get('order')
    if (order) for (const term of order.split(',').reverse()) {
      const [key, direction] = term.split('.')
      rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (direction === 'desc' ? -1 : 1))
    }
    if (url.searchParams.has('limit')) rows = rows.slice(0, Number(url.searchParams.get('limit')))
    if (method === 'GET' && table === readTable && url.searchParams.has('id') && (table !== 'user_themes' || url.searchParams.get('id') === `eq.${aliasId}`) && afterRead) { const hook = afterRead; afterRead = undefined; hook() }
    const responseHeaders = { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` }
    if (method === 'HEAD') return new Response(null, { headers: responseHeaders })
    if (headers.get('Accept') === 'application/vnd.pgrst.object+json') {
      if (!rows.length) return new Response(JSON.stringify({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'No rows' }), { status: 406, headers: responseHeaders })
      return new Response(JSON.stringify(rows[0]), { headers: responseHeaders })
    }
    return new Response(JSON.stringify(rows), { headers: responseHeaders })
  } }) as unknown as SupabaseClient
  return {
    client, writes,
    put(setting: Setting) { tableRows('user_settings').set(`${setting.user_id}:${setting.key}`, { ...setting, id: `${setting.user_id}:${setting.key}` }) },
    putTheme(row: Record<string, unknown>) { tableRows('user_themes').set(String(row.id), row) },
    getTheme(id: string) { return tableRows('user_themes').get(id) },
    purgeThemes() { tableRows('user_themes').clear() },
    get() { return tableRows('user_settings').get(`${userId}:theme_id`)! },
    onWrite(hook: () => void, table = 'user_settings') { beforeWrite = hook; writeTable = table },
    onRead(hook: () => void, table = 'user_settings') { afterRead = hook; readTable = table },
    failNextMutation(table = 'user_settings') { failMutation = true; failTable = table }
  }
}
function install(device: ReturnType<typeof database>, server: ReturnType<typeof cloud>, throughIpc = false): { context: SyncContext; queue: SyncQueueEntry[] } {
  const generation = ++databaseGeneration
  network.token = null
  const queue: SyncQueueEntry[] = []
  const highWater = new Map<string, string>()
  const api = {
    auth: { getSupabaseConfig: async () => ({ url: 'https://example.invalid', anonKey: 'synthetic' }) },
    settings: {
      themeReferenceSource: async (user: string, value: string | null, stamp: string) => device.settings.themeReferenceSource(user, value, stamp),
      canRewriteThemeReference: async (user: string, from: string | null, to: string | null, stamp: string) => device.settings.canRewriteThemeReference(user, from, to, stamp),
      get: async (user: string, key: string) => device.settings.get(user, key),
      getAll: async (user: string) => device.settings.getAll(user),
      set: async (user: string, key: string, value: string | null) => device.settings.set(user, key, value),
      findRaw: async (user: string, key: string) => device.settings.findRaw(user, key),
      findAllByUser: async (user: string, options: { includeTombstones?: boolean } = {}) => device.settings.findAllByUser(user, options),
      findMaxUpdatedAt: async (user: string) => device.settings.findMaxUpdatedAt(user),
      applyRemote: async (row: Setting) => device.settings.applyRemote(row)
    },
    themes: { findById: async (id: string) => device.themes.findById(id), isPresetAlias: async (theme: Theme) => device.themes.isPresetAlias(theme), findMaxUpdatedAt: async (user: string) => device.themes.findMaxUpdatedAt(user), findAllByOwner: async (user: string, options: { includeTombstones?: boolean }) => device.themes.findAllByOwner(user, options), applyRemote: async (row: Theme) => device.themes.applyRemote(row) },
    projects: { getProjectsForUser: async () => [] },
    labels: { findAll: async () => [] },
    savedViews: { findByUserId: async () => [] },
    projectAreas: { findByUserId: async () => [] },
    syncMeta: {
      getHighWater: async (_user: string, _scope: string, name: string) => highWater.get(name) ?? null,
      setHighWater: async (_user: string, _scope: string, name: string, stamp: string) => { highWater.set(name, stamp) },
      setLastReconciledAt: async () => {}
    },
    sync: {
      captureContext: async () => ({ userId, generation }),
      invokeContext: async (context: { generation: number }, channel: string, args: unknown[]) => {
        if (context.generation !== generation) throw new Error('Synthetic database changed')
        const [namespace, method] = channel.split(':')
        return (api as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>)[namespace][method](...args)
      },
      getQueue: async () => [...queue], count: async () => queue.length,
      enqueue: async (table_name: string, row_id: string, operation: SyncQueueEntry['operation'], payload: string) => { queue.push({ id: `queue-${queue.length}`, table_name, row_id, operation, payload, created_at: new Date().toISOString() }) },
      dequeue: async (id: string) => { const index = queue.findIndex((item) => item.id === id); if (index < 0) return false; queue.splice(index, 1); return true }
    }
  }
  if (throughIpc) {
    ipc.database = device.db
    ipc.handlers.clear()
    registerIpcHandlers()
    ipc.handlers.get('auth:switchDatabase')!({}, userId)
    const database = ipc.handlers.get('sync:captureContext')!({}) as { userId: string; generation: number }
    api.sync.captureContext = async () => ipc.handlers.get('sync:captureContext')!({}) as typeof database
    api.sync.invokeContext = async (context, channel, args) => {
      const current = await api.sync.captureContext()
      if (current.generation !== context.generation) throw new Error('Synthetic database changed')
      const [namespace, method] = channel.split(':')
      return (api as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>)[namespace][method](...args)
    }
    for (const namespace of ['settings', 'themes'] as const) {
      api[namespace] = new Proxy(api[namespace], { get: (_, method: string) => async (...args: unknown[]) => ipc.handlers.get('sync:invokeContext')!({}, database, `${namespace}:${method}`, args) }) as typeof api.settings & typeof api.themes
    }
  }
  vi.stubGlobal('window', { api })
  network.client = server.client
  const pinnedApi = window.api
  const capturedDatabase = throughIpc ? ipc.handlers.get('sync:captureContext')!({}) as { userId: string; generation: number } : null
  const isCurrent = (): boolean => {
    const current = throughIpc ? ipc.handlers.get('sync:captureContext')!({}) as typeof capturedDatabase : null
    return useAuthStore.getState().currentUser?.id === userId && window.api === pinnedApi && (!capturedDatabase || (current?.userId === capturedDatabase.userId && current?.generation === capturedDatabase.generation))
  }
  return { queue, context: { api: pinnedApi, client: server.client, assertCurrent: () => { if (!isCurrent()) throw new Error('Synthetic account changed') }, isCurrent: async () => isCurrent(), scope: 'synthetic' } }
}
beforeEach(() => {
  network.token = null
  vi.useFakeTimers()
  vi.setSystemTime(upgrade)
  vi.mocked(requireSession).mockResolvedValue({ user: { id: userId } } as Session)
  useAuthStore.setState({ currentUser: { id: userId } as never })
  useSettingsStore.getState().setUserId('')
  useSettingsStore.setState({ currentThemeId: null, themes: {}, settings: {}, error: null, loading: false })
  useSyncStore.setState({ status: 'synced', errorMessage: null })
  setOnlineStatus(true)
})

type PublishPath = 'eager' | 'full upload' | 'queued' | 'reconcile'
const paths: PublishPath[] = ['eager', 'full upload', 'queued', 'reconcile']
async function publish(path: PublishPath, installed: ReturnType<typeof install>): Promise<void> {
  if (path === 'eager') {
    pushSetting('theme_id', aliasId, userId)
    await vi.advanceTimersByTimeAsync(6000)
  } else if (path === 'full upload') await fullUpload(userId, installed.context)
  else if (path === 'queued') {
    if (!installed.queue.length) installed.queue.push({ id: 'selection', table_name: 'user_settings', row_id: `${userId}:theme_id`, operation: 'UPDATE', payload: JSON.stringify(selection(aliasId, older)), created_at: upgrade })
    await processSyncQueue(installed.context)
  } else await reconcileTable(settingsTable, userId, userId, installed.context)
}

async function publishTheme(path: PublishPath, device: ReturnType<typeof database>, installed: ReturnType<typeof install>): Promise<void> {
  const theme = device.themes.findById(aliasId)!
  if (path === 'eager') await pushTheme(theme)
  else if (path === 'full upload') await fullUpload(userId, installed.context)
  else if (path === 'queued') {
    installed.queue.push({ id: `theme-${installed.queue.length}`, table_name: 'user_themes', row_id: aliasId, operation: 'UPDATE', payload: JSON.stringify(SYNC_TABLES.themes!.toRemote(theme)), created_at: upgrade })
    await processSyncQueue(installed.context)
  } else await reconcileTable(themesTable, userId, userId, installed.context)
}

function genuine(original: Theme, updatedAt = newer): Theme {
  return { ...original, name: 'Aviobook Dark', updated_at: updatedAt, deleted_at: null, config: JSON.stringify({ ...BUILTIN_THEMES[0].config, accent: '#b6d9c7', sidebar: '#123456' }) }
}
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  databases.splice(0).forEach((db) => db.close())
})

async function restoredCloudSelection(archive: boolean, stamp: string) {
  const a = database()
  const offline = database()
  const b = database(!archive)
  const forest = BUILTIN_THEMES.find((theme) => theme.name === 'Forest Dark')!
  const builtin = builtinThemeId(forest.name)
  for (const device of [a, offline, ...(archive ? [b] : [])]) {
    device.db.prepare('UPDATE themes SET name=?,config=?,updated_at=? WHERE id=?')
      .run(forest.name, JSON.stringify(forest.config), stamp, aliasId)
  }
  const original = offline.themes.findById(aliasId)!
  offline.settings.applyRemote(selection(aliasId, stamp))
  offline.themes.applyRemote(genuine(original, new Date(Date.parse(stamp) + 3600000).toISOString()))
  a.settings.applyRemote(selection(aliasId, stamp))
  repairBuiltinThemes(a.db)
  repairBuiltinThemes(b.db)
  const server = cloud()
  server.put(selection(aliasId, stamp))
  let installed = install(a, server, true)
  await SYNC_TABLES.settings!.remoteUpsert(a.settings.findRaw(userId, 'theme_id')!, installed.context)
  expect(server.get()).toMatchObject(selection(builtin, stamp))
  installed = install(b, server, true)
  await fullPull(userId, installed.context)
  expect(b.settings.findRaw(userId, 'theme_id')).toEqual(selection(builtin, stamp))
  const archives = b.db.prepare('SELECT snapshot FROM theme_duplicate_archive').all() as Array<{ snapshot: string }>
  expect(archives).toHaveLength(archive ? 1 : 0)
  for (const row of archives) expect(JSON.parse(row.snapshot).selections).toEqual([])
  installed = install(offline, server, true)
  await publishTheme('eager', offline, installed)
  expect(server.getTheme(aliasId)).toMatchObject({ name: 'Aviobook Dark', deleted_at: null })
  installed = install(b, server, true)
  await SYNC_TABLES.themes!.localApplyRemote(server.getTheme(aliasId)!, installed.context.api, installed.context)
  expect(b.settings.canRewriteThemeReference(userId, builtin, aliasId, stamp)).toBe(false)
  expect(b.settings.findRaw(userId, 'theme_id')).toEqual(selection(builtin, stamp))
  installed = install(a, server, true)
  await fullPull(userId, installed.context)
  expect(a.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, stamp))
  await reconcileTable(settingsTable, userId, userId, installed.context)
  expect(server.get()).toMatchObject(selection(aliasId, stamp))
  return { a, b, server, builtin, installed: install(b, server, true) }
}

describe('equal-version theme selection convergence', () => {
  it.each(['full pull', 'reconcile', 'IPC'] as const)('%s adopts a three-peer restoration without receiver-owned selection proof', async (path) => {
    for (const archive of [false, true]) for (const stamp of [older, '2090-10-29T09:00:00.000Z']) {
      const { b, server, builtin, installed } = await restoredCloudSelection(archive, stamp)
      if (path === 'full pull') await fullPull(userId, installed.context)
      else if (path === 'reconcile') expect((await reconcileTable(settingsTable, userId, userId, installed.context)).failed).toBe(0)
      else await installed.context.api.settings.applyRemote(selection(aliasId, stamp.replace('Z', '+00:00')))
      expect(b.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, stamp))
      for (let delivery = 0; delivery < 2; delivery++) {
        await SYNC_TABLES.settings!.localApplyRemote(SYNC_TABLES.settings!.toRemote(selection(builtin, stamp)), installed.context.api, installed.context)
        expect(b.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, stamp))
        await fullPull(userId, installed.context)
        expect((await reconcileTable(settingsTable, userId, userId, installed.context)).failed).toBe(0)
        expect(b.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, stamp))
        expect(server.get()).toMatchObject(selection(aliasId, stamp))
      }
      await installed.context.api.settings.applyRemote(selection(builtin, stamp))
      await publish('queued', installed)
      expect(installed.queue).toHaveLength(0)
      expect(b.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, stamp))
      expect(server.get()).toMatchObject(selection(aliasId, stamp))
      expect(server.writes.filter((write) => write.table === 'user_settings' && write.payload.key === 'theme_id').map((write) => write.payload.value)).toEqual([builtin, aliasId])
    }
  })

  it.each([false, true])('refreshes a pending offline retry from corrected cloud state, archive=%s', async (archive) => {
    const stamp = '2090-10-29T09:00:00.000Z'
    const { b, server, builtin, installed } = await restoredCloudSelection(archive, stamp)
    vi.mocked(requireSession).mockResolvedValue(null)
    pushSetting('theme_id', builtin, userId)
    await vi.advanceTimersByTimeAsync(6000)
    expect(installed.queue).toHaveLength(1)
    expect(JSON.parse(installed.queue[0].payload)).toMatchObject(selection(builtin, stamp))
    vi.mocked(requireSession).mockResolvedValue({ user: { id: userId } } as Session)
    expect(await processSyncQueue(installed.context)).toBe(1)
    expect(installed.queue).toHaveLength(0)
    await fullPull(userId, installed.context)
    expect((await reconcileTable(settingsTable, userId, userId, installed.context)).failed).toBe(0)
    expect(b.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, stamp))
    expect(server.get()).toMatchObject(selection(aliasId, stamp))
  })

  it.each(['builtin', 'custom'] as const)('preserves and publishes a genuinely later explicit %s choice', async (choice) => {
    for (const stamp of [older, '2090-10-29T09:00:00.000Z']) {
      const { b, server, builtin, installed } = await restoredCloudSelection(false, stamp)
      await installed.context.api.themes.applyRemote({ ...b.themes.findById(aliasId)!, id: 'later-custom', name: 'Evening Dark' })
      const value = choice === 'builtin' ? builtinThemeId('Ocean Blue Dark') : 'later-custom'
      await installed.context.api.settings.set(userId, 'theme_id', value)
      const explicit = b.settings.findRaw(userId, 'theme_id')!
      expect(Date.parse(explicit.updated_at)).toBeGreaterThan(Date.parse(stamp))
      await installed.context.api.settings.applyRemote(selection(aliasId, stamp))
      await SYNC_TABLES.settings!.localApplyRemote(SYNC_TABLES.settings!.toRemote(selection(builtin, stamp)), installed.context.api, installed.context)
      await fullPull(userId, installed.context)
      expect(b.settings.findRaw(userId, 'theme_id')).toEqual(explicit)
      await publish('queued', installed)
      await fullPull(userId, installed.context)
      expect((await reconcileTable(settingsTable, userId, userId, installed.context)).failed).toBe(0)
      expect(b.settings.findRaw(userId, 'theme_id')).toEqual(explicit)
      expect(server.get()).toMatchObject(explicit)
    }
  })

  it('keeps deletion and unrelated equal-version setting merges unchanged', async () => {
    const { b, installed } = await restoredCloudSelection(false, older)
    await installed.context.api.settings.applyRemote(selection(aliasId, older))
    await installed.context.api.settings.applyRemote(selection(null, older, older))
    expect(b.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, older))
    const unrelated = { user_id: userId, key: 'unrelated', value: 'first', updated_at: older, deleted_at: null }
    await installed.context.api.settings.applyRemote(unrelated)
    await installed.context.api.settings.applyRemote({ ...unrelated, value: 'equal' })
    expect(b.settings.findRaw(userId, unrelated.key)).toEqual(unrelated)
    b.settings.delete(userId, 'theme_id')
    const deleted = b.settings.findRaw(userId, 'theme_id')!
    await installed.context.api.settings.applyRemote(selection(aliasId, deleted.updated_at))
    expect(b.settings.findRaw(userId, 'theme_id')).toEqual(deleted)
  })
})

async function renderedThemeFixture(indirect = false) {
  const device = database(!indirect)
  const forest = BUILTIN_THEMES.find((theme) => theme.name === 'Forest Dark')!
  const builtin = builtinThemeId(forest.name)
  const original: Theme = { id: aliasId, name: forest.name, mode: forest.mode, config: JSON.stringify(forest.config), is_builtin: 0, owner_id: userId, created_at: older, updated_at: older, deleted_at: null }
  if (indirect) device.db.prepare('UPDATE themes SET name=?,config=? WHERE id=?').run(original.name, original.config, aliasId)
  device.settings.applyRemote(selection(indirect ? aliasId : builtin, older))
  repairBuiltinThemes(device.db)
  const server = cloud()
  server.put(selection(builtin, older))
  const installed = install(device, server, true)
  useSettingsStore.getState().setUserId(userId)
  await useSettingsStore.getState().hydrateSettings()
  await useSettingsStore.getState().hydrateThemes()
  useSettingsStore.setState((state) => ({ settings: { ...state.settings, unrelated: 'optimistic' } }))
  expect(useSettingsStore.getState().currentThemeId).toBe(builtin)
  expect(selectCurrentTheme(useSettingsStore.getState())?.id).toBe(builtin)
  expect(useSettingsStore.getState().themes[aliasId]).toBeUndefined()
  server.putTheme(SYNC_TABLES.themes!.toRemote(genuine(original)) as Record<string, unknown>)
  server.put(selection(aliasId, older))
  return { device, server, installed, builtin, original }
}

function expectRenderedTheme(device: ReturnType<typeof database>, value: string, stamp: string) {
  const state = useSettingsStore.getState()
  expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(value, stamp))
  expect(state.currentThemeId).toBe(value)
  expect(state.settings.theme_id).toBe(value)
  expect(state.settings.unrelated).toBe('optimistic')
  expect(state.themes[value]).toEqual(device.themes.findById(value))
  expect(selectCurrentTheme(state)).toEqual(device.themes.findById(value))
}

function holdIpc(channel: string, before = false) {
  let release!: () => void
  let reached!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const ready = new Promise<void>((resolve) => { reached = resolve })
  const handler = ipc.handlers.get('sync:invokeContext')!
  ipc.handlers.set('sync:invokeContext', async (...args: unknown[]) => {
    if (args[2] !== channel) return handler(...args)
    ipc.handlers.set('sync:invokeContext', handler)
    if (before) {
      reached()
      await blocked
      return handler(...args)
    }
    const result = await handler(...args)
    reached()
    await blocked
    return result
  })
  return { ready, release }
}

describe('accepted theme state in the renderer', () => {
  it.each(['themes:list', 'settings:get'])('ordinary reconciliation retries a failed %s refresh on equal builtin-only state', async (channel) => {
    const device = database(true)
    repairBuiltinThemes(device.db)
    const forest = builtinThemeId('Forest Dark')
    const ocean = builtinThemeId('Ocean Blue Dark')
    device.settings.applyRemote(selection(forest, older))
    const server = cloud()
    server.put(selection(ocean, newer))
    const { context } = install(device, server, true)
    useSettingsStore.getState().setUserId(userId)
    await useSettingsStore.getState().hydrateSettings()
    await useSettingsStore.getState().hydrateThemes()
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, unrelated: 'optimistic' } }))
    expect(device.themes.findAllByOwner(userId, { includeTombstones: true })).toHaveLength(0)
    expectRenderedTheme(device, forest, older)
    const invoke = ipc.handlers.get('sync:invokeContext')!
    ipc.handlers.set('sync:invokeContext', (...args: unknown[]) => {
      if (args[2] !== channel) return invoke(...args)
      ipc.handlers.set('sync:invokeContext', invoke)
      expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(ocean, newer))
      throw new Error('Synthetic accepted-state read failure')
    })
    const first = await reconcileTable(settingsTable, userId, userId, context)
    expect(first).toMatchObject({ failed: 1, inSync: 0, pulled: 0 })
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(ocean, newer))
    expect(useSettingsStore.getState().currentThemeId).toBe(forest)
    expect(useSettingsStore.getState().settings.theme_id).toBe(forest)
    expect(selectCurrentTheme(useSettingsStore.getState())?.id).toBe(forest)
    const second = await reconcileTable(settingsTable, userId, userId, context)
    expect(second).toMatchObject({ failed: 0, inSync: 1, pulled: 0, pushed: 0 })
    expectRenderedTheme(device, ocean, newer)
    expect(server.get()).toMatchObject(selection(ocean, newer))
    expect(server.writes).toHaveLength(0)
  })

  it.each(['full pull', ...paths] as const)('%s refreshes the hydrated store and selector without another hydrate', async (path) => {
    const { device, server, installed } = await renderedThemeFixture()
    if (path === 'full pull') await fullPull(userId, installed.context)
    else await publish(path, installed)
    expectRenderedTheme(device, aliasId, older)
    expect(server.get()).toMatchObject(selection(aliasId, older))
    await SYNC_TABLES.settings!.localApplyRemote(SYNC_TABLES.settings!.toRemote(selection(builtinThemeId('Forest Dark'), older)), installed.context.api, installed.context)
    expectRenderedTheme(device, aliasId, older)
    const rendered = useSettingsStore.getState().currentThemeId!
    await useSettingsStore.getState().setSetting('theme_id', rendered)
    await vi.advanceTimersByTimeAsync(6000)
    const explicit = device.settings.findRaw(userId, 'theme_id')!
    expect(Date.parse(explicit.updated_at)).toBeGreaterThan(Date.parse(older))
    expectRenderedTheme(device, aliasId, explicit.updated_at)
    expect(server.get()).toMatchObject(explicit)
  })

  it.each(['eager theme', 'theme reconcile'] as const)('%s publishes indirect selection recovery even when settings is already in sync', async (path) => {
    const { device, server, installed } = await renderedThemeFixture(true)
    if (path === 'eager theme') await publishTheme('eager', device, installed)
    else expect((await reconcileTable(themesTable, userId, userId, installed.context)).failed).toBe(0)
    expectRenderedTheme(device, aliasId, older)
    const stats = await reconcileTable(settingsTable, userId, userId, installed.context)
    expect(stats).toMatchObject({ inSync: 1, failed: 0 })
    expectRenderedTheme(device, aliasId, older)
    expect(server.get()).toMatchObject(selection(aliasId, older))
  })

  it.each(['same rendered ID', 'different ID'] as const)('preserves an explicit %s choice made during an accepted-state read', async (choice) => {
    const { device, server, installed, builtin } = await renderedThemeFixture()
    const held = holdIpc('themes:list')
    const merging = SYNC_TABLES.settings!.localApplyRemote(server.get(), installed.context.api, installed.context)
    await held.ready
    const value = choice === 'same rendered ID' ? builtin : builtinThemeId('Ocean Blue Dark')
    await useSettingsStore.getState().setSetting('theme_id', value)
    const explicit = device.settings.findRaw(userId, 'theme_id')!
    const visible: Array<string | null> = []
    const unsubscribe = useSettingsStore.subscribe((state) => visible.push(state.currentThemeId))
    held.release()
    await merging
    unsubscribe()
    expect(visible).not.toContain(aliasId)
    expectRenderedTheme(device, value, explicit.updated_at)
    await publish('queued', installed)
    expect(server.get()).toMatchObject(explicit)
    expectRenderedTheme(device, value, explicit.updated_at)
  })

  it('keeps a pending same-ID write protected until persistence completes', async () => {
    const { device, server, installed, builtin } = await renderedThemeFixture()
    const held = holdIpc('settings:set', true)
    const saving = useSettingsStore.getState().setSetting('theme_id', builtin)
    await held.ready
    await SYNC_TABLES.settings!.localApplyRemote(server.get(), installed.context.api, installed.context)
    expect(device.settings.findRaw(userId, 'theme_id')?.value).toBe(aliasId)
    expect(useSettingsStore.getState().currentThemeId).toBe(builtin)
    held.release()
    await saving
    const explicit = device.settings.findRaw(userId, 'theme_id')!
    expectRenderedTheme(device, builtin, explicit.updated_at)
    await publish('queued', installed)
    expect(server.get()).toMatchObject(explicit)
  })

  it('keeps a local color edit while accepting the recovered selection', async () => {
    const { device, server, installed, builtin } = await renderedThemeFixture()
    const held = holdIpc('themes:list')
    const merging = SYNC_TABLES.settings!.localApplyRemote(server.get(), installed.context.api, installed.context)
    await held.ready
    const config = JSON.stringify({ ...JSON.parse(device.themes.findById(builtin)!.config), accent: '#aBcDEF' })
    await useSettingsStore.getState().updateTheme(builtin, { config })
    held.release()
    await merging
    expectRenderedTheme(device, aliasId, older)
    expect(useSettingsStore.getState().themes[builtin].config).toBe(config)
    expect(device.themes.findById(builtin)?.config).toBe(config)
    expect(server.get()).toMatchObject(selection(aliasId, older))
  })

  it.each(['account', 'same-user database'] as const)('rejects a held snapshot after a %s switch', async (change) => {
    const { device, server, installed } = await renderedThemeFixture()
    const held = holdIpc('themes:list')
    const merging = SYNC_TABLES.themes!.localApplyRemote(server.getTheme(aliasId)!, installed.context.api, installed.context)
    await held.ready
    const other = database(true)
    repairBuiltinThemes(other.db)
    const nextUser = change === 'account' ? 'other-user' : userId
    const nextTheme = other.themes.findById(builtinThemeId('Ocean Blue Dark'))!
    other.settings.applyRemote({ ...selection(nextTheme.id, newer), user_id: nextUser })
    ipc.database = other.db
    ipc.handlers.get('auth:switchDatabase')!({}, nextUser)
    useAuthStore.setState({ currentUser: { id: nextUser } as never })
    const nextState = { userId: nextUser, currentThemeId: nextTheme.id, themes: { [nextTheme.id]: nextTheme }, settings: { theme_id: nextTheme.id, unrelated: 'new account' } }
    useSettingsStore.setState(nextState)
    held.release()
    await merging
    expect(useSettingsStore.getState()).toMatchObject(nextState)
    expect(selectCurrentTheme(useSettingsStore.getState())).toEqual(nextTheme)
    expect(device.themes.findById(aliasId)?.name).toBe('Aviobook Dark')
  })

  it('retries an accepted merge whose renderer-state read failed', async () => {
    const { device, server, installed, builtin } = await renderedThemeFixture()
    const read = ipc.handlers.get('sync:invokeContext')!
    ipc.handlers.set('sync:invokeContext', (...args: unknown[]) => {
      if (args[2] !== 'themes:list') return read(...args)
      ipc.handlers.set('sync:invokeContext', read)
      throw new Error('Synthetic theme-state read failure')
    })
    await publish('queued', installed)
    expect(installed.queue).toHaveLength(1)
    expect(useSettingsStore.getState().currentThemeId).toBe(builtin)
    expect(useSettingsStore.getState().settings.theme_id).toBe(builtin)
    expect(selectCurrentTheme(useSettingsStore.getState())?.id).toBe(builtin)
    expect(server.get()).toMatchObject(selection(aliasId, older))
    await publish('queued', installed)
    expect(installed.queue).toHaveLength(0)
    expectRenderedTheme(device, aliasId, older)
    expect(server.get()).toMatchObject(selection(aliasId, older))
  })
})

describe('theme selection intent ordering', () => {
  it('commits a normalized setting and its raw-reference provenance atomically', () => {
    const device = database()
    device.settings.applyRemote(selection(aliasId, older))
    repairBuiltinThemes(device.db)
    device.db.exec(`CREATE TRIGGER reject_selection BEFORE UPDATE ON settings WHEN NEW.updated_at='${newer}' BEGIN SELECT RAISE(ABORT,'synthetic selection failure'); END`)
    expect(() => device.settings.applyRemote(selection(aliasId, newer))).toThrow('synthetic selection failure')
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(canonical, older))
    expect(device.settings.themeReferenceSource(userId, canonical, newer)).toBe(canonical)
  })
  it('recovers a genuine rename of an original builtin install ID after local retirement', () => {
    const device = database()
    device.db.prepare('UPDATE themes SET is_builtin=1,owner_id=NULL WHERE id=?').run(aliasId)
    const original = device.themes.findById(aliasId)!
    device.settings.applyRemote(selection(aliasId, older))
    repairBuiltinThemes(device.db)
    device.settings.applyRemote(selection(aliasId, newer))
    const renamed = { ...genuine(original), is_builtin: 0, owner_id: userId }
    expect(device.themes.applyRemote(renamed)).toEqual(renamed)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, newer))
  })

  it('full pull resolves the current genuine identity before normalizing its newer explicit selection', async () => {
    const device = database()
    const original = device.themes.findById(aliasId)!
    device.settings.applyRemote(selection(aliasId, older))
    repairBuiltinThemes(device.db)
    const server = cloud()
    server.put(selection(aliasId, newer))
    server.putTheme(SYNC_TABLES.themes!.toRemote(genuine(original)) as Record<string, unknown>)
    const installed = install(device, server)
    await fullPull(userId, installed.context)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, newer))
    expect(device.themes.findById(aliasId)).toMatchObject({ name: 'Aviobook Dark', updated_at: newer, deleted_at: null })
    expect(server.get()).toMatchObject(selection(aliasId, newer))
  })
  it.each(paths)('%s resolves a genuine cloud rename before cleanup clocks can win', async (path) => {
    const device = database()
    const original = device.themes.findById(aliasId)!
    device.settings.applyRemote(selection(aliasId, older))
    repairBuiltinThemes(device.db)
    const cleanup = device.themes.findById(aliasId)!
    expect(Date.parse(cleanup.updated_at)).toBeGreaterThan(Date.parse(newer))
    const renamed = genuine(original)
    const server = cloud()
    server.putTheme(SYNC_TABLES.themes!.toRemote(renamed) as Record<string, unknown>)
    const installed = install(device, server)
    await publishTheme(path, device, installed)
    expect(device.themes.findById(aliasId)).toMatchObject({ name: renamed.name, updated_at: newer, deleted_at: null })
    expect(JSON.parse(device.themes.findById(aliasId)!.config)).toEqual(JSON.parse(renamed.config))
    expect(server.getTheme(aliasId)).toMatchObject({ name: renamed.name, updated_at: newer, deleted_at: null, accent: '#b6d9c7', sidebar: '#123456' })
    expect(server.writes.some((write) => write.table === 'user_themes' && write.payload.id === aliasId && write.payload.deleted_at)).toBe(false)
  })

  it('preserves a recovered custom against higher cleanup replay and then repairs the cloud', async () => {
    const device = database()
    const original = device.themes.findById(aliasId)!
    device.settings.applyRemote(selection(aliasId, older))
    repairBuiltinThemes(device.db)
    const cleanup = device.themes.findById(aliasId)!
    const renamed = genuine(original)
    device.themes.applyRemote(renamed)
    const server = cloud()
    server.putTheme(SYNC_TABLES.themes!.toRemote(cleanup) as Record<string, unknown>)
    const installed = install(device, server)
    await fullPull(userId, installed.context)
    expect(device.themes.findById(aliasId)).toEqual(renamed)
    await installed.context.api.syncMeta.setHighWater(userId, userId, 'themes', cleanup.updated_at)
    expect((await reconcileTable(themesTable, userId, userId, installed.context)).failed).toBe(0)
    expect(server.getTheme(aliasId)).toMatchObject({ name: renamed.name, updated_at: newer, deleted_at: null, accent: '#b6d9c7', sidebar: '#123456' })
    const writes = server.writes.length
    await reconcileTable(themesTable, userId, userId, installed.context)
    expect(server.writes).toHaveLength(writes)
  })

  it('drops a purged queued cleanup instead of replaying its destructive snapshot', async () => {
    const device = database()
    const original = device.themes.findById(aliasId)!
    repairBuiltinThemes(device.db)
    const cleanup = device.themes.findById(aliasId)!
    device.themes.hardDelete(aliasId)
    const server = cloud()
    server.putTheme(SYNC_TABLES.themes!.toRemote(genuine(original)) as Record<string, unknown>)
    const installed = install(device, server)
    installed.queue.push({ id: 'purged-cleanup', table_name: 'user_themes', row_id: aliasId, operation: 'UPDATE', payload: JSON.stringify(SYNC_TABLES.themes!.toRemote(cleanup)), created_at: upgrade })
    expect(await processSyncQueue(installed.context)).toBe(1)
    expect(installed.queue).toHaveLength(0)
    expect(server.getTheme(aliasId)).toMatchObject({ name: 'Aviobook Dark', updated_at: newer, deleted_at: null })
    expect(server.writes).toHaveLength(0)
  })

  it.each(paths)('%s protects concurrent genuine identity during conditional repair and first insert', async (path) => {
    for (const initial of ['cleanup', 'absent']) {
      const device = database()
      const original = device.themes.findById(aliasId)!
      repairBuiltinThemes(device.db)
      const cleanup = device.themes.findById(aliasId)!
      device.themes.applyRemote(genuine(original))
      const concurrent = { ...genuine(original, '2090-01-01T00:00:00.000Z'), name: 'Later custom Dark' }
      const server = cloud()
      if (initial === 'cleanup') server.putTheme(SYNC_TABLES.themes!.toRemote(cleanup) as Record<string, unknown>)
      server.onWrite(() => server.putTheme(SYNC_TABLES.themes!.toRemote(concurrent) as Record<string, unknown>), 'user_themes')
      const installed = install(device, server)
      await publishTheme(path, device, installed)
      expect(server.getTheme(aliasId)).toMatchObject({ name: concurrent.name, updated_at: concurrent.updated_at, deleted_at: null })
      expect(device.themes.findById(aliasId)).toMatchObject({ name: concurrent.name, updated_at: concurrent.updated_at, deleted_at: null })
      expect(server.writes.filter((write) => write.table === 'user_themes' && write.payload.id === aliasId)).toHaveLength(0)
    }
  })

  it.each(paths)('%s retries failed genuine-theme repair without publishing cleanup', async (path) => {
    const device = database()
    const original = device.themes.findById(aliasId)!
    repairBuiltinThemes(device.db)
    const cleanup = device.themes.findById(aliasId)!
    device.themes.applyRemote(genuine(original))
    const server = cloud()
    server.putTheme(SYNC_TABLES.themes!.toRemote(cleanup) as Record<string, unknown>)
    const installed = install(device, server)
    server.failNextMutation('user_themes')
    await publishTheme(path, device, installed)
    expect(server.getTheme(aliasId)).toMatchObject({ name: cleanup.name, deleted_at: cleanup.deleted_at })
    expect(device.themes.findById(aliasId)).toMatchObject({ name: 'Aviobook Dark', updated_at: newer, deleted_at: null })
    if (path !== 'reconcile') expect(installed.queue).toHaveLength(1)
    if (path === 'reconcile') await reconcileTable(themesTable, userId, userId, installed.context)
    else await processSyncQueue(installed.context)
    expect(server.getTheme(aliasId)).toMatchObject({ name: 'Aviobook Dark', updated_at: newer, deleted_at: null })
    expect(installed.queue).toHaveLength(0)
  })

  it.each(paths)('%s pins theme identity resolution to its account and database', async (path) => {
    for (const change of ['account', 'database']) {
      useAuthStore.setState({ currentUser: { id: userId } as never })
      const device = database()
      const original = device.themes.findById(aliasId)!
      repairBuiltinThemes(device.db)
      const cleanup = device.themes.findById(aliasId)!
      device.themes.applyRemote(genuine(original))
      const other = database()
      const otherOriginal = other.themes.findById(aliasId)!
      const server = cloud()
      server.putTheme(SYNC_TABLES.themes!.toRemote(cleanup) as Record<string, unknown>)
      const installed = install(device, server)
      server.onRead(() => {
        if (change === 'account') useAuthStore.setState({ currentUser: { id: 'other-user' } as never })
        else install(other, server)
      }, 'user_themes')
      await publishTheme(path, device, installed)
      expect(server.getTheme(aliasId)).toMatchObject({ name: cleanup.name, deleted_at: cleanup.deleted_at })
      expect(server.writes.filter((write) => write.table === 'user_themes' && write.payload.id === aliasId)).toHaveLength(0)
      expect(other.themes.findById(aliasId)).toEqual(otherOriginal)
    }
  })

  it.each(paths)('%s quarantines aliases instead of creating destructive cleanup writes', async (path) => {
    const device = database()
    const original = device.themes.findById(aliasId)!
    repairBuiltinThemes(device.db)
    const server = cloud()
    server.onRead(() => server.putTheme(SYNC_TABLES.themes!.toRemote(genuine(original)) as Record<string, unknown>), 'user_themes')
    const installed = install(device, server)
    await publishTheme(path, device, installed)
    expect(server.getTheme(aliasId)).toMatchObject({ name: 'Aviobook Dark', updated_at: newer, deleted_at: null })
    expect(server.writes.filter((write) => write.table === 'user_themes' && write.payload.id === aliasId)).toHaveLength(0)
    await reconcileTable(themesTable, userId, userId, installed.context)
    expect(device.themes.findById(aliasId)).toMatchObject({ name: 'Aviobook Dark', updated_at: newer, deleted_at: null })
  })

  it('preserves real explicit deletion of a future-dated genuine custom', async () => {
    const device = database()
    const original = device.themes.findById(aliasId)!
    repairBuiltinThemes(device.db)
    device.themes.applyRemote(genuine(original, '2090-01-01T00:00:00.000Z'))
    const server = cloud()
    server.putTheme(SYNC_TABLES.themes!.toRemote(device.themes.findById(aliasId)!) as Record<string, unknown>)
    const installed = install(device, server)
    expect(device.themes.delete(aliasId)).toBe(true)
    const deleted = device.themes.findById(aliasId)!
    expect(Date.parse(deleted.updated_at)).toBeGreaterThan(Date.parse('2090-01-01T00:00:00.000Z'))
    await deleteThemeFromSupabase(aliasId)
    expect(server.getTheme(aliasId)).toMatchObject({ name: deleted.name, updated_at: deleted.updated_at, deleted_at: deleted.deleted_at })
    await fullPull(userId, installed.context)
    expect(device.themes.findById(aliasId)).toMatchObject({ deleted_at: deleted.deleted_at, updated_at: deleted.updated_at })
  })

  it.each(paths)('%s resolves a newer raw selection before theme pull instead of publishing a stale preset identity', async (path) => {
    for (const stamp of [newer, '2090-01-01T10:00:00.000Z']) {
      const device = database()
      const original = device.themes.findById(aliasId)!
      device.settings.applyRemote(selection(aliasId, older))
      repairBuiltinThemes(device.db)
      const server = cloud()
      server.put(selection(aliasId, stamp))
      server.putTheme(SYNC_TABLES.themes!.toRemote(genuine(original, stamp)) as Record<string, unknown>)
      const installed = install(device, server)
      await publish(path, installed)
      expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, stamp))
      expect(server.get()).toMatchObject(selection(aliasId, stamp))
      expect(device.themes.findById(aliasId)).toMatchObject({ name: 'Aviobook Dark', deleted_at: null, updated_at: stamp })
      expect(server.writes.some((write) => write.table === 'user_settings' && write.payload.key === 'theme_id' && write.payload.value === canonical)).toBe(false)
    }
  })

  it.each([false, true])('retains every normalized selection version for late identity recovery, purged=%s', async (purged) => {
    const device = database()
    const original = device.themes.findById(aliasId)!
    device.settings.applyRemote(selection(aliasId, older))
    repairBuiltinThemes(device.db)
    device.settings.applyRemote(selection(aliasId, newer))
    device.settings.applyRemote(selection(aliasId, newer.replace('Z', '+00:00')))
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(canonical, newer))
    expect(device.settings.themeReferenceSource(userId, canonical, newer)).toBe(aliasId)
    if (purged) device.themes.hardDelete(aliasId)
    device.themes.applyRemote(genuine(original))
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, newer))
    device.settings.applyRemote(selection(canonical, newer))
    device.settings.applyRemote(selection(aliasId, newer))
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, newer))
    const server = cloud()
    server.put(selection(canonical, newer))
    server.putTheme(SYNC_TABLES.themes!.toRemote(genuine(original)) as Record<string, unknown>)
    const installed = install(device, server)
    await publish('reconcile', installed)
    expect(server.get()).toMatchObject(selection(aliasId, newer))
    for (const explicit of ['named-custom', builtinThemeId('Ocean Blue Dark')]) {
      device.settings.set(userId, 'theme_id', explicit)
      const chosen = device.settings.findRaw(userId, 'theme_id')!
      device.themes.applyRemote(genuine(original, '2091-01-01T00:00:00.000Z'))
      device.settings.applyRemote(selection(aliasId, newer))
      expect(device.settings.findRaw(userId, 'theme_id')).toEqual(chosen)
      expect(device.settings.themeReferenceSource(userId, explicit, chosen.updated_at)).toBe(explicit)
    }
  })
  it.each([
    [older, newer], [newer, newer], ['2090-01-01T09:00:00.000Z', '2090-01-01T10:00:00.000Z'], ['2090-01-01T10:00:00.000Z', '2090-01-01T10:00:00.000Z']
  ])('keeps a current named custom theme through stale/equal name replay at %s / %s', async (replayStamp, renameStamp) => {
    const device = database()
    const stale = { ...device.themes.findById(aliasId)!, updated_at: replayStamp }
    const config = ' { "accent": "#b6d9c7", "sidebar": "#123456", "extra": "keep" } '
    device.db.prepare('UPDATE themes SET name=?,config=?,updated_at=? WHERE id=?').run('Aviobook Dark', config, renameStamp, aliasId)
    device.settings.applyRemote(selection(aliasId, older))
    repairBuiltinThemes(device.db)
    const before = device.themes.findById(aliasId)!
    const server = cloud()
    server.put(selection(aliasId, older))
    server.putTheme(SYNC_TABLES.themes!.toRemote(stale) as Record<string, unknown>)
    const { context } = install(device, server)
    await fullPull(userId, context)
    expect(device.themes.findById(aliasId)).toEqual(before)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, older))
    await SYNC_TABLES.themes!.remoteUpsert(before, context)
    expect(server.writes.at(-1)).toMatchObject({ table: 'user_themes', payload: { id: aliasId, name: 'Aviobook Dark', deleted_at: null, updated_at: renameStamp, accent: '#b6d9c7', sidebar: '#123456' } })
  })

  it.each([false, true])('recovers a newer remote rename using original provenance after cleanup, purged=%s', async (purged) => {
    const device = database()
    device.settings.applyRemote(selection(aliasId, older))
    const original = device.themes.findById(aliasId)!
    repairBuiltinThemes(device.db)
    expect(Date.parse(device.themes.findById(aliasId)!.updated_at)).toBeGreaterThan(Date.parse(newer))
    if (purged) device.themes.hardDelete(aliasId)
    const renamed = { ...original, name: 'Aviobook Dark', config: ' {"accent":"#b6d9c7","sidebar":"#112233"} ', updated_at: newer }
    expect(device.themes.applyRemote(renamed)).toEqual(renamed)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(aliasId, older))
    expect(device.settings.canRewriteThemeReference(userId, canonical, aliasId, older)).toBe(true)
    expect(device.settings.canRewriteThemeReference('another-user', canonical, aliasId, older)).toBe(false)
    expect(device.settings.canRewriteThemeReference(userId, canonical, aliasId, newer)).toBe(false)
    expect(device.themes.applyRemote(original)).toEqual(renamed)
    expect(device.themes.applyRemote({ ...original, updated_at: newer })).toEqual(renamed)
    const server = cloud()
    server.put(selection(canonical, older))
    const installed = install(device, server)
    await publish('eager', installed)
    expect(server.get()).toMatchObject(selection(aliasId, older))
    expect(device.themes.findById(aliasId)?.config).toBe(renamed.config)
  })

  it('does not restore a recovered rename over a later explicit theme choice', () => {
    const device = database()
    device.settings.applyRemote(selection(aliasId, older))
    const original = device.themes.findById(aliasId)!
    repairBuiltinThemes(device.db)
    device.settings.applyRemote(selection('named-custom', newer))
    const explicit = device.settings.findRaw(userId, 'theme_id')!
    const renamed = { ...original, name: 'Aviobook Dark', updated_at: newer, config: '{"bg":"#123456"}' }
    device.themes.applyRemote(renamed)
    expect(device.themes.findById(aliasId)).toEqual(renamed)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(explicit)
    expect(device.settings.canRewriteThemeReference(userId, aliasId, canonical, older)).toBe(false)
  })

  it('does not restore a selection onto a deleted renamed theme', () => {
    const device = database()
    device.settings.applyRemote(selection(aliasId, older))
    const original = device.themes.findById(aliasId)!
    repairBuiltinThemes(device.db)
    const deleted = { ...original, name: 'Aviobook Dark', updated_at: newer, deleted_at: newer }
    expect(device.themes.applyRemote(deleted)).toEqual(deleted)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(canonical, older))
    expect(device.settings.canRewriteThemeReference(userId, canonical, aliasId, older)).toBe(false)
  })

  it('keeps known catalog replays retired after purge with archived selection versions', () => {
    const device = database()
    device.settings.applyRemote(selection(aliasId, older))
    const original = device.themes.findById(aliasId)!
    repairBuiltinThemes(device.db)
    device.themes.hardDelete(aliasId)
    const replay = { ...original, updated_at: '2090-01-01T00:00:00.000Z' }
    const retired = device.themes.applyRemote(replay)
    expect(retired.deleted_at).not.toBeNull()
    expect(Date.parse(retired.updated_at)).toBeGreaterThan(Date.parse(replay.updated_at))
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(canonical, older))
    expect(device.themes.applyRemote(replay)).toEqual(retired)
  })
  it.each(paths)('%s publishes the non-default canonical selection before cold bootstrap after purge', async (path) => {
    const device = database()
    device.db.prepare('UPDATE themes SET name=? WHERE id=?').run('Forest Dark', aliasId)
    device.settings.applyRemote(selection(aliasId, older))
    repairBuiltinThemes(device.db)
    device.themes.hardDelete(aliasId)
    const forest = builtinThemeId('Forest Dark')
    const server = cloud()
    server.put(selection(aliasId, older.replace('Z', '+00:00')))
    const installed = install(device, server)
    await installed.context.api.syncMeta.setHighWater(userId, userId, 'settings', older)
    await publish(path, installed)
    expect(server.get()).toMatchObject(selection(forest, older))
    const writes = server.writes.filter((write) => write.table === 'user_settings' && write.payload.key === 'theme_id').length
    await publish(path, installed)
    expect(server.writes.filter((write) => write.table === 'user_settings' && write.payload.key === 'theme_id')).toHaveLength(writes)
    server.purgeThemes()
    const fresh = database(true)
    repairBuiltinThemes(fresh.db)
    expect(fresh.db.prepare('SELECT * FROM theme_duplicate_archive').all()).toHaveLength(0)
    expect(fresh.themes.findById(aliasId)).toBeUndefined()
    const cold = install(fresh, server)
    await fullPull(userId, cold.context)
    expect(fresh.settings.findRaw(userId, 'theme_id')).toEqual(selection(forest, older))
    expect(fresh.themes.findById(forest)?.is_builtin).toBe(1)
    expect(useSyncStore.getState().errorMessage).toBeNull()
  })

  it.each(paths)('%s atomically preserves concurrent choices during updates and first inserts', async (path) => {
    for (const kind of ['newer update', 'equal reference update', 'newer insert', 'equal insert']) {
      const device = database()
      device.settings.applyRemote(selection(aliasId, older))
      repairBuiltinThemes(device.db)
      const server = cloud()
      if (kind.includes('update')) server.put(selection(kind.startsWith('equal') ? aliasId : 'named-custom', kind.startsWith('equal') ? older : '2026-10-29T08:00:00.000Z'))
      const concurrent = selection('named-custom', kind.startsWith('equal') ? older : newer)
      const installed = install(device, server)
      server.onWrite(() => server.put(concurrent))
      await publish(path, installed)
      expect(server.get(), kind).toMatchObject(concurrent)
      expect(server.writes.filter((write) => write.table === 'user_settings' && write.payload.key === 'theme_id'), kind).toHaveLength(0)
      if (!kind.startsWith('equal')) expect(device.settings.findRaw(userId, 'theme_id')).toEqual(concurrent)
    }
  })

  it.each(paths)('%s retains failed conditional writes for a safe retry', async (path) => {
    const device = database()
    device.settings.applyRemote(selection(aliasId, older))
    repairBuiltinThemes(device.db)
    const server = cloud()
    server.put(selection(aliasId, older))
    const installed = install(device, server)
    server.failNextMutation()
    await publish(path, installed)
    expect(server.get().value).toBe(aliasId)
    if (path !== 'reconcile') expect(installed.queue).toHaveLength(1)
    await publish(path === 'reconcile' ? path : 'queued', installed)
    expect(server.get()).toMatchObject(selection(canonical, older))
    expect(installed.queue).toHaveLength(0)
  })

  it.each(paths)('%s isolates reference proofs and conditional writes from account/database switches', async (path) => {
    for (const change of ['account', 'database']) {
      useAuthStore.setState({ currentUser: { id: userId } as never })
      const device = database()
      device.settings.applyRemote(selection(aliasId, older))
      repairBuiltinThemes(device.db)
      const other = database()
      const server = cloud()
      server.put(selection(aliasId, older))
      const installed = install(device, server)
      server.onRead(() => {
        if (change === 'account') useAuthStore.setState({ currentUser: { id: 'other-user' } as never })
        else install(other, server)
      })
      await publish(path, installed)
      expect(server.get().value).toBe(aliasId)
      expect(server.writes.filter((write) => write.table === 'user_settings' && write.payload.key === 'theme_id')).toHaveLength(0)
      expect(other.settings.findRaw(userId, 'theme_id')).toBeUndefined()
      expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(canonical, older))
    }
  })

  it('routes explicit theme-selection deletion through its persisted conditional version', async () => {
    const device = database()
    repairBuiltinThemes(device.db)
    device.settings.applyRemote(selection(canonical, '2090-01-01T00:00:00.000Z'))
    device.settings.delete(userId, 'theme_id')
    const deleted = device.settings.findRaw(userId, 'theme_id')!
    expect(Date.parse(deleted.updated_at)).toBeGreaterThan(Date.parse('2090-01-01T00:00:00.000Z'))
    const server = cloud()
    server.put(selection(canonical, older))
    install(device, server)
    await deleteSettingFromSupabase('theme_id', userId)
    expect(server.get()).toMatchObject(deleted)
  })
  it.each([
    [older, newer, upgrade],
    [older, '2090-10-29T10:00:00.000Z', '2099-10-29T11:00:00.000Z'],
    ['2090-10-29T09:00:00.000Z', '2090-10-29T10:00:00.000Z', upgrade]
  ])('preserves selection versions through migration at %s / %s / %s', (oldStamp, newStamp, clock) => {
    vi.setSystemTime(clock)
    for (const winner of ['named-custom', builtinThemeId('Ocean Blue Dark')]) {
      const a = database()
      const b = database()
      a.settings.applyRemote(selection(aliasId, oldStamp))
      b.settings.applyRemote(selection(winner, newStamp))
      for (const device of [a, b]) for (const migration of migrations.slice(30)) migration(device.db)
      expect(a.settings.findRaw(userId, 'theme_id')).toEqual(selection(canonical, oldStamp))
      expect(b.settings.findRaw(userId, 'theme_id')).toEqual(selection(winner, newStamp))
      b.settings.applyRemote(a.settings.findRaw(userId, 'theme_id')!)
      a.settings.applyRemote(b.settings.findRaw(userId, 'theme_id')!)
      expect(a.settings.findRaw(userId, 'theme_id')).toEqual(selection(winner, newStamp))
      expect(b.settings.findRaw(userId, 'theme_id')).toEqual(selection(winner, newStamp))
      const retired = a.themes.findById(aliasId)!
      expect(Date.parse(retired.updated_at)).toBeGreaterThan(Date.parse(older))
      expect(retired.deleted_at).toBe(retired.updated_at)
      expect(canSyncTheme(retired)).toBe(true)
    }
  })

  it.each([older, '2090-10-29T09:00:00.000Z'])('retains incoming selection version %s when the alias arrives later or is purged', (stamp) => {
    const device = database()
    repairBuiltinThemes(device.db)
    const softAlias: Theme = { ...device.themes.findById(aliasId)!, id: 'soft-alias', name: 'Soft Sage Dark', is_builtin: 1, owner_id: userId, deleted_at: null, updated_at: '2099-01-01T00:00:00.000Z' }
    device.settings.applyRemote(selection(softAlias.id, stamp))
    device.themes.applyRemote(softAlias)
    const expected = selection(builtinThemeId('Soft Sage Dark'), stamp)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(expected)
    const retired = device.themes.findById(softAlias.id)!
    expect(Date.parse(retired.updated_at)).toBeGreaterThan(Date.parse(softAlias.updated_at))
    expect(device.themes.applyRemote(softAlias)).toEqual(retired)
    device.themes.hardDelete(softAlias.id)
    device.settings.hardDelete(userId, 'theme_id')
    expect(device.settings.applyRemote(selection(softAlias.id, stamp.replace('Z', '+00:00')))).toEqual(expected)
    const later = new Date(Date.parse(stamp) + 1).toISOString()
    device.settings.applyRemote(selection('named-custom', later))
    for (const replay of [stamp, stamp.replace('Z', '+00:00')]) {
      device.settings.applyRemote(selection(softAlias.id, replay))
      expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection('named-custom', later))
    }
    repairBuiltinThemes(device.db)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection('named-custom', later))
  })

  it.each(['set', 'setMultiple'] as const)('gives explicit local choices a new version via %s without raising other setting clocks', (method) => {
    const device = database()
    repairBuiltinThemes(device.db)
    const future = '2090-01-01T00:00:00.000Z'
    device.settings.applyRemote(selection('named-custom', future))
    device.settings.applyRemote({ user_id: userId, key: 'unrelated', value: 'keep', updated_at: older, deleted_at: null })
    const choose = (value: string): void => {
      if (method === 'set') device.settings.set(userId, 'theme_id', value)
      else device.settings.setMultiple(userId, [{ key: 'theme_id', value }])
    }
    choose(aliasId)
    const first = device.settings.findRaw(userId, 'theme_id')!
    expect(first.value).toBe(canonical)
    expect(Date.parse(first.updated_at)).toBeGreaterThan(Date.parse(future))
    choose('named-custom')
    expect(Date.parse(device.settings.findRaw(userId, 'theme_id')!.updated_at)).toBeGreaterThan(Date.parse(first.updated_at))
    expect(device.settings.findRaw(userId, 'unrelated')!.updated_at).toBe(older)
    expect(device.settings.applyRemote(selection(aliasId, first.updated_at)).value).toBe('named-custom')
  })

  it.each(['eager', 'full upload', 'queued', 'reconcile'] as const)('%s keeps a newer remote choice instead of promoting the old alias', async (path) => {
    for (const [oldStamp, newStamp, clock] of [[older, newer, upgrade], ['2090-01-01T09:00:00.000Z', '2090-01-01T10:00:00.000Z', '2099-01-01T11:00:00.000Z']]) for (const winner of ['named-custom', builtinThemeId('Ocean Blue Dark')]) {
      vi.setSystemTime(clock)
      const device = database()
      const peer = database()
      device.settings.applyRemote(selection(aliasId, oldStamp))
      peer.settings.applyRemote(selection(winner, newStamp))
      repairBuiltinThemes(device.db)
      repairBuiltinThemes(peer.db)
      const server = cloud()
      server.put(peer.settings.findRaw(userId, 'theme_id')!)
      const { context, queue } = install(device, server)
      if (path === 'eager') {
        pushSetting('theme_id', aliasId, userId)
        await vi.advanceTimersByTimeAsync(6000)
      } else if (path === 'full upload') await fullUpload(userId, context)
      else if (path === 'queued') {
        queue.push({ id: 'old-selection', table_name: 'user_settings', row_id: `${userId}:theme_id`, operation: 'UPDATE', payload: JSON.stringify(selection(aliasId, oldStamp)), created_at: clock })
        expect(await processSyncQueue(context)).toBe(1)
        expect(queue).toHaveLength(0)
      } else expect((await reconcileTable(settingsTable, userId, userId, context)).failed).toBe(0)
      expect(server.get()).toMatchObject(selection(winner, newStamp))
      expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(winner, newStamp))
      expect(useSyncStore.getState().errorMessage).toBeNull()
    }
  })

  it('keeps an offline eager selection version through queue retry and a newer remote choice', async () => {
    const device = database()
    device.settings.applyRemote(selection(aliasId, older))
    repairBuiltinThemes(device.db)
    const server = cloud()
    const { context, queue } = install(device, server)
    vi.mocked(requireSession).mockResolvedValue(null)
    pushSetting('theme_id', aliasId, userId)
    await vi.advanceTimersByTimeAsync(6000)
    expect(queue).toHaveLength(1)
    expect(JSON.parse(queue[0].payload)).toMatchObject(selection(canonical, older))
    server.put(selection('named-custom', newer))
    expect(await processSyncQueue(context)).toBe(1)
    expect(queue).toHaveLength(0)
    expect(server.get()).toMatchObject(selection('named-custom', newer))
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection('named-custom', newer))
  })

  it('publishes a verified equal-version alias rewrite without creating a new intent', async () => {
    const device = database()
    device.settings.applyRemote(selection(aliasId, older))
    repairBuiltinThemes(device.db)
    const server = cloud()
    server.put(selection(aliasId, older.replace('Z', '+00:00')))
    install(device, server)
    pushSetting('theme_id', aliasId, userId)
    await vi.advanceTimersByTimeAsync(6000)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(canonical, older))
    expect(server.get()).toMatchObject(selection(canonical, older))
    expect(server.writes).toHaveLength(1)
  })

  it.each(['eager', 'full upload', 'queued', 'reconcile'] as const)('%s sends the persisted canonical choice and its original future version', async (path) => {
    const device = database()
    const future = '2090-01-01T00:00:00.000Z'
    device.settings.applyRemote(selection(aliasId, future))
    repairBuiltinThemes(device.db)
    device.themes.hardDelete(aliasId)
    const server = cloud()
    server.put(selection('named-custom', newer))
    const { context, queue } = install(device, server)
    if (path === 'eager') {
      pushSetting('theme_id', aliasId, userId)
      await vi.advanceTimersByTimeAsync(6000)
    } else if (path === 'full upload') await fullUpload(userId, context)
    else if (path === 'queued') {
      queue.push({ id: 'stale-payload', table_name: 'user_settings', row_id: `${userId}:theme_id`, operation: 'UPDATE', payload: JSON.stringify(selection(aliasId, upgrade)), created_at: upgrade })
      expect(await processSyncQueue(context)).toBe(1)
    } else await reconcileTable(settingsTable, userId, userId, context)
    expect(server.get()).toMatchObject(selection(canonical, future))
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(canonical, future))
    expect(server.writes.filter((write) => write.table === 'user_settings' && write.payload.key === 'theme_id')).toHaveLength(1)
  })

  it('full pull preserves remote alias versions and respects newer local choices and tombstones', async () => {
    const device = database()
    repairBuiltinThemes(device.db)
    device.themes.hardDelete(aliasId)
    const server = cloud()
    const { context } = install(device, server)
    server.put(selection(aliasId, older))
    await fullPull(userId, context)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(canonical, older))
    device.settings.applyRemote(selection('named-custom', newer))
    await fullPull(userId, context)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection('named-custom', newer))
    server.put(selection(aliasId, '2090-01-01T00:00:00.000Z'))
    await fullPull(userId, context)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(canonical, '2090-01-01T00:00:00.000Z'))
    const deleted = selection(null, '2091-01-01T00:00:00.000Z', '2091-01-01T00:00:00.000Z')
    server.put(deleted)
    await fullPull(userId, context)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(deleted)
    expect(useSyncStore.getState().errorMessage).toBeNull()
  })
})
