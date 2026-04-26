import type { DatabaseSync } from 'node:sqlite'
import type { ProjectArea, CreateProjectAreaInput, UpdateProjectAreaInput } from '../../shared/types'
import { withTransaction } from '../database/transaction'

const UPDATABLE_COLUMNS = ['name', 'color', 'icon', 'sidebar_order', 'is_collapsed'] as const

export class ProjectAreaRepository {
  constructor(private db: DatabaseSync) {}

  /**
   * Raw lookup — returns tombstones too (sync layer needs them).
   */
  findById(id: string): ProjectArea | undefined {
    return this.db.prepare('SELECT * FROM project_areas WHERE id = ?').get(id) as ProjectArea | undefined
  }

  findByUserId(userId: string): ProjectArea[] {
    return this.db
      .prepare(
        'SELECT * FROM project_areas WHERE user_id = ? AND deleted_at IS NULL ORDER BY sidebar_order ASC'
      )
      .all(userId) as unknown as ProjectArea[]
  }

  create(input: CreateProjectAreaInput): ProjectArea {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO project_areas (id, user_id, name, color, icon, sidebar_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.user_id,
        input.name,
        input.color ?? '#888888',
        input.icon ?? 'folder',
        input.sidebar_order ?? 0,
        now,
        now
      )
    return this.findById(input.id)!
  }

  update(id: string, input: UpdateProjectAreaInput): ProjectArea | null {
    const sets: string[] = []
    const params: (string | number | null)[] = []

    for (const col of UPDATABLE_COLUMNS) {
      const val = (input as Record<string, unknown>)[col]
      if (val !== undefined) {
        sets.push(`${col} = ?`)
        params.push(val as string | number | null)
      }
    }

    if (sets.length === 0) return this.findById(id) ?? null

    sets.push('updated_at = ?')
    params.push(new Date().toISOString())
    params.push(id)

    this.db.prepare(`UPDATE project_areas SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return this.findById(id) ?? null
  }

  /**
   * Soft-delete: tombstone the area + clear area_id on every project that
   * pointed at it (we can't rely on FK ON DELETE SET NULL under soft-delete).
   * Both writes happen in a single transaction.
   * Returns false if the area is missing or already tombstoned.
   */
  delete(id: string): boolean {
    const row = this.findById(id)
    if (!row || row.deleted_at) return false
    const now = new Date().toISOString()
    let changed = false
    withTransaction(this.db, () => {
      const result = this.db
        .prepare(
          'UPDATE project_areas SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
        )
        .run(now, now, id)
      changed = result.changes > 0
      if (changed) {
        // Detach projects from the dying area; bump their updated_at so the
        // sync layer notices and pushes the change.
        this.db
          .prepare('UPDATE projects SET area_id = NULL, updated_at = ? WHERE area_id = ?')
          .run(now, id)
      }
    })
    return changed
  }

  /**
   * Hard delete — physical removal. Only the 30-day purge job should call this.
   */
  hardDelete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM project_areas WHERE id = ?').run(id)
    return result.changes > 0
  }

  reorder(areaIds: string[]): void {
    const now = new Date().toISOString()
    withTransaction(this.db, () => {
      const stmt = this.db.prepare(
        'UPDATE project_areas SET sidebar_order = ?, updated_at = ? WHERE id = ?'
      )
      for (let i = 0; i < areaIds.length; i++) {
        stmt.run(i, now, areaIds[i])
      }
    })
  }

  assignProject(projectId: string, areaId: string | null): void {
    const now = new Date().toISOString()
    this.db
      .prepare('UPDATE projects SET area_id = ?, updated_at = ? WHERE id = ?')
      .run(areaId, now, projectId)
  }

  /**
   * Sync-layer list. Returns rows for `userId`, optionally including tombstones.
   */
  findAllByUser(
    userId: string,
    options: { includeTombstones?: boolean; sinceUpdatedAt?: string | null } = {}
  ): ProjectArea[] {
    const includeTombstones = options.includeTombstones ?? false
    const since = options.sinceUpdatedAt ?? null
    let sql = 'SELECT * FROM project_areas WHERE user_id = ?'
    const params: (string | number)[] = [userId]
    if (!includeTombstones) sql += ' AND deleted_at IS NULL'
    if (since) {
      sql += ' AND updated_at > ?'
      params.push(since)
    }
    sql += ' ORDER BY updated_at ASC'
    return this.db.prepare(sql).all(...params) as unknown as ProjectArea[]
  }

  /**
   * High-water mark for incremental sync: max(updated_at) across ALL rows
   * including tombstones (so a fresh soft-delete bumps the high-water and
   * the next reconcile retries any failed tombstone push).
   */
  findMaxUpdatedAt(userId: string): string | null {
    const row = this.db
      .prepare('SELECT MAX(updated_at) as max FROM project_areas WHERE user_id = ?')
      .get(userId) as { max: string | null }
    return row.max
  }

  /**
   * Sync-only: write a project area as-is, preserving remote timestamps and
   * deleted_at. Skips when local row's updated_at is newer (LWW).
   */
  applyRemote(remote: ProjectArea): ProjectArea {
    const existing = this.findById(remote.id)
    if (existing && existing.updated_at >= remote.updated_at) {
      return existing
    }
    this.db
      .prepare(
        `INSERT INTO project_areas (id, user_id, name, color, icon, sidebar_order, is_collapsed, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           user_id = excluded.user_id,
           name = excluded.name,
           color = excluded.color,
           icon = excluded.icon,
           sidebar_order = excluded.sidebar_order,
           is_collapsed = excluded.is_collapsed,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at`
      )
      .run(
        remote.id,
        remote.user_id,
        remote.name,
        remote.color,
        remote.icon,
        remote.sidebar_order,
        remote.is_collapsed,
        remote.created_at,
        remote.updated_at,
        remote.deleted_at ?? null
      )
    return this.findById(remote.id)!
  }
}
