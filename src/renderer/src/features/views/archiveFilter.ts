import type { Task, Label } from '../../../../shared/types'
import type { DueDateRange } from '../../shared/stores/labelStore'
import { matchesDueDateFilter } from '../../shared/utils/dueDateFilter'

/**
 * Filter criteria for the Archive view. Mirrors the include/exclude filter
 * shape used by `TaskListView` (label / priority / status / project / due-date /
 * keyword), pulled from the shared `labelStore`. Extracted as a pure function so
 * it can be unit-tested without rendering the component (the codebase has no
 * jsdom/testing-library setup — see existing `*.test.ts` convention).
 */
export interface ArchiveFilterCriteria {
  /** Active label-name filters (lowercase names). */
  activeLabelFilters: Set<string>
  /** Whether all active label filters must match ('all') or any ('any'). */
  labelFilterLogic: 'any' | 'all'
  priorityFilters: Set<number>
  statusFilters: Set<string>
  projectFilters: Set<string>
  excludeLabelFilters: Set<string>
  excludePriorityFilters: Set<number>
  excludeStatusFilters: Set<string>
  excludeProjectFilters: Set<string>
  dueDatePreset: string | null
  dueDateRange: DueDateRange | null
  keyword: string
}

/** True when at least one filter dimension is active. */
export function hasAnyArchiveFilter(c: ArchiveFilterCriteria): boolean {
  return (
    c.activeLabelFilters.size > 0 ||
    c.priorityFilters.size > 0 ||
    c.statusFilters.size > 0 ||
    c.projectFilters.size > 0 ||
    c.excludeLabelFilters.size > 0 ||
    c.excludePriorityFilters.size > 0 ||
    c.excludeStatusFilters.size > 0 ||
    c.excludeProjectFilters.size > 0 ||
    c.dueDatePreset !== null ||
    c.dueDateRange !== null ||
    c.keyword !== ''
  )
}

/**
 * Returns true when an archived task matches the active filter criteria. Mirrors
 * `TaskListView`'s `taskMatchesFilters` (include filters, then exclusion filters,
 * then due-date, then keyword). `labels` is the task's resolved label list.
 */
export function archiveTaskMatchesFilters(
  task: Task,
  labels: Label[],
  c: ArchiveFilterCriteria
): boolean {
  const labelNames = new Set(labels.map((l) => l.name.toLowerCase()))

  // Include filters
  if (c.activeLabelFilters.size > 0) {
    if (c.labelFilterLogic === 'all') {
      if (![...c.activeLabelFilters].every((fid) => labelNames.has(fid))) return false
    } else {
      if (![...c.activeLabelFilters].some((fid) => labelNames.has(fid))) return false
    }
  }
  if (c.priorityFilters.size > 0 && !c.priorityFilters.has(task.priority)) return false
  if (c.statusFilters.size > 0 && !c.statusFilters.has(task.status_id)) return false
  if (c.projectFilters.size > 0 && !c.projectFilters.has(task.project_id)) return false

  // Exclusion filters
  if (c.excludeLabelFilters.size > 0 && [...c.excludeLabelFilters].some((fid) => labelNames.has(fid))) return false
  if (c.excludePriorityFilters.size > 0 && c.excludePriorityFilters.has(task.priority)) return false
  if (c.excludeStatusFilters.size > 0 && c.excludeStatusFilters.has(task.status_id)) return false
  if (c.excludeProjectFilters.size > 0 && c.excludeProjectFilters.has(task.project_id)) return false

  // Due date (preset or custom range)
  if ((c.dueDatePreset || c.dueDateRange) && !matchesDueDateFilter(task.due_date, c.dueDatePreset, c.dueDateRange)) return false

  // Keyword (title + description)
  if (c.keyword) {
    const kw = c.keyword.toLowerCase()
    const titleMatch = task.title.toLowerCase().includes(kw)
    const descMatch = (task.description ?? '').toLowerCase().includes(kw)
    if (!titleMatch && !descMatch) return false
  }

  return true
}
