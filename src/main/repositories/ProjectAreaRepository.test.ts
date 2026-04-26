import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { ProjectAreaRepository } from './ProjectAreaRepository'
import type { ProjectArea } from '../../shared/types'

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  for (const migration of migrations) {
    migration(db)
  }
  return db
}

function seedUser(db: DatabaseSync, id = 'user-1'): string {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, `${id}@example.com`, null, null, now, now)
  return id
}

function seedProject(db: DatabaseSync, id: string, ownerId: string, areaId: string | null = null): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO projects (id, name, owner_id, area_id, color, icon, sidebar_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, `Project ${id}`, ownerId, areaId, '#888', 'folder', 0, now, now)
}

describe('ProjectAreaRepository — soft-delete', () => {
  let db: DatabaseSync
  let repo: ProjectAreaRepository
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    userId = seedUser(db)
    repo = new ProjectAreaRepository(db)
  })

  it('delete() sets deleted_at instead of removing the row', () => {
    const a = repo.create({ id: 'a1', user_id: userId, name: 'Personal' })
    expect(repo.delete(a.id)).toBe(true)
    const raw = repo.findById(a.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })

  it('delete() is idempotent — second delete on tombstoned row returns false', () => {
    const a = repo.create({ id: 'a1', user_id: userId, name: 'Personal' })
    expect(repo.delete(a.id)).toBe(true)
    expect(repo.delete(a.id)).toBe(false)
  })

  it('delete() returns false for missing rows', () => {
    expect(repo.delete('does-not-exist')).toBe(false)
  })

  it('delete() clears area_id on projects that pointed at the area', () => {
    const a = repo.create({ id: 'a1', user_id: userId, name: 'Personal' })
    seedProject(db, 'p1', userId, a.id)
    seedProject(db, 'p2', userId, a.id)
    seedProject(db, 'p3', userId, null)
    expect(repo.delete(a.id)).toBe(true)
    const rows = db
      .prepare('SELECT id, area_id FROM projects ORDER BY id')
      .all() as { id: string; area_id: string | null }[]
    const map = new Map(rows.map((r) => [r.id, r.area_id]))
    expect(map.get('p1')).toBeNull()
    expect(map.get('p2')).toBeNull()
    expect(map.get('p3')).toBeNull()
  })

  it('delete() bumps updated_at on detached projects so the sync layer pushes them', () => {
    const a = repo.create({ id: 'a1', user_id: userId, name: 'Personal' })
    seedProject(db, 'p1', userId, a.id)
    // Force the project's updated_at into the past so we can detect the bump.
    const past = '2020-01-01T00:00:00.000Z'
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(past, 'p1')
    repo.delete(a.id)
    const after = (
      db.prepare('SELECT updated_at FROM projects WHERE id = ?').get('p1') as { updated_at: string }
    ).updated_at
    expect(after > past).toBe(true)
  })

  it('hardDelete() physically removes the row', () => {
    const a = repo.create({ id: 'a1', user_id: userId, name: 'Personal' })
    expect(repo.hardDelete(a.id)).toBe(true)
    expect(repo.findById(a.id)).toBeUndefined()
  })

  it('findByUserId() filters out tombstoned areas', () => {
    repo.create({ id: 'a1', user_id: userId, name: 'A' })
    const b = repo.create({ id: 'a2', user_id: userId, name: 'B' })
    repo.delete(b.id)
    const ids = repo.findByUserId(userId).map((a) => a.id)
    expect(ids).toContain('a1')
    expect(ids).not.toContain('a2')
  })

  it('findById() returns the tombstone (raw access for sync layer)', () => {
    const a = repo.create({ id: 'a1', user_id: userId, name: 'Personal' })
    repo.delete(a.id)
    const raw = repo.findById(a.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })
})

