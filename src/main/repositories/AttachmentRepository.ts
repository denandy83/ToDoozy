import type { DatabaseSync } from 'node:sqlite'
import type { Attachment } from '../../shared/types'

interface AttachmentRow {
  id: string
  task_id: string
  filename: string
  mime_type: string
  size_bytes: number
  created_at: string
  updated_at: string
}

interface AttachmentFileData {
  filename: string
  mime_type: string
  file_data: Buffer
}

interface CreateAttachmentInput {
  id: string
  task_id: string
  filename: string
  mime_type: string
  size_bytes: number
  file_data: Buffer
}

export class AttachmentRepository {
  constructor(private db: DatabaseSync) {}

  findByTaskId(taskId: string): Attachment[] {
    return this.db
      .prepare(
        'SELECT id, task_id, filename, mime_type, size_bytes, created_at, updated_at FROM attachments WHERE task_id = ? ORDER BY created_at ASC'
      )
      .all(taskId) as unknown as AttachmentRow[]
  }

  getFileData(id: string): AttachmentFileData | undefined {
    const row = this.db
      .prepare('SELECT filename, mime_type, file_data FROM attachments WHERE id = ?')
      .get(id) as unknown as { filename: string; mime_type: string; file_data: Uint8Array } | undefined
    if (!row) return undefined
    return { filename: row.filename, mime_type: row.mime_type, file_data: Buffer.from(row.file_data) }
  }

  create(input: CreateAttachmentInput): Attachment {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO attachments (id, task_id, filename, mime_type, size_bytes, file_data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(input.id, input.task_id, input.filename, input.mime_type, input.size_bytes, input.file_data, now, now)
    return this.db
      .prepare(
        'SELECT id, task_id, filename, mime_type, size_bytes, created_at, updated_at FROM attachments WHERE id = ?'
      )
      .get(input.id) as unknown as Attachment
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id)
    return result.changes > 0
  }

  deleteByTaskId(taskId: string): number {
    const result = this.db.prepare('DELETE FROM attachments WHERE task_id = ?').run(taskId)
    return Number(result.changes)
  }
}
