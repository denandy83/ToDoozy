import type { DatabaseSync } from 'node:sqlite'
import type { SavedView, CreateSavedViewInput, UpdateSavedViewInput } from '../../shared/types'
import { withTransaction } from '../database/transaction'

const UPDATABLE_COLUMNS = ['name', 'color', 'icon', 'sidebar_order', 'filter_config', 'project_id'] as const

export class SavedViewRepository {
  constructor(private db: DatabaseSync) {}

  findById(id: string): SavedView | undefined {
    return this.db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as SavedView | undefined
  }

  findByUserId(userId: string): SavedView[] {
    return this.db
      .prepare('SELECT * FROM saved_views WHERE user_id = ? ORDER BY sidebar_order ASC')
      .all(userId) as unknown as SavedView[]
  }

  findByProjectId(projectId: string): SavedView[] {
    return this.db
      .prepare('SELECT * FROM saved_views WHERE project_id = ? ORDER BY sidebar_order ASC')
      .all(projectId) as unknown as SavedView[]
  }

  create(input: CreateSavedViewInput): SavedView {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO saved_views (id, user_id, project_id, name, color, icon, sidebar_order, filter_config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.user_id,
        input.project_id ?? null,
        input.name,
        input.color ?? '#6366f1',
        input.icon ?? 'filter',
        input.sidebar_order ?? 0,
        input.filter_config,
        now,
        now
      )
    return this.findById(input.id)!
  }

  update(id: string, input: UpdateSavedViewInput): SavedView | null {
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

    this.db.prepare(`UPDATE saved_views SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return this.findById(id) ?? null
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM saved_views WHERE id = ?').run(id)
    return result.changes > 0
  }

  reorder(viewIds: string[]): void {
    withTransaction(this.db, () => {
      const stmt = this.db.prepare('UPDATE saved_views SET sidebar_order = ? WHERE id = ?')
      for (let i = 0; i < viewIds.length; i++) {
        stmt.run(i, viewIds[i])
      }
    })
  }

  countMatchingTasks(filterConfig: string, _userId: string): number {
    // Parse filter config and count matching tasks
    // This is a convenience method; frontend can also compute this
    try {
      const config = JSON.parse(filterConfig) as Record<string, unknown>
      let sql = 'SELECT COUNT(DISTINCT t.id) as count FROM tasks t'
      const conditions: string[] = ['t.is_template = 0', 't.is_archived = 0', 't.parent_id IS NULL', 't.status_id NOT IN (SELECT id FROM statuses WHERE is_done = 1)']
      const params: (string | number)[] = []

      const labelIds = config.labelIds as string[] | undefined
      if (labelIds && labelIds.length > 0) {
        sql += ' INNER JOIN task_labels tl ON tl.task_id = t.id'
        const placeholders = labelIds.map(() => '?').join(', ')
        conditions.push(`tl.label_id IN (${placeholders})`)
        params.push(...labelIds)
      }

      const projectIds = config.projectIds as string[] | undefined
      if (projectIds && projectIds.length > 0) {
        const placeholders = projectIds.map(() => '?').join(', ')
        conditions.push(`t.project_id IN (${placeholders})`)
        params.push(...projectIds)
      }

      const statusIds = config.statusIds as string[] | undefined
      if (statusIds && statusIds.length > 0) {
        const placeholders = statusIds.map(() => '?').join(', ')
        conditions.push(`t.status_id IN (${placeholders})`)
        params.push(...statusIds)
      }

      const priorities = config.priorities as number[] | undefined
      if (priorities && priorities.length > 0) {
        const placeholders = priorities.map(() => '?').join(', ')
        conditions.push(`t.priority IN (${placeholders})`)
        params.push(...priorities)
      }

      const keyword = config.keyword as string | undefined
      if (keyword) {
        conditions.push('(t.title LIKE ? OR t.description LIKE ?)')
        const kw = `%${keyword}%`
        params.push(kw, kw)
      }

      // Exclusion filters
      const excludeLabelIds = config.excludeLabelIds as string[] | undefined
      if (excludeLabelIds && excludeLabelIds.length > 0) {
        const placeholders = excludeLabelIds.map(() => '?').join(', ')
        conditions.push(`t.id NOT IN (SELECT task_id FROM task_labels WHERE label_id IN (${placeholders}))`)
        params.push(...excludeLabelIds)
      }

      const excludeStatusIds = config.excludeStatusIds as string[] | undefined
      if (excludeStatusIds && excludeStatusIds.length > 0) {
        const placeholders = excludeStatusIds.map(() => '?').join(', ')
        conditions.push(`t.status_id NOT IN (${placeholders})`)
        params.push(...excludeStatusIds)
      }

      const excludePriorities = config.excludePriorities as number[] | undefined
      if (excludePriorities && excludePriorities.length > 0) {
        const placeholders = excludePriorities.map(() => '?').join(', ')
        conditions.push(`t.priority NOT IN (${placeholders})`)
        params.push(...excludePriorities)
      }

      const excludeProjectIds = config.excludeProjectIds as string[] | undefined
      if (excludeProjectIds && excludeProjectIds.length > 0) {
        const placeholders = excludeProjectIds.map(() => '?').join(', ')
        conditions.push(`t.project_id NOT IN (${placeholders})`)
        params.push(...excludeProjectIds)
      }

      sql += ' WHERE ' + conditions.join(' AND ')
      const row = this.db.prepare(sql).get(...params) as { count: number } | undefined
      return row?.count ?? 0
    } catch {
      return 0
    }
  }
}
