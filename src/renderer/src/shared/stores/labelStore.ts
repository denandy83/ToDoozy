import { useMemo, useRef } from 'react'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { Label, CreateLabelInput, UpdateLabelInput } from '../../../../shared/types'
import { useAuthStore } from './authStore'

function getUserId(): string {
  return useAuthStore.getState().currentUser?.id ?? ''
}

export type LabelFilterMode = 'hide' | 'blur'

interface LabelState {
  labels: Record<string, Label>
  projectLabels: Record<string, Set<string>> // projectId -> Set<labelId>
  activeLabelFilters: Set<string>
  assigneeFilters: Set<string> // user_ids to filter by
  priorityFilters: Set<number> // priority levels to filter by
  statusFilters: Set<string> // status IDs to filter by
  dueDatePreset: string | null // 'today' | 'this_week' | 'overdue' | 'no_date'
  keyword: string // search keyword matching title and description
  filterMode: LabelFilterMode
  loading: boolean
  error: string | null
}

interface LabelActions {
  hydrateLabels(projectId: string): Promise<void>
  hydrateAllLabels(): Promise<void>
  createLabel(input: CreateLabelInput): Promise<Label>
  updateLabel(id: string, input: UpdateLabelInput): Promise<Label | null>
  deleteLabel(id: string): Promise<boolean>
  removeFromProject(projectId: string, labelId: string): Promise<boolean>
  addToProject(projectId: string, labelId: string): Promise<void>
  reorderLabels(labelIds: string[]): Promise<void>
  toggleLabelFilter(labelId: string): void
  clearLabelFilters(): void
  setFilterMode(mode: LabelFilterMode): void
  toggleAssigneeFilter(userId: string): void
  togglePriorityFilter(priority: number): void
  toggleStatusFilter(statusId: string): void
  setDueDatePreset(preset: string | null): void
  setKeyword(keyword: string): void
  clearAllFilters(): void
  clearError(): void
}

export type LabelStore = LabelState & LabelActions

