import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// authStore pulls in the supabase lib, sessionRecovery, and (dynamically)
// SyncService — mock all three so no real client or window.api is constructed.
const getUserMock = vi.fn()
const authUpdateUserMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  getSupabase: vi.fn(async () => ({
    auth: { getUser: getUserMock, updateUser: authUpdateUserMock }
  })),
  parseAuthTokensFromUrl: vi.fn(() => null)
}))

const tryRestoreSessionMock = vi.fn()
const stopRecoveryTimerMock = vi.fn()
const isPermanentlyDeadMock = vi.fn()
vi.mock('../../services/sessionRecovery', () => ({
  tryRestoreSession: (attempts: number) => tryRestoreSessionMock(attempts),
  startRecoveryTimer: vi.fn(),
  stopRecoveryTimer: () => stopRecoveryTimerMock(),
  resetPermanentlyDeadFlag: vi.fn(),
  isPermanentlyDead: () => isPermanentlyDeadMock()
}))

const processSyncQueueMock = vi.fn()
vi.mock('../../services/SyncService', () => ({
  processSyncQueue: () => processSyncQueueMock()
}))

vi.mock('./logStore', () => ({
  logEvent: vi.fn()
}))

import { useAuthStore } from './authStore'
import { useSyncStore } from './syncStore'

const SUPABASE_USER = {
  id: 'u1',
  email: 'andy@example.com',
  user_metadata: { full_name: 'Andy', avatar_url: null }
}
const LOCAL_USER = {
  id: 'u1',
  email: 'andy@example.com',
  display_name: 'Andy',
  avatar_url: null
}

const switchDatabase = vi.fn()
const findById = vi.fn()
const updateUser = vi.fn()
const settingsGet = vi.fn()
const settingsSet = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  isPermanentlyDeadMock.mockReturnValue(false)
  getUserMock.mockResolvedValue({ data: { user: SUPABASE_USER } })
  authUpdateUserMock.mockResolvedValue({ data: {}, error: null })
  switchDatabase.mockResolvedValue(undefined)
  findById.mockResolvedValue(LOCAL_USER)
  updateUser.mockResolvedValue(LOCAL_USER)
  settingsGet.mockResolvedValue(null)
  settingsSet.mockResolvedValue(undefined)
  processSyncQueueMock.mockResolvedValue(undefined)
  vi.stubGlobal('window', {
    api: {
      auth: { switchDatabase },
      users: { findById, update: updateUser, create: vi.fn() },
      settings: { get: settingsGet, set: settingsSet }
    }
  })
  // Seed the offline-fallback state every retry starts from.
  useAuthStore.setState({
    currentUser: null,
    isAuthenticated: true,
    isOffline: true,
    isTokenPermanentlyDead: false
  })
  useSyncStore.setState({ status: 'offline' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('retrySessionRestore', () => {
  it('recovers fully on success: clears isOffline, sets status synced, drains the queue', async () => {
    tryRestoreSessionMock.mockResolvedValue(true)

    const result = await useAuthStore.getState().retrySessionRestore()

    expect(result).toBe(true)
    expect(tryRestoreSessionMock).toHaveBeenCalledWith(1)
    // Manual recovery must stop the 30s auto-retry timer — it's done its job.
    expect(stopRecoveryTimerMock).toHaveBeenCalled()
    expect(switchDatabase).toHaveBeenCalledWith('u1', 'andy@example.com')
    expect(useAuthStore.getState().isOffline).toBe(false)
    expect(useAuthStore.getState().currentUser).toEqual(LOCAL_USER)
    expect(useSyncStore.getState().status).toBe('synced')
    expect(processSyncQueueMock).toHaveBeenCalled()
  })

  it('leaves all state untouched on a transient failure', async () => {
    tryRestoreSessionMock.mockResolvedValue(false)

    const result = await useAuthStore.getState().retrySessionRestore()

    expect(result).toBe(false)
    // Timer keeps running so auto-recovery can still kick in.
    expect(stopRecoveryTimerMock).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isOffline).toBe(true)
    expect(useAuthStore.getState().isTokenPermanentlyDead).toBe(false)
    expect(useSyncStore.getState().status).toBe('offline')
    expect(processSyncQueueMock).not.toHaveBeenCalled()
  })

  it('flips to the dead-token state when the attempt discovers a permanently dead token', async () => {
    tryRestoreSessionMock.mockResolvedValue(false)
    // First call is the pre-attempt guard, second the post-failure check.
    isPermanentlyDeadMock.mockReturnValueOnce(false).mockReturnValue(true)

    const result = await useAuthStore.getState().retrySessionRestore()

    expect(result).toBe(false)
    expect(stopRecoveryTimerMock).toHaveBeenCalled()
    expect(useAuthStore.getState().isTokenPermanentlyDead).toBe(true)
    expect(useAuthStore.getState().isOffline).toBe(true)
  })

  it('fails fast without a restore attempt when the token is already known dead', async () => {
    isPermanentlyDeadMock.mockReturnValue(true)

    const result = await useAuthStore.getState().retrySessionRestore()

    expect(result).toBe(false)
    expect(tryRestoreSessionMock).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isTokenPermanentlyDead).toBe(true)
  })

  it('reports failure and keeps offline state when the restored session has no user', async () => {
    tryRestoreSessionMock.mockResolvedValue(true)
    getUserMock.mockResolvedValue({ data: { user: null } })

    const result = await useAuthStore.getState().retrySessionRestore()

    expect(result).toBe(false)
    expect(useAuthStore.getState().isOffline).toBe(true)
    expect(useSyncStore.getState().status).toBe('offline')
  })

  it('retries a pending profile push after recovery', async () => {
    tryRestoreSessionMock.mockResolvedValue(true)
    settingsGet.mockResolvedValue('true')

    await useAuthStore.getState().retrySessionRestore()

    expect(authUpdateUserMock).toHaveBeenCalledWith({
      data: { display_name: 'Andy', first_name: 'Andy', last_name: '' }
    })
    expect(settingsSet).toHaveBeenCalledWith('u1', 'profile_sync_pending', '')
  })

  it('still recovers when the queue drain throws', async () => {
    tryRestoreSessionMock.mockResolvedValue(true)
    processSyncQueueMock.mockRejectedValue(new Error('network'))

    const result = await useAuthStore.getState().retrySessionRestore()

    expect(result).toBe(true)
    expect(useAuthStore.getState().isOffline).toBe(false)
    expect(useSyncStore.getState().status).toBe('synced')
  })
})
