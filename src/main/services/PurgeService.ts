import type { DatabaseSync } from 'node:sqlite'

/**
 * Local tombstones are eligible for cleanup after 30 days, but age never
 * overrides queued intent. Retain queued rows, their foreign-key prerequisites
 * and ancestors, and dependencies of active/recent syncable rows. Local-only
 * attachment tombstones retain their original bytes through this window.
 *
 * This local sweep is independent of server-side cleanup; age does not prove
 * that every peer has received a tombstone.
 *
 * This list includes local-only attachments. Local junction tables
 * (`task_labels`, `project_labels`) have no `deleted_at`; parent cascades and
 * sync key-set differences manage their removal instead.
 */
const PURGEABLE_TABLES = [
  'tasks',
  'statuses',
  'projects',
  'labels',
  'themes',
  'settings',
  'saved_views',
  'project_areas',
  'attachments'
] as const

const RETENTION_DAYS = 30

export interface PurgeStats {
  /** Per-table row counts removed. */
  byTable: Record<string, number>
  /** Sum across tables. */
  total: number
  /** ISO cutoff used for the run. */
  cutoffIso: string
}

/**
 * Apply the retention invariant above; safe to call on every boot.
 */
export function purgeOldTombstones(db: DatabaseSync): PurgeStats {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const cutoffIso = cutoff.toISOString()
  const byTable: Record<string, number> = {}
  let total = 0

  const rowKey = (table: string): string => table === 'settings' ? "user_id || ':' || key" : 'id'
  const rows = PURGEABLE_TABLES.map((table) => `SELECT '${table}' AS table_name, ${rowKey(table)} AS row_id, deleted_at FROM ${table}`).join(' UNION ALL ')
  const retained = `WITH RECURSIVE
    rows AS (${rows}),
    edges(source_table,source_id,target_table,target_id) AS (
      SELECT 'tasks',id,'tasks',parent_id FROM tasks WHERE parent_id IS NOT NULL
      UNION ALL SELECT 'tasks',id,'statuses',status_id FROM tasks
      UNION ALL SELECT 'tasks',id,'projects',project_id FROM tasks
      UNION ALL SELECT 'statuses',id,'projects',project_id FROM statuses
      UNION ALL SELECT 'attachments',id,'tasks',task_id FROM attachments
      UNION ALL SELECT 'activity_log',id,'tasks',task_id FROM activity_log
      UNION ALL SELECT 'projects',id,'project_areas',area_id FROM projects WHERE area_id IS NOT NULL
    ),
    retained(table_name,row_id) AS (
      SELECT table_name,row_id FROM rows WHERE deleted_at>=? OR (deleted_at IS NULL AND table_name<>'attachments')
      UNION SELECT CASE table_name
        WHEN 'user_settings' THEN 'settings' WHEN 'user_themes' THEN 'themes'
        WHEN 'user_labels' THEN 'labels' WHEN 'user_saved_views' THEN 'saved_views'
        WHEN 'user_project_areas' THEN 'project_areas' ELSE table_name END,row_id FROM sync_queue
      UNION SELECT 'tasks',t.id FROM tasks t JOIN sync_queue q ON q.table_name='statuses'
        AND json_valid(q.payload) AND json_extract(q.payload,'$.status_delete')=1
        AND COALESCE(json_extract(q.payload,'$.project_id'),(SELECT project_id FROM statuses WHERE id=q.row_id))=t.project_id
      UNION SELECT 'projects',COALESCE(json_extract(payload,'$.project_id'),json_extract(payload,'$.projectId'))
        FROM sync_queue WHERE table_name='project_labels' AND json_valid(payload)
      UNION SELECT 'labels',COALESCE(json_extract(payload,'$.label_id'),json_extract(payload,'$.labelId'))
        FROM sync_queue WHERE table_name IN ('project_labels','task_labels') AND json_valid(payload)
      UNION SELECT 'tasks',COALESCE(json_extract(payload,'$.task_id'),json_extract(payload,'$.taskId'))
        FROM sync_queue WHERE table_name='task_labels' AND json_valid(payload)
      UNION SELECT e.target_table,e.target_id FROM edges e JOIN retained r
        ON e.source_table=r.table_name AND e.source_id=r.row_id
    )`

  for (const table of PURGEABLE_TABLES) {
    const result = db.prepare(`${retained} DELETE FROM ${table}
      WHERE deleted_at IS NOT NULL AND deleted_at < ?
      AND ${rowKey(table)} NOT IN (SELECT row_id FROM retained WHERE table_name='${table}' AND row_id IS NOT NULL)`)
      .run(cutoffIso, cutoffIso)
    const removed = Number(result.changes)
    byTable[table] = removed
    total += removed
  }

  return { byTable, total, cutoffIso }
}
