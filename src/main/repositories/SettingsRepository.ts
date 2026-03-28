import type { DatabaseSync } from 'node:sqlite'
import { withTransaction } from '../database'
import type { Setting } from '../../shared/types'

export class SettingsRepository {
  constructor(private db: DatabaseSync) {}

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string | null }
      | undefined
    return row?.value ?? null
  }

  set(key: string, value: string | null): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value)
  }

  getAll(): Setting[] {
    return this.db.prepare('SELECT * FROM settings ORDER BY key ASC').all() as unknown as Setting[]
  }

  getMultiple(keys: string[]): Setting[] {
    if (keys.length === 0) return []
    const placeholders = keys.map(() => '?').join(', ')
    return this.db
      .prepare(`SELECT * FROM settings WHERE key IN (${placeholders}) ORDER BY key ASC`)
      .all(...keys) as unknown as Setting[]
  }

  setMultiple(settings: Setting[]): void {
    withTransaction(this.db, () => {
      const stmt = this.db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      for (const setting of settings) {
        stmt.run(setting.key, setting.value)
      }
    })
  }

  delete(key: string): boolean {
    const result = this.db.prepare('DELETE FROM settings WHERE key = ?').run(key)
    return result.changes > 0
  }
}
