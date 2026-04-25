import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error'

interface SyncState {
  status: SyncStatus
  pendingCount: number
  lastSyncedAt: string | null
  /** True during initial full sync (new device or first login) */
  isFirstSync: boolean
  /** Progress 0-100 during first sync */
  firstSyncProgress: number
  /** Error message for display */
  errorMessage: string | null
  /** Whether Supabase Realtime is connected (used to toggle polling) */
  realtimeConnected: boolean
}

interface SyncActions {
  setStatus(status: SyncStatus): void
  setPendingCount(count: number): void
  /**
   * Mark a successful push. Only flips status to 'synced' and bumps lastSyncedAt
   * when the sync state is genuinely clean: queue drained, no recent error,
   * and not offline. Otherwise leaves status alone — a per-op success doesn't
   * mean "everything is in sync".
   */
  setLastSynced(): void
  setFirstSync(active: boolean): void
  setFirstSyncProgress(progress: number): void
  setError(message: string | null): void
  setRealtimeConnected(connected: boolean): void
  hydrate(): Promise<void>
  /** Re-read sync_queue count from SQLite and update pendingCount. */
  refreshPendingCount(): Promise<void>
}

export type SyncStore = SyncState & SyncActions

export const useSyncStore = createWithEqualityFn<SyncStore>(
  (set) => ({
    status: 'synced',
    pendingCount: 0,
    lastSyncedAt: null,
    isFirstSync: false,
    firstSyncProgress: 0,
    errorMessage: null,
    realtimeConnected: false,

    setStatus: (status) => set({ status, errorMessage: status !== 'error' ? null : undefined }),
    setPendingCount: (count) => set({ pendingCount: count }),
    setLastSynced: () => set((state) => {
      const clean =
        state.errorMessage === null &&
        state.pendingCount === 0 &&
        state.status !== 'offline'
      if (!clean) return state
      return { ...state, lastSyncedAt: new Date().toISOString(), status: 'synced' }
    }),
    setFirstSync: (active) => set({ isFirstSync: active, firstSyncProgress: active ? 0 : 100 }),
    setFirstSyncProgress: (progress) => set({ firstSyncProgress: progress }),
    setError: (message) => set({ errorMessage: message, status: message ? 'error' : 'synced' }),
    setRealtimeConnected: (connected) => set({ realtimeConnected: connected }),

    hydrate: async () => {
      try {
        const count = await window.api.sync.count()
        set({
          pendingCount: count,
          status: count > 0 ? 'syncing' : 'synced'
        })
      } catch {
        set({ status: 'synced', pendingCount: 0 })
      }
    },

    refreshPendingCount: async () => {
      try {
        const count = await window.api.sync.count()
        set({ pendingCount: count })
      } catch {
        // Best-effort; leave previous value
      }
    }
  }),
  shallow
)

export const selectSyncStatus = (state: SyncState): SyncStatus => state.status
export const selectPendingCount = (state: SyncState): number => state.pendingCount
export const selectLastSyncedAt = (state: SyncState): string | null => state.lastSyncedAt
export const selectIsFirstSync = (state: SyncState): boolean => state.isFirstSync
export const selectFirstSyncProgress = (state: SyncState): number => state.firstSyncProgress
export const selectRealtimeConnected = (state: SyncState): boolean => state.realtimeConnected
