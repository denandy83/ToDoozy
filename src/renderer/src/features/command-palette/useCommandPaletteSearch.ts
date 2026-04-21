import { useMemo } from 'react'
import { useTaskStore } from '../../shared/stores/taskStore'
import { useLabelStore } from '../../shared/stores/labelStore'
import { useStatusStore } from '../../shared/stores/statusStore'
import type { Task, Label, Status } from '../../../../shared/types'

const MAX_RESULTS = 12

export interface ParsedQuery {
  textTerms: string[]
  priorityFilters: string[]
  labelFilters: string[]
  statusFilters: string[]
  dueFilters: string[]
  hasFilters: string[]
}

export const PRIORITY_NAME_TO_VALUE: Record<string, number> = {
  none: 0,
  low: 1,
  normal: 2,
  medium: 2,
  high: 3,
  urgent: 4
}

export function parseQuery(query: string): ParsedQuery {
  const result: ParsedQuery = {
    textTerms: [],
    priorityFilters: [],
    labelFilters: [],
    statusFilters: [],
    dueFilters: [],
    hasFilters: []
  }

  // Split by whitespace, but handle operator:value pairs
  const tokens = query.trim().split(/\s+/).filter(Boolean)

  for (const token of tokens) {
    const colonIdx = token.indexOf(':')
    if (colonIdx === -1) {
      result.textTerms.push(token.toLowerCase())
      continue
    }

    const prefix = token.slice(0, colonIdx).toLowerCase()
    const value = token.slice(colonIdx + 1).toLowerCase()
    if (!value) {
      result.textTerms.push(token.toLowerCase())
      continue
    }

    switch (prefix) {
      case 'p':
      case 'priority':
        result.priorityFilters.push(value)
        break
      case 'l':
      case 'label':
        result.labelFilters.push(value)
        break
      case 's':
      case 'status':
        result.statusFilters.push(value)
        break
      case 'd':
        result.dueFilters.push(value)
        break
      case 'has':
        result.hasFilters.push(value)
        break
      default:
        result.textTerms.push(token.toLowerCase())
    }
  }

  return result
}

export function matchesPriority(task: Task, filters: string[]): boolean {
  for (const filter of filters) {
    // Exact match
    const numericValue = PRIORITY_NAME_TO_VALUE[filter]
    if (numericValue !== undefined && task.priority === numericValue) return true
    // Numeric match
    const parsed = parseInt(filter, 10)
    if (!isNaN(parsed) && task.priority === parsed) return true
    // Substring match against priority names
    for (const [name, value] of Object.entries(PRIORITY_NAME_TO_VALUE)) {
      if (name.startsWith(filter) && task.priority === value) return true
    }
  }
  return false
}

export function matchesLabel(
  taskLabels: Label[],
  filters: string[]
): boolean {
  for (const filter of filters) {
    if (taskLabels.some((l) => l.name.toLowerCase().includes(filter))) return true
  }
  return false
}

export function matchesStatus(
  task: Task,
  filters: string[],
  statuses: Record<string, Status>
): boolean {
  const status = statuses[task.status_id]
  if (!status) return false
  const statusName = status.name.toLowerCase()
  for (const filter of filters) {
    if (statusName.includes(filter)) return true
  }
  return false
}

