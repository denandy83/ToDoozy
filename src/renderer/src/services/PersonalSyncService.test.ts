const pinnedProducer = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => pinnedProducer.client) }))
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient, Session } from '@supabase/supabase-js'

// PersonalSyncService pulls in Supabase, session-recovery and the log store at
// import time. Mock the network/side-effect boundaries so fullUpload/initSync
// can run purely in-memory. The store (syncStore) is exercised for real — it is
// a plain in-memory Zustand store and safe under node.
vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn(), safeRefresh: vi.fn() }))
vi.mock('./sessionRecovery', () => ({ requireSession: vi.fn() }))
vi.mock('../shared/stores/logStore', async (importOriginal) => ({ ...await importOriginal<typeof import('../shared/stores/logStore')>(), logEvent: vi.fn() }))

import { chunkArray, fullPull, fullUpload, initSync, pushSetting, pushTheme } from './PersonalSyncService'
import { BUILTIN_THEMES, presetForTheme } from '../../../shared/themeCatalog'
import { useAuthStore } from '../shared/stores/authStore'
import { getSupabase } from '../lib/supabase'
import { requireSession } from './sessionRecovery'

describe('chunkArray', () => {
  it('returns an empty array for no items', () => {
    expect(chunkArray([], 500)).toEqual([])
  })

  it('returns a single chunk when items fit within size', () => {
    expect(chunkArray([1, 2, 3], 500)).toEqual([[1, 2, 3]])
  })

  it('splits into fixed-size chunks, last chunk holding the remainder', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('splits evenly when length is a multiple of size', () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('covers every item across chunks with no duplication or loss', () => {
    const items = Array.from({ length: 1201 }, (_, i) => i)
    const chunks = chunkArray(items, 500)
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 201])
    expect(chunks.flat()).toEqual(items)
  })

  it('yields a single chunk for a non-positive size', () => {
    expect(chunkArray([1, 2, 3], 0)).toEqual([[1, 2, 3]])
    expect(chunkArray([1, 2, 3], -5)).toEqual([[1, 2, 3]])
  })

  it('yields nothing for a non-positive size when there are no items', () => {
    expect(chunkArray([], 0)).toEqual([])
  })
})

// ── fullUpload / initSync: last_sync_at is a completion marker, not a sentinel ──
//
// Regression guard for #106: fullUpload used to write last_sync_at BEFORE
// pushing any data (as an in-flight sentinel). If the upload threw midway, that
// stale timestamp was left behind, and the next initSync — which treats any
// truthy last_sync_at as "already fully synced" — skipped the retry, stranding
// the account partially uploaded. The fix writes last_sync_at ONLY on success
// and relies on initSyncInFlight for concurrency.

const USER_ID = 'user-1'

interface QueryResult {
  error: null
  data: unknown[]
  count: number
}

/**
 * A Supabase double whose query builder is both chainable and awaitable and
 * always resolves to a benign empty/success result. Enough for fullUpload's
 * upserts, RPCs and count-verification queries to complete without a network.
 */
function makeSupabase(records: UpsertRecord[] = [], tableRows: Record<string, unknown[]> = {}): SupabaseClient {
  const make = (table: string): Record<string, unknown> => {
    const result: QueryResult = { error: null, data: tableRows[table] ?? [], count: 0 }
    const chain: Record<string, unknown> = {}
    for (const method of ['select','insert','update','delete','eq','neq','in','is','order','limit','or','filter','match']) {
      chain[method] = (): Record<string, unknown> => chain
    }
    chain.upsert = (payload: unknown): Record<string, unknown> => { records.push({table,payload}); result.data = Array.isArray(payload) ? payload : [payload]; return chain }
    chain.single = (): Promise<QueryResult> => Promise.resolve(result)
    chain.maybeSingle = async () => ({ ...result, data: result.data[0] ?? null })
    chain.then = (resolve: (value: QueryResult) => unknown): unknown => resolve(result)
    return chain
  }
  const supabase = {
    auth: { getSession: async () => ({ data: { session: { user: { id: USER_ID } } } }) },
    from: make,
    rpc: async () => ({error:null,data:[],count:0})
  }
  pinnedProducer.client = supabase
  return supabase as unknown as SupabaseClient
}

