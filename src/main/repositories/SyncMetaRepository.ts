import type { DatabaseSync } from 'node:sqlite'

export type SyncTableName =
  | 'tasks'
  | 'statuses'
  | 'projects'
  | 'labels'
  | 'themes'
  | 'settings'
  | 'saved_views'
  | 'project_areas'
  | 'task_labels'
  | 'project_labels'

export interface SyncMetaRow {
  user_id: string
  scope_id: string
  table_name: SyncTableName
  last_high_water: string | null
  last_reconciled_at: string | null
}

/**
 * Per-(user, scope, table) reconcile state for the uniform sync layer.
 *
 * `scope_id` is the bucket within a user the high-water applies to:
 *   - For user-scoped tables (labels, themes, settings, saved_views,
 *     project_areas, projects) `scope_id` equals `userId`.
 *   - For project-scoped tables (tasks, statuses) `scope_id` is the
 *     project_id, so each project keeps its own high-water and projects
 *     don't shadow each other across reconcile passes.
 */
export class SyncMetaRepository {
  constructor(private db: DatabaseSync) {}

  get(userId: string, scopeId: string, tableName: SyncTableName): SyncMetaRow | null {
    const row = this.db
      .prepare(
        'SELECT * FROM sync_meta WHERE user_id = ? AND scope_id = ? AND table_name = ?'
      )
      .get(userId, scopeId, tableName) as SyncMetaRow | undefined
    return row ?? null
  }

  getHighWater(userId: string, scopeId: string, tableName: SyncTableName): string | null {
    return this.get(userId, scopeId, tableName)?.last_high_water ?? null
  }

  setHighWater(
    userId: string,
    scopeId: string,
    tableName: SyncTableName,
    isoTs: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO sync_meta (user_id, scope_id, table_name, last_high_water)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, scope_id, table_name) DO UPDATE SET last_high_water = excluded.last_high_water`
      )
      .run(userId, scopeId, tableName, isoTs)
  }

  getLastReconciledAt(
    userId: string,
    scopeId: string,
    tableName: SyncTableName
  ): string | null {
    return this.get(userId, scopeId, tableName)?.last_reconciled_at ?? null
  }

  setLastReconciledAt(
    userId: string,
    scopeId: string,
    tableName: SyncTableName,
    isoTs: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO sync_meta (user_id, scope_id, table_name, last_reconciled_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, scope_id, table_name) DO UPDATE SET last_reconciled_at = excluded.last_reconciled_at`
      )
      .run(userId, scopeId, tableName, isoTs)
  }

  clearAll(userId: string): number {
    const result = this.db.prepare('DELETE FROM sync_meta WHERE user_id = ?').run(userId)
    return Number(result.changes)
  }
}