export const useLabelStore = createWithEqualityFn<LabelStore>((set) => ({
  labels: {},
  projectLabels: {},
  activeLabelFilters: new Set(),
  assigneeFilters: new Set(),
  priorityFilters: new Set(),
  statusFilters: new Set(),
  dueDatePreset: null,
  keyword: '',
  filterMode: 'hide' as LabelFilterMode,
  loading: false,
  error: null,

  async hydrateLabels(projectId: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      const labels = await window.api.labels.findByProjectId(projectId)
      set((state) => {
        const updated = { ...state.labels }
        const labelIdSet = new Set<string>()
        for (const label of labels) {
          updated[label.id] = label
          labelIdSet.add(label.id)
        }
        return {
          labels: updated,
          projectLabels: { ...state.projectLabels, [projectId]: labelIdSet },
          loading: false
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load labels'
      set({ error: message, loading: false })
    }
  },

  async hydrateAllLabels(): Promise<void> {
    try {
      const labels = await window.api.labels.findAll(getUserId())
      const labelMap: Record<string, Label> = {}
      for (const l of labels) {
        labelMap[l.id] = l
      }
      set((state) => ({ ...state, labels: labelMap }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load all labels'
      set({ error: message })
    }
  },

  async createLabel(input: CreateLabelInput): Promise<Label> {
    try {
      const label = await window.api.labels.create(input)
      // Re-hydrate all labels to get fresh order_index values
      const allLabels = await window.api.labels.findAll(getUserId())
      const labelMap: Record<string, Label> = {}
      for (const l of allLabels) {
        labelMap[l.id] = l
      }
      set((state) => {
        const updatedProjectLabels = { ...state.projectLabels }
        if (input.project_id) {
          const existing = new Set(updatedProjectLabels[input.project_id] ?? [])
          existing.add(label.id)
          updatedProjectLabels[input.project_id] = existing
        }
        return { labels: labelMap, projectLabels: updatedProjectLabels }
      })
      return label
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create label'
      set({ error: message })
      throw err
    }
  },

  async updateLabel(id: string, input: UpdateLabelInput): Promise<Label | null> {
    try {
      const label = await window.api.labels.update(id, input)
      if (label) {
        set((state) => ({
          labels: { ...state.labels, [label.id]: label }
        }))
      }
      return label
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update label'
      set({ error: message })
      throw err
    }
  },

  async deleteLabel(id: string): Promise<boolean> {
    try {
      const result = await window.api.labels.delete(id)
      if (result) {
        set((state) => {
          const { [id]: _, ...remaining } = state.labels
          const newFilters = new Set(state.activeLabelFilters)
          newFilters.delete(id)
          // Remove from all projectLabels
          const updatedProjectLabels: Record<string, Set<string>> = {}
          for (const [projId, labelIds] of Object.entries(state.projectLabels)) {
            const updated = new Set(labelIds)
            updated.delete(id)
            updatedProjectLabels[projId] = updated
          }
          return { labels: remaining, activeLabelFilters: newFilters, projectLabels: updatedProjectLabels }
        })
        // Remove deleted label from task labels in the task store
        const { useTaskStore } = await import('./taskStore')
        useTaskStore.setState((state) => {
          const updated: Record<string, Label[]> = {}
          for (const [taskId, labels] of Object.entries(state.taskLabels)) {
            updated[taskId] = labels.filter((l) => l.id !== id)
          }
          return { taskLabels: updated }
        })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete label'
      set({ error: message })
      throw err
    }
  },

  async removeFromProject(projectId: string, labelId: string): Promise<boolean> {
    try {
      const result = await window.api.labels.removeFromProject(projectId, labelId)
      if (result) {
        set((state) => {
          const updatedProjectLabels = { ...state.projectLabels }
          const existing = new Set(updatedProjectLabels[projectId] ?? [])
          existing.delete(labelId)
          updatedProjectLabels[projectId] = existing
          return { projectLabels: updatedProjectLabels }
        })
        // Remove label from task labels in the task store for this project
        const { useTaskStore } = await import('./taskStore')
        useTaskStore.setState((state) => {
          const updated: Record<string, Label[]> = {}
          for (const [taskId, labels] of Object.entries(state.taskLabels)) {
            updated[taskId] = labels.filter((l) => l.id !== labelId)
          }
          return { taskLabels: updated }
        })
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove label from project'
      set({ error: message })
      throw err
    }
  },

  async addToProject(projectId: string, labelId: string): Promise<void> {
    try {
      await window.api.labels.addToProject(projectId, labelId)
      set((state) => {
        const updatedProjectLabels = { ...state.projectLabels }
        const existing = new Set(updatedProjectLabels[projectId] ?? [])
        existing.add(labelId)
        updatedProjectLabels[projectId] = existing
        return { projectLabels: updatedProjectLabels }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add label to project'
      set({ error: message })
      throw err
    }
  },

  async reorderLabels(labelIds: string[]): Promise<void> {
    try {
      await window.api.labels.reorder(labelIds)
      set((state) => {
        const updated = { ...state.labels }
        for (let i = 0; i < labelIds.length; i++) {
          const label = updated[labelIds[i]]
          if (label) {
            updated[labelIds[i]] = { ...label, order_index: i }
          }
        }
        return { labels: updated }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reorder labels'
      set({ error: message })
      throw err
    }
  },

  toggleLabelFilter(labelId: string): void {
    set((state) => {
      const newFilters = new Set(state.activeLabelFilters)
      if (newFilters.has(labelId)) {
        newFilters.delete(labelId)
      } else {
        newFilters.add(labelId)
      }
      return { activeLabelFilters: newFilters }
    })
  },

  clearLabelFilters(): void {
    set({
      activeLabelFilters: new Set(),
      assigneeFilters: new Set(),
      priorityFilters: new Set(),
      statusFilters: new Set(),
      dueDatePreset: null,
      keyword: ''
    })
  },

  setFilterMode(mode: LabelFilterMode): void {
    set({ filterMode: mode })
  },

  toggleAssigneeFilter(userId: string): void {
    set((state) => {
      const next = new Set(state.assigneeFilters)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return { assigneeFilters: next }
    })
  },

  togglePriorityFilter(priority: number): void {
    set((state) => {
      const next = new Set(state.priorityFilters)
      if (next.has(priority)) {
        next.delete(priority)
      } else {
        next.add(priority)
      }
      return { priorityFilters: next }
    })
  },

  toggleStatusFilter(statusId: string): void {
    set((state) => {
      const next = new Set(state.statusFilters)
      if (next.has(statusId)) {
        next.delete(statusId)
      } else {
        next.add(statusId)
      }
      return { statusFilters: next }
    })
  },

  setDueDatePreset(preset: string | null): void {
    set({ dueDatePreset: preset })
  },

  setKeyword(keyword: string): void {
    set({ keyword })
  },

  clearAllFilters(): void {
    set({
      activeLabelFilters: new Set(),
      assigneeFilters: new Set(),
      priorityFilters: new Set(),
      statusFilters: new Set(),
      dueDatePreset: null,
      keyword: ''
    })
  },

  clearError(): void {
    set({ error: null })
  }
}), shallow)

// Selectors
export const selectLabelsByProject = (projectId: string) => (state: LabelState): Label[] => {
  const labelIds = state.projectLabels[projectId]
  if (!labelIds) return []
  return Array.from(labelIds)
    .map((id) => state.labels[id])
    .filter((l): l is Label => l !== undefined)
    .sort((a, b) => a.order_index - b.order_index)
}

export const selectAllLabels = (state: LabelState): Label[] =>
  Object.values(state.labels).sort((a, b) => a.order_index - b.order_index)

export const selectLabelById = (id: string) => (state: LabelState): Label | undefined =>
  state.labels[id]

export const selectActiveLabelFilters = (state: LabelState): Set<string> =>
  state.activeLabelFilters

export const selectHasActiveLabelFilters = (state: LabelState): boolean =>
  state.activeLabelFilters.size > 0

export const selectFilterMode = (state: LabelState): LabelFilterMode => state.filterMode

export const selectAssigneeFilters = (state: LabelState): Set<string> => state.assigneeFilters

export const selectHasAssigneeFilters = (state: LabelState): boolean => state.assigneeFilters.size > 0

export const selectPriorityFilters = (state: LabelState): Set<number> => state.priorityFilters

export const selectHasPriorityFilters = (state: LabelState): boolean => state.priorityFilters.size > 0

export const selectStatusFilters = (state: LabelState): Set<string> => state.statusFilters

export const selectHasStatusFilters = (state: LabelState): boolean => state.statusFilters.size > 0

export const selectDueDatePreset = (state: LabelState): string | null => state.dueDatePreset

export const selectKeyword = (state: LabelState): string => state.keyword

export const selectHasAnyFilter = (state: LabelState): boolean =>
  state.activeLabelFilters.size > 0 ||
  state.assigneeFilters.size > 0 ||
  state.priorityFilters.size > 0 ||
  state.statusFilters.size > 0 ||
  state.dueDatePreset !== null ||
  state.keyword !== ''

// Hooks — stable selectors for parameterized queries
export function useLabelsByProject(projectId: string): Label[] {
  const labels = useLabelStore((s) => s.labels)
  const projectLabels = useLabelStore((s) => s.projectLabels)
  const prevRef = useRef<Label[]>([])
  return useMemo(() => {
    const labelIds = projectLabels[projectId]
    if (!labelIds) return prevRef.current.length === 0 ? prevRef.current : []
    const next = Array.from(labelIds)
      .map((id) => labels[id])
      .filter((l): l is Label => l !== undefined)
      .sort((a, b) => a.order_index - b.order_index)
    if (next.length === prevRef.current.length && next.every((l, i) => l === prevRef.current[i])) {
      return prevRef.current
    }
    prevRef.current = next
    return next
  }, [labels, projectLabels, projectId])
}
