import type { DatabaseSync } from 'node:sqlite'
import { withTransaction } from '../database/transaction'
import type { Label, CreateLabelInput, UpdateLabelInput, TaskLabelMapping, LabelUsageInfo } from '../../shared/types'

export class LabelRepository {
  constructor(private db: DatabaseSync) {}

  // Raw — sync layer needs to see tombstones to compare timestamps.
  findById(id: string): Label | undefined {
    return this.db.prepare('SELECT * FROM labels WHERE id = ?').get(id) as unknown as Label | undefined
  }

  findByIds(ids: string[]): Label[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    return this.db
      .prepare(`SELECT * FROM labels WHERE id IN (${placeholders}) AND deleted_at IS NULL`)
      .all(...ids) as unknown as Label[]
  }

  /** Get all labels accessible to a user (linked to any of their projects) */
  findAllForUser(userId: string): Label[] {
    return this.db.prepare(
      `SELECT DISTINCT l.* FROM labels l
       INNER JOIN project_labels pl ON pl.label_id = l.id AND pl.deleted_at IS NULL
       INNER JOIN project_members pm ON pm.project_id = pl.project_id
       WHERE pm.user_id = ? AND l.deleted_at IS NULL
       ORDER BY l.order_index ASC`
    ).all(userId) as unknown as Label[]
  }

  /** Get labels linked to a specific project via project_labels junction */
  findByProjectId(projectId: string): Label[] {
    return this.db
      .prepare(
        `SELECT l.* FROM labels l
         INNER JOIN project_labels pl ON pl.label_id = l.id AND pl.deleted_at IS NULL
         WHERE pl.project_id = ? AND l.deleted_at IS NULL
         ORDER BY l.order_index ASC`
      )
      .all(projectId) as unknown as Label[]
  }

