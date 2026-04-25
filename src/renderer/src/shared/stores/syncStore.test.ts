import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('useSyncStore - honest setLastSynced semantics', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      ...globalThis.window,
      api: {
        sync: {
          count: vi.fn().mockResolvedValue(0)
        }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('flips status to synced and bumps lastSyncedAt when state is clean', async () => {
    const { useSyncStore } = await import('./syncStore')
    useSyncStore.setState({
      status: 'syncing',
      pendingCount: 0,
      errorMessage: null,
      lastSyncedAt: null
    })

    useSyncStore.getState().setLastSynced()

    const state = useSyncStore.getState()
    expect(state.status).toBe('synced')
    expect(state.lastSyncedAt).not.toBeNull()
  })

  it('does NOT flip when there is an error', async () => {
    const { useSyncStore } = await import('./syncStore')
    useSyncStore.setState({
      status: 'error',
      pendingCount: 0,
      errorMessage: 'Supabase 500',
      lastSyncedAt: null
    })

    useSyncStore.getState().setLastSynced()

    const state = useSyncStore.getState()
    expect(state.status).toBe('error')
    expect(state.errorMessage).toBe('Supabase 500')
    expect(state.lastSyncedAt).toBeNull()
  })

  it('does NOT flip when pendingCount > 0', async () => {
    const { useSyncStore } = await import('./syncStore')
    useSyncStore.setState({
      status: 'syncing',
      pendingCount: 3,
      errorMessage: null,
      lastSyncedAt: null
    })

    useSyncStore.getState().setLastSynced()

    const state = useSyncStore.getState()
    expect(state.status).toBe('syncing')
    expect(state.lastSyncedAt).toBeNull()
  })

  it('does NOT flip when offline', async () => {
    const { useSyncStore } = await import('./syncStore')
    useSyncStore.setState({
      status: 'offline',
      pendingCount: 0,
      errorMessage: null,
      lastSyncedAt: null
    })

    useSyncStore.getState().setLastSynced()

    const state = useSyncStore.getState()
    expect(state.status).toBe('offline')
    expect(state.lastSyncedAt).toBeNull()
  })

  it('refreshPendingCount reads from window.api.sync.count', async () => {
    const countMock = vi.fn().mockResolvedValue(5)
    vi.stubGlobal('window', {
      ...globalThis.window,
      api: { sync: { count: countMock } }
    })
    const { useSyncStore } = await import('./syncStore')
    useSyncStore.setState({ pendingCount: 0 })

    await useSyncStore.getState().refreshPendingCount()

    expect(countMock).toHaveBeenCalled()
    expect(useSyncStore.getState().pendingCount).toBe(5)
  })

  it('refreshPendingCount keeps previous value on error', async () => {
    const countMock = vi.fn().mockRejectedValue(new Error('IPC blew up'))
    vi.stubGlobal('window', {
      ...globalThis.window,
      api: { sync: { count: countMock } }
    })
    const { useSyncStore } = await import('./syncStore')
    useSyncStore.setState({ pendingCount: 7 })

    await useSyncStore.getState().refreshPendingCount()

    expect(useSyncStore.getState().pendingCount).toBe(7)
  })

  it('setError flips status to error and stores message', async () => {
    const { useSyncStore } = await import('./syncStore')
    useSyncStore.setState({ status: 'synced', errorMessage: null })

    useSyncStore.getState().setError('Push failed')

    const state = useSyncStore.getState()
    expect(state.status).toBe('error')
    expect(state.errorMessage).toBe('Push failed')
  })

  it('setError(null) clears the error and flips status to synced', async () => {
    const { useSyncStore } = await import('./syncStore')
    useSyncStore.setState({ status: 'error', errorMessage: 'something' })

    useSyncStore.getState().setError(null)

    const state = useSyncStore.getState()
    expect(state.status).toBe('synced')
    expect(state.errorMessage).toBeNull()
  })
})
