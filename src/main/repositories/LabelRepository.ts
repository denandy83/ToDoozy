import type Database from 'better-sqlite3'
import type { Label, CreateLabelInput, UpdateLabelInput, TaskLabelMapping } from '../../shared/types'

export class LabelRepository {
  constructor(private db: Database.Database) {}

  findById(id: string): Label | undefined {
    return this.db.prepare('SELECT * FROM labels WHERE id = ?').get(id) as Label | undefined
  }

  findByProjectId(projectId: string): Label[] {
    return this.db
      .prepare('SELECT * FROM labels WHERE project_id = ? ORDER BY order_index ASC')
      .all(projectId) as Label[]
  }

  create(input: CreateLabelInput): Label {
    const now = new Date().toISOString()
    // Shift existing labels down to make room at top
    this.db.prepare('UPDATE labels SET order_index = order_index + 1 WHERE project_id = ?').run(input.project_id)
    this.db
      .prepare(
        `INSERT INTO labels (id, project_id, name, color, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      )
      .run(input.id, input.project_id, input.name, input.color ?? '#888888', now, now)
    return this.findById(input.id)!
  }

  reorder(labelIds: string[]): void {
    const reorderTx = this.db.transaction(() => {
      const stmt = this.db.prepare('UPDATE labels SET order_index = ? WHERE id = ?')
      for (let i = 0; i < labelIds.length; i++) {
        stmt.run(i, labelIds[i])
      }
    })
    reorderTx()
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

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM labels WHERE id = ?').run(id)
    return result.changes > 0
  }

  findByTaskId(taskId: string): Label[] {
    return this.db
      .prepare(
        `SELECT l.* FROM labels l
         INNER JOIN task_labels tl ON tl.label_id = l.id
         WHERE tl.task_id = ?
         ORDER BY l.order_index ASC`
      )
      .all(taskId) as Label[]
  }

  findTaskLabelsByProject(projectId: string): TaskLabelMapping[] {
    return this.db
      .prepare(
        `SELECT tl.task_id, l.id, l.project_id, l.name, l.color, l.created_at, l.updated_at
         FROM task_labels tl
         INNER JOIN labels l ON l.id = tl.label_id
         WHERE l.project_id = ?
         ORDER BY l.order_index ASC`
      )
      .all(projectId) as TaskLabelMapping[]
  }
}
