import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { TaskRepository } from './TaskRepository'
import { toCanonicalIso } from './lww'
import type { Task } from '../../shared/types'

// Story #115. Local SQLite writes the millisecond-UTC canonical (`…Z`) form;
// PostgREST returns the offset (`…+00:00`) form. Z and PLUS below are the SAME
// instant but do NOT sort the same as SQLite TEXT.
const Z = '2026-07-21T10:00:00.000Z'
const PLUS = '2026-07-21T10:00:00.000+00:00'
const OLDER_PLUS = '2026-07-21T09:00:00.000+00:00'
const NEWER_PLUS = '2026-07-21T10:00:05.000+00:00'

/**
 * Build a test DB. `throughMigration` bounds how many migrations run so a test
 * can observe the pre-#26 (mixed-format) state and then apply migration_26
 * explicitly. Defaults to the full set.
 */
function createTestDb(throughMigration = migrations.length): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  for (const migration of migrations.slice(0, throughMigration)) {
    migration(db)
  }
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('user-1', 'test@example.com', null, null, now, now)
  db.prepare(
    `INSERT INTO projects (id, owner_id, name, description, color, icon, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('proj-1', 'user-1', 'Test', null, null, null, now, now)
  db.prepare(
    `INSERT INTO statuses (id, project_id, name, color, icon, order_index, is_done, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('status-1', 'proj-1', 'Todo', null, null, 0, 0, 1, now, now)
  return db
}

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 't1',
    project_id: 'proj-1',
    owner_id: 'user-1',
    assigned_to: null,
    title: 'Test task',
    description: null,
    status_id: 'status-1',
    priority: 0,
    due_date: null,
    parent_id: null,
    order_index: 0,
    is_in_my_day: 0,
    is_template: 0,
    is_archived: 0,
    completed_date: null,
    recurrence_rule: null,
    reference_url: null,
    my_day_dismissed_date: null,
    created_at: Z,
    updated_at: Z,
    deleted_at: null,
    ...overrides
  }
}

/** Raw insert bypassing applyRemote — used to force a legacy mixed-format state. */
function insertRawTask(db: DatabaseSync, id: string, updatedAt: string, createdAt = updatedAt): void {
  db.prepare(
    `INSERT INTO tasks (id, project_id, owner_id, title, status_id, created_at, updated_at)
     VALUES (?, 'proj-1', 'user-1', ?, 'status-1', ?, ?)`
  ).run(id, `Task ${id}`, createdAt, updatedAt)
}

function rawTs(db: DatabaseSync, id: string): { created_at: string; updated_at: string; deleted_at: string | null } {
  return db
    .prepare('SELECT created_at, updated_at, deleted_at FROM tasks WHERE id = ?')
    .get(id) as { created_at: string; updated_at: string; deleted_at: string | null }
}

describe('applyRemote* normalizes remote-origin timestamps to canonical Z (Story #115)', () => {
  it('applyRemoteTask converts +00:00 created_at/updated_at/deleted_at to canonical Z on write', () => {
    const db = createTestDb()
    const repo = new TaskRepository(db)
    repo.applyRemoteTask(
      makeTask({ id: 't1', created_at: PLUS, updated_at: PLUS, deleted_at: NEWER_PLUS })
    )
    const stored = rawTs(db, 't1')
    expect(stored.updated_at).toBe(Z)
    expect(stored.created_at).toBe(Z)
    expect(stored.deleted_at).toBe('2026-07-21T10:00:05.000Z')
    // The whole column is now single-format — every value ends in `Z`.
    expect(stored.updated_at.endsWith('Z')).toBe(true)
  })

  it('leaves an app-written Z row byte-for-byte unchanged (no spurious rewrite)', () => {
    const db = createTestDb()
    const repo = new TaskRepository(db)
    repo.applyRemoteTask(makeTask({ id: 't1', created_at: Z, updated_at: Z }))
    const stored = rawTs(db, 't1')
    expect(stored.updated_at).toBe(Z)
    expect(stored.created_at).toBe(Z)
  })
})

