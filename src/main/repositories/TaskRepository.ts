import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type { Task, CreateTaskInput, UpdateTaskInput, TaskLabel } from '../../shared/types'
import { TASK_UPDATABLE_COLUMNS } from '../../shared/types'

export class TaskRepository {
  constructor(private db: Database.Database) {}

  findById(id: string): Task | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined
  }

  findByProjectId(projectId: string): Task[] {
    return this.db
      .prepare(
        'SELECT * FROM tasks WHERE project_id = ? AND is_archived = 0 AND is_template = 0 ORDER BY order_index ASC'
      )
      .all(projectId) as Task[]
  }

  findByStatusId(statusId: string): Task[] {
    return this.db
      .prepare(
        'SELECT * FROM tasks WHERE status_id = ? AND is_archived = 0 AND is_template = 0 ORDER BY order_index ASC'
      )
      .all(statusId) as Task[]
  }

  findMyDay(userId: string): Task[] {
    return this.db
      .prepare(
        `SELECT * FROM tasks
         WHERE owner_id = ? AND is_archived = 0 AND is_template = 0
         AND (is_in_my_day = 1 OR (due_date IS NOT NULL AND date(due_date) = date('now')))
         ORDER BY order_index ASC`
      )
      .all(userId) as Task[]
  }

  findArchived(projectId: string): Task[] {
    return this.db
      .prepare('SELECT * FROM tasks WHERE project_id = ? AND is_archived = 1 ORDER BY updated_at DESC')
      .all(projectId) as Task[]
  }

  findTemplates(projectId: string): Task[] {
    return this.db
      .prepare('SELECT * FROM tasks WHERE project_id = ? AND is_template = 1 ORDER BY created_at ASC')
      .all(projectId) as Task[]
  }

  findSubtasks(parentId: string): Task[] {
    return this.db
      .prepare('SELECT * FROM tasks WHERE parent_id = ? ORDER BY order_index ASC')
      .all(parentId) as Task[]
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
         completed_date, recurrence_rule, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    return this.findById(id)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    return result.changes > 0
  }

  reorder(taskIds: string[]): void {
    const reorderTx = this.db.transaction(() => {
      const stmt = this.db.prepare('UPDATE tasks SET order_index = ? WHERE id = ?')
      for (let i = 0; i < taskIds.length; i++) {
        stmt.run(i, taskIds[i])
      }
    })
    reorderTx()
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
      .all(taskId) as TaskLabel[]
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
}
