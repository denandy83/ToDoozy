import type { DatabaseSync } from 'node:sqlite'
import type { SyncQueueEntry, SyncOperation } from '../../shared/types'

export class SyncQueueRepository {
  constructor(private db: DatabaseSync) {}

  findAll(): SyncQueueEntry[] {
    return this.db
      .prepare('SELECT * FROM sync_queue ORDER BY created_at ASC')
      .all() as unknown as SyncQueueEntry[]
  }

  enqueue(tableName: string, rowId: string, operation: SyncOperation, payload: string): SyncQueueEntry {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO sync_queue (id, table_name, row_id, operation, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, tableName, rowId, operation, payload, now)
    return { id, table_name: tableName, row_id: rowId, operation, payload, created_at: now }
  }

  dequeue(id: string): boolean {
    const result = this.db.prepare('DELETE FROM sync_queue WHERE id = ?').run(id)
    return result.changes > 0
  }

  clear(): number {
    const result = this.db.prepare('DELETE FROM sync_queue').run()
    return Number(result.changes)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM sync_queue').get() as { count: number }
    return row.count
  }
}
