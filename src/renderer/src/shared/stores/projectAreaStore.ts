import { captureSyncProducer, requireProducerCurrent } from '../../services/syncContext'
import { hydrationContext } from './hydrationContext'
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
    const { api, isCurrent } = hydrationContext()
    set({ loading: true })
    try {
      const areas = await api.projectAreas.findByUserId(userId)
      if (!await isCurrent()) return
      set({ areas, loading: false })
    } catch {
      if (!await isCurrent()) return
      set({ loading: false })
    }
  },

  async createArea(userId: string, name: string, color?: string): Promise<ProjectArea> {
    const origin = captureSyncProducer()
    const input: CreateProjectAreaInput = {
      id: crypto.randomUUID(),
      user_id: userId,
      name,
      color: color ?? '#888888',
      sidebar_order: useProjectAreaStore.getState().areas.length
    }
    const area = await origin.api.projectAreas.create(input)
    await requireProducerCurrent(origin)
    set((state) => ({ areas: [...state.areas, area] }))
    // Push to Supabase
    import('../../services/PersonalSyncService').then(({ pushProjectArea }) => {
      pushProjectArea({ ...area, user_id: userId }, origin).catch(() => {})
    })
    return area
  },

  async updateArea(id: string, updates: { name?: string; color?: string; is_collapsed?: number }): Promise<void> {
    const origin = captureSyncProducer()
    const result = await origin.api.projectAreas.update(id, updates)
    await requireProducerCurrent(origin)
    if (result) {
      set((state) => ({
        areas: state.areas.map((a) => (a.id === id ? result : a))
      }))
      // Push to Supabase
      import('../../services/PersonalSyncService').then(({ pushProjectArea }) => {
        pushProjectArea({ ...result, user_id: result.user_id }, origin).catch(() => {})
      })
    }
  },

  async deleteArea(id: string): Promise<void> {
    const origin = captureSyncProducer()
    await origin.api.projectAreas.delete(id)
    await requireProducerCurrent(origin)
    set((state) => ({ areas: state.areas.filter((a) => a.id !== id) }))
    // Delete from Supabase
    import('../../services/PersonalSyncService').then(({ deleteProjectAreaFromSupabase }) => {
      deleteProjectAreaFromSupabase(id, origin).catch(() => {})
    })
  },

  async reorderAreas(areaIds: string[]): Promise<void> {
    const origin = captureSyncProducer()
    await origin.api.projectAreas.reorder(areaIds)
    await requireProducerCurrent(origin)
    set((state) => {
      const updated = areaIds
        .map((id, i) => {
          const area = state.areas.find((a) => a.id === id)
          return area ? { ...area, sidebar_order: i } : null
        })
        .filter((a): a is ProjectArea => a !== null)
      // Push reordered areas to Supabase
      import('../../services/PersonalSyncService').then(({ pushProjectArea }) => {
        for (const area of updated) {
          pushProjectArea({ ...area, user_id: area.user_id }, origin).catch(() => {})
        }
      })
      return { areas: updated }
    })
  },

  async assignProject(projectId: string, areaId: string | null): Promise<void> {
    const origin = captureSyncProducer()
    await origin.api.projectAreas.assignProject(projectId, areaId)
    // Sync the updated project to Supabase (area_id changed)
    const project = await origin.api.projects.findById(projectId)
    await requireProducerCurrent(origin)
    if (project) {
      import('../../services/PersonalSyncService').then(({ pushProject }) => {
        pushProject(project, origin).catch((err) => console.error('[ProjectAreaStore] pushProject failed:', err))
      })
    }
  },

  toggleCollapsed(id: string): void {
    const area = useProjectAreaStore.getState().areas.find((item) => item.id === id)
    if (!area) return
    void useProjectAreaStore.getState().updateArea(id, { is_collapsed: area.is_collapsed === 1 ? 0 : 1 }).catch(() => {})
  }
}), shallow)

export const selectProjectAreas = (state: ProjectAreaState): ProjectArea[] => state.areas
