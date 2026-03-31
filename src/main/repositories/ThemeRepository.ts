import type { DatabaseSync } from 'node:sqlite'
import type { Theme, ThemeConfig, CreateThemeInput, UpdateThemeInput } from '../../shared/types'

export class ThemeRepository {
  constructor(private db: DatabaseSync) {}

  findById(id: string): Theme | undefined {
    return this.db.prepare('SELECT * FROM themes WHERE id = ?').get(id) as unknown as Theme | undefined
  }

  list(userId?: string): Theme[] {
    if (userId) {
      return this.db.prepare('SELECT * FROM themes WHERE is_builtin = 1 OR owner_id = ? ORDER BY name ASC').all(userId) as unknown as Theme[]
    }
    return this.db.prepare('SELECT * FROM themes ORDER BY name ASC').all() as unknown as Theme[]
  }

  listByMode(mode: string, userId?: string): Theme[] {
    if (userId) {
      return this.db
        .prepare('SELECT * FROM themes WHERE mode = ? AND (is_builtin = 1 OR owner_id = ?) ORDER BY name ASC')
        .all(mode, userId) as unknown as Theme[]
    }
    return this.db
      .prepare('SELECT * FROM themes WHERE mode = ? ORDER BY name ASC')
      .all(mode) as unknown as Theme[]
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

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM themes WHERE id = ?').run(id)
    return result.changes > 0
  }

  getConfig(id: string): ThemeConfig | undefined {
    const theme = this.findById(id)
    if (!theme) return undefined
    return JSON.parse(theme.config) as unknown as ThemeConfig
  }
}
