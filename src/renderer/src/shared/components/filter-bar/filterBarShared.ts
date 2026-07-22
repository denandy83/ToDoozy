// Shared constants and operator types for the FilterBar and its sub-pickers.
// Extracted from FilterBar.tsx (Story #107) — values unchanged.

export const PRIORITY_OPTIONS = [
  { value: 0, label: 'None', color: '#888' },
  { value: 1, label: 'Low', color: '#3b82f6' },
  { value: 2, label: 'Normal', color: '#f59e0b' },
  { value: 3, label: 'High', color: '#f97316' },
  { value: 4, label: 'Urgent', color: '#ef4444' }
] as const

export const DUE_DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'no_date', label: 'No Date' }
] as const

export type FilterOperator = 'is' | 'is_not'

export type LabelOperator = 'is_any' | 'is_all' | 'is_not'
