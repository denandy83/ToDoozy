import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'

type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error'

interface SyncState {
  status: SyncStatus
  pendingCount: number
  lastSyncedAt: string | null
}

interface SyncActions {
  setStatus(status: SyncStatus): void
  setPendingCount(count: number): void
  setLastSynced(): void
  hydrate(): Promise<void>
}

export const useSyncStore = createWithEqualityFn<SyncState & SyncActions>(
  (set) => ({
    status: 'idle',
    pendingCount: 0,
    lastSyncedAt: null,

    setStatus: (status) => set({ status }),
    setPendingCount: (count) => set({ pendingCount: count }),
    setLastSynced: () => set({ lastSyncedAt: new Date().toISOString() }),

    hydrate: async () => {
      const count = await window.api.sync.count()
      set({
        pendingCount: count,
        status: count > 0 ? 'syncing' : 'idle'
      })
    }
  }),
  shallow
)