describe('incremental high-water updated_at > ? across the Z / +00:00 boundary (Story #115)', () => {
  it('demonstrates the raw TEXT hazard: equal instants mis-sort, canonical form fixes it', () => {
    const db = createTestDb()
    // Same instant, two formats. `Z` (0x5A) > `+` (0x2B) so a raw compare flags
    // equal instants as "greater" → the boundary row gets re-pulled (duplicate).
    const buggy = db.prepare('SELECT (? > ?) AS gt').get(Z, PLUS) as { gt: number }
    expect(buggy.gt).toBe(1)
    // Normalizing both sides removes the hazard — equal instants compare equal.
    const fixed = db
      .prepare('SELECT (? > ?) AS gt')
      .get(toCanonicalIso(Z), toCanonicalIso(PLUS)) as { gt: number }
    expect(fixed.gt).toBe(0)
  })

  it('findAllByProject(sinceUpdatedAt) returns exactly the strictly-newer rows once storage is uniform', () => {
    const db = createTestDb()
    const repo = new TaskRepository(db)
    // Three remote rows arrive in the +00:00 form; applyRemoteTask normalizes all
    // to Z, so the column is single-format.
    repo.applyRemoteTask(makeTask({ id: 't-old', updated_at: OLDER_PLUS }))
    repo.applyRemoteTask(makeTask({ id: 't-boundary', updated_at: PLUS })) // same instant as cursor
    repo.applyRemoteTask(makeTask({ id: 't-new', updated_at: NEWER_PLUS }))

    // A canonical local high-water at the boundary instant.
    const rows = repo.findAllByProject('proj-1', { includeTombstones: true, sinceUpdatedAt: Z })
    const ids = rows.map((r) => r.id).sort()
    // t-old is older → excluded; t-boundary is the SAME instant → excluded (not
    // strictly newer); only t-new is strictly newer. No miss, no duplicate.
    expect(ids).toEqual(['t-new'])
  })

  it('migration_26 converges legacy +00:00 rows so a legacy high-water stops re-pulling the boundary row', () => {
    const db = createTestDb(25) // migrations 1..25 only — pre-#115 mixed state
    // Legacy rows stored in +00:00, plus one app write in Z at the same instant.
    insertRawTask(db, 't-boundary', PLUS)
    insertRawTask(db, 't-appwrite', Z)
    insertRawTask(db, 't-new', NEWER_PLUS)
    const legacyCursor = PLUS // a high-water captured during the +00:00 era

    // BUG (pre-migration): the Z app-write at the same instant sorts above the
    // +00:00 cursor and is wrongly re-pulled (duplicate).
    const buggy = db
      .prepare('SELECT id FROM tasks WHERE updated_at > ? ORDER BY id')
      .all(legacyCursor)
      .map((r) => (r as { id: string }).id)
    expect(buggy).toContain('t-appwrite')

    // Apply migration_26: all +00:00 rows converge to canonical Z.
    migrations[25](db)
    expect(rawTs(db, 't-boundary').updated_at).toBe(Z)
    expect(rawTs(db, 't-new').updated_at).toBe('2026-07-21T10:00:05.000Z')
    expect(rawTs(db, 't-appwrite').updated_at).toBe(Z) // untouched, already Z

    // With uniform storage the high-water (now canonical) selects exactly the
    // strictly-newer row — no duplicate, no miss.
    const canonicalCursor = toCanonicalIso(legacyCursor)
    const fixed = db
      .prepare('SELECT id FROM tasks WHERE updated_at > ? ORDER BY id')
      .all(canonicalCursor)
      .map((r) => (r as { id: string }).id)
    expect(fixed).toEqual(['t-new'])
  })

  it('migration_26 is idempotent and leaves legacy datetime() and Z values alone', () => {
    const db = createTestDb(25)
    insertRawTask(db, 't-plus', PLUS)
    insertRawTask(db, 't-z', Z)
    // Legacy `datetime('now')` space-separated form (not remote-origin) must be untouched.
    insertRawTask(db, 't-legacy', '2026-07-21 09:00:00')

    migrations[25](db)
    const afterFirst = rawTs(db, 't-plus').updated_at
    expect(afterFirst).toBe(Z)
    expect(rawTs(db, 't-z').updated_at).toBe(Z)
    expect(rawTs(db, 't-legacy').updated_at).toBe('2026-07-21 09:00:00')

    // Re-running finds no `+00:00` rows left — a no-op.
    migrations[25](db)
    expect(rawTs(db, 't-plus').updated_at).toBe(afterFirst)
  })
})
