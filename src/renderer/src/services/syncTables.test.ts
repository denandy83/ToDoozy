import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SyncTableDescriptor } from './syncTables'

interface FakeRow {
  id: string
  user_id: string
  updated_at: string
  deleted_at: string | null
}

function makeDescriptor(opts: {
  localList: FakeRow[]
  remoteList: FakeRow[]
  localMax: string | null
  remoteMax: string | null
  spies: {
    remoteUpsert: (row: FakeRow) => void
    localApplyRemote: (row: FakeRow) => void
  }
}): SyncTableDescriptor<FakeRow, FakeRow> {
  return {
    name: 'labels',
    remoteName: 'fake_remote',
    scope: 'user',
    localScopeColumn: 'user_id',
    remoteScopeColumn: 'user_id',
    async localList() {
      return opts.localList
    },
    async localGetById(id) {
      return opts.localList.find((r) => r.id === id) ?? null
    },
    async localApplyRemote(remote) {
      opts.spies.localApplyRemote(remote)
    },
    async localMaxUpdatedAt() {
      return opts.localMax
    },
    async remoteList() {
      return opts.remoteList
    },
    async remoteUpsert(local) {
      opts.spies.remoteUpsert(local)
    },
    async remoteSoftDelete() {
      // not used in these tests
    },
    async remoteMaxUpdatedAt() {
      return opts.remoteMax
    },
    toRemote(row) {
      return row
    },
    fromRemote(row) {
      return row
    }
  }
}

function stubSyncMeta(initial: { highWater: string | null }): {
  getHighWater: ReturnType<typeof vi.fn>
  setHighWater: ReturnType<typeof vi.fn>
  setLastReconciledAt: ReturnType<typeof vi.fn>
} {
  const state = { highWater: initial.highWater }
  return {
    getHighWater: vi.fn(async () => state.highWater),
    setHighWater: vi.fn(async (_uid: string, _scope: string, _t: string, ts: string) => {
      state.highWater = ts
    }),
    setLastReconciledAt: vi.fn(async () => {})
  }
}

