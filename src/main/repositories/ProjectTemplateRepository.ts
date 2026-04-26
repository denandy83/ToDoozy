import type { DatabaseSync } from 'node:sqlite'
import type {
  ProjectTemplate,
  CreateProjectTemplateInput,
  UpdateProjectTemplateInput
} from '../../shared/types'

const UPDATABLE_COLUMNS = ['name', 'color', 'data'] as const
type UpdatableColumn = (typeof UPDATABLE_COLUMNS)[number]

export class ProjectTemplateRepository {
  constructor(private db: DatabaseSync) {}

  findById(id: string): ProjectTemplate | undefined {
    return this.db.prepare('SELECT * FROM project_templates WHERE id = ?').get(id) as
      | ProjectTemplate
      | undefined
  }

  findByOwnerId(ownerId: string): ProjectTemplate[] {
    return this.db
      .prepare(
        'SELECT * FROM project_templates WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC'
      )
      .all(ownerId) as unknown as ProjectTemplate[]
  }

  findAll(): ProjectTemplate[] {
    return this.db
      .prepare('SELECT * FROM project_templates WHERE deleted_at IS NULL ORDER BY created_at DESC')
      .all() as unknown as ProjectTemplate[]
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

  /**
   * Soft-delete — bumps deleted_at + updated_at so the sync layer picks it
   * up via the high-water-mark and propagates the tombstone to other devices.
   * Hard-DELETE is reserved for the 30-day purge job.
   */
  delete(id: string): boolean {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        'UPDATE project_templates SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
      )
      .run(now, now, id)
    return result.changes > 0
  }

  /**
   * Hard delete — used only by the 30-day tombstone purge.
   */
  hardDelete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM project_templates WHERE id = ?').run(id)
    return result.changes > 0
  }

  // ─── Sync layer ───────────────────────────────────────────────────────────

  /**
   * Sync-layer list. Returns ALL rows for an owner (optionally including
   * tombstones) so reconcile can diff local vs remote.
   */
  findAllByOwner(
    ownerId: string,
    options: { includeTombstones?: boolean } = {}
  ): ProjectTemplate[] {
    const tombstoneFilter = options.includeTombstones ? '' : 'AND deleted_at IS NULL'
    return this.db
      .prepare(
        `SELECT * FROM project_templates WHERE owner_id = ? ${tombstoneFilter} ORDER BY created_at DESC`
      )
      .all(ownerId) as unknown as ProjectTemplate[]
  }

  /**
   * High-water mark for incremental sync — max(updated_at) across ALL rows
   * including tombstones, so soft-deletes bump the high-water and failed
   * pushes retry.
   */
  findMaxUpdatedAt(ownerId: string): string | null {
    const row = this.db
      .prepare('SELECT MAX(updated_at) as max FROM project_templates WHERE owner_id = ?')
      .get(ownerId) as { max: string | null }
    return row.max ?? null
  }

  /**
   * Sync-only: write a template as-is, preserving remote timestamps and
   * deleted_at. Skips when local is newer (LWW). Uses Date.parse compare
   * so `Z` vs `+00:00` for the same instant don't false-flag as drift.
   */
  applyRemote(remote: ProjectTemplate): ProjectTemplate {
    const existing = this.findById(remote.id)
    if (
      existing &&
      Date.parse(existing.updated_at) >= Date.parse(remote.updated_at)
    ) {
      return existing
    }
    this.db
      .prepare(
        `INSERT INTO project_templates (id, name, color, owner_id, data, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           color = excluded.color,
           owner_id = excluded.owner_id,
           data = excluded.data,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at`
      )
      .run(
        remote.id,
        remote.name,
        remote.color,
        remote.owner_id,
        remote.data,
        remote.created_at,
        remote.updated_at,
        remote.deleted_at ?? null
      )
    return this.findById(remote.id)!
  }
}
