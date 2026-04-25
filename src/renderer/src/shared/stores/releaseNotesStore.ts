import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { logEvent } from './logStore'

interface ReleaseNotesState {
  content: string
  isSyncing: boolean
  syncError: string | null
  lastSyncedAt: number | null
}

interface ReleaseNotesActions {
  loadCached(): Promise<void>
  sync(): Promise<void>
}

export type ReleaseNotesStore = ReleaseNotesState & ReleaseNotesActions

function parseChangelog(raw: string): string {
  const lines = raw.split('\n')
  const startIdx = lines.findIndex((l) => l.startsWith('## '))
  return startIdx >= 0 ? lines.slice(startIdx).join('\n') : raw
}

export const useReleaseNotesStore = createWithEqualityFn<ReleaseNotesStore>(
  (set, get) => ({
    content: '',
    isSyncing: false,
    syncError: null,
    lastSyncedAt: null,

    async loadCached(): Promise<void> {
      const raw = await window.api.app.getChangelog()
      set({ content: parseChangelog(raw) })
    },

    async sync(): Promise<void> {
      // Single-flight: if a sync is already running, await its completion via the flag.
      if (get().isSyncing) return
      set({ isSyncing: true, syncError: null })
      try {
        const result = await window.api.releaseNotes.sync()
        if (result.ok) {
          logEvent(
            'info',
            'sync',
            `Release notes synced (${result.count} versions)`,
            `cached=${result.cached}`
          )
          const raw = await window.api.app.getChangelog()
          set({
            content: parseChangelog(raw),
            syncError: null,
            lastSyncedAt: Date.now()
          })
        } else {
          logEvent(
            'error',
            'sync',
            `Release notes sync failed: ${result.error ?? 'unknown'}`,
            `cached=${result.cached}`
          )
          set({ syncError: result.error ?? 'unknown error' })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logEvent('error', 'sync', `Release notes IPC failed: ${msg}`)
        set({ syncError: msg })
      } finally {
        set({ isSyncing: false })
      }
    }
  }),
  shallow
)

export const selectReleaseNotesContent = (s: ReleaseNotesState): string => s.content
