import type { DueDateRange } from '../stores/labelStore'

/**
 * Resolve a DueDateRange to absolute ISO date strings (YYYY-MM-DD).
 * For relative ranges, offsets are applied to today's date.
 */
export function resolveDueDateRange(range: DueDateRange): { from: string; to?: string } {
  if (range.mode === 'absolute') {
    return { from: range.fromDate!, to: range.toDate }
  }
  const today = new Date()
  const from = new Date(today)
  from.setDate(today.getDate() + (range.fromOffset ?? 0))
  const result: { from: string; to?: string } = { from: toIsoDate(from) }
  if (range.toOffset !== undefined) {
    const to = new Date(today)
    to.setDate(today.getDate() + range.toOffset)
    result.to = toIsoDate(to)
  }
  return result
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Check if a task's due_date matches the active due date filter (preset or custom range).
 * Returns true if no filter is active, or if the task matches the filter.
 */
export function matchesDueDateFilter(
  dueDate: string | null,
  dueDatePreset: string | null,
  dueDateRange: DueDateRange | null
): boolean {
  if (dueDatePreset) {
    const now = new Date()
    const todayStr = toIsoDate(now)
    if (dueDatePreset === 'no_date') return !dueDate
    if (dueDatePreset === 'overdue') return !!dueDate && dueDate < todayStr
    if (dueDatePreset === 'today') return !!dueDate && dueDate.slice(0, 10) === todayStr
    if (dueDatePreset === 'this_week') {
      if (!dueDate) return false
      const endOfWeek = new Date(now)
      endOfWeek.setDate(now.getDate() + (7 - now.getDay()))
      const dd = dueDate.slice(0, 10)
      return dd >= todayStr && dd <= toIsoDate(endOfWeek)
    }
  }
  if (dueDateRange) {
    const resolved = resolveDueDateRange(dueDateRange)
    if (!dueDate) return false
    const dd = dueDate.slice(0, 10)
    if (dd < resolved.from) return false
    if (resolved.to && dd > resolved.to) return false
    return true
  }
  return true
}

/**
 * Format a DueDateRange for display as a filter chip label.
 */
export function formatDueDateRange(range: DueDateRange): string {
  if (range.mode === 'relative') {
    const from = formatOffset(range.fromOffset ?? 0)
    if (range.toOffset !== undefined) {
      return `${from} → ${formatOffset(range.toOffset)}`
    }
    return `from ${from}`
  }
  // absolute
  const from = formatAbsDate(range.fromDate!)
  if (range.toDate) {
    return `${from} → ${formatAbsDate(range.toDate)}`
  }
  return `from ${from}`
}

function formatOffset(offset: number): string {
  if (offset === 0) return 'today'
  if (offset === 1) return '+1d'
  if (offset === -1) return '-1d'
  return offset > 0 ? `+${offset}d` : `${offset}d`
}

function formatAbsDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
