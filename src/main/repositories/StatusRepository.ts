import type Database from 'better-sqlite3'
import type { Status, CreateStatusInput, UpdateStatusInput } from '../../shared/types'

export class StatusRepository {
  constructor(private db: Database.Database) {}

  findById(id: string): Status | undefined {
    return this.db.prepare('SELECT * FROM statuses WHERE id = ?').get(id) as Status | undefined
  }

  findByProjectId(projectId: string): Status[] {
    return this.db
      .prepare('SELECT * FROM statuses WHERE project_id = ? ORDER BY order_index ASC')
      .all(projectId) as Status[]
  }

  findDefault(projectId: string): Status | undefined {
    return this.db
      .prepare('SELECT * FROM statuses WHERE project_id = ? AND is_default = 1')
      .get(projectId) as Status | undefined
  }

  findDone(projectId: string): Status | undefined {
    return this.db
      .prepare('SELECT * FROM statuses WHERE project_id = ? AND is_done = 1')
      .get(projectId) as Status | undefined
  }

  create(input: CreateStatusInput): Status {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO statuses (id, project_id, name, color, icon, order_index, is_done, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.project_id,
        input.name,
        input.color ?? '#888888',
        input.icon ?? 'circle',
        input.order_index ?? 0,
        input.is_done ?? 0,
        input.is_default ?? 0,
        now,
        now
      )
    return this.findById(input.id)!
  }

  update(id: string, input: UpdateStatusInput): Status | undefined {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const values: (string | number | null)[] = [now]

    if (input.name !== undefined) {
      sets.push('name = ?')
      values.push(input.name)
    }
    if (input.color !== undefined) {
      sets.push('color = ?')
      values.push(input.color)
    }
    if (input.icon !== undefined) {
      sets.push('icon = ?')
      values.push(input.icon)
    }
    if (input.order_index !== undefined) {
      sets.push('order_index = ?')
      values.push(input.order_index)
    }
    if (input.is_done !== undefined) {
      sets.push('is_done = ?')
      values.push(input.is_done)
    }
    if (input.is_default !== undefined) {
      sets.push('is_default = ?')
      values.push(input.is_default)
    }

    values.push(id)
    this.db.prepare(`UPDATE statuses SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.findById(id)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM statuses WHERE id = ?').run(id)
    return result.changes > 0
  }

  reassignAndDelete(statusId: string, targetStatusId: string): boolean {
    const reassignAndRemove = this.db.transaction(() => {
      this.db
        .prepare('UPDATE tasks SET status_id = ? WHERE status_id = ?')
        .run(targetStatusId, statusId)
      return this.db.prepare('DELETE FROM statuses WHERE id = ?').run(statusId).changes > 0
    })
    return reassignAndRemove()
  }
}
