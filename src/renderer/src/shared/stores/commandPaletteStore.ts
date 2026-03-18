import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'

interface CommandPaletteState {
  isOpen: boolean
  query: string
  selectedIndex: number
}

interface CommandPaletteActions {
  open(): void
  close(): void
  setQuery(query: string): void
  setSelectedIndex(index: number): void
}

export type CommandPaletteStore = CommandPaletteState & CommandPaletteActions

export const useCommandPaletteStore = createWithEqualityFn<CommandPaletteStore>((set) => ({
  isOpen: false,
  query: '',
  selectedIndex: 0,

  open(): void {
    set({ isOpen: true, query: '', selectedIndex: 0 })
  },

  close(): void {
    set({ isOpen: false, query: '', selectedIndex: 0 })
  },

  setQuery(query: string): void {
    set({ query, selectedIndex: 0 })
  },

  setSelectedIndex(index: number): void {
    set({ selectedIndex: index })
  }
}), shallow)