/** In-memory settings store + spies mirroring the window.api surface fullUpload touches. */
interface ApiHarness {
  settings: Map<string, string>
  labelsFindAll: ReturnType<typeof vi.fn>
  statusesFindByProjectId: ReturnType<typeof vi.fn>
  projectsGetProjectsForUser: ReturnType<typeof vi.fn>
  settingsSet: ReturnType<typeof vi.fn>
  themesFindAllByOwner: ReturnType<typeof vi.fn>
  themesApplyRemote: ReturnType<typeof vi.fn>
}

function ownedProject(): Record<string, unknown> {
  return {
    id: 'p1', name: 'Project 1', description: null, color: '#888888', icon: 'folder',
    owner_id: USER_ID, is_default: 0, sidebar_order: 0, area_id: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z'
  }
}

function installApi(opts: { hasProject: boolean }): ApiHarness {
  const settings = new Map<string, string>()
  const settingsSet = vi.fn((_userId: string, key: string, value: string): Promise<void> => {
    settings.set(key, value)
    return Promise.resolve()
  })
  const settingsGet = vi.fn((_userId: string, key: string): Promise<string | null> =>
    Promise.resolve(settings.get(key) ?? null))
  const settingsGetAll = vi.fn((): Promise<Array<{ key: string; value: string }>> =>
    Promise.resolve([...settings.entries()].map(([key, value]) => ({ key, value }))))
  const projectsGetProjectsForUser = vi.fn((): Promise<Array<Record<string, unknown>>> =>
    Promise.resolve(opts.hasProject ? [ownedProject()] : []))
  const labelsFindAll = vi.fn((): Promise<unknown[]> => Promise.resolve([]))
  const statusesFindByProjectId = vi.fn((): Promise<unknown[]> => Promise.resolve([]))
  const empty = (): Promise<unknown[]> => Promise.resolve([])

  const themesFindAllByOwner = vi.fn(empty)
  const themesApplyRemote = vi.fn(async (theme: unknown) => theme)

  useAuthStore.setState({ currentUser: { id: USER_ID } as never })
  const api = {
    auth: { getSupabaseConfig: async () => ({ url: 'https://example.invalid', anonKey: 'synthetic' }) },
    sync: {
      captureContext: async () => ({ userId: USER_ID, generation: 1 }),
      invokeContext: async (_context: unknown, channel: string, args: unknown[]) => {
        const [namespace, method] = channel.split(':')
        return (window.api as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>)[namespace][method](...args)
      }
    },
    settings: { set: settingsSet, get: settingsGet, getAll: settingsGetAll },
    projects: { getProjectsForUser: projectsGetProjectsForUser },
    labels: { findAll: labelsFindAll, findByProjectId: empty },
    savedViews: { findByUserId: empty },
    statuses: { findByProjectId: statusesFindByProjectId },
    tasks: {
      findByProjectId: empty, findArchived: empty, findTemplates: empty,
      getLabelState: empty,
      acknowledgeLabelState: async()=>undefined,
      getLabels: empty
    },
    projectAreas: { findByUserId: empty },
    themes: { list: empty, findAllByOwner: themesFindAllByOwner, findById: async (id: string) => (await themesFindAllByOwner() as Array<{ id: string }>).find((theme) => theme.id === id), isPresetAlias: async (theme: Parameters<typeof presetForTheme>[0]) => Boolean(presetForTheme(theme)), applyRemote: themesApplyRemote }
  }
  vi.stubGlobal('window', { api })
  return { settings, labelsFindAll, statusesFindByProjectId, projectsGetProjectsForUser, settingsSet, themesFindAllByOwner, themesApplyRemote }
}

