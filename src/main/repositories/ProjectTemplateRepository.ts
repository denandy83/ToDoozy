import type Database from 'better-sqlite3'
import type {
  ProjectTemplate,
  CreateProjectTemplateInput,
  UpdateProjectTemplateInput
} from '../../shared/types'

const UPDATABLE_COLUMNS = ['name', 'color', 'data'] as const
type UpdatableColumn = (typeof UPDATABLE_COLUMNS)[number]

export class ProjectTemplateRepository {
  constructor(private db: Database.Database) {}

  findById(id: string): ProjectTemplate | undefined {
    return this.db.prepare('SELECT * FROM project_templates WHERE id = ?').get(id) as
      | ProjectTemplate
      | undefined
  }

  findByOwnerId(ownerId: string): ProjectTemplate[] {
    return this.db
      .prepare('SELECT * FROM project_templates WHERE owner_id = ? ORDER BY created_at DESC')
      .all(ownerId) as ProjectTemplate[]
  }

  findAll(): ProjectTemplate[] {
    return this.db
      .prepare('SELECT * FROM project_templates ORDER BY created_at DESC')
      .all() as ProjectTemplate[]
  }

  create(input: CreateProjectTemplateInput): ProjectTemplate {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO project_templates (id, name, color, owner_id, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(input.id, input.name, input.color, input.owner_id, input.data, now, now)
    return this.findById(input.id)!
  }

  update(id: string, input: UpdateProjectTemplateInput): ProjectTemplate | undefined {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const values: (string | number | null)[] = [now]

    for (const col of UPDATABLE_COLUMNS) {
      if (input[col as UpdatableColumn] !== undefined) {
        sets.push(`${col} = ?`)
        values.push(input[col as UpdatableColumn] as string)
      }
    }

    values.push(id)
    this.db.prepare(`UPDATE project_templates SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.findById(id)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM project_templates WHERE id = ?').run(id)
    return result.changes > 0
  }
}
