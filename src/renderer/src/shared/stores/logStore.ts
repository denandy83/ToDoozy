import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'

export type LogLevel = 'info' | 'warn' | 'error'
export type LogCategory = 'realtime' | 'network' | 'sync'

export interface LogEntry {
  id: number
  timestamp: string
  level: LogLevel
  category: LogCategory
  message: string
  context?: string
}

const MAX_ENTRIES = 500

interface LogState {
  entries: LogEntry[]
}

interface LogActions {
  addLog(level: LogLevel, category: LogCategory, message: string, context?: string): void
  clear(): void
}

export type LogStore = LogState & LogActions

let nextId = 1

export const useLogStore = createWithEqualityFn<LogStore>(
  (set) => ({
    entries: [],

    addLog: (level, category, message, context) => {
      const entry: LogEntry = {
        id: nextId++,
        timestamp: new Date().toISOString(),
        level,
        category,
        message,
        context
      }
      set((state) => {
        const next = [entry, ...state.entries]
        if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES
        return { entries: next }
      })
    },

    clear: () => set({ entries: [] })
  }),
  shallow
)

export const selectLogEntries = (state: LogState): LogEntry[] => state.entries

export function logEvent(
  level: LogLevel,
  category: LogCategory,
  message: string,
  context?: string
): void {
  useLogStore.getState().addLog(level, category, message, context)
}
