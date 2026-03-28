import type { DatabaseSync } from 'node:sqlite'
import { withTransaction } from '../database'
import type { Label, CreateLabelInput, UpdateLabelInput, TaskLabelMapping, LabelUsageInfo } from '../../shared/types'

export class LabelRepository {
  constructor(private db: DatabaseSync) {}

  findById(id: string): Label | undefined {
    return this.db.prepare('SELECT * FROM labels WHERE id = ?').get(id) as unknown as Label | undefined
  }

  /** Get all global labels */
  findAll(): Label[] {
    return this.db.prepare('SELECT * FROM labels ORDER BY order_index ASC').all() as unknown as Label[]
  }

  /** Get labels linked to a specific project via project_labels junction */
  findByProjectId(projectId: string): Label[] {
    return this.db
      .prepare(
        `SELECT l.* FROM labels l
         INNER JOIN project_labels pl ON pl.label_id = l.id
         WHERE pl.project_id = ?
         ORDER BY l.order_index ASC`
      )
      .all(projectId) as unknown as Label[]
  }

  /** Find a global label by exact name (case-insensitive) */
  findByName(name: string): Label | undefined {
    return this.db
      .prepare('SELECT * FROM labels WHERE LOWER(name) = LOWER(?)')
      .get(name) as unknown as Label | undefined
  }

  /** Create a new global label. If project_id is provided, also links to that project. */
  create(input: CreateLabelInput): Label {
    const now = new Date().toISOString()
    // Shift existing labels down to make room at top
    this.db.prepare('UPDATE labels SET order_index = order_index + 1').run()
    this.db
      .prepare(
        `INSERT INTO labels (id, name, color, order_index, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`
      )
      .run(input.id, input.name, input.color ?? '#888888', now, now)

    // If project_id provided, link label to that project
    if (input.project_id) {
      this.addToProject(input.project_id, input.id)
    }

    return this.findById(input.id)!
  }

  reorder(labelIds: string[]): void {
    withTransaction(this.db, () => {
      const stmt = this.db.prepare('UPDATE labels SET order_index = ? WHERE id = ?')
      for (let i = 0; i < labelIds.length; i++) {
        stmt.run(i, labelIds[i])
      }
    })
  }

  update(id: string, input: UpdateLabelInput): Label | undefined {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const values: (string | null)[] = [now]

    if (input.name !== undefined) {
      sets.push('name = ?')
      values.push(input.name)
    }
    if (input.color !== undefined) {
      sets.push('color = ?')
      values.push(input.color)
    }

    values.push(id)
    this.db.prepare(`UPDATE labels SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.findById(id)
  }

  /** Delete a label globally — removes from all projects and all tasks */
  delete(id: string): boolean {
    // project_labels and task_labels cascade on label delete
    const result = this.db.prepare('DELETE FROM labels WHERE id = ?').run(id)
    return result.changes > 0
  }

  /** Remove a label from a specific project. Tasks in that project lose the label. */
  removeFromProject(projectId: string, labelId: string): boolean {
    // Remove label from tasks in this project
    this.db.prepare(
      `DELETE FROM task_labels WHERE label_id = ? AND task_id IN (
        SELECT id FROM tasks WHERE project_id = ?
      )`
    ).run(labelId, projectId)

    // Remove from project_labels junction
    const result = this.db.prepare(
      'DELETE FROM project_labels WHERE project_id = ? AND label_id = ?'
    ).run(projectId, labelId)
    return result.changes > 0
  }

  /** Link an existing label to a project */
  addToProject(projectId: string, labelId: string): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO project_labels (project_id, label_id, created_at)
       VALUES (?, ?, datetime('now'))`
    ).run(projectId, labelId)
  }

  findByTaskId(taskId: string): Label[] {
    return this.db
      .prepare(
        `SELECT l.* FROM labels l
         INNER JOIN task_labels tl ON tl.label_id = l.id
         WHERE tl.task_id = ?
         ORDER BY l.order_index ASC`
      )
      .all(taskId) as unknown as Label[]
  }

  /** Get task-label mappings for tasks in a specific project */
  findTaskLabelsByProject(projectId: string): TaskLabelMapping[] {
    return this.db
      .prepare(
        `SELECT tl.task_id, l.id, l.name, l.color, l.order_index, l.created_at, l.updated_at
         FROM task_labels tl
         INNER JOIN labels l ON l.id = tl.label_id
         INNER JOIN tasks t ON t.id = tl.task_id
         WHERE t.project_id = ?
         ORDER BY l.order_index ASC`
      )
      .all(projectId) as unknown as TaskLabelMapping[]
  }

  /** Get all labels with usage counts (project count + task count) */
  findAllWithUsage(): LabelUsageInfo[] {
    return this.db
      .prepare(
        `SELECT l.*,
           COALESCE(pc.cnt, 0) as project_count,
           COALESCE(tc.cnt, 0) as task_count
         FROM labels l
         LEFT JOIN (SELECT label_id, COUNT(*) as cnt FROM project_labels GROUP BY label_id) pc ON pc.label_id = l.id
         LEFT JOIN (SELECT label_id, COUNT(*) as cnt FROM task_labels GROUP BY label_id) tc ON tc.label_id = l.id
         ORDER BY l.order_index ASC`
      )
      .all() as unknown as LabelUsageInfo[]
  }

  /** Get projects that use a specific label, with task count per project */
  findProjectsUsingLabel(labelId: string): Array<{ project_id: string; project_name: string; task_count: number }> {
    return this.db
      .prepare(
        `SELECT pl.project_id, p.name as project_name,
           (SELECT COUNT(*) FROM task_labels tl
            INNER JOIN tasks t ON t.id = tl.task_id
            WHERE tl.label_id = ? AND t.project_id = pl.project_id) as task_count
         FROM project_labels pl
         INNER JOIN projects p ON p.id = pl.project_id
         WHERE pl.label_id = ?
         ORDER BY p.name ASC`
      )
      .all(labelId, labelId) as unknown as Array<{ project_id: string; project_name: string; task_count: number }>
  }

  /** Get labels assigned to active (non-archived) tasks in a project */
  findActiveLabelsForProject(projectId: string): Label[] {
    return this.db
      .prepare(
        `SELECT DISTINCT l.* FROM labels l
         INNER JOIN task_labels tl ON tl.label_id = l.id
         INNER JOIN tasks t ON t.id = tl.task_id
         WHERE t.project_id = ? AND t.is_archived = 0
         ORDER BY l.order_index ASC`
      )
      .all(projectId) as unknown as Label[]
  }
}
