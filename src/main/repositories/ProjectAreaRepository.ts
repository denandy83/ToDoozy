import type { DatabaseSync } from 'node:sqlite'
import type { ProjectArea, CreateProjectAreaInput, UpdateProjectAreaInput } from '../../shared/types'
import { withTransaction } from '../database/transaction'

const UPDATABLE_COLUMNS = ['name', 'color', 'icon', 'sidebar_order', 'is_collapsed'] as const

export class ProjectAreaRepository {
  constructor(private db: DatabaseSync) {}

  findById(id: string): ProjectArea | undefined {
    return this.db.prepare('SELECT * FROM project_areas WHERE id = ?').get(id) as ProjectArea | undefined
  }

  findByUserId(userId: string): ProjectArea[] {
    return this.db
      .prepare('SELECT * FROM project_areas WHERE user_id = ? ORDER BY sidebar_order ASC')
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

  delete(id: string): boolean {
    // ON DELETE SET NULL handles area_id on projects
    const result = this.db.prepare('DELETE FROM project_areas WHERE id = ?').run(id)
    return result.changes > 0
  }

  reorder(areaIds: string[]): void {
    withTransaction(this.db, () => {
      const stmt = this.db.prepare('UPDATE project_areas SET sidebar_order = ? WHERE id = ?')
      for (let i = 0; i < areaIds.length; i++) {
        stmt.run(i, areaIds[i])
      }
    })
  }

  assignProject(projectId: string, areaId: string | null): void {
    this.db.prepare('UPDATE projects SET area_id = ? WHERE id = ?').run(areaId, projectId)
  }
}
