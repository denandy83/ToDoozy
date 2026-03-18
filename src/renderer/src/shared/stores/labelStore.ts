import { create } from 'zustand'
import type { Label, CreateLabelInput, UpdateLabelInput } from '../../../../shared/types'

interface LabelState {
  labels: Record<string, Label>
  activeLabelFilters: Set<string>
  loading: boolean
  error: string | null
}

interface LabelActions {
  hydrateLabels(projectId: string): Promise<void>
  createLabel(input: CreateLabelInput): Promise<Label>
  updateLabel(id: string, input: UpdateLabelInput): Promise<Label | null>
  deleteLabel(id: string): Promise<boolean>
  toggleLabelFilter(labelId: string): void
  clearLabelFilters(): void
  clearError(): void
}

export type LabelStore = LabelState & LabelActions

export const useLabelStore = create<LabelStore>((set) => ({
  labels: {},
  activeLabelFilters: new Set(),
  loading: false,
  error: null,

  async hydrateLabels(projectId: string): Promise<void> {
    set({ loading: true, error: null })
    try {
      const labels = await window.api.labels.findByProjectId(projectId)
      const labelMap: Record<string, Label> = {}
      for (const label of labels) {
        labelMap[label.id] = label
      }
      set({ labels: labelMap, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load labels'
      set({ error: message, loading: false })
    }
  },

  async createLabel(input: CreateLabelInput): Promise<Label> {
    try {
      const label = await window.api.labels.create(input)
      set((state) => ({
        labels: { ...state.labels, [label.id]: label }
      }))
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
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete label'
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

  clearError(): void {
    set({ error: null })
  }
}))

// Selectors
export const selectLabelsByProject = (projectId: string) => (state: LabelState): Label[] =>
  Object.values(state.labels).filter((l) => l.project_id === projectId)

export const selectLabelById = (id: string) => (state: LabelState): Label | undefined =>
  state.labels[id]

export const selectActiveLabelFilters = (state: LabelState): Set<string> =>
  state.activeLabelFilters

export const selectHasActiveLabelFilters = (state: LabelState): boolean =>
  state.activeLabelFilters.size > 0