  /**
   * Find a label by name owned by this user (case-insensitive).
   * Falls back to the legacy project_labels join for any pre-migration rows
   * whose user_id is still NULL — once those are healed we can drop the fallback.
   */
  findByName(userId: string, name: string): Label | undefined {
    const direct = this.db
      .prepare(
        `SELECT * FROM labels
         WHERE user_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(userId, name) as unknown as Label | undefined
    if (direct) return direct

    const legacy = this.db
      .prepare(
        `SELECT DISTINCT l.* FROM labels l
         INNER JOIN project_labels pl ON pl.label_id = l.id AND pl.deleted_at IS NULL
         INNER JOIN project_members pm ON pm.project_id = pl.project_id
         WHERE pm.user_id = ? AND LOWER(l.name) = LOWER(?) AND l.user_id IS NULL AND l.deleted_at IS NULL
         LIMIT 1`
      )
      .get(userId, name) as unknown as Label | undefined
    if (legacy) {
      // Heal: stamp user_id so subsequent lookups hit the fast path.
      this.db.prepare(`UPDATE labels SET user_id = ? WHERE id = ? AND user_id IS NULL`).run(userId, legacy.id)
      legacy.user_id = userId
    }
    return legacy
  }

  /**
   * Sync-layer list. Returns ALL rows for a user, optionally including tombstones.
   */
  findAllByUser(
    userId: string,
    options: { includeTombstones?: boolean; sinceUpdatedAt?: string | null } = {}
  ): Label[] {
    const includeTombstones = options.includeTombstones ?? false
    const since = options.sinceUpdatedAt ?? null
    let sql = 'SELECT * FROM labels WHERE user_id = ?'
    const params: (string | number)[] = [userId]
    if (!includeTombstones) sql += ' AND deleted_at IS NULL'
    if (since) {
      sql += ' AND updated_at > ?'
      params.push(since)
    }
    sql += ' ORDER BY updated_at ASC'
    return this.db.prepare(sql).all(...params) as unknown as Label[]
  }

  /**
   * High-water mark for incremental sync: max(updated_at) across ALL rows
   * including tombstones (so a fresh soft-delete bumps the high-water and
   * the next reconcile retries any failed tombstone push).
   */
  findMaxUpdatedAt(userId: string): string | null {
    const row = this.db
      .prepare('SELECT MAX(updated_at) as max FROM labels WHERE user_id = ?')
      .get(userId) as { max: string | null }
    return row.max
  }

  /** Create a new label owned by user_id. If project_id is provided, also links to that project. */
  create(input: CreateLabelInput): Label {
    const now = new Date().toISOString()
    // Shift existing labels down to make room at top
    this.db.prepare('UPDATE labels SET order_index = order_index + 1').run()
    this.db
      .prepare(
        `INSERT INTO labels (id, user_id, name, color, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      )
      .run(input.id, input.user_id, input.name, input.color ?? '#888888', now, now)

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

  /**
   * Sync-only: write a label as-is, preserving remote timestamps and deleted_at.
   * Skips when local row's updated_at is newer (LWW).
   */
  applyRemote(remote: Label): Label {
    const existing = this.findById(remote.id)
    if (existing && existing.updated_at >= remote.updated_at) {
      return existing
    }
    this.db
      .prepare(
        `INSERT INTO labels (id, user_id, name, color, order_index, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           user_id = excluded.user_id,
           name = excluded.name,
           color = excluded.color,
           order_index = excluded.order_index,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at`
      )
      .run(
        remote.id,
        remote.user_id,
        remote.name,
        remote.color,
        remote.order_index,
        remote.created_at,
        remote.updated_at,
        remote.deleted_at ?? null
      )
    return this.findById(remote.id)!
  }

  /**
   * Soft-delete: tombstone the label AND cascade tombstones to junction rows.
   * task_labels is synced (has deleted_at on prod), project_labels is local-only.
   * Both get soft-deleted locally for uniformity. Sync push handles task_labels.
   */
  delete(id: string): boolean {
    return withTransaction(this.db, () => {
      const row = this.findById(id)
      if (!row || row.deleted_at) return false

      const now = new Date().toISOString()

      this.db
        .prepare('UPDATE task_labels SET deleted_at = ? WHERE label_id = ? AND deleted_at IS NULL')
        .run(now, id)
      this.db
        .prepare('UPDATE project_labels SET deleted_at = ? WHERE label_id = ? AND deleted_at IS NULL')
        .run(now, id)

      const result = this.db
        .prepare('UPDATE labels SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(now, now, id)
      return result.changes > 0
    })
  }

  /**
   * Hard delete — physical removal. ONLY used by the 30-day purge job.
   */
  hardDelete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM labels WHERE id = ?').run(id)
    return result.changes > 0
  }

  /** Remove a label from a specific project. Tasks in that project lose the label. */
  removeFromProject(projectId: string, labelId: string): boolean {
    const now = new Date().toISOString()
    return withTransaction(this.db, () => {
      // Soft-delete task_labels for tasks in this project (active rows only)
      this.db.prepare(
        `UPDATE task_labels SET deleted_at = ?
         WHERE label_id = ? AND deleted_at IS NULL AND task_id IN (
           SELECT id FROM tasks WHERE project_id = ?
         )`
      ).run(now, labelId, projectId)

      // Soft-delete the project_labels junction row
      const result = this.db.prepare(
        'UPDATE project_labels SET deleted_at = ? WHERE project_id = ? AND label_id = ? AND deleted_at IS NULL'
      ).run(now, projectId, labelId)
      return result.changes > 0
    })
  }

  /** Link an existing label to a project — revives a tombstoned link if present. */
  addToProject(projectId: string, labelId: string): void {
    this.db.prepare(
      `INSERT INTO project_labels (project_id, label_id, created_at, deleted_at)
       VALUES (?, ?, datetime('now'), NULL)
       ON CONFLICT(project_id, label_id) DO UPDATE SET deleted_at = NULL`
    ).run(projectId, labelId)
  }

  findByTaskId(taskId: string): Label[] {
    return this.db
      .prepare(
        `SELECT l.* FROM labels l
         INNER JOIN task_labels tl ON tl.label_id = l.id AND tl.deleted_at IS NULL
         WHERE tl.task_id = ? AND l.deleted_at IS NULL
         ORDER BY l.order_index ASC`
      )
      .all(taskId) as unknown as Label[]
  }

  /** Get task-label mappings for tasks in a specific project */
  findTaskLabelsByProject(projectId: string): TaskLabelMapping[] {
    return this.db
      .prepare(
        `SELECT tl.task_id, l.id, l.name, l.color, l.user_id, l.order_index, l.created_at, l.updated_at, l.deleted_at
         FROM task_labels tl
         INNER JOIN labels l ON l.id = tl.label_id
         INNER JOIN tasks t ON t.id = tl.task_id
         WHERE t.project_id = ? AND tl.deleted_at IS NULL AND l.deleted_at IS NULL AND t.deleted_at IS NULL
         ORDER BY l.order_index ASC`
      )
      .all(projectId) as unknown as TaskLabelMapping[]
  }

  /** Get all labels accessible to a user with usage counts */
  findAllWithUsage(userId: string): LabelUsageInfo[] {
    return this.db
      .prepare(
        `SELECT l.*,
           COALESCE(pc.cnt, 0) as project_count,
           COALESCE(tc.cnt, 0) as task_count
         FROM labels l
         INNER JOIN project_labels pl ON pl.label_id = l.id AND pl.deleted_at IS NULL
         INNER JOIN project_members pm ON pm.project_id = pl.project_id
         LEFT JOIN (
           SELECT label_id, COUNT(*) as cnt FROM project_labels
           WHERE deleted_at IS NULL AND project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
           GROUP BY label_id
         ) pc ON pc.label_id = l.id
         LEFT JOIN (
           SELECT tl.label_id, COUNT(*) as cnt FROM task_labels tl
           INNER JOIN tasks t ON t.id = tl.task_id
           WHERE tl.deleted_at IS NULL AND t.deleted_at IS NULL AND t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
           GROUP BY tl.label_id
         ) tc ON tc.label_id = l.id
         WHERE pm.user_id = ? AND l.deleted_at IS NULL
         GROUP BY l.id
         ORDER BY l.order_index ASC`
      )
      .all(userId, userId, userId) as unknown as LabelUsageInfo[]
  }

  /** Get projects (that the user has access to) that use a specific label, with task count per project */
  findProjectsUsingLabel(userId: string, labelId: string): Array<{ project_id: string; project_name: string; task_count: number }> {
    return this.db
      .prepare(
        `SELECT pl.project_id, p.name as project_name,
           (SELECT COUNT(*) FROM task_labels tl
            INNER JOIN tasks t ON t.id = tl.task_id
            WHERE tl.label_id = ? AND tl.deleted_at IS NULL AND t.deleted_at IS NULL AND t.project_id = pl.project_id) as task_count
         FROM project_labels pl
         INNER JOIN projects p ON p.id = pl.project_id
         INNER JOIN project_members pm ON pm.project_id = pl.project_id
         WHERE pl.label_id = ? AND pm.user_id = ? AND pl.deleted_at IS NULL AND p.deleted_at IS NULL
         ORDER BY p.name ASC`
      )
      .all(labelId, labelId, userId) as unknown as Array<{ project_id: string; project_name: string; task_count: number }>
  }

  /** Get labels assigned to active (non-archived) tasks in a project */
  findActiveLabelsForProject(projectId: string): Label[] {
    return this.db
      .prepare(
        `SELECT DISTINCT l.* FROM labels l
         INNER JOIN task_labels tl ON tl.label_id = l.id AND tl.deleted_at IS NULL
         INNER JOIN tasks t ON t.id = tl.task_id
         WHERE t.project_id = ? AND t.is_archived = 0 AND t.deleted_at IS NULL AND l.deleted_at IS NULL
         ORDER BY l.order_index ASC`
      )
      .all(projectId) as unknown as Label[]
  }
}