describe('reconcileTable — high-water short-circuit', () => {
  let syncMetaStub: ReturnType<typeof stubSyncMeta>

  beforeEach(() => {
    syncMetaStub = stubSyncMeta({ highWater: null })
    vi.stubGlobal('window', {
      ...globalThis.window,
      api: {
        syncMeta: {
          getHighWater: syncMetaStub.getHighWater,
          setHighWater: syncMetaStub.setHighWater,
          getLastReconciledAt: vi.fn(async () => null),
          setLastReconciledAt: syncMetaStub.setLastReconciledAt,
          clearAll: vi.fn(async () => 0)
        }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('skips the diff when both sides max <= storedHighWater', async () => {
    syncMetaStub.getHighWater.mockResolvedValueOnce('2026-04-25T12:00:00.000Z')
    const spies = { remoteUpsert: vi.fn(), localApplyRemote: vi.fn() }
    const desc = makeDescriptor({
      localList: [],
      remoteList: [],
      localMax: '2026-04-25T11:00:00.000Z',
      remoteMax: '2026-04-25T11:00:00.000Z',
      spies
    })
    // localList/remoteList shouldn't even be called when we skip — wrap them
    // to assert that.
    const localListSpy = vi.fn(async () => [])
    const remoteListSpy = vi.fn(async () => [])
    desc.localList = localListSpy
    desc.remoteList = remoteListSpy

    const { reconcileTable } = await import('./syncTables')
    const stats = await reconcileTable(desc, 'user-1', 'user-1')

    expect(stats.skipped).toBe(true)
    expect(stats.pushed).toBe(0)
    expect(stats.pulled).toBe(0)
    expect(localListSpy).not.toHaveBeenCalled()
    expect(remoteListSpy).not.toHaveBeenCalled()
    expect(spies.remoteUpsert).not.toHaveBeenCalled()
    expect(spies.localApplyRemote).not.toHaveBeenCalled()
    expect(syncMetaStub.setLastReconciledAt).toHaveBeenCalledOnce()
    // High-water should NOT be advanced when skipped (nothing newer happened).
    expect(syncMetaStub.setHighWater).not.toHaveBeenCalled()
  })

  it('runs the full diff when remote max > storedHighWater', async () => {
    syncMetaStub.getHighWater.mockResolvedValueOnce('2026-04-25T11:00:00.000Z')
    const remote: FakeRow = {
      id: 'r1',
      user_id: 'user-1',
      updated_at: '2026-04-25T12:00:00.000Z',
      deleted_at: null
    }
    const spies = { remoteUpsert: vi.fn(), localApplyRemote: vi.fn() }
    const desc = makeDescriptor({
      localList: [],
      remoteList: [remote],
      localMax: '2026-04-25T10:00:00.000Z',
      remoteMax: '2026-04-25T12:00:00.000Z',
      spies
    })

    const { reconcileTable } = await import('./syncTables')
    const stats = await reconcileTable(desc, 'user-1', 'user-1')

    expect(stats.skipped).toBe(false)
    expect(stats.pulled).toBe(1)
    expect(spies.localApplyRemote).toHaveBeenCalledWith(remote)
    // High-water should advance to the new remote max on a clean pass.
    expect(syncMetaStub.setHighWater).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      'labels',
      '2026-04-25T12:00:00.000Z'
    )
  })

  it('runs the full diff when local max > storedHighWater (push case)', async () => {
    syncMetaStub.getHighWater.mockResolvedValueOnce('2026-04-25T11:00:00.000Z')
    const local: FakeRow = {
      id: 'l1',
      user_id: 'user-1',
      updated_at: '2026-04-25T12:00:00.000Z',
      deleted_at: null
    }
    const spies = { remoteUpsert: vi.fn(), localApplyRemote: vi.fn() }
    const desc = makeDescriptor({
      localList: [local],
      remoteList: [],
      localMax: '2026-04-25T12:00:00.000Z',
      remoteMax: '2026-04-25T10:00:00.000Z',
      spies
    })

    const { reconcileTable } = await import('./syncTables')
    const stats = await reconcileTable(desc, 'user-1', 'user-1')

    expect(stats.skipped).toBe(false)
    expect(stats.pushed).toBe(1)
    expect(spies.remoteUpsert).toHaveBeenCalledWith(local)
    expect(syncMetaStub.setHighWater).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      'labels',
      '2026-04-25T12:00:00.000Z'
    )
  })

  it('does NOT skip when there is no stored high-water (first reconcile)', async () => {
    syncMetaStub.getHighWater.mockResolvedValueOnce(null)
    const spies = { remoteUpsert: vi.fn(), localApplyRemote: vi.fn() }
    const desc = makeDescriptor({
      localList: [],
      remoteList: [],
      localMax: null,
      remoteMax: null,
      spies
    })

    const { reconcileTable } = await import('./syncTables')
    const stats = await reconcileTable(desc, 'user-1', 'user-1')

    expect(stats.skipped).toBe(false)
    // No data anywhere → no high-water to advance.
    expect(syncMetaStub.setHighWater).not.toHaveBeenCalled()
    expect(syncMetaStub.setLastReconciledAt).toHaveBeenCalledOnce()
  })

  it('does NOT advance high-water when any row failed (so the next pass retries)', async () => {
    syncMetaStub.getHighWater.mockResolvedValueOnce('2026-04-25T10:00:00.000Z')
    const local: FakeRow = {
      id: 'l1',
      user_id: 'user-1',
      updated_at: '2026-04-25T12:00:00.000Z',
      deleted_at: null
    }
    const spies = {
      remoteUpsert: vi.fn(() => {
        throw new Error('network')
      }),
      localApplyRemote: vi.fn()
    }
    const desc = makeDescriptor({
      localList: [local],
      remoteList: [],
      localMax: '2026-04-25T12:00:00.000Z',
      remoteMax: '2026-04-25T10:00:00.000Z',
      spies
    })

    const { reconcileTable } = await import('./syncTables')
    const stats = await reconcileTable(desc, 'user-1', 'user-1')

    expect(stats.failed).toBe(1)
    expect(stats.pushed).toBe(0)
    expect(syncMetaStub.setHighWater).not.toHaveBeenCalled()
  })
})
