import { useMemo, useRef } from 'react'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { Label, CreateLabelInput, UpdateLabelInput } from '../../../../shared/types'
import { useAuthStore } from './authStore'
import type { SortRule } from '../utils/sortTasks'

function getUserId(): string {
  return useAuthStore.getState().currentUser?.id ?? ''
}

export type LabelFilterMode = 'hide' | 'blur'

export interface DueDateRange {
  mode: 'relative' | 'absolute'
  fromOffset?: number   // relative: days from today (negative = past)
  toOffset?: number     // relative: days from today (optional, omit = open-ended)
  fromDate?: string     // absolute: ISO date string
  toDate?: string       // absolute: ISO date string (optional)
}

interface LabelState {
  labels: Record<string, Label>
  projectLabels: Record<string, Set<string>> // projectId -> Set<labelId>
  activeLabelFilters: Set<string>
  assigneeFilters: Set<string> // user_ids to filter by
  priorityFilters: Set<number> // priority levels to filter by
  statusFilters: Set<string> // status IDs to filter by
  projectFilters: Set<string> // project IDs to filter by (for saved views)
  // Exclusion filters — "is not" counterparts
  excludeLabelFilters: Set<string>
  excludeStatusFilters: Set<string>
  excludePriorityFilters: Set<number>
  excludeAssigneeFilters: Set<string>
  excludeProjectFilters: Set<string>
  labelFilterLogic: 'any' | 'all' // 'any' = OR, 'all' = AND (default)
  dueDatePreset: string | null // 'today' | 'this_week' | 'overdue' | 'no_date'
  dueDateRange: DueDateRange | null // custom date range (relative or absolute)
  keyword: string // search keyword matching title and description
  filterMode: LabelFilterMode
  sortRules: SortRule[]
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
  toggleExcludeLabelFilter(labelId: string): void
  toggleExcludeStatusFilter(statusId: string): void
  toggleExcludePriorityFilter(priority: number): void
  toggleExcludeAssigneeFilter(userId: string): void
  toggleExcludeProjectFilter(projectId: string): void
  clearExcludeLabelFilters(): void
  clearExcludeStatusFilters(): void
  clearExcludePriorityFilters(): void
  clearExcludeAssigneeFilters(): void
  clearExcludeProjectFilters(): void
  clearLabelFilters(): void
  setLabelFilterLogic(logic: 'any' | 'all'): void
  setFilterMode(mode: LabelFilterMode): void
  toggleAssigneeFilter(userId: string): void
  togglePriorityFilter(priority: number): void
  toggleStatusFilter(statusId: string): void
  toggleProjectFilter(projectId: string): void
  setDueDatePreset(preset: string | null): void
  setDueDateRange(range: DueDateRange | null): void
  setKeyword(keyword: string): void
  setSortRules(rules: SortRule[]): void
  clearSort(): void
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
  projectFilters: new Set(),
  excludeLabelFilters: new Set(),
  excludeStatusFilters: new Set(),
  excludePriorityFilters: new Set(),
  excludeAssigneeFilters: new Set(),
  excludeProjectFilters: new Set(),
  labelFilterLogic: 'all' as const,
  dueDatePreset: null,
  dueDateRange: null,
  keyword: '',
  filterMode: 'hide' as LabelFilterMode,
  sortRules: [],
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
      // Push to Supabase
      import('../../services/PersonalSyncService').then(({ pushLabel }) => {
        pushLabel(label, getUserId()).catch(() => {})
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
        // Push to Supabase
        import('../../services/PersonalSyncService').then(({ pushLabel }) => {
          pushLabel(label, getUserId()).catch(() => {})
        })
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
        // Delete from Supabase
        import('../../services/PersonalSyncService').then(({ deleteLabelFromSupabase }) => {
          deleteLabelFromSupabase(id).catch(() => {})
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
        // Tombstone the junction row on Supabase so other devices see the unlink.
        const { pushProjectLabel } = await import('../../services/PersonalSyncService')
        void pushProjectLabel(projectId, labelId, new Date().toISOString())
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
      // Push the junction row to Supabase so other devices see the link.
      const { pushProjectLabel } = await import('../../services/PersonalSyncService')
      void pushProjectLabel(projectId, labelId, null)
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
        // Push reordered labels to Supabase
        const userId = getUserId()
        if (userId) {
          import('../../services/PersonalSyncService').then(({ pushLabel }) => {
            for (const id of labelIds) {
              const label = updated[id]
              if (label) pushLabel(label, userId).catch(() => {})
            }
          })
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
      const newExclude = new Set(state.excludeLabelFilters)
      if (newFilters.has(labelId)) {
        newFilters.delete(labelId)
      } else {
        newFilters.add(labelId)
        newExclude.delete(labelId) // last-action-wins: remove from exclude
      }
      return { activeLabelFilters: newFilters, excludeLabelFilters: newExclude }
    })
  },

  toggleExcludeLabelFilter(labelId: string): void {
    set((state) => {
      const newExclude = new Set(state.excludeLabelFilters)
      const newInclude = new Set(state.activeLabelFilters)
      if (newExclude.has(labelId)) {
        newExclude.delete(labelId)
      } else {
        newExclude.add(labelId)
        newInclude.delete(labelId) // last-action-wins: remove from include
      }
      return { excludeLabelFilters: newExclude, activeLabelFilters: newInclude }
    })
  },

  toggleExcludeStatusFilter(statusId: string): void {
    set((state) => {
      const newExclude = new Set(state.excludeStatusFilters)
      const newInclude = new Set(state.statusFilters)
      if (newExclude.has(statusId)) {
        newExclude.delete(statusId)
      } else {
        newExclude.add(statusId)
        newInclude.delete(statusId)
      }
      return { excludeStatusFilters: newExclude, statusFilters: newInclude }
    })
  },

  toggleExcludePriorityFilter(priority: number): void {
    set((state) => {
      const newExclude = new Set(state.excludePriorityFilters)
      const newInclude = new Set(state.priorityFilters)
      if (newExclude.has(priority)) {
        newExclude.delete(priority)
      } else {
        newExclude.add(priority)
        newInclude.delete(priority)
      }
      return { excludePriorityFilters: newExclude, priorityFilters: newInclude }
    })
  },

  toggleExcludeAssigneeFilter(userId: string): void {
    set((state) => {
      const newExclude = new Set(state.excludeAssigneeFilters)
      const newInclude = new Set(state.assigneeFilters)
      if (newExclude.has(userId)) {
        newExclude.delete(userId)
      } else {
        newExclude.add(userId)
        newInclude.delete(userId)
      }
      return { excludeAssigneeFilters: newExclude, assigneeFilters: newInclude }
    })
  },

  toggleExcludeProjectFilter(projectId: string): void {
    set((state) => {
      const newExclude = new Set(state.excludeProjectFilters)
      const newInclude = new Set(state.projectFilters)
      if (newExclude.has(projectId)) {
        newExclude.delete(projectId)
      } else {
        newExclude.add(projectId)
        newInclude.delete(projectId)
      }
      return { excludeProjectFilters: newExclude, projectFilters: newInclude }
    })
  },

  clearExcludeLabelFilters(): void {
    set({ excludeLabelFilters: new Set() })
  },

  clearExcludeStatusFilters(): void {
    set({ excludeStatusFilters: new Set() })
  },

  clearExcludePriorityFilters(): void {
    set({ excludePriorityFilters: new Set() })
  },

  clearExcludeAssigneeFilters(): void {
    set({ excludeAssigneeFilters: new Set() })
  },

  clearExcludeProjectFilters(): void {
    set({ excludeProjectFilters: new Set() })
  },

  clearLabelFilters(): void {
    set({
      activeLabelFilters: new Set(),
      assigneeFilters: new Set(),
      priorityFilters: new Set(),
      statusFilters: new Set(),
      projectFilters: new Set(),
      excludeLabelFilters: new Set(),
      excludeStatusFilters: new Set(),
      excludePriorityFilters: new Set(),
      excludeAssigneeFilters: new Set(),
      excludeProjectFilters: new Set(),
      dueDatePreset: null,
      dueDateRange: null,
      keyword: '',
      labelFilterLogic: 'all'
    })
  },

  setLabelFilterLogic(logic: 'any' | 'all'): void {
    set({ labelFilterLogic: logic })
  },

  setFilterMode(mode: LabelFilterMode): void {
    set({ filterMode: mode })
  },

  toggleAssigneeFilter(userId: string): void {
    set((state) => {
      const next = new Set(state.assigneeFilters)
      const nextExclude = new Set(state.excludeAssigneeFilters)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
        nextExclude.delete(userId)
      }
      return { assigneeFilters: next, excludeAssigneeFilters: nextExclude }
    })
  },

  togglePriorityFilter(priority: number): void {
    set((state) => {
      const next = new Set(state.priorityFilters)
      const nextExclude = new Set(state.excludePriorityFilters)
      if (next.has(priority)) {
        next.delete(priority)
      } else {
        next.add(priority)
        nextExclude.delete(priority)
      }
      return { priorityFilters: next, excludePriorityFilters: nextExclude }
    })
  },

  toggleStatusFilter(statusId: string): void {
    set((state) => {
      const next = new Set(state.statusFilters)
      const nextExclude = new Set(state.excludeStatusFilters)
      if (next.has(statusId)) {
        next.delete(statusId)
      } else {
        next.add(statusId)
        nextExclude.delete(statusId)
      }
      return { statusFilters: next, excludeStatusFilters: nextExclude }
    })
  },

  toggleProjectFilter(projectId: string): void {
    set((state) => {
      const next = new Set(state.projectFilters)
      const nextExclude = new Set(state.excludeProjectFilters)
      if (next.has(projectId)) { next.delete(projectId) } else { next.add(projectId); nextExclude.delete(projectId) }
      return { projectFilters: next, excludeProjectFilters: nextExclude }
    })
  },

  setDueDatePreset(preset: string | null): void {
    set({ dueDatePreset: preset, dueDateRange: null })
  },

  setDueDateRange(range: DueDateRange | null): void {
    set({ dueDateRange: range, dueDatePreset: null })
  },

  setKeyword(keyword: string): void {
    set({ keyword })
  },

  setSortRules(rules: SortRule[]): void {
    set({ sortRules: rules })
  },

  clearSort(): void {
    set({ sortRules: [] })
  },

  clearAllFilters(): void {
    set({
      activeLabelFilters: new Set(),
      assigneeFilters: new Set(),
      priorityFilters: new Set(),
      statusFilters: new Set(),
      projectFilters: new Set(),
      excludeLabelFilters: new Set(),
      excludeStatusFilters: new Set(),
      excludePriorityFilters: new Set(),
      excludeAssigneeFilters: new Set(),
      excludeProjectFilters: new Set(),
      dueDatePreset: null,
      dueDateRange: null,
      keyword: '',
      labelFilterLogic: 'all',
      sortRules: []
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

export const selectProjectFilters = (state: LabelState): Set<string> => state.projectFilters

export const selectHasProjectFilters = (state: LabelState): boolean => state.projectFilters.size > 0

export const selectDueDatePreset = (state: LabelState): string | null => state.dueDatePreset

export const selectDueDateRange = (state: LabelState): DueDateRange | null => state.dueDateRange

export const selectKeyword = (state: LabelState): string => state.keyword

export const selectExcludeLabelFilters = (state: LabelState): Set<string> => state.excludeLabelFilters
export const selectHasExcludeLabelFilters = (state: LabelState): boolean => state.excludeLabelFilters.size > 0
export const selectExcludeStatusFilters = (state: LabelState): Set<string> => state.excludeStatusFilters
export const selectHasExcludeStatusFilters = (state: LabelState): boolean => state.excludeStatusFilters.size > 0
export const selectExcludePriorityFilters = (state: LabelState): Set<number> => state.excludePriorityFilters
export const selectHasExcludePriorityFilters = (state: LabelState): boolean => state.excludePriorityFilters.size > 0
export const selectExcludeAssigneeFilters = (state: LabelState): Set<string> => state.excludeAssigneeFilters
export const selectHasExcludeAssigneeFilters = (state: LabelState): boolean => state.excludeAssigneeFilters.size > 0
export const selectExcludeProjectFilters = (state: LabelState): Set<string> => state.excludeProjectFilters
export const selectHasExcludeProjectFilters = (state: LabelState): boolean => state.excludeProjectFilters.size > 0

export const selectLabelFilterLogic = (state: LabelState): 'any' | 'all' => state.labelFilterLogic

export const selectSortRules = (state: LabelState): SortRule[] => state.sortRules
export const selectHasSort = (state: LabelState): boolean => state.sortRules.length > 0

export const selectHasAnyFilter = (state: LabelState): boolean =>
  state.activeLabelFilters.size > 0 ||
  state.assigneeFilters.size > 0 ||
  state.priorityFilters.size > 0 ||
  state.statusFilters.size > 0 ||
  state.projectFilters.size > 0 ||
  state.excludeLabelFilters.size > 0 ||
  state.excludeStatusFilters.size > 0 ||
  state.excludePriorityFilters.size > 0 ||
  state.excludeAssigneeFilters.size > 0 ||
  state.excludeProjectFilters.size > 0 ||
  state.dueDatePreset !== null ||
  state.dueDateRange !== null ||
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