// ── pushSetting never emits the plaintext api_key to user_settings (#114) ──
//
// A prior build synced the raw API key into user_settings.value (5s debounce)
// because pushSetting had no exclusion for `api_key`. The key is a bearer secret
// — it must stay device-local and only ever reach the cloud as a SHA-256 hash in
// api_keys. This asserts the debounced push path drops `api_key` and still
// forwards ordinary settings.

interface UpsertRecord {
  table: string
  payload: unknown
}

/** Supabase double that records every from(table).upsert(payload) call. */
function makeRecordingSupabase(records: UpsertRecord[]): SupabaseClient {
  const ok = { error: null, data: [], count: 0 }
  const make = (table: string): Record<string, unknown> => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'update', 'delete', 'insert']) {
      chain[m] = (): Record<string, unknown> => chain
    }
    chain.upsert = (payload: unknown): Promise<typeof ok> => {
      records.push({ table, payload })
      return Promise.resolve(ok)
    }
    chain.single = (): Promise<typeof ok> => Promise.resolve(ok)
    chain.maybeSingle = (): Promise<typeof ok> => Promise.resolve(ok)
    chain.then = (resolve: (v: typeof ok) => unknown): unknown => resolve(ok)
    return chain
  }
  const client = { from: (table: string): Record<string, unknown> => make(table) } as unknown as SupabaseClient
  pinnedProducer.client = client
  return client
}

describe('pushSetting api_key exclusion (#114)', () => {
  beforeEach(() => {
    installApi({ hasProject: false })
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(requireSession).mockResolvedValue({ user: { id: USER_ID } } as unknown as Session)
  })

  afterEach(() => {
    vi.useRealTimers()
  })


  it('never upserts api_key to user_settings, even after the debounce flushes', async () => {
    const records: UpsertRecord[] = []
    vi.mocked(getSupabase).mockResolvedValue(makeRecordingSupabase(records))

    pushSetting('api_key', 'super-secret-plaintext', USER_ID)
    // Advance past the 5s debounce and drain the async flush.
    await vi.advanceTimersByTimeAsync(6_000)

    const settingsUpserts = records.filter((r) => r.table === 'user_settings')
    expect(settingsUpserts).toHaveLength(0)
  })

  it('still forwards ordinary integration settings through the debounced push', async () => {
    const records: UpsertRecord[] = []
    vi.mocked(getSupabase).mockResolvedValue(makeRecordingSupabase(records))

    pushSetting('telegram_user_id', '123456', USER_ID)
    await vi.advanceTimersByTimeAsync(6_000)

    const settingsUpserts = records.filter((r) => r.table === 'user_settings')
    expect(settingsUpserts).toHaveLength(1)
    expect(settingsUpserts[0].payload).toMatchObject({ key: 'telegram_user_id', value: '123456' })
  })
})

// ── fullPull never imports a remote api_key into local settings (#114) ──
//
// A pre-#114 build could leak the raw API key into the cloud user_settings
// table (the debounced push had no exclusion). fullPull runs for any new /
// empty-local device via initSync and did an UNFILTERED read of user_settings,
// writing every row back under the REAL user_id — re-absorbing the leaked
// secret and violating the device-local-only invariant. This asserts the pull
// path drops `api_key` (via the shared isSettingSyncExcluded list) while still
// importing ordinary settings.

/**
 * Supabase double for fullPull: every table read resolves to an empty list
 * except user_settings, which returns the supplied rows. Awaitable and
 * chainable so fullPull's SELECT/eq/in chains resolve without a network.
 */
function makePullSupabase(
  userSettingsRows: Array<{ key: string; value: string }>
): SupabaseClient {
  const make = (table: string): Record<string, unknown> => {
    const result = {
      data: table === 'user_settings' ? userSettingsRows : [],
      error: null,
      count: 0
    }
    const chain: Record<string, unknown> = {}
    for (const m of [
      'select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'or', 'filter', 'match',
      'update', 'delete', 'insert', 'upsert'
    ]) {
      chain[m] = (): Record<string, unknown> => chain
    }
    chain.single = (): Promise<typeof result> => Promise.resolve(result)
    chain.maybeSingle = (): Promise<typeof result> => Promise.resolve(result)
    chain.then = (resolve: (v: typeof result) => unknown): unknown => resolve(result)
    return chain
  }
  const client = { from: (table: string): Record<string, unknown> => make(table) } as unknown as SupabaseClient
  pinnedProducer.client = client
  return client
}