describe('ProjectAreaRepository — sync surface', () => {
  let db: DatabaseSync
  let repo: ProjectAreaRepository
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    userId = seedUser(db)
    repo = new ProjectAreaRepository(db)
  })

  it('findAllByUser() returns active rows for the user', () => {
    repo.create({ id: 'a1', user_id: userId, name: 'A' })
    repo.create({ id: 'a2', user_id: userId, name: 'B' })
    const otherUser = seedUser(db, 'user-2')
    repo.create({ id: 'a3', user_id: otherUser, name: 'Other' })
    const ids = repo.findAllByUser(userId).map((a) => a.id).sort()
    expect(ids).toEqual(['a1', 'a2'])
  })

  it('findAllByUser() excludes tombstones by default', () => {
    repo.create({ id: 'a1', user_id: userId, name: 'A' })
    const b = repo.create({ id: 'a2', user_id: userId, name: 'B' })
    repo.delete(b.id)
    const ids = repo.findAllByUser(userId).map((a) => a.id)
    expect(ids).toEqual(['a1'])
  })

  it('findAllByUser({ includeTombstones: true }) returns tombstones too', () => {
    repo.create({ id: 'a1', user_id: userId, name: 'A' })
    const b = repo.create({ id: 'a2', user_id: userId, name: 'B' })
    repo.delete(b.id)
    const all = repo.findAllByUser(userId, { includeTombstones: true })
    expect(all.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
  })

  it('findAllByUser({ sinceUpdatedAt }) filters by updated_at', () => {
    db.prepare(
      `INSERT INTO project_areas (id, user_id, name, color, icon, sidebar_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('a1', userId, 'A', '#888', 'folder', 0, '2026-04-01T10:00:00.000Z', '2026-04-01T10:00:00.000Z')
    db.prepare(
      `INSERT INTO project_areas (id, user_id, name, color, icon, sidebar_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('a2', userId, 'B', '#888', 'folder', 0, '2026-04-01T11:00:00.000Z', '2026-04-01T11:00:00.000Z')
    const since = repo.findAllByUser(userId, { sinceUpdatedAt: '2026-04-01T10:30:00.000Z' })
    expect(since.map((a) => a.id)).toContain('a2')
    expect(since.map((a) => a.id)).not.toContain('a1')
  })

  it('findMaxUpdatedAt() includes tombstones (so soft-deletes bump the high-water)', () => {
    repo.create({ id: 'a1', user_id: userId, name: 'A' })
    const b = repo.create({ id: 'a2', user_id: userId, name: 'B' })
    repo.delete(b.id)
    const tombstoned = repo.findById(b.id)!
    expect(repo.findMaxUpdatedAt(userId)).toBe(tombstoned.updated_at)
  })

  it('findMaxUpdatedAt() returns null when no rows exist', () => {
    expect(repo.findMaxUpdatedAt(userId)).toBeNull()
  })
})

describe('ProjectAreaRepository — applyRemote', () => {
  let db: DatabaseSync
  let repo: ProjectAreaRepository
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    userId = seedUser(db)
    repo = new ProjectAreaRepository(db)
  })

  it('inserts a new row from remote, preserving timestamps', () => {
    const remote: ProjectArea = {
      id: 'r1',
      user_id: userId,
      name: 'Remote',
      color: '#abcdef',
      icon: 'star',
      sidebar_order: 3,
      is_collapsed: 1,
      created_at: '2026-04-25T10:00:00.000Z',
      updated_at: '2026-04-25T10:00:00.000Z',
      deleted_at: null
    }
    repo.applyRemote(remote)
    const local = repo.findById('r1')!
    expect(local.created_at).toBe(remote.created_at)
    expect(local.updated_at).toBe(remote.updated_at)
    expect(local.deleted_at).toBeNull()
    expect(local.name).toBe('Remote')
    expect(local.is_collapsed).toBe(1)
  })

  it('preserves remote deleted_at on apply (tombstone propagation)', () => {
    const tombstoned: ProjectArea = {
      id: 'r2',
      user_id: userId,
      name: 'Tombstoned',
      color: '#888',
      icon: 'folder',
      sidebar_order: 0,
      is_collapsed: 0,
      created_at: '2026-04-25T10:00:00.000Z',
      updated_at: '2026-04-25T11:00:00.000Z',
      deleted_at: '2026-04-25T11:00:00.000Z'
    }
    repo.applyRemote(tombstoned)
    const local = repo.findById('r2')!
    expect(local.deleted_at).toBe('2026-04-25T11:00:00.000Z')
    expect(repo.findAllByUser(userId).map((a) => a.id)).not.toContain('r2')
  })

  it('skips when local updated_at is newer than remote (LWW)', () => {
    const a = repo.create({ id: 'r3', user_id: userId, name: 'Original' })
    const stale: ProjectArea = {
      ...a,
      name: 'Stale remote',
      updated_at: new Date(new Date(a.updated_at).getTime() - 60_000).toISOString()
    }
    repo.applyRemote(stale)
    expect(repo.findById('r3')!.name).toBe('Original')
  })

  it('overwrites local row when remote updated_at is newer', () => {
    const a = repo.create({ id: 'r4', user_id: userId, name: 'Original' })
    const fresh: ProjectArea = {
      ...a,
      name: 'Updated remote',
      updated_at: new Date(new Date(a.updated_at).getTime() + 60_000).toISOString()
    }
    repo.applyRemote(fresh)
    const local = repo.findById('r4')!
    expect(local.name).toBe('Updated remote')
    expect(local.updated_at).toBe(fresh.updated_at)
  })

  it('idempotent — applying the same remote twice yields the same row', () => {
    const remote: ProjectArea = {
      id: 'r5',
      user_id: userId,
      name: 'Remote',
      color: '#888',
      icon: 'folder',
      sidebar_order: 0,
      is_collapsed: 0,
      created_at: '2026-04-25T10:00:00.000Z',
      updated_at: '2026-04-25T10:00:00.000Z',
      deleted_at: null
    }
    repo.applyRemote(remote)
    repo.applyRemote(remote)
    const local = repo.findById('r5')!
    expect(local.name).toBe('Remote')
    expect(local.updated_at).toBe(remote.updated_at)
  })
})
