import { randomUUID } from 'crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Task, CreateTaskInput, UpdateTaskInput, TaskLabel } from '../../shared/types'
import { TASK_UPDATABLE_COLUMNS } from '../../shared/types'
import { withTransaction } from '../database'
import { parseRecurrence, getNextOccurrence } from '../../shared/recurrenceUtils'

export interface TaskSearchFilters {
  project_id?: string
  status_id?: string
  priority?: number
  label_id?: string
  due_before?: string
  due_after?: string
  keyword?: string
  is_archived?: number
  owner_id?: string
}

export class TaskRepository {
  constructor(private db: DatabaseSync) {}

  findById(id: string): Task | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as Task | undefined
  }

  findByProjectId(projectId: string): Task[] {
    return this.db
      .prepare(
        'SELECT * FROM tasks WHERE project_id = ? AND is_archived = 0 AND is_template = 0 ORDER BY order_index ASC'
      )
      .all(projectId) as unknown as Task[]
  }

  findByStatusId(statusId: string): Task[] {
    return this.db
      .prepare(
        'SELECT * FROM tasks WHERE status_id = ? AND is_archived = 0 AND is_template = 0 ORDER BY order_index ASC'
      )
      .all(statusId) as unknown as Task[]
  }

  findMyDay(userId: string): Task[] {
    return this.db
      .prepare(
        `SELECT * FROM tasks
         WHERE owner_id = ? AND is_archived = 0 AND is_template = 0
         AND (is_in_my_day = 1 OR (due_date IS NOT NULL AND date(due_date) = date('now')))
         ORDER BY order_index ASC`
      )
      .all(userId) as unknown as Task[]
  }

  findArchived(projectId: string): Task[] {
    return this.db
      .prepare('SELECT * FROM tasks WHERE project_id = ? AND is_archived = 1 ORDER BY updated_at DESC')
      .all(projectId) as unknown as Task[]
  }

  findTemplates(projectId: string): Task[] {
    return this.db
      .prepare('SELECT * FROM tasks WHERE project_id = ? AND is_template = 1 ORDER BY created_at ASC')
      .all(projectId) as unknown as Task[]
  }

  findSubtasks(parentId: string): Task[] {
    return this.db
      .prepare('SELECT * FROM tasks WHERE parent_id = ? ORDER BY order_index ASC')
      .all(parentId) as unknown as Task[]
  }

  getSubtaskCount(parentId: string): { total: number; done: number } {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status_id IN (SELECT id FROM statuses WHERE is_done = 1) THEN 1 ELSE 0 END) as done
         FROM tasks WHERE parent_id = ?`
      )
      .get(parentId) as { total: number; done: number }
    return { total: row.total, done: row.done ?? 0 }
  }

  create(input: CreateTaskInput): Task {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, owner_id, title, status_id, assigned_to, description,
         priority, due_date, parent_id, order_index, is_in_my_day, is_template, is_archived,
         completed_date, recurrence_rule, reference_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.project_id,
        input.owner_id,
        input.title,
        input.status_id,
        input.assigned_to ?? null,
        input.description ?? null,
        input.priority ?? 0,
        input.due_date ?? null,
        input.parent_id ?? null,
        input.order_index ?? 0,
        input.is_in_my_day ?? 0,
        input.is_template ?? 0,
        input.is_archived ?? 0,
        input.completed_date ?? null,
        input.recurrence_rule ?? null,
        input.reference_url ?? null,
        now,
        now
      )
    return this.findById(input.id)!
  }

  update(id: string, input: UpdateTaskInput): Task | undefined {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const values: (string | number | null)[] = [now]

    for (const col of TASK_UPDATABLE_COLUMNS) {
      if (input[col] !== undefined) {
        sets.push(`${col} = ?`)
        values.push(input[col] as string | number | null)
      }
    }

    values.push(id)
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values)

    // Cascade archive/unarchive to subtasks
    if (input.is_archived !== undefined) {
      const subtasks = this.findSubtasks(id)
      for (const subtask of subtasks) {
        this.update(subtask.id, { is_archived: input.is_archived })
      }
    }

    return this.findById(id)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    return result.changes > 0
  }

  reorder(taskIds: string[]): void {
    withTransaction(this.db, () => {
      const stmt = this.db.prepare('UPDATE tasks SET order_index = ? WHERE id = ?')
      for (let i = 0; i < taskIds.length; i++) {
        stmt.run(i, taskIds[i])
      }
    })
  }

  // Label assignments
  addLabel(taskId: string, labelId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)')
      .run(taskId, labelId)
  }

  removeLabel(taskId: string, labelId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM task_labels WHERE task_id = ? AND label_id = ?')
      .run(taskId, labelId)
    return result.changes > 0
  }

  getLabels(taskId: string): TaskLabel[] {
    return this.db
      .prepare('SELECT * FROM task_labels WHERE task_id = ?')
      .all(taskId) as unknown as TaskLabel[]
  }

  findAllTemplates(userId: string): Task[] {
    return this.db
      .prepare(
        `SELECT t.* FROM tasks t
         INNER JOIN project_members pm ON pm.project_id = t.project_id
         WHERE t.is_template = 1 AND pm.user_id = ?
         ORDER BY t.created_at ASC`
      )
      .all(userId) as unknown as Task[]
  }

  saveAsTemplate(id: string, newId: string): Task | undefined {
    const original = this.findById(id)
    if (!original) return undefined

    const defaultStatusStmt = this.db.prepare(
      'SELECT id FROM statuses WHERE project_id = ? AND is_default = 1 LIMIT 1'
    )
    const defaultStatus = defaultStatusStmt.get(original.project_id) as { id: string } | undefined
    const statusId = defaultStatus?.id ?? original.status_id

    return withTransaction(this.db, () => {
      const template = this.create({
        id: newId,
        project_id: original.project_id,
        owner_id: original.owner_id,
        title: original.title,
        status_id: statusId,
        description: original.description,
        priority: original.priority,
        is_template: 1,
        is_in_my_day: 0,
        is_archived: 0,
        recurrence_rule: original.recurrence_rule,
        order_index: 0
        // Strips: due_date, completed_date, snooze (no snooze field — just omit due_date)
      })

      // Copy labels
      const labels = this.getLabels(id)
      for (const label of labels) {
        this.addLabel(template.id, label.label_id)
      }

      // Recursively copy subtasks (stripping dates, resetting status)
      this.copySubtasksAsTemplate(id, template.id, original.project_id, statusId)

      return template
    })
  }

  private copySubtasksAsTemplate(
    originalParentId: string,
    newParentId: string,
    projectId: string,
    defaultStatusId: string
  ): void {
    const subtasks = this.findSubtasks(originalParentId)
    for (const subtask of subtasks) {
      const subtaskId = randomUUID()
      this.create({
        id: subtaskId,
        project_id: projectId,
        owner_id: subtask.owner_id,
        title: subtask.title,
        status_id: defaultStatusId,
        description: subtask.description,
        priority: subtask.priority,
        parent_id: newParentId,
        order_index: subtask.order_index,
        is_template: 1,
        is_in_my_day: 0,
        is_archived: 0,
        recurrence_rule: subtask.recurrence_rule
      })
      // Copy subtask labels
      const labels = this.getLabels(subtask.id)
      for (const label of labels) {
        this.addLabel(subtaskId, label.label_id)
      }
      // Recursive subtasks
      this.copySubtasksAsTemplate(subtask.id, subtaskId, projectId, defaultStatusId)
    }
  }

  findWithUpcomingDueTimes(minutesAhead: number): Task[] {
    // due_date is stored as local time without timezone (e.g. "2026-03-30T15:16")
    // Compare using local time format to match
    const now = new Date()
    const cutoff = new Date(now.getTime() + minutesAhead * 60 * 1000)
    const pad = (n: number): string => String(n).padStart(2, '0')
    const toLocal = (d: Date): string =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    return this.db
      .prepare(
        `SELECT * FROM tasks
         WHERE is_archived = 0
         AND is_template = 0
         AND due_date IS NOT NULL
         AND due_date LIKE '%T%'
         AND due_date >= ?
         AND due_date <= ?
         AND status_id NOT IN (SELECT id FROM statuses WHERE is_done = 1)
         ORDER BY due_date ASC`
      )
      .all(toLocal(now), toLocal(cutoff)) as unknown as Task[]
  }

  search(filters: TaskSearchFilters): Task[] {
    let sql = 'SELECT DISTINCT t.* FROM tasks t'
    const conditions: string[] = ['t.is_template = 0']
    const params: (string | number)[] = []

    if (filters.label_id) {
      sql += ' INNER JOIN task_labels tl ON tl.task_id = t.id'
      conditions.push('tl.label_id = ?')
      params.push(filters.label_id)
    }

    if (filters.project_id) {
      conditions.push('t.project_id = ?')
      params.push(filters.project_id)
    }

    if (filters.status_id) {
      conditions.push('t.status_id = ?')
      params.push(filters.status_id)
    }

    if (filters.priority !== undefined) {
      conditions.push('t.priority = ?')
      params.push(filters.priority)
    }

    if (filters.due_before) {
      conditions.push('t.due_date IS NOT NULL AND t.due_date <= ?')
      params.push(filters.due_before)
    }

    if (filters.due_after) {
      conditions.push('t.due_date IS NOT NULL AND t.due_date >= ?')
      params.push(filters.due_after)
    }

    if (filters.keyword) {
      conditions.push('(t.title LIKE ? OR t.description LIKE ?)')
      const kw = `%${filters.keyword}%`
      params.push(kw, kw)
    }

    if (filters.is_archived !== undefined) {
      conditions.push('t.is_archived = ?')
      params.push(filters.is_archived)
    } else {
      conditions.push('t.is_archived = 0')
    }

    if (filters.owner_id) {
      conditions.push('t.owner_id = ?')
      params.push(filters.owner_id)
    }

    sql += ' WHERE ' + conditions.join(' AND ')
    sql += ' ORDER BY t.order_index ASC'

    return this.db.prepare(sql).all(...params) as unknown as Task[]
  }

  duplicate(id: string, newId: string): Task | undefined {
    const original = this.findById(id)
    if (!original) return undefined

    const newTask = this.create({
      id: newId,
      project_id: original.project_id,
      owner_id: original.owner_id,
      title: `${original.title} (copy)`,
      status_id: original.status_id,
      assigned_to: original.assigned_to,
      description: original.description,
      priority: original.priority,
      due_date: original.due_date,
      parent_id: original.parent_id,
      order_index: original.order_index + 1,
      is_in_my_day: original.is_in_my_day,
      recurrence_rule: original.recurrence_rule
    })

    if (!newTask) return undefined

    // Copy labels
    const labels = this.getLabels(id)
    for (const label of labels) {
      this.addLabel(newTask.id, label.label_id)
    }

    // Recursively duplicate subtasks
    const subtasks = this.findSubtasks(id)
    for (const subtask of subtasks) {
      const subtaskNewId = randomUUID()
      const dupSubtask = this.findById(subtask.id)
      if (dupSubtask) {
        this.create({
          id: subtaskNewId,
          project_id: dupSubtask.project_id,
          owner_id: dupSubtask.owner_id,
          title: `${dupSubtask.title} (copy)`,
          status_id: dupSubtask.status_id,
          assigned_to: dupSubtask.assigned_to,
          description: dupSubtask.description,
          priority: dupSubtask.priority,
          due_date: dupSubtask.due_date,
          parent_id: newTask.id,
          order_index: dupSubtask.order_index,
          is_in_my_day: dupSubtask.is_in_my_day,
          recurrence_rule: dupSubtask.recurrence_rule
        })
        // Copy subtask labels too
        const subtaskLabels = this.getLabels(subtask.id)
        for (const label of subtaskLabels) {
          this.addLabel(subtaskNewId, label.label_id)
        }
      }
    }

    return newTask
  }

  completeRecurringTask(taskId: string): { id: string; dueDate: string } | null {
    const task = this.findById(taskId)
    if (!task || !task.recurrence_rule) return null

    const config = parseRecurrence(task.recurrence_rule)
    if (!config) return null

    // Compute next due date
    const fromDate = config.afterCompletion
      ? new Date()
      : task.due_date
        ? new Date(task.due_date)
        : new Date()

    const nextDate = getNextOccurrence(task.recurrence_rule, fromDate)
    if (!nextDate) return null // end date passed

    const nextDueDate = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`

    return withTransaction(this.db, () => {
      // Find the project's default status
      const defaultStatus = this.db
        .prepare(
          `SELECT id FROM statuses WHERE project_id = ? AND is_done = 0
           ORDER BY is_default DESC, order_index ASC LIMIT 1`
        )
        .get(task.project_id) as { id: string } | undefined

      const statusId = defaultStatus?.id ?? task.status_id

      const newId = randomUUID()
      const clonedTask = this.create({
        id: newId,
        project_id: task.project_id,
        owner_id: task.owner_id,
        title: task.title,
        status_id: statusId,
        assigned_to: task.assigned_to,
        description: task.description,
        priority: task.priority,
        due_date: nextDueDate,
        parent_id: task.parent_id,
        order_index: task.order_index,
        recurrence_rule: task.recurrence_rule,
        reference_url: task.reference_url
      })

      // Copy labels
      const labels = this.getLabels(taskId)
      for (const label of labels) {
        this.addLabel(clonedTask.id, label.label_id)
      }

      // Copy subtasks with reset status
      this.copySubtasksForRecurrence(taskId, clonedTask.id, task.project_id, statusId)

      return { id: clonedTask.id, dueDate: nextDueDate }
    })
  }

  private copySubtasksForRecurrence(
    originalParentId: string,
    newParentId: string,
    projectId: string,
    defaultStatusId: string
  ): void {
    const subtasks = this.findSubtasks(originalParentId)
    for (const subtask of subtasks) {
      const subtaskId = randomUUID()
      this.create({
        id: subtaskId,
        project_id: projectId,
        owner_id: subtask.owner_id,
        title: subtask.title,
        status_id: defaultStatusId,
        description: subtask.description,
        priority: subtask.priority,
        parent_id: newParentId,
        order_index: subtask.order_index,
        is_in_my_day: 0,
        is_archived: 0,
        completed_date: null
      })
      // Copy subtask labels
      const labels = this.getLabels(subtask.id)
      for (const label of labels) {
        this.addLabel(subtaskId, label.label_id)
      }
      // Recursive subtasks
      this.copySubtasksForRecurrence(subtask.id, subtaskId, projectId, defaultStatusId)
    }
  }
}
