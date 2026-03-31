import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'

interface CommandPaletteState {
  isOpen: boolean
  query: string
  selectedIndex: number
  includeArchived: boolean
}

interface CommandPaletteActions {
  open(): void
  close(): void
  setQuery(query: string): void
  setSelectedIndex(index: number): void
  setIncludeArchived(value: boolean): void
}

export type CommandPaletteStore = CommandPaletteState & CommandPaletteActions

export const useCommandPaletteStore = createWithEqualityFn<CommandPaletteStore>((set) => ({
  isOpen: false,
  query: '',
  selectedIndex: 0,
  includeArchived: false,

  open(): void {
    set({ isOpen: true, query: '', selectedIndex: 0, includeArchived: false })
  },

  close(): void {
    set({ isOpen: false, query: '', selectedIndex: 0, includeArchived: false })
  },

  setQuery(query: string): void {
    set({ query, selectedIndex: 0 })
  },

  setSelectedIndex(index: number): void {
    set({ selectedIndex: index })
  },

  setIncludeArchived(value: boolean): void {
    set({ includeArchived: value, selectedIndex: 0 })
  }
}), shallow)
