import type { DatabaseSync } from 'node:sqlite'
import { withTransaction } from '../database/transaction'
import type { Setting } from '../../shared/types'

export class SettingsRepository {
  constructor(private db: DatabaseSync) {}

  /**
   * Read a setting. Tombstoned rows are treated as absent so callers
   * fall back to the global default.
   */
  get(userId: string, key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE user_id = ? AND key = ? AND deleted_at IS NULL')
      .get(userId, key) as { value: string | null } | undefined
    if (row) return row.value ?? null
    // Fall back to global default (user_id = '')
    const fallback = this.db
      .prepare('SELECT value FROM settings WHERE user_id = ? AND key = ? AND deleted_at IS NULL')
      .get('', key) as { value: string | null } | undefined
    return fallback?.value ?? null
  }

  /**
   * Sync-layer raw access — returns tombstones so the sync layer can compare
   * timestamps. Composite key is (user_id, key); we expose a flat lookup.
   */
  findRaw(userId: string, key: string): Setting | undefined {
    return this.db
      .prepare('SELECT * FROM settings WHERE user_id = ? AND key = ?')
      .get(userId, key) as unknown as Setting | undefined
  }

  set(userId: string, key: string, value: string | null): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO settings (user_id, key, value, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(user_id, key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           deleted_at = NULL`
      )
      .run(userId, key, value, now)
  }

  getAll(userId: string): Setting[] {
    // Active rows only — global defaults merged with user-specific overrides.
    return this.db.prepare(
      `SELECT COALESCE(u.key, g.key) as key, COALESCE(u.value, g.value) as value
       FROM settings g
       LEFT JOIN settings u ON u.key = g.key AND u.user_id = ? AND u.deleted_at IS NULL
       WHERE g.user_id = '' AND g.deleted_at IS NULL
       UNION
       SELECT key, value FROM settings
       WHERE user_id = ? AND deleted_at IS NULL
         AND key NOT IN (SELECT key FROM settings WHERE user_id = '' AND deleted_at IS NULL)
       ORDER BY key ASC`
    ).all(userId, userId) as unknown as Setting[]
  }

  getMultiple(userId: string, keys: string[]): Setting[] {
    if (keys.length === 0) return []
    const placeholders = keys.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT key, COALESCE(
           (SELECT value FROM settings WHERE user_id = ? AND key = s.key AND deleted_at IS NULL),
           s.value
         ) as value
         FROM settings s
         WHERE s.user_id = '' AND s.deleted_at IS NULL AND s.key IN (${placeholders})
         ORDER BY key ASC`
      )
      .all(userId, ...keys) as unknown as Setting[]
  }

  setMultiple(userId: string, settings: Array<Pick<Setting, 'key' | 'value'>>): void {
    const now = new Date().toISOString()
    withTransaction(this.db, () => {
      const stmt = this.db.prepare(
        `INSERT INTO settings (user_id, key, value, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(user_id, key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           deleted_at = NULL`
      )
      for (const setting of settings) {
        stmt.run(userId, setting.key, setting.value, now)
      }
    })
  }

  /**
   * Sync-layer list. Returns rows for `userId`, optionally including tombstones.
   * Global defaults (user_id = '') are excluded — they don't sync.
   */
  findAllByUser(
    userId: string,
    options: { includeTombstones?: boolean; sinceUpdatedAt?: string | null } = {}
  ): Setting[] {
    const includeTombstones = options.includeTombstones ?? false
    const since = options.sinceUpdatedAt ?? null
    let sql = "SELECT * FROM settings WHERE user_id = ? AND user_id <> ''"
    const params: (string | number)[] = [userId]
    if (!includeTombstones) sql += ' AND deleted_at IS NULL'
    if (since) {
      sql += ' AND updated_at > ?'
      params.push(since)
    }
    sql += ' ORDER BY updated_at ASC'
    return this.db.prepare(sql).all(...params) as unknown as Setting[]
  }

  /**
   * High-water mark for incremental sync: max(updated_at) across rows for the
   * given user, INCLUDING tombstones (so a fresh soft-delete bumps the
   * high-water and the next reconcile retries any failed tombstone push).
   * Global defaults (`user_id = ''`) are still excluded — they're seeded
   * locally per release and never participate in sync.
   */
  findMaxUpdatedAt(userId: string): string | null {
    const row = this.db
      .prepare(
        "SELECT MAX(updated_at) as max FROM settings WHERE user_id = ? AND user_id <> ''"
      )
      .get(userId) as { max: string | null }
    return row.max
  }

  /**
   * Sync-only: write a setting as-is, preserving remote timestamps and deleted_at.
   * Skips when local row's updated_at is newer (LWW).
   */
  applyRemote(remote: Setting): Setting {
    const existing = this.findRaw(remote.user_id, remote.key)
    if (existing && existing.updated_at >= remote.updated_at) {
      return existing
    }
    this.db
      .prepare(
        `INSERT INTO settings (user_id, key, value, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at`
      )
      .run(
        remote.user_id,
        remote.key,
        remote.value,
        remote.updated_at,
        remote.deleted_at ?? null
      )
    return this.findRaw(remote.user_id, remote.key)!
  }

  /**
   * Soft-delete: tombstone the row + bump updated_at so peers learn about it.
   */
  delete(userId: string, key: string): boolean {
    const row = this.findRaw(userId, key)
    if (!row || row.deleted_at) return false
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `UPDATE settings SET deleted_at = ?, updated_at = ?
         WHERE user_id = ? AND key = ? AND deleted_at IS NULL`
      )
      .run(now, now, userId, key)
    return result.changes > 0
  }

  /**
   * Hard delete — physical removal. Only the 30-day purge job should call this.
   */
  hardDelete(userId: string, key: string): boolean {
    const result = this.db
      .prepare('DELETE FROM settings WHERE user_id = ? AND key = ?')
      .run(userId, key)
    return result.changes > 0
  }
}
