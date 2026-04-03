import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { SavedView, CreateSavedViewInput } from '../../../../shared/types'

interface SavedViewState {
  views: SavedView[]
  loading: boolean
}

interface SavedViewActions {
  hydrate(userId: string): Promise<void>
  createView(userId: string, name: string, filterConfig: string, projectId?: string | null): Promise<SavedView>
  updateView(id: string, updates: { name?: string; color?: string; filter_config?: string }): Promise<void>
  deleteView(id: string): Promise<void>
  reorderViews(viewIds: string[]): Promise<void>
}

export type SavedViewStore = SavedViewState & SavedViewActions

export const useSavedViewStore = createWithEqualityFn<SavedViewStore>((set) => ({
  views: [],
  loading: false,

  async hydrate(userId: string): Promise<void> {
    set({ loading: true })
    try {
      const views = await window.api.savedViews.findByUserId(userId)
      set({ views, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  async createView(userId: string, name: string, filterConfig: string, projectId?: string | null): Promise<SavedView> {
    const input: CreateSavedViewInput = {
      id: crypto.randomUUID(),
      user_id: userId,
      name,
      filter_config: filterConfig,
      project_id: projectId ?? null,
      sidebar_order: useSavedViewStore.getState().views.length
    }
    const view = await window.api.savedViews.create(input)
    set((state) => ({ views: [...state.views, view] }))
    return view
  },

  async updateView(id: string, updates: { name?: string; color?: string; filter_config?: string }): Promise<void> {
    const result = await window.api.savedViews.update(id, updates)
    if (result) {
      set((state) => ({
        views: state.views.map((v) => (v.id === id ? result : v))
      }))
    }
  },

  async deleteView(id: string): Promise<void> {
    await window.api.savedViews.delete(id)
    set((state) => ({ views: state.views.filter((v) => v.id !== id) }))
  },

  async reorderViews(viewIds: string[]): Promise<void> {
    await window.api.savedViews.reorder(viewIds)
    set((state) => {
      const updated = viewIds
        .map((id, i) => {
          const view = state.views.find((v) => v.id === id)
          return view ? { ...view, sidebar_order: i } : null
        })
        .filter((v): v is SavedView => v !== null)
      return { views: updated }
    })
  }
}), shallow)

export const selectSavedViews = (state: SavedViewState): SavedView[] => state.views