export function matchesDue(task: Task, filters: string[]): boolean {
  for (const filter of filters) {
    if ('overdue'.startsWith(filter)) {
      if (!task.due_date) continue
      return new Date(task.due_date) < new Date(new Date().toISOString().split('T')[0])
    }

    if (!task.due_date) continue
    const dueDate = new Date(task.due_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    if ('today'.startsWith(filter)) {
      const todayStr = today.toISOString().split('T')[0]
      if (task.due_date.startsWith(todayStr)) return true
    } else if ('week'.startsWith(filter)) {
      const weekEnd = new Date(today)
      weekEnd.setDate(weekEnd.getDate() + 7)
      if (dueDate >= today && dueDate <= weekEnd) return true
    }
  }
  return false
}

export function matchesHas(
  task: Task,
  filters: string[],
  allTasks: Record<string, Task>
): boolean {
  for (const filter of filters) {
    const f = filter.toLowerCase()
    switch (true) {
      case 'subtasks'.startsWith(f): {
        const hasChildren = Object.values(allTasks).some((t) => t.parent_id === task.id)
        if (hasChildren) return true
        break
      }
      case 'image'.startsWith(f):
        if (task.description && (task.description.includes('![') || task.description.includes('<img'))) {
          return true
        }
        break
      case 'recurrence'.startsWith(f):
        if (task.recurrence_rule && task.recurrence_rule !== 'none') return true
        break
    }
  }
  return false
}

export function matchesTextTerms(task: Task, textTerms: string[]): boolean {
  if (textTerms.length === 0) return true
  const titleLower = task.title.toLowerCase()
  const idLower = task.id.toLowerCase()
  return textTerms.every((term) => {
    const t = term.toLowerCase()
    return titleLower.includes(t) || idLower.includes(t)
  })
}

export interface ExternalFilters {
  priorityValues?: number[]
  labelIds?: string[]
  projectIds?: string[]
  dueDates?: string[]
  statusIds?: string[]
}

export function useCommandPaletteSearch(
  query: string,
  includeArchived = false,
  externalFilters?: ExternalFilters
): Task[] {
  const tasks = useTaskStore((s) => s.tasks)
  const taskLabels = useTaskStore((s) => s.taskLabels)
  const statuses = useStatusStore((s) => s.statuses)
  const labels = useLabelStore((s) => s.labels)

  return useMemo(() => {
    const hasChips = externalFilters && (
      externalFilters.priorityValues?.length ||
      externalFilters.labelIds?.length ||
      externalFilters.projectIds?.length ||
      externalFilters.dueDates?.length ||
      externalFilters.statusIds?.length
    )
    if (!query.trim() && !hasChips) return []

    const parsed = parseQuery(query)
    const allTasks = Object.values(tasks).filter(
      (t) => (includeArchived || t.is_archived === 0) && t.is_template === 0
    )

    const filtered = allTasks.filter((task) => {
      // Text search: all text terms must match title OR task ID (substring)
      if (!matchesTextTerms(task, parsed.textTerms)) {
        return false
      }

      // Priority filter (typed)
      if (parsed.priorityFilters.length > 0 && !matchesPriority(task, parsed.priorityFilters)) {
        return false
      }

      // Priority filter (chip)
      if (externalFilters?.priorityValues?.length) {
        if (!externalFilters.priorityValues.includes(task.priority)) return false
      }

      // Label filter (typed)
      if (parsed.labelFilters.length > 0) {
        const tLabels = taskLabels[task.id] ?? []
        if (!matchesLabel(tLabels, parsed.labelFilters)) {
          return false
        }
      }

      // Label filter (chip - by ID)
      if (externalFilters?.labelIds?.length) {
        const tLabels = taskLabels[task.id] ?? []
        const tLabelIds = new Set(tLabels.map((l) => l.id))
        if (!externalFilters.labelIds.some((id) => tLabelIds.has(id))) return false
      }

      // Project filter (chip)
      if (externalFilters?.projectIds?.length) {
        if (!externalFilters.projectIds.includes(task.project_id)) return false
      }

      // Status filter (typed)
      if (parsed.statusFilters.length > 0 && !matchesStatus(task, parsed.statusFilters, statuses)) {
        return false
      }

      // Status filter (chip - by ID)
      if (externalFilters?.statusIds?.length) {
        if (!externalFilters.statusIds.includes(task.status_id)) return false
      }

      // Due filter (typed)
      if (parsed.dueFilters.length > 0 && !matchesDue(task, parsed.dueFilters)) {
        return false
      }

      // Due filter (chip - exact date)
      if (externalFilters?.dueDates?.length) {
        if (!task.due_date) return false
        if (!externalFilters.dueDates.some((d) => task.due_date!.startsWith(d))) return false
      }

      // Has filter
      if (parsed.hasFilters.length > 0 && !matchesHas(task, parsed.hasFilters, tasks)) {
        return false
      }

      return true
    })

    // Sort by priority (highest first), then by updated_at (most recent first)
    filtered.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return b.updated_at.localeCompare(a.updated_at)
    })

    return filtered.slice(0, MAX_RESULTS)
  }, [query, includeArchived, externalFilters, tasks, taskLabels, statuses, labels])
}
