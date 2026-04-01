import type { DatabaseSync } from 'node:sqlite'
import type { Notification, CreateNotificationInput } from '../../shared/types'

export class NotificationRepository {
  constructor(private db: DatabaseSync) {}

  findById(id: string): Notification | undefined {
    return this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as unknown as Notification | undefined
  }

  findAll(limit = 50): Notification[] {
    return this.db
      .prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?')
      .all(limit) as unknown as Notification[]
  }

  findUnread(): Notification[] {
    return this.db
      .prepare('SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC')
      .all() as unknown as Notification[]
  }

  getUnreadCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM notifications WHERE read = 0')
      .get() as { count: number }
    return row.count
  }

  create(input: CreateNotificationInput): Notification {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO notifications (id, type, message, task_id, project_id, from_user_id, read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        input.id,
        input.type,
        input.message,
        input.task_id ?? null,
        input.project_id ?? null,
        input.from_user_id ?? null,
        now
      )
    return this.findById(input.id)!
  }

  markAsRead(id: string): boolean {
    const result = this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id)
    return result.changes > 0
  }

  markAllAsRead(): number {
    const result = this.db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run()
    return Number(result.changes)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM notifications WHERE id = ?').run(id)
    return result.changes > 0
  }

  deleteByProjectId(projectId: string): number {
    const result = this.db.prepare('DELETE FROM notifications WHERE project_id = ?').run(projectId)
    return Number(result.changes)
  }
}
