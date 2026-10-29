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
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn((_url, _key, options) => { network.token = options.accessToken; return network.client }) }))
vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn(async () => network.client), safeRefresh: vi.fn() }))
vi.mock('./sessionRecovery', () => ({ requireSession: vi.fn(async () => ({ user: { id: 'user-1' } }) as Session) }))
vi.mock('../shared/stores/logStore', () => ({ logEvent: vi.fn() }))
import { fullPull, fullUpload, pushSetting, deleteSettingFromSupabase } from './PersonalSyncService'
import { processSyncQueue, setOnlineStatus } from './SyncService'
import { requireSession } from './sessionRecovery'
import { reconcileTable, SYNC_TABLES } from './syncTables'
import { useAuthStore } from '../shared/stores/authStore'
import { useSyncStore } from '../shared/stores/syncStore'

const databases: DatabaseSync[] = []
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
  let afterRead: (() => void) | undefined
  let failMutation = false
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
    if (selectionMutation && beforeWrite) { const hook = beforeWrite; beforeWrite = undefined; hook() }
    if (selectionMutation && failMutation) {
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
    if (method === 'GET' && url.searchParams.has('id') && afterRead) { const hook = afterRead; afterRead = undefined; hook() }
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
    purgeThemes() { tableRows('user_themes').clear() },
    get() { return tableRows('user_settings').get(`${userId}:theme_id`)! },
    onWrite(hook: () => void) { beforeWrite = hook },
    onRead(hook: () => void) { afterRead = hook },
    failNextMutation() { failMutation = true }
  }
}
function install(device: ReturnType<typeof database>, server: ReturnType<typeof cloud>): { context: SyncContext; queue: SyncQueueEntry[] } {
  const generation = ++databaseGeneration
  network.token = null
  const queue: SyncQueueEntry[] = []
  const highWater = new Map<string, string>()
  const api = {
    auth: { getSupabaseConfig: async () => ({ url: 'https://example.invalid', anonKey: 'synthetic' }) },
    settings: {
      canRewriteThemeReference: async (user: string, from: string | null, to: string | null, stamp: string) => device.settings.canRewriteThemeReference(user, from, to, stamp),
      get: async (user: string, key: string) => device.settings.get(user, key),
      getAll: async (user: string) => device.settings.getAll(user),
      set: async (user: string, key: string, value: string | null) => device.settings.set(user, key, value),
      findRaw: async (user: string, key: string) => device.settings.findRaw(user, key),
      findAllByUser: async (user: string, options: { includeTombstones?: boolean } = {}) => device.settings.findAllByUser(user, options),
      findMaxUpdatedAt: async (user: string) => device.settings.findMaxUpdatedAt(user),
      applyRemote: async (row: Setting) => device.settings.applyRemote(row)
    },
    themes: { findAllByOwner: async (user: string, options: { includeTombstones?: boolean }) => device.themes.findAllByOwner(user, options), applyRemote: async (row: Theme) => device.themes.applyRemote(row) },
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
  vi.stubGlobal('window', { api })
  network.client = server.client
  const pinnedApi = window.api
  const isCurrent = (): boolean => useAuthStore.getState().currentUser?.id === userId && window.api === pinnedApi
  return { queue, context: { api: pinnedApi, client: server.client, assertCurrent: () => { if (!isCurrent()) throw new Error('Synthetic account changed') }, isCurrent: async () => isCurrent(), scope: 'synthetic' } }
}
beforeEach(() => {
  network.token = null
  vi.useFakeTimers()
  vi.setSystemTime(upgrade)
  vi.mocked(requireSession).mockResolvedValue({ user: { id: userId } } as Session)
  useAuthStore.setState({ currentUser: { id: userId } as never })
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
  } else await reconcileTable(SYNC_TABLES.settings!, userId, userId, installed.context)
}
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  databases.splice(0).forEach((db) => db.close())
})

describe('theme selection intent ordering', () => {
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
    for (const winner of ['named-custom', builtinThemeId('Nord Dark')]) {
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
    for (const replay of [stamp, later]) {
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
    for (const [oldStamp, newStamp, clock] of [[older, newer, upgrade], ['2090-01-01T09:00:00.000Z', '2090-01-01T10:00:00.000Z', '2099-01-01T11:00:00.000Z']]) for (const winner of ['named-custom', builtinThemeId('Nord Dark')]) {
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
      } else expect((await reconcileTable(SYNC_TABLES.settings!, userId, userId, context)).failed).toBe(0)
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
    } else await reconcileTable(SYNC_TABLES.settings!, userId, userId, context)
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
