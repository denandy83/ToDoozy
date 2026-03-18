import { create } from 'zustand'
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

export const useStatusStore = create<StatusStore>((set) => ({
  statuses: {},
  loading: false,
  error: null,

  async hydrateStatuses(projectId: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      const statuses = await window.api.statuses.findByProjectId(projectId)
      const statusMap: Record<string, Status> = {}
      for (const status of statuses) {
        statusMap[status.id] = status
      }
      set({ statuses: statusMap, loading: false })
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
}))

// Selectors
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
