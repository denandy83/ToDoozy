import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { SavedView, CreateSavedViewInput } from '../../../../shared/types'
import { LABEL_AUTO_COLORS } from '../hooks/smartInputParser'
import { useViewStore } from './viewStore'

interface SavedViewState {
  views: SavedView[]
  viewCounts: Record<string, number>
  loading: boolean
  /** The filter_config of the currently active saved view (set on mount), used to detect dirty state */
  activeViewFilterConfig: string | null
}

interface SavedViewActions {
  hydrate(userId: string): Promise<void>
  hydrateCounts(userId: string): Promise<void>
  /**
   * Debounced (1s) recount of every saved view's matching-task count. Wired to
   * task mutations / Realtime / WAL events so sidebar counts refresh when a task
   * starts (or stops) matching a view's filter without needing an app restart.
   */
  scheduleRecount(userId: string): void
  setActiveViewFilterConfig(config: string | null): void
  setViewCount(viewId: string, count: number): void
  createView(userId: string, name: string, filterConfig: string, projectId?: string | null): Promise<SavedView>
  updateView(id: string, updates: { name?: string; color?: string; filter_config?: string }): Promise<void>
  deleteView(id: string): Promise<void>
  reorderViews(viewIds: string[]): Promise<void>
}

export type SavedViewStore = SavedViewState & SavedViewActions

/** Debounce handle for scheduleRecount — module-level so rapid mutations coalesce. */
let recountTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Recompute matching-task counts for every saved view via one indexed SQL
 * COUNT per view. When `skipViewId` is set, that view's existing count is
 * preserved instead of recomputed — used by scheduleRecount so the currently
 * open saved view (which keeps its own count live from the rendered task list,
 * and may carry unsaved filter edits) isn't clobbered by the saved-config count.
 */
async function recomputeCounts(userId: string, skipViewId: string | null): Promise<void> {
  const { views, viewCounts } = useSavedViewStore.getState()
  const counts: Record<string, number> = {}
  for (const view of views) {
    if (view.id === skipViewId) {
      if (viewCounts[view.id] !== undefined) counts[view.id] = viewCounts[view.id]
      continue
    }
    try {
      counts[view.id] = await window.api.savedViews.countMatching(view.filter_config, userId)
    } catch {
      counts[view.id] = 0
    }
  }
  useSavedViewStore.setState({ viewCounts: counts })
}

export const useSavedViewStore = createWithEqualityFn<SavedViewStore>((set) => ({
  views: [],
  viewCounts: {},
  loading: false,
  activeViewFilterConfig: null,

  async hydrate(userId: string): Promise<void> {
    set({ loading: true })
    try {
      const views = await window.api.savedViews.findByUserId(userId)
      set({ views, loading: false })
      // Hydrate counts in background
      useSavedViewStore.getState().hydrateCounts(userId)
    } catch {
      set({ loading: false })
    }
  },

  async hydrateCounts(userId: string): Promise<void> {
    // Explicit recount of every view (app start, view-unmount cleanup, save).
    await recomputeCounts(userId, null)
  },

  scheduleRecount(userId: string): void {
    if (recountTimer) clearTimeout(recountTimer)
    recountTimer = setTimeout(() => {
      recountTimer = null
      // Skip the currently open saved view: it maintains its own count live
      // from the rendered task list and may have unsaved filter edits whose
      // count must not be overwritten by the saved-config SQL count. Its
      // unmount cleanup re-runs hydrateCounts to settle on the saved value.
      const view = useViewStore.getState()
      const skipId = view.currentView === 'saved-view' ? view.selectedSavedViewId : null
      void recomputeCounts(userId, skipId)
    }, 1000)
  },

  async createView(userId: string, name: string, filterConfig: string, projectId?: string | null): Promise<SavedView> {
    // Auto-assign next available color
    const existingColors = new Set(useSavedViewStore.getState().views.map((v) => v.color))
    let autoColor: string = LABEL_AUTO_COLORS[0]
    for (const c of LABEL_AUTO_COLORS) {
      if (!existingColors.has(c)) { autoColor = c; break }
    }
    // If all used, cycle based on count
    if (existingColors.has(autoColor) && existingColors.size >= LABEL_AUTO_COLORS.length) {
      autoColor = LABEL_AUTO_COLORS[useSavedViewStore.getState().views.length % LABEL_AUTO_COLORS.length]
    }
    const input: CreateSavedViewInput = {
      id: crypto.randomUUID(),
      user_id: userId,
      name,
      color: autoColor,
      filter_config: filterConfig,
      project_id: projectId ?? null,
      sidebar_order: useSavedViewStore.getState().views.length
    }
    const view = await window.api.savedViews.create(input)
    set((state) => ({ views: [...state.views, view] }))
    // Push to Supabase
    import('../../services/PersonalSyncService').then(({ pushSavedView }) => {
      pushSavedView(view).catch(() => {})
    })
    return view
  },

  async updateView(id: string, updates: { name?: string; color?: string; filter_config?: string }): Promise<void> {
    const result = await window.api.savedViews.update(id, updates)
    if (result) {
      set((state) => ({
        views: state.views.map((v) => (v.id === id ? result : v))
      }))
      // Push to Supabase
      import('../../services/PersonalSyncService').then(({ pushSavedView }) => {
        pushSavedView(result).catch(() => {})
      })
    }
  },

  async deleteView(id: string): Promise<void> {
    await window.api.savedViews.delete(id)
    set((state) => ({ views: state.views.filter((v) => v.id !== id) }))
    // Delete from Supabase
    import('../../services/PersonalSyncService').then(({ deleteSavedViewFromSupabase }) => {
      deleteSavedViewFromSupabase(id).catch(() => {})
    })
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
      // Push reordered views to Supabase
      import('../../services/PersonalSyncService').then(({ pushSavedView }) => {
        for (const view of updated) {
          pushSavedView(view).catch(() => {})
        }
      })
      return { views: updated }
    })
  },

  setActiveViewFilterConfig(config: string | null): void {
    set({ activeViewFilterConfig: config })
  },

  setViewCount(viewId: string, count: number): void {
    set((state) => ({
      viewCounts: { ...state.viewCounts, [viewId]: count }
    }))
  }
}), shallow)

export const selectSavedViews = (state: SavedViewState): SavedView[] => state.views
export const selectViewCounts = (state: SavedViewState): Record<string, number> => state.viewCounts
