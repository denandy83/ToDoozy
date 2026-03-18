import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'

interface ContextMenuState {
  isOpen: boolean
  position: { x: number; y: number }
  taskId: string | null
}

interface ContextMenuActions {
  open(taskId: string, x: number, y: number): void
  close(): void
}

export type ContextMenuStore = ContextMenuState & ContextMenuActions

export const useContextMenuStore = createWithEqualityFn<ContextMenuStore>((set) => ({
  isOpen: false,
  position: { x: 0, y: 0 },
  taskId: null,

  open(taskId: string, x: number, y: number): void {
    set({ isOpen: true, position: { x, y }, taskId })
  },

  close(): void {
    set({ isOpen: false, taskId: null })
  }
}), shallow)
