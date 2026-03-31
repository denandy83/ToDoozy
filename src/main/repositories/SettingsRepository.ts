import type { DatabaseSync } from 'node:sqlite'
import { withTransaction } from '../database'
import type { Setting } from '../../shared/types'

export class SettingsRepository {
  constructor(private db: DatabaseSync) {}

  get(userId: string, key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').get(userId, key) as
      | { value: string | null }
      | undefined
    if (row) return row.value ?? null
    // Fall back to global default (user_id = '')
    const fallback = this.db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').get('', key) as
      | { value: string | null }
      | undefined
    return fallback?.value ?? null
  }

  set(userId: string, key: string, value: string | null): void {
    this.db
      .prepare(
        `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
      )
      .run(userId, key, value)
  }

  getAll(userId: string): Setting[] {
    // Get global defaults merged with user-specific overrides
    return this.db.prepare(
      `SELECT COALESCE(u.key, g.key) as key, COALESCE(u.value, g.value) as value
       FROM settings g
       LEFT JOIN settings u ON u.key = g.key AND u.user_id = ?
       WHERE g.user_id = ''
       UNION
       SELECT key, value FROM settings WHERE user_id = ? AND key NOT IN (SELECT key FROM settings WHERE user_id = '')
       ORDER BY key ASC`
    ).all(userId, userId) as unknown as Setting[]
  }

  getMultiple(userId: string, keys: string[]): Setting[] {
    if (keys.length === 0) return []
    const placeholders = keys.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT key, COALESCE(
           (SELECT value FROM settings WHERE user_id = ? AND key = s.key),
           s.value
         ) as value
         FROM settings s
         WHERE s.user_id = '' AND s.key IN (${placeholders})
         ORDER BY key ASC`
      )
      .all(userId, ...keys) as unknown as Setting[]
  }

  setMultiple(userId: string, settings: Setting[]): void {
    withTransaction(this.db, () => {
      const stmt = this.db.prepare(
        `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
      )
      for (const setting of settings) {
        stmt.run(userId, setting.key, setting.value)
      }
    })
  }

  delete(userId: string, key: string): boolean {
    const result = this.db.prepare('DELETE FROM settings WHERE user_id = ? AND key = ?').run(userId, key)
    return result.changes > 0
  }
}
