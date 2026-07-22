import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient, Session } from '@supabase/supabase-js'

// PersonalSyncService pulls in Supabase, session-recovery and the log store at
// import time. Mock the network/side-effect boundaries so fullUpload/initSync
// can run purely in-memory. The store (syncStore) is exercised for real — it is
// a plain in-memory Zustand store and safe under node.
vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn(), safeRefresh: vi.fn() }))
vi.mock('./sessionRecovery', () => ({ requireSession: vi.fn() }))
vi.mock('../shared/stores/logStore', () => ({ logEvent: vi.fn() }))

import { chunkArray, fullPull, fullUpload, initSync, pushSetting } from './PersonalSyncService'
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
function makeSupabase(): SupabaseClient {
  const result: QueryResult = { error: null, data: [], count: 0 }
  const chain: Record<string, unknown> = {}
  const chainMethods = [
    'select', 'insert', 'upsert', 'update', 'delete',
    'eq', 'neq', 'in', 'is', 'order', 'limit', 'filter', 'match'
  ]
  for (const method of chainMethods) chain[method] = (): Record<string, unknown> => chain
  chain.single = (): Promise<QueryResult> => Promise.resolve(result)
  chain.maybeSingle = (): Promise<QueryResult> => Promise.resolve(result)
  chain.then = (resolve: (value: QueryResult) => unknown): unknown => resolve(result)
  const supabase = {
    auth: {
      getSession: (): Promise<{ data: { session: { user: { id: string } } } }> =>
        Promise.resolve({ data: { session: { user: { id: USER_ID } } } })
    },
    from: (): Record<string, unknown> => chain,
    rpc: (): Promise<QueryResult> => Promise.resolve(result)
  }
  return supabase as unknown as SupabaseClient
}

/** In-memory settings store + spies mirroring the window.api surface fullUpload touches. */
interface ApiHarness {
  settings: Map<string, string>
  labelsFindAll: ReturnType<typeof vi.fn>
  statusesFindByProjectId: ReturnType<typeof vi.fn>
  projectsGetProjectsForUser: ReturnType<typeof vi.fn>
  settingsSet: ReturnType<typeof vi.fn>
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

  const api = {
    settings: { set: settingsSet, get: settingsGet, getAll: settingsGetAll },
    projects: { getProjectsForUser: projectsGetProjectsForUser },
    labels: { findAll: labelsFindAll, findByProjectId: empty },
    savedViews: { findByUserId: empty },
    statuses: { findByProjectId: statusesFindByProjectId },
    tasks: {
      findByProjectId: empty, findArchived: empty, findTemplates: empty,
      getLabels: empty
    },
    projectAreas: { findByUserId: empty },
    themes: { list: empty }
  }
  vi.stubGlobal('window', { api })
  return { settings, labelsFindAll, statusesFindByProjectId, projectsGetProjectsForUser, settingsSet }
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
  return { from: (table: string): Record<string, unknown> => make(table) } as unknown as SupabaseClient
}

describe('pushSetting api_key exclusion (#114)', () => {
  beforeEach(() => {
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
      'select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'filter', 'match',
      'update', 'delete', 'insert', 'upsert'
    ]) {
      chain[m] = (): Record<string, unknown> => chain
    }
    chain.single = (): Promise<typeof result> => Promise.resolve(result)
    chain.maybeSingle = (): Promise<typeof result> => Promise.resolve(result)
    chain.then = (resolve: (v: typeof result) => unknown): unknown => resolve(result)
    return chain
  }
  return { from: (table: string): Record<string, unknown> => make(table) } as unknown as SupabaseClient
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
