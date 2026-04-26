import type { DatabaseSync } from 'node:sqlite'
import { withTransaction } from '../database/transaction'
import type { Status, CreateStatusInput, UpdateStatusInput } from '../../shared/types'

export class StatusRepository {
  constructor(private db: DatabaseSync) {}

  // Raw — sync layer needs to see tombstones to compare timestamps.
  findById(id: string): Status | undefined {
    return this.db.prepare('SELECT * FROM statuses WHERE id = ?').get(id) as unknown as Status | undefined
  }

  findByProjectId(projectId: string): Status[] {
    return this.db
      .prepare('SELECT * FROM statuses WHERE project_id = ? AND deleted_at IS NULL ORDER BY order_index ASC')
      .all(projectId) as unknown as Status[]
  }

  findDefault(projectId: string): Status | undefined {
    return this.db
      .prepare('SELECT * FROM statuses WHERE project_id = ? AND deleted_at IS NULL AND is_default = 1')
      .get(projectId) as unknown as Status | undefined
  }

  findDone(projectId: string): Status | undefined {
    return this.db
      .prepare('SELECT * FROM statuses WHERE project_id = ? AND deleted_at IS NULL AND is_done = 1')
      .get(projectId) as unknown as Status | undefined
  }

  /**
   * Sync-layer list. Returns ALL rows for a project, optionally including tombstones.
   */
  findAllByProject(projectId: string, options: { includeTombstones?: boolean; sinceUpdatedAt?: string | null } = {}): Status[] {
    const includeTombstones = options.includeTombstones ?? false
    const since = options.sinceUpdatedAt ?? null
    let sql = 'SELECT * FROM statuses WHERE project_id = ?'
    const params: (string | number)[] = [projectId]
    if (!includeTombstones) sql += ' AND deleted_at IS NULL'
    if (since) {
      sql += ' AND updated_at > ?'
      params.push(since)
    }
    sql += ' ORDER BY updated_at ASC'
    return this.db.prepare(sql).all(...params) as unknown as Status[]
  }

  /**
   * High-water mark for incremental sync: max(updated_at) across ALL rows
   * including tombstones (so a fresh soft-delete bumps the high-water and
   * the next reconcile retries any failed tombstone push).
   */
  findMaxUpdatedAt(projectId: string): string | null {
    const row = this.db
      .prepare('SELECT MAX(updated_at) as max FROM statuses WHERE project_id = ?')
      .get(projectId) as { max: string | null }
    return row.max
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

  /**
   * Sync-only: write a status as-is, preserving remote timestamps and deleted_at.
   * Skips when local row's updated_at is newer (LWW).
   */
  applyRemote(remote: Status): Status {
    const existing = this.findById(remote.id)
    if (existing && existing.updated_at >= remote.updated_at) {
      return existing
    }
    this.db
      .prepare(
        `INSERT INTO statuses (id, project_id, name, color, icon, order_index, is_done, is_default, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id = excluded.project_id,
           name = excluded.name,
           color = excluded.color,
           icon = excluded.icon,
           order_index = excluded.order_index,
           is_done = excluded.is_done,
           is_default = excluded.is_default,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at`
      )
      .run(
        remote.id,
        remote.project_id,
        remote.name,
        remote.color,
        remote.icon,
        remote.order_index,
        remote.is_done,
        remote.is_default,
        remote.created_at,
        remote.updated_at,
        remote.deleted_at ?? null
      )
    return this.findById(remote.id)!
  }

  /**
   * Soft-delete: tombstone the status AND reassign tasks holding it back to the
   * project's default. Without reassignment those tasks would orphan; the
   * existing TaskRepository.repairOrphanedStatuses would patch them on next read,
   * but doing it here is atomic and emits a single `updated_at` bump per task
   * for the sync layer to pick up.
   */
  delete(id: string): boolean {
    return withTransaction(this.db, () => {
      const row = this.findById(id)
      if (!row || row.deleted_at) return false

      // Find the project's default status (excluding this one)
      const def = this.db
        .prepare(
          `SELECT id FROM statuses
           WHERE project_id = ? AND id != ? AND deleted_at IS NULL AND is_default = 1
           LIMIT 1`
        )
        .get(row.project_id, id) as { id: string } | undefined
      const fallbackId = def?.id

      const now = new Date().toISOString()
      if (fallbackId) {
        this.db
          .prepare('UPDATE tasks SET status_id = ?, updated_at = ? WHERE status_id = ? AND deleted_at IS NULL')
          .run(fallbackId, now, id)
      }

      const result = this.db
        .prepare('UPDATE statuses SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(now, now, id)
      return result.changes > 0
    })
  }

  /**
   * Hard delete — physical removal. ONLY used by the 30-day purge job.
   */
  hardDelete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM statuses WHERE id = ?').run(id)
    return result.changes > 0
  }

  reassignAndDelete(statusId: string, targetStatusId: string): boolean {
    return withTransaction(this.db, () => {
      const now = new Date().toISOString()
      this.db
        .prepare('UPDATE tasks SET status_id = ?, updated_at = ? WHERE status_id = ? AND deleted_at IS NULL')
        .run(targetStatusId, now, statusId)
      const result = this.db
        .prepare('UPDATE statuses SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(now, now, statusId)
      return result.changes > 0
    })
  }
}
