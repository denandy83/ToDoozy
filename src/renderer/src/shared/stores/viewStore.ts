import { create } from 'zustand'

export type ViewId = 'my-day' | 'backlog' | 'archive' | 'templates'

interface ViewState {
  currentView: ViewId
  sidebarPinned: boolean
  sidebarExpanded: boolean
  sidebarWidth: number
}

interface ViewActions {
  setView(view: ViewId): void
  nextView(): void
  prevView(): void
  setSidebarPinned(pinned: boolean): void
  toggleSidebarPinned(): void
  setSidebarExpanded(expanded: boolean): void
  setSidebarWidth(width: number): void
}

export type ViewStore = ViewState & ViewActions

const VIEW_ORDER: ViewId[] = ['my-day', 'backlog', 'archive', 'templates']

export const useViewStore = create<ViewStore>((set, get) => ({
  currentView: 'backlog',
  sidebarPinned: true,
  sidebarExpanded: true,
  sidebarWidth: 224, // 56 * 4 = w-56

  setView(view: ViewId): void {
    set({ currentView: view })
  },

  nextView(): void {
    const { currentView } = get()
    const idx = VIEW_ORDER.indexOf(currentView)
    const next = VIEW_ORDER[(idx + 1) % VIEW_ORDER.length]
    set({ currentView: next })
  },

  prevView(): void {
    const { currentView } = get()
    const idx = VIEW_ORDER.indexOf(currentView)
    const prev = VIEW_ORDER[(idx - 1 + VIEW_ORDER.length) % VIEW_ORDER.length]
    set({ currentView: prev })
  },

  setSidebarPinned(pinned: boolean): void {
    set({ sidebarPinned: pinned, sidebarExpanded: pinned })
  },

  toggleSidebarPinned(): void {
    const { sidebarPinned } = get()
    set({ sidebarPinned: !sidebarPinned, sidebarExpanded: !sidebarPinned })
  },

  setSidebarExpanded(expanded: boolean): void {
    set({ sidebarExpanded: expanded })
  },

  setSidebarWidth(width: number): void {
    set({ sidebarWidth: Math.max(120, Math.min(600, width)) })
  }
}))

// Selectors
export const selectCurrentView = (state: ViewState): ViewId => state.currentView
export const selectSidebarPinned = (state: ViewState): boolean => state.sidebarPinned
export const selectSidebarExpanded = (state: ViewState): boolean => state.sidebarExpanded
export const selectSidebarWidth = (state: ViewState): number => state.sidebarWidth
