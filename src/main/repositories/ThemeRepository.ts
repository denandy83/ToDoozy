import type { DatabaseSync } from 'node:sqlite'
import { withTransaction } from '../database/transaction'
import type { Theme, ThemeConfig, CreateThemeInput, UpdateThemeInput } from '../../shared/types'

export class ThemeRepository {
  constructor(private db: DatabaseSync) {}

  // Raw — sync layer needs to see tombstones to compare timestamps.
  findById(id: string): Theme | undefined {
    return this.db.prepare('SELECT * FROM themes WHERE id = ?').get(id) as unknown as Theme | undefined
  }

  list(userId?: string): Theme[] {
    if (userId) {
      return this.db
        .prepare(
          `SELECT * FROM themes
           WHERE deleted_at IS NULL AND (is_builtin = 1 OR owner_id = ?)
           ORDER BY name ASC`
        )
        .all(userId) as unknown as Theme[]
    }
    return this.db
      .prepare('SELECT * FROM themes WHERE deleted_at IS NULL ORDER BY name ASC')
      .all() as unknown as Theme[]
  }

  listByMode(mode: string, userId?: string): Theme[] {
    if (userId) {
      return this.db
        .prepare(
          `SELECT * FROM themes
           WHERE mode = ? AND deleted_at IS NULL AND (is_builtin = 1 OR owner_id = ?)
           ORDER BY name ASC`
        )
        .all(mode, userId) as unknown as Theme[]
    }
    return this.db
      .prepare('SELECT * FROM themes WHERE mode = ? AND deleted_at IS NULL ORDER BY name ASC')
      .all(mode) as unknown as Theme[]
  }

  /**
   * Sync-layer list. Returns user-owned (non-builtin) themes for `ownerId`.
   * Built-ins are seeded locally only — they don't sync.
   */
  findAllByOwner(
    ownerId: string,
    options: { includeTombstones?: boolean; sinceUpdatedAt?: string | null } = {}
  ): Theme[] {
    const includeTombstones = options.includeTombstones ?? false
    const since = options.sinceUpdatedAt ?? null
    let sql = 'SELECT * FROM themes WHERE owner_id = ? AND is_builtin = 0'
    const params: (string | number)[] = [ownerId]
    if (!includeTombstones) sql += ' AND deleted_at IS NULL'
    if (since) {
      sql += ' AND updated_at > ?'
      params.push(since)
    }
    sql += ' ORDER BY updated_at ASC'
    return this.db.prepare(sql).all(...params) as unknown as Theme[]
  }

  /**
   * High-water mark for incremental sync: max(updated_at) across rows owned
   * by ownerId, INCLUDING tombstones (so a fresh soft-delete bumps the
   * high-water and the next reconcile retries any failed tombstone push).
   * Built-in themes are still excluded — they're seeded locally per release
   * and never participate in sync.
   */
  findMaxUpdatedAt(ownerId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT MAX(updated_at) as max FROM themes
         WHERE owner_id = ? AND is_builtin = 0`
      )
      .get(ownerId) as { max: string | null }
    return row.max
  }

  create(input: CreateThemeInput & { owner_id?: string }): Theme {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO themes (id, name, mode, config, owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(input.id, input.name, input.mode, input.config, input.owner_id ?? null, now, now)
    return this.findById(input.id)!
  }

  update(id: string, input: UpdateThemeInput): Theme | undefined {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const values: (string | null)[] = [now]

    if (input.name !== undefined) {
      sets.push('name = ?')
      values.push(input.name)
    }
    if (input.mode !== undefined) {
      sets.push('mode = ?')
      values.push(input.mode)
    }
    if (input.config !== undefined) {
      sets.push('config = ?')
      values.push(input.config)
    }

    values.push(id)
    this.db.prepare(`UPDATE themes SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.findById(id)
  }

  /**
   * Sync-only: write a theme as-is, preserving remote timestamps and deleted_at.
   * Skips when local row's updated_at is newer (LWW). Built-in themes are
   * never overwritten — they're seeded locally and don't round-trip.
   */
  applyRemote(remote: Theme): Theme {
    const existing = this.findById(remote.id)
    if (existing && existing.is_builtin === 1) return existing
    if (existing && existing.updated_at >= remote.updated_at) {
      return existing
    }
    this.db
      .prepare(
        `INSERT INTO themes (id, name, mode, config, is_builtin, owner_id, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           mode = excluded.mode,
           config = excluded.config,
           owner_id = excluded.owner_id,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at`
      )
      .run(
        remote.id,
        remote.name,
        remote.mode,
        remote.config,
        remote.is_builtin ?? 0,
        remote.owner_id,
        remote.created_at,
        remote.updated_at,
        remote.deleted_at ?? null
      )
    return this.findById(remote.id)!
  }

  /**
   * Soft-delete. Built-in themes are protected — call hardDelete() if you
   * really need to remove a built-in (e.g. cleanup after a renaming migration).
   */
  delete(id: string): boolean {
    return withTransaction(this.db, () => {
      const row = this.findById(id)
      if (!row || row.deleted_at) return false
      if (row.is_builtin === 1) return false
      const now = new Date().toISOString()
      const result = this.db
        .prepare('UPDATE themes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(now, now, id)
      return result.changes > 0
    })
  }

  /**
   * Hard delete — physical removal. Used by the 30-day purge job and to
   * remove builtins that have been renamed/dropped between releases.
   */
  hardDelete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM themes WHERE id = ?').run(id)
    return result.changes > 0
  }

  getConfig(id: string): ThemeConfig | undefined {
    const theme = this.findById(id)
    if (!theme || theme.deleted_at) return undefined
    return JSON.parse(theme.config) as unknown as ThemeConfig
  }
}
