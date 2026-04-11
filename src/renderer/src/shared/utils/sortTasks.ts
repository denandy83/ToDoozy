import type { Task } from '../../../../shared/types'

export type SortField = 'priority' | 'due_date' | 'status' | 'created_at' | 'updated_at' | 'title' | 'project' | 'custom'
export type SortDirection = 'asc' | 'desc'

export interface SortRule {
  field: SortField
  direction: SortDirection
}

/**
 * Creates a comparator function from an array of sort rules.
 * Falls back to order_index when all rules produce equal values.
 */
export function createSortComparator(
  rules: SortRule[],
  statusOrderMap?: Map<string, number>
): (a: Task, b: Task) => number {
  return (a: Task, b: Task): number => {
    for (const rule of rules) {
      if (rule.field === 'custom') {
        // Custom = order_index sort
        const diff = a.order_index - b.order_index
        return rule.direction === 'desc' ? -diff : diff
      }

      const diff = compareField(a, b, rule.field, statusOrderMap)
      if (diff !== 0) return rule.direction === 'desc' ? -diff : diff
    }
    // Stable fallback: order_index
    return a.order_index - b.order_index
  }
}

function compareField(
  a: Task,
  b: Task,
  field: SortField,
  statusOrderMap?: Map<string, number>
): number {
  switch (field) {
    case 'priority':
      return a.priority - b.priority
    case 'due_date': {
      // Null dates go to the end
      if (!a.due_date && !b.due_date) return 0
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date.localeCompare(b.due_date)
    }
    case 'status': {
      const aOrder = statusOrderMap?.get(a.status_id) ?? 0
      const bOrder = statusOrderMap?.get(b.status_id) ?? 0
      return aOrder - bOrder
    }
    case 'created_at':
      return (a.created_at ?? '').localeCompare(b.created_at ?? '')
    case 'updated_at':
      return (a.updated_at ?? '').localeCompare(b.updated_at ?? '')
    case 'title':
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    case 'project':
      return a.project_id.localeCompare(b.project_id)
    default:
      return 0
  }
}

export const SORT_FIELD_LABELS: Record<SortField, string> = {
  priority: 'Priority',
  due_date: 'Due Date',
  status: 'Status',
  created_at: 'Created',
  updated_at: 'Updated',
  title: 'Title',
  project: 'Project',
  custom: 'Custom'
}

export const DEFAULT_SAVED_VIEW_SORT: SortRule[] = [{ field: 'priority', direction: 'desc' }]
export const DEFAULT_PROJECT_SORT: SortRule[] = [{ field: 'custom', direction: 'asc' }]
