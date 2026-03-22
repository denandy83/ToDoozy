import type Database from 'better-sqlite3'
import type { Attachment, CreateAttachmentInput } from '../../shared/types'

export class AttachmentRepository {
  constructor(private db: Database.Database) {}

  findById(id: string): Attachment | undefined {
    return this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as
      | Attachment
      | undefined
  }

  findByTaskId(taskId: string): Attachment[] {
    return this.db
      .prepare('SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at ASC')
      .all(taskId) as Attachment[]
  }

  create(input: CreateAttachmentInput): Attachment {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO attachments (id, task_id, filename, mime_type, size_bytes, local_path, icloud_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.task_id,
        input.filename,
        input.mime_type,
        input.size_bytes,
        input.local_path,
        input.icloud_path ?? null,
        now,
        now
      )
    return this.findById(input.id)!
  }

  updateIcloudPath(id: string, icloudPath: string | null): Attachment | undefined {
    const now = new Date().toISOString()
    this.db
      .prepare('UPDATE attachments SET icloud_path = ?, updated_at = ? WHERE id = ?')
      .run(icloudPath, now, id)
    return this.findById(id)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id)
    return result.changes > 0
  }

  deleteByTaskId(taskId: string): number {
    const result = this.db.prepare('DELETE FROM attachments WHERE task_id = ?').run(taskId)
    return result.changes
  }

  countByTaskId(taskId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM attachments WHERE task_id = ?')
      .get(taskId) as { count: number }
    return row.count
  }
}
