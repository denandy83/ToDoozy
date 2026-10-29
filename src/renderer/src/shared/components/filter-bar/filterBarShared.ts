// Shared constants and operator types for the FilterBar and its sub-pickers.
// Extracted from FilterBar.tsx (Story #107) — values unchanged.

export { PRIORITY_LEVELS as PRIORITY_OPTIONS } from '../../../../../shared/taskPriorities'

export const DUE_DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'no_date', label: 'No Date' }
] as const

export type FilterOperator = 'is' | 'is_not'

export type LabelOperator = 'is_any' | 'is_all' | 'is_not'
