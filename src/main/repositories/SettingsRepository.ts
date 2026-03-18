import type Database from 'better-sqlite3'
import type { Setting } from '../../shared/types'

export class SettingsRepository {
  constructor(private db: Database.Database) {}

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
    return this.db.prepare('SELECT * FROM settings ORDER BY key ASC').all() as Setting[]
  }

  getMultiple(keys: string[]): Setting[] {
    if (keys.length === 0) return []
    const placeholders = keys.map(() => '?').join(', ')
    return this.db
      .prepare(`SELECT * FROM settings WHERE key IN (${placeholders}) ORDER BY key ASC`)
      .all(...keys) as Setting[]
  }

  setMultiple(settings: Setting[]): void {
    const setAll = this.db.transaction(() => {
      const stmt = this.db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      for (const setting of settings) {
        stmt.run(setting.key, setting.value)
      }
    })
    setAll()
  }

  delete(key: string): boolean {
    const result = this.db.prepare('DELETE FROM settings WHERE key = ?').run(key)
    return result.changes > 0
  }
}
