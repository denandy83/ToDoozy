import { useMemo, useRef } from 'react'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { Status, CreateStatusInput, UpdateStatusInput } from '../../../../shared/types'

interface StatusState {
  statuses: Record<string, Status>
  loading: boolean
  error: string | null
}

interface StatusActions {
  hydrateStatuses(projectId: string): Promise<void>
  createStatus(input: CreateStatusInput): Promise<Status>
  updateStatus(id: string, input: UpdateStatusInput): Promise<Status | null>
  deleteStatus(id: string): Promise<boolean>
  reassignAndDelete(statusId: string, targetStatusId: string): Promise<boolean>
  clearError(): void
}

export type StatusStore = StatusState & StatusActions

export const useStatusStore = createWithEqualityFn<StatusStore>((set) => ({
  statuses: {},
  loading: false,
  error: null,

  async hydrateStatuses(projectId: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      const statuses = await window.api.statuses.findByProjectId(projectId)
      set((state) => {
        // Remove old statuses for this project, then add new ones
        const updated: Record<string, Status> = {}
        for (const [id, s] of Object.entries(state.statuses)) {
          if (s.project_id !== projectId) updated[id] = s
        }
        for (const status of statuses) {
          updated[status.id] = status
        }
        return { statuses: updated, loading: false }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load statuses'
      set({ error: message, loading: false })
    }
  },

  async createStatus(input: CreateStatusInput): Promise<Status> {
    try {
      const status = await window.api.statuses.create(input)
      set((state) => ({
        statuses: { ...state.statuses, [status.id]: status }
      }))
      import('../../services/PersonalSyncService').then(({ pushStatus }) => {
        pushStatus(status).catch((err) => console.error('[StatusStore] push failed:', err))
      })
      return status
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create status'
      set({ error: message })
      throw err
    }
  },

  async updateStatus(id: string, input: UpdateStatusInput): Promise<Status | null> {
    try {
      const status = await window.api.statuses.update(id, input)
      if (status) {
        set((state) => ({
          statuses: { ...state.statuses, [status.id]: status }
        }))
        import('../../services/PersonalSyncService').then(({ pushStatus }) => {
          pushStatus(status).catch((err) => console.error('[StatusStore] push failed:', err))
        })
      }
      return status
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update status'
      set({ error: message })
      throw err
    }
  },

  async deleteStatus(id: string): Promise<boolean> {
    try {
      const result = await window.api.statuses.delete(id)
      if (result) {
        set((state) => {
          const { [id]: _, ...remaining } = state.statuses
          return { statuses: remaining }
        })
        import('../../services/PersonalSyncService').then(({ deleteStatusFromSupabase }) => {
          deleteStatusFromSupabase(id).catch((err) => console.error('[StatusStore] delete sync failed:', err))
        })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete status'
      set({ error: message })
      throw err
    }
  },

  async reassignAndDelete(statusId: string, targetStatusId: string): Promise<boolean> {
    try {
      const result = await window.api.statuses.reassignAndDelete(statusId, targetStatusId)
      if (result) {
        set((state) => {
          const { [statusId]: _, ...remaining } = state.statuses
          return { statuses: remaining }
        })
        import('../../services/PersonalSyncService').then(({ deleteStatusFromSupabase }) => {
          deleteStatusFromSupabase(statusId).catch((err) => console.error('[StatusStore] delete sync failed:', err))
        })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reassign and delete status'
      set({ error: message })
      throw err
    }
  },

  clearError(): void {
    set({ error: null })
  }
}), shallow)

// Hooks — memoize selectors so Zustand gets a stable reference across renders

function arraysEqual(a: Status[], b: Status[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function useStatusesByProject(projectId: string): Status[] {
  const statuses = useStatusStore((state) => state.statuses)
  const prevRef = useRef<Status[]>([])
  const result = useMemo(() => {
    const next = Object.values(statuses)
      .filter((s) => s.project_id === projectId)
      .sort((a, b) => a.order_index - b.order_index)
    if (arraysEqual(prevRef.current, next)) return prevRef.current
    prevRef.current = next
    return next
  }, [statuses, projectId])
  return result
}

export function useDefaultStatus(projectId: string): Status | undefined {
  const statuses = useStatusStore((state) => state.statuses)
  return useMemo(
    () => Object.values(statuses).find((s) => s.project_id === projectId && s.is_default === 1),
    [statuses, projectId]
  )
}

export function useDoneStatus(projectId: string): Status | undefined {
  const statuses = useStatusStore((state) => state.statuses)
  return useMemo(
    () => Object.values(statuses).find((s) => s.project_id === projectId && s.is_done === 1),
    [statuses, projectId]
  )
}

export function useStatusById(id: string): Status | undefined {
  return useStatusStore((state) => state.statuses[id])
}

// Keep old selector factories as aliases for backward compat with re-exports
export const selectStatusesByProject = (projectId: string) => (state: StatusState): Status[] =>
  Object.values(state.statuses)
    .filter((s) => s.project_id === projectId)
    .sort((a, b) => a.order_index - b.order_index)

export const selectDefaultStatus = (projectId: string) => (state: StatusState): Status | undefined =>
  Object.values(state.statuses).find((s) => s.project_id === projectId && s.is_default === 1)

export const selectDoneStatus = (projectId: string) => (state: StatusState): Status | undefined =>
  Object.values(state.statuses).find((s) => s.project_id === projectId && s.is_done === 1)

export const selectStatusById = (id: string) => (state: StatusState): Status | undefined =>
  state.statuses[id]
