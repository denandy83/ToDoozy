import type { ProjectTemplateTask } from '../../../../shared/types'

const MS_PER_DAY = 86400000

/**
 * Compute a due_date_offset (in days) from a task's due_date relative to a reference date.
 * Returns null if the task has no due_date.
 */
export function computeOffset(dueDate: string | null, referenceDate: Date): number | null {
  if (!dueDate) return null
  const due = new Date(dueDate)
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const refStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())
  return Math.round((dueStart.getTime() - refStart.getTime()) / MS_PER_DAY)
}

/**
 * Compute an actual ISO date string (YYYY-MM-DD) from a deploy date and an offset in days.
 * Returns null if offset is null.
 */
export function computeDateFromOffset(deployDate: string, offset: number | null): string | null {
  if (offset == null) return null
  const d = new Date(deployDate + 'T00:00:00')
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Format an offset as a human-readable string (e.g., "+5 days", "-2 days", "same day").
 */
export function formatOffset(offset: number): string {
  if (offset === 0) return 'same day'
  const abs = Math.abs(offset)
  const unit = abs === 1 ? 'day' : 'days'
  return offset > 0 ? `+${abs} ${unit}` : `${offset} ${unit}`
}

/**
 * Collect all tasks (flat) that have a non-null due_date_offset.
 */
export function collectTasksWithOffsets(
  tasks: ProjectTemplateTask[]
): Array<{ title: string; offset: number }> {
  const result: Array<{ title: string; offset: number }> = []
  const walk = (taskList: ProjectTemplateTask[]): void => {
    for (const t of taskList) {
      if (t.due_date_offset != null) {
        result.push({ title: t.title, offset: t.due_date_offset })
      }
      walk(t.subtasks)
    }
  }
  walk(tasks)
  return result
}

/**
 * Strip due_date_offset from all tasks in a tree (set to null).
 */
export function stripOffsets(tasks: ProjectTemplateTask[]): ProjectTemplateTask[] {
  return tasks.map((t) => ({
    ...t,
    due_date_offset: null,
    subtasks: stripOffsets(t.subtasks)
  }))
}
