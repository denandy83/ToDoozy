import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { ProjectArea, CreateProjectAreaInput } from '../../../../shared/types'

interface ProjectAreaState {
  areas: ProjectArea[]
  loading: boolean
}

interface ProjectAreaActions {
  hydrate(userId: string): Promise<void>
  createArea(userId: string, name: string, color?: string): Promise<ProjectArea>
  updateArea(id: string, updates: { name?: string; color?: string; is_collapsed?: number }): Promise<void>
  deleteArea(id: string): Promise<void>
  reorderAreas(areaIds: string[]): Promise<void>
  assignProject(projectId: string, areaId: string | null): Promise<void>
  toggleCollapsed(id: string): void
}

export type ProjectAreaStore = ProjectAreaState & ProjectAreaActions

export const useProjectAreaStore = createWithEqualityFn<ProjectAreaStore>((set) => ({
  areas: [],
  loading: false,

  async hydrate(userId: string): Promise<void> {
    set({ loading: true })
    try {
      const areas = await window.api.projectAreas.findByUserId(userId)
      set({ areas, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  async createArea(userId: string, name: string, color?: string): Promise<ProjectArea> {
    const input: CreateProjectAreaInput = {
      id: crypto.randomUUID(),
      user_id: userId,
      name,
      color: color ?? '#888888',
      sidebar_order: useProjectAreaStore.getState().areas.length
    }
    const area = await window.api.projectAreas.create(input)
    set((state) => ({ areas: [...state.areas, area] }))
    return area
  },

  async updateArea(id: string, updates: { name?: string; color?: string; is_collapsed?: number }): Promise<void> {
    const result = await window.api.projectAreas.update(id, updates)
    if (result) {
      set((state) => ({
        areas: state.areas.map((a) => (a.id === id ? result : a))
      }))
    }
  },

  async deleteArea(id: string): Promise<void> {
    await window.api.projectAreas.delete(id)
    set((state) => ({ areas: state.areas.filter((a) => a.id !== id) }))
  },

  async reorderAreas(areaIds: string[]): Promise<void> {
    await window.api.projectAreas.reorder(areaIds)
    set((state) => {
      const updated = areaIds
        .map((id, i) => {
          const area = state.areas.find((a) => a.id === id)
          return area ? { ...area, sidebar_order: i } : null
        })
        .filter((a): a is ProjectArea => a !== null)
      return { areas: updated }
    })
  },

  async assignProject(projectId: string, areaId: string | null): Promise<void> {
    await window.api.projectAreas.assignProject(projectId, areaId)
  },

  toggleCollapsed(id: string): void {
    set((state) => {
      const areas = state.areas.map((a) => {
        if (a.id !== id) return a
        const newCollapsed = a.is_collapsed === 1 ? 0 : 1
        // Persist to DB
        window.api.projectAreas.update(id, { is_collapsed: newCollapsed })
        return { ...a, is_collapsed: newCollapsed }
      })
      return { areas }
    })
  }
}), shallow)

export const selectProjectAreas = (state: ProjectAreaState): ProjectArea[] => state.areas
