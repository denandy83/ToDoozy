import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { purgeOldTombstones } from './PurgeService'

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  for (const migration of migrations) {
    migration(db)
  }
  return db
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function seedUser(db: DatabaseSync, id = 'user-1'): string {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, `${id}@example.com`, null, null, now, now)
  return id
}

function seedProjectArea(
  db: DatabaseSync,
  id: string,
  userId: string,
  deletedAt: string | null
): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO project_areas (id, user_id, name, color, icon, sidebar_order, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, `Area ${id}`, '#888', 'folder', 0, now, now, deletedAt)
}

function seedLabel(
  db: DatabaseSync,
  id: string,
  userId: string,
  deletedAt: string | null
): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO labels (id, user_id, name, color, order_index, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, `Label ${id}`, '#888', 0, now, now, deletedAt)
}

describe('PurgeService.purgeOldTombstones', () => {
  let db: DatabaseSync
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    userId = seedUser(db)
  })

  it('hard-deletes tombstones older than 30 days', () => {
    seedProjectArea(db, 'a-old', userId, isoDaysAgo(31))
    seedProjectArea(db, 'a-keep', userId, null)

    const stats = purgeOldTombstones(db)
    expect(stats.byTable.project_areas).toBe(1)
    expect(stats.total).toBe(1)

    const remaining = db
      .prepare('SELECT id FROM project_areas')
      .all() as { id: string }[]
    expect(remaining.map((r) => r.id)).toEqual(['a-keep'])
  })

  it('keeps tombstones younger than 30 days', () => {
    seedProjectArea(db, 'a-recent', userId, isoDaysAgo(1))
    seedProjectArea(db, 'a-29-days', userId, isoDaysAgo(29))

    const stats = purgeOldTombstones(db)
    expect(stats.byTable.project_areas).toBe(0)
    expect(stats.total).toBe(0)

    const remaining = db
      .prepare('SELECT COUNT(*) as c FROM project_areas')
      .get() as { c: number }
    expect(remaining.c).toBe(2)
  })

  it('never touches active rows (deleted_at IS NULL)', () => {
    seedProjectArea(db, 'a-active', userId, null)
    seedProjectArea(db, 'a-old', userId, isoDaysAgo(60))

    purgeOldTombstones(db)

    const remaining = db
      .prepare('SELECT id FROM project_areas')
      .all() as { id: string }[]
    expect(remaining.map((r) => r.id)).toEqual(['a-active'])
  })

  it('purges across multiple tables in a single pass', () => {
    seedProjectArea(db, 'area-old', userId, isoDaysAgo(45))
    seedLabel(db, 'label-old', userId, isoDaysAgo(45))

    const stats = purgeOldTombstones(db)
    expect(stats.byTable.project_areas).toBe(1)
    expect(stats.byTable.labels).toBe(1)
    expect(stats.total).toBe(2)
  })

  it('is idempotent on a clean DB', () => {
    const stats = purgeOldTombstones(db)
    expect(stats.total).toBe(0)
    // Run again — still no-op.
    expect(purgeOldTombstones(db).total).toBe(0)
  })

  it('records every purgeable table in byTable (zero counts included)', () => {
    const stats = purgeOldTombstones(db)
    // Every key the service knows about should appear, even when zero, so the
    // caller can log a complete row-count breakdown.
    expect(Object.keys(stats.byTable).sort()).toEqual(
      [
        'tasks',
        'statuses',
        'projects',
        'labels',
        'themes',
        'settings',
        'saved_views',
        'project_areas'
      ].sort()
    )
  })
})
