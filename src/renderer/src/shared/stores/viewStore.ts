import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'

export type ViewId = 'my-day' | 'backlog' | 'archive' | 'templates'
export type DetailPanelPosition = 'side' | 'bottom'
export type LayoutMode = 'list' | 'kanban'

interface ViewState {
  currentView: ViewId
  layoutMode: LayoutMode
  sidebarPinned: boolean
  sidebarExpanded: boolean
  sidebarWidth: number
  detailPanelPosition: DetailPanelPosition
  detailPanelSize: number
}

interface ViewActions {
  setView(view: ViewId): void
  toggleLayoutMode(): void
  nextView(): void
  prevView(): void
  setSidebarPinned(pinned: boolean): void
  toggleSidebarPinned(): void
  setSidebarExpanded(expanded: boolean): void
  setSidebarWidth(width: number): void
  setDetailPanelPosition(position: DetailPanelPosition): void
  toggleDetailPanelPosition(): void
  setDetailPanelSize(size: number): void
}

export type ViewStore = ViewState & ViewActions

const VIEW_ORDER: ViewId[] = ['my-day', 'backlog', 'archive', 'templates']

export const useViewStore = createWithEqualityFn<ViewStore>((set, get) => ({
  currentView: 'backlog',
  layoutMode: 'list' as LayoutMode,
  sidebarPinned: true,
  sidebarExpanded: true,
  sidebarWidth: 224, // 56 * 4 = w-56
  detailPanelPosition: 'side' as DetailPanelPosition,
  detailPanelSize: 400,

  setView(view: ViewId): void {
    set({ currentView: view })
  },

  toggleLayoutMode(): void {
    const { layoutMode } = get()
    set({ layoutMode: layoutMode === 'list' ? 'kanban' : 'list' })
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
  },

  setDetailPanelPosition(position: DetailPanelPosition): void {
    set({ detailPanelPosition: position })
  },

  toggleDetailPanelPosition(): void {
    const { detailPanelPosition } = get()
    set({
      detailPanelPosition: detailPanelPosition === 'side' ? 'bottom' : 'side',
      detailPanelSize: 400
    })
  },

  setDetailPanelSize(size: number): void {
    set({ detailPanelSize: Math.max(200, Math.min(800, size)) })
  }
}), shallow)

// Selectors
export const selectCurrentView = (state: ViewState): ViewId => state.currentView
export const selectSidebarPinned = (state: ViewState): boolean => state.sidebarPinned
export const selectSidebarExpanded = (state: ViewState): boolean => state.sidebarExpanded
export const selectSidebarWidth = (state: ViewState): number => state.sidebarWidth
export const selectDetailPanelPosition = (state: ViewState): DetailPanelPosition =>
  state.detailPanelPosition
export const selectDetailPanelSize = (state: ViewState): number => state.detailPanelSize
export const selectLayoutMode = (state: ViewState): LayoutMode => state.layoutMode
