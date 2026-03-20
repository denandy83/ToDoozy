import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'

interface ContextMenuState {
  isOpen: boolean
  position: { x: number; y: number }
  taskId: string | null
  isBulk: boolean
  bulkTaskIds: string[]
}

interface ContextMenuActions {
  open(taskId: string, x: number, y: number): void
  openBulk(taskIds: string[], x: number, y: number): void
  close(): void
}

export type ContextMenuStore = ContextMenuState & ContextMenuActions

export const useContextMenuStore = createWithEqualityFn<ContextMenuStore>((set) => ({
  isOpen: false,
  position: { x: 0, y: 0 },
  taskId: null,
  isBulk: false,
  bulkTaskIds: [],

  open(taskId: string, x: number, y: number): void {
    set({ isOpen: true, position: { x, y }, taskId, isBulk: false, bulkTaskIds: [] })
  },

  openBulk(taskIds: string[], x: number, y: number): void {
    set({ isOpen: true, position: { x, y }, taskId: null, isBulk: true, bulkTaskIds: taskIds })
  },

  close(): void {
    set({ isOpen: false, taskId: null, isBulk: false, bulkTaskIds: [] })
  }
}), shallow)
