import { useMemo, useRef } from 'react'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { Label, CreateLabelInput, UpdateLabelInput } from '../../../../shared/types'

export type LabelFilterMode = 'hide' | 'blur'

interface LabelState {
  labels: Record<string, Label>
  activeLabelFilters: Set<string>
  filterMode: LabelFilterMode
  loading: boolean
  error: string | null
}

interface LabelActions {
  hydrateLabels(projectId: string): Promise<void>
  createLabel(input: CreateLabelInput): Promise<Label>
  updateLabel(id: string, input: UpdateLabelInput): Promise<Label | null>
  deleteLabel(id: string): Promise<boolean>
  reorderLabels(labelIds: string[]): Promise<void>
  toggleLabelFilter(labelId: string): void
  clearLabelFilters(): void
  setFilterMode(mode: LabelFilterMode): void
  clearError(): void
}

export type LabelStore = LabelState & LabelActions

export const useLabelStore = createWithEqualityFn<LabelStore>((set) => ({
  labels: {},
  activeLabelFilters: new Set(),
  filterMode: 'hide' as LabelFilterMode,
  loading: false,
  error: null,

  async hydrateLabels(projectId: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      const labels = await window.api.labels.findByProjectId(projectId)
      set((state) => {
        const updated: Record<string, Label> = {}
        for (const [id, l] of Object.entries(state.labels)) {
          if (l.project_id !== projectId) updated[id] = l
        }
        for (const label of labels) {
          updated[label.id] = label
        }
        return { labels: updated, loading: false }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load labels'
      set({ error: message, loading: false })
    }
  },

  async createLabel(input: CreateLabelInput): Promise<Label> {
    try {
      const label = await window.api.labels.create(input)
      // Re-hydrate all labels to get fresh order_index values
      // (create shifts existing labels in the database)
      const allLabels = await window.api.labels.findByProjectId(input.project_id)
      const labelMap: Record<string, Label> = {}
      for (const l of allLabels) {
        labelMap[l.id] = l
      }
      set({ labels: labelMap })
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
          return { labels: remaining, activeLabelFilters: newFilters }
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
    set({ activeLabelFilters: new Set() })
  },

  setFilterMode(mode: LabelFilterMode): void {
    set({ filterMode: mode })
  },

  clearError(): void {
    set({ error: null })
  }
}), shallow)

// Selectors
export const selectLabelsByProject = (projectId: string) => (state: LabelState): Label[] =>
  Object.values(state.labels).filter((l) => l.project_id === projectId)

export const selectLabelById = (id: string) => (state: LabelState): Label | undefined =>
  state.labels[id]

export const selectActiveLabelFilters = (state: LabelState): Set<string> =>
  state.activeLabelFilters

export const selectHasActiveLabelFilters = (state: LabelState): boolean =>
  state.activeLabelFilters.size > 0

export const selectFilterMode = (state: LabelState): LabelFilterMode => state.filterMode

// Hooks — stable selectors for parameterized queries
export function useLabelsByProject(projectId: string): Label[] {
  const labels = useLabelStore((s) => s.labels)
  const prevRef = useRef<Label[]>([])
  return useMemo(() => {
    const next = Object.values(labels).filter((l) => l.project_id === projectId)
    if (next.length === prevRef.current.length && next.every((l, i) => l === prevRef.current[i])) {
      return prevRef.current
    }
    prevRef.current = next
    return next
  }, [labels, projectId])
}
