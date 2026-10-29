import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { migrations } from '../../../main/database/migrations'
import { repairBuiltinThemes } from '../../../main/database/themeRepair'
import { SettingsRepository } from '../../../main/repositories/SettingsRepository'
import { ThemeRepository } from '../../../main/repositories/ThemeRepository'
import { BUILTIN_THEMES, builtinThemeId, canSyncTheme } from '../../../shared/themeCatalog'
import type { Setting, SyncQueueEntry, Theme } from '../../../shared/types'
import type { SyncContext } from './syncContext'

const network = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => network.client) }))
vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn(async () => network.client), safeRefresh: vi.fn() }))
vi.mock('./sessionRecovery', () => ({ requireSession: vi.fn(async () => ({ user: { id: 'user-1' } }) as Session) }))
vi.mock('../shared/stores/logStore', () => ({ logEvent: vi.fn() }))
import { fullPull, fullUpload, pushSetting } from './PersonalSyncService'
import { processSyncQueue, setOnlineStatus } from './SyncService'
import { requireSession } from './sessionRecovery'
import { reconcileTable, SYNC_TABLES } from './syncTables'
import { useAuthStore } from '../shared/stores/authStore'
import { useSyncStore } from '../shared/stores/syncStore'

const databases: DatabaseSync[] = []
const userId = 'user-1'
const older = '2026-10-29T09:00:00.000Z'
const newer = '2026-10-29T10:00:00.000Z'
const upgrade = '2026-10-29T11:00:00.000Z'
const aliasId = 'legacy-copy'
const canonical = builtinThemeId('Standard Dark')
function selection(value: string | null, updated_at: string, deleted_at: string | null = null): Setting {
  return { user_id: userId, key: 'theme_id', value, updated_at, deleted_at }
}
function database(): { db: DatabaseSync; settings: SettingsRepository; themes: ThemeRepository } {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  for (const migration of migrations.slice(0, 30)) migration(db)
  const themes = new ThemeRepository(db)
  const settings = new SettingsRepository(db)
  for (const theme of [
    { id: aliasId, name: 'Standard Dark', is_builtin: 0 },
    { id: 'named-custom', name: 'Soft Sage Dark', is_builtin: 0 }
  ]) db.prepare('INSERT INTO themes (id,name,mode,config,is_builtin,owner_id,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,NULL)')
    .run(theme.id, theme.name, 'dark', JSON.stringify(BUILTIN_THEMES[0].config), theme.is_builtin, userId, older, older)
  return { db, settings, themes }
}
function cloud() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>()
  const writes: Array<{ table: string; payload: Record<string, unknown> }> = []
  const tableRows = (table: string): Map<string, Record<string, unknown>> => {
    if (!tables.has(table)) tables.set(table, new Map())
    return tables.get(table)!
  }
  const client = { from(table: string) {
    let rows = [...tableRows(table).values()]
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (key: string, value: unknown) => { rows = rows.filter((row) => row[key] === value); return chain }
    chain.is = (key: string, value: unknown) => { rows = rows.filter((row) => (row[key] ?? null) === value); return chain }
    chain.gt = (key: string, value: string) => { rows = rows.filter((row) => Date.parse(String(row[key])) > Date.parse(value)); return chain }
    chain.in = (key: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[key])); return chain }
    chain.order = (key: string, options?: { ascending?: boolean }) => { rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options?.ascending === false ? -1 : 1)); return chain }
    chain.limit = (count: number) => { rows = rows.slice(0, count); return chain }
    chain.upsert = (payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
      for (const row of Array.isArray(payload) ? payload : [payload]) {
        writes.push({ table, payload: structuredClone(row) })
        tableRows(table).set(String(row.id), structuredClone(row))
      }
      return chain
    }
    chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null })
    chain.then = (resolve: (result: unknown) => unknown) => resolve({ data: rows, error: null, count: rows.length })
    return chain
  } } as unknown as SupabaseClient
  return {
    client, writes,
    put(setting: Setting) { tableRows('user_settings').set(`${setting.user_id}:${setting.key}`, { ...setting, id: `${setting.user_id}:${setting.key}` }) },
    get() { return tableRows('user_settings').get(`${userId}:theme_id`)! }
  }
}
function install(device: ReturnType<typeof database>, server: ReturnType<typeof cloud>): { context: SyncContext; queue: SyncQueueEntry[] } {
  const queue: SyncQueueEntry[] = []
  const highWater = new Map<string, string>()
  const api = {
    auth: { getSupabaseConfig: async () => ({ url: 'https://example.invalid', anonKey: 'synthetic' }) },
    settings: {
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
      captureContext: async () => ({ userId, generation: 1 }),
      invokeContext: async (_context: unknown, channel: string, args: unknown[]) => {
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
  return { queue, context: { api: window.api, client: server.client, assertCurrent: () => {}, isCurrent: async () => true, scope: 'synthetic' } }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(upgrade)
  vi.mocked(requireSession).mockResolvedValue({ user: { id: userId } } as Session)
  useAuthStore.setState({ currentUser: { id: userId } as never })
  useSyncStore.setState({ status: 'synced', errorMessage: null })
  setOnlineStatus(true)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  databases.splice(0).forEach((db) => db.close())
})

describe('theme selection intent ordering', () => {
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

  it('does not upload an equal-version representation change as a new choice', async () => {
    const device = database()
    device.settings.applyRemote(selection(aliasId, older))
    repairBuiltinThemes(device.db)
    const server = cloud()
    server.put(selection(aliasId, older.replace('Z', '+00:00')))
    install(device, server)
    pushSetting('theme_id', aliasId, userId)
    await vi.advanceTimersByTimeAsync(6000)
    expect(device.settings.findRaw(userId, 'theme_id')).toEqual(selection(canonical, older))
    expect(server.get().updated_at).toBe(older.replace('Z', '+00:00'))
    expect(server.writes).toHaveLength(0)
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
