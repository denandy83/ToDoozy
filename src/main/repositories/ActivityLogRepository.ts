import type { DatabaseSync } from 'node:sqlite'
import type { ActivityLogEntry, CreateActivityLogInput } from '../../shared/types'

export class ActivityLogRepository {
  constructor(private db: DatabaseSync) {}

  findById(id: string): ActivityLogEntry | undefined {
    return this.db.prepare('SELECT * FROM activity_log WHERE id = ?').get(id) as
      | ActivityLogEntry
      | undefined
  }

  findByTaskId(taskId: string): ActivityLogEntry[] {
    return this.db
      .prepare('SELECT * FROM activity_log WHERE task_id = ? ORDER BY created_at DESC')
      .all(taskId) as unknown as ActivityLogEntry[]
  }

  findByUserId(userId: string): ActivityLogEntry[] {
    return this.db
      .prepare('SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as unknown as ActivityLogEntry[]
  }

  create(input: CreateActivityLogInput): ActivityLogEntry {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO activity_log (id, task_id, user_id, action, old_value, new_value, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.task_id,
        input.user_id,
        input.action,
        input.old_value ?? null,
        input.new_value ?? null,
        now
      )
    return this.findById(input.id)!
  }

  deleteByTaskId(taskId: string): number {
    const result = this.db.prepare('DELETE FROM activity_log WHERE task_id = ?').run(taskId)
    return Number(result.changes)
  }

  getRecent(limit: number): ActivityLogEntry[] {
    return this.db
      .prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?')
      .all(limit) as unknown as ActivityLogEntry[]
  }
}
