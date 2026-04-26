import type { DatabaseSync } from 'node:sqlite'

/**
 * 30-day tombstone retention. Soft-deleted rows linger so other devices can
 * propagate the tombstone via reconcile; once a row has been tombstoned for 30
 * days, every honest peer has had a chance to see it and we can hard-DELETE.
 *
 * Counterpart server-side cron: `public.purge_tombstones()` (see
 * supabase/migrations/20260425_purge_tombstones.sql) runs daily at 03:00 UTC.
 *
 * Tables purged here are exactly the syncable tables that carry a `deleted_at`
 * column. Junction tables (`task_labels`, `project_labels`) have no
 * `deleted_at` and are managed via key-set diff in the sync layer — they are
 * not purged here.
 */
const PURGEABLE_TABLES = [
  'tasks',
  'statuses',
  'projects',
  'labels',
  'themes',
  'settings',
  'saved_views',
  'project_areas'
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
 * Hard-DELETE rows whose `deleted_at` is older than 30 days.
 * Safe to run on every boot — it's idempotent and a no-op when the DB is
 * already clean.
 */
export function purgeOldTombstones(db: DatabaseSync): PurgeStats {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const cutoffIso = cutoff.toISOString()
  const byTable: Record<string, number> = {}
  let total = 0

  for (const table of PURGEABLE_TABLES) {
    const result = db
      .prepare(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?`)
      .run(cutoffIso)
    const removed = Number(result.changes)
    byTable[table] = removed
    total += removed
  }

  return { byTable, total, cutoffIso }
}