describe('fullPull api_key exclusion (#114)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireSession).mockResolvedValue({ user: { id: USER_ID } } as unknown as Session)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('never imports a remote api_key row into local settings under the real user_id', async () => {
    const h = installApi({ hasProject: false })
    vi.mocked(getSupabase).mockResolvedValue(
      makePullSupabase([
        { key: 'api_key', value: 'leaked-plaintext-key' },
        { key: 'theme', value: 'dark' }
      ])
    )

    await fullPull(USER_ID)

    // The leaked bearer secret must NOT land in local settings under user_id…
    expect(h.settings.has('api_key')).toBe(false)
    expect(h.settingsSet).not.toHaveBeenCalledWith(USER_ID, 'api_key', expect.anything())
    // …while ordinary settings still import as before.
    expect(h.settings.get('theme')).toBe('dark')
  })
})

describe('fullUpload / initSync last_sync_at handling (#106)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSupabase).mockResolvedValue(makeSupabase())
    vi.mocked(requireSession).mockResolvedValue({ user: { id: USER_ID } } as unknown as Session)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(BUILTIN_THEMES)('eager upload distinguishes custom $name from original preset copies', async (preset) => {
    const h = installApi({ hasProject: true })
    const records: UpsertRecord[] = []
    vi.mocked(getSupabase).mockResolvedValue(makeSupabase(records))
    const theme = { id: 'custom', user_id: USER_ID, name: preset.name, mode: preset.mode,
      bg: '#000000', fg: '#ffffff', fg_secondary: '#aaaaaa', fg_muted: '#888888', muted: '#888888',
      accent: '#cccccc', accent_fg: '#111111', border: '#333333', sidebar: '#123456' }
    h.themesFindAllByOwner.mockResolvedValue([{ id: theme.id, name: theme.name, mode: theme.mode, owner_id: USER_ID, is_builtin: 0, config: JSON.stringify({ bg: theme.bg, fg: theme.fg, fgSecondary: theme.fg_secondary, fgMuted: theme.fg_muted, muted: theme.muted, accent: theme.accent, accentFg: theme.accent_fg, border: theme.border, sidebar: theme.sidebar }), created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null }] as never)
    await pushTheme(theme)
    const uploaded = records.filter((record) => record.table === 'user_themes')
    expect(uploaded).toHaveLength(preset.name.startsWith('Soft ') ? 1 : 0)
    if (uploaded.length) expect(uploaded[0].payload).toMatchObject(theme)
  })

  it('bootstrap uploads owned genuine customs while quarantining preset copies and cleanup tombstones', async () => {
    const h = installApi({ hasProject: true })
    const records: UpsertRecord[] = []
    vi.mocked(getSupabase).mockResolvedValue(makeSupabase(records))
    const config = JSON.stringify({bg:'#000000',fg:'#ffffff',fgSecondary:'#cccccc',fgMuted:'#888888',muted:'#888888',accent:'#c8bce7',accentFg:'#111111',border:'#333333',sidebar:'#aabbcc'})
    const base = {mode:'dark',config,is_builtin:0,owner_id:USER_ID,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-02T00:00:00Z',deleted_at:null}
    h.themesFindAllByOwner.mockResolvedValue([
      {...base,id:'builtin',name:'Standard Dark',is_builtin:1,owner_id:null},
      {...base,id:'old-copy',name:'Standard Dark'},
      {...base,id:'custom',name:'Aviobook Dark'},
      {...base,id:'custom-soft',name:'Soft Sage Dark'},
      {...base,id:'deleted-custom',name:'Old custom Dark',deleted_at:base.updated_at},
      {...base,id:'retired-copy',name:'Standard Dark',deleted_at:base.updated_at}
    ])
    await fullUpload(USER_ID)
    expect(h.themesFindAllByOwner).toHaveBeenCalledWith(USER_ID,{includeTombstones:true})
    const themes = records.filter((record)=>record.table==='user_themes').map((record)=>record.payload as Record<string,unknown>)
    expect(themes.map((theme)=>theme.id).sort()).toEqual(['custom','custom-soft','deleted-custom'])
    expect(themes.find((theme)=>theme.id==='custom')?.sidebar).toBe('#aabbcc')
  })

  it('bootstrap pull uses the shared theme path with exact custom sidebar, clocks and tombstone', async () => {
    const h = installApi({hasProject:false})
    const remote = {id:'custom',user_id:USER_ID,name:'Soft Sage Dark',mode:'dark',bg:'#000000',fg:'#ffffff',fg_secondary:'#cccccc',fg_muted:'#888888',muted:'#888888',accent:'#c8bce7',accent_fg:'#111111',surface:'#cccccc',border:'#333333',sidebar:'#aabbcc',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-02T00:00:00Z',deleted_at:'2026-01-02T00:00:00Z'}
    vi.mocked(getSupabase).mockResolvedValue(makeSupabase([],{user_themes:[remote]}))
    await fullPull(USER_ID)
    expect(h.themesApplyRemote).toHaveBeenCalledWith(expect.objectContaining({id:remote.id,created_at:remote.created_at,updated_at:remote.updated_at,deleted_at:remote.deleted_at}))
    const local = h.themesApplyRemote.mock.calls[0][0] as unknown as {config:string}
    expect(JSON.parse(local.config).sidebar).toBe(remote.sidebar)
  })

  it('sets last_sync_at only after a successful upload completes', async () => {
    const h = installApi({ hasProject: true })
    await fullUpload(USER_ID)

    const value = h.settings.get('last_sync_at')
    expect(value).toBeDefined()
    // Written once (completion only), and a valid ISO timestamp.
    expect(h.settingsSet).toHaveBeenCalledWith(USER_ID, 'last_sync_at', expect.any(String))
    expect(Number.isNaN(Date.parse(value as string))).toBe(false)
  })

  it('leaves last_sync_at UNSET when the upload throws midway (retry-on-next-launch)', async () => {
    const h = installApi({ hasProject: true })
    // Fail after the first project has already been pushed — a genuine mid-upload
    // failure (e.g. dropped network). The old sentinel would already be on disk here.
    h.statusesFindByProjectId.mockRejectedValueOnce(new Error('network dropped'))

    // fullUpload swallows the error into the sync store (does not rethrow).
    await expect(fullUpload(USER_ID)).resolves.toBeUndefined()

    // The sole reader — initSync — treats a falsy last_sync_at as "not yet synced"
    // and retries, so the account is NOT stranded partially uploaded.
    expect(h.settings.has('last_sync_at')).toBe(false)
  })

  it('retries the full upload on next init when last_sync_at is unset after a failure', async () => {
    // Simulate the post-failure state: last_sync_at never written, local data present.
    const h = installApi({ hasProject: true })
    await initSync(USER_ID)

    // fullUpload ran (labels.findAll is only reached inside fullUpload) and then
    // recorded completion.
    expect(h.labelsFindAll).toHaveBeenCalledTimes(1)
    expect(h.settings.has('last_sync_at')).toBe(true)
  })

  it('does not double-upload when two initSync calls race (initSyncInFlight guards)', async () => {
    const h = installApi({ hasProject: true })

    // Fire both before awaiting either — the second must join the first's promise.
    const a = initSync(USER_ID)
    const b = initSync(USER_ID)
    await Promise.all([a, b])

    // Exactly one fullUpload body executed despite two concurrent initSync calls.
    expect(h.labelsFindAll).toHaveBeenCalledTimes(1)
    expect(h.settingsSet).toHaveBeenCalledWith(USER_ID, 'last_sync_at', expect.any(String))
    const lastSyncWrites = h.settingsSet.mock.calls.filter((c) => c[1] === 'last_sync_at')
    expect(lastSyncWrites).toHaveLength(1)
  })
})
