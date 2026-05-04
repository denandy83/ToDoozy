import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { ProjectRepository } from './ProjectRepository'
import type { Project } from '../../shared/types'

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

function makeProject(repo: ProjectRepository, ownerId: string, id: string, name = 'Test'): Project {
  return repo.create({ id, owner_id: ownerId, name })
}

describe('ProjectRepository — soft-delete', () => {
  let db: DatabaseSync
  let repo: ProjectRepository
  let ownerId: string

  beforeEach(() => {
    db = createTestDb()
    ownerId = seedUser(db)
    repo = new ProjectRepository(db)
  })

  it('delete() sets deleted_at instead of removing the row', () => {
    const p = makeProject(repo, ownerId, 'p1')
    expect(repo.delete(p.id)).toBe(true)

    const raw = repo.findById(p.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })

  it('delete() is idempotent — second delete on tombstoned row returns false', () => {
    const p = makeProject(repo, ownerId, 'p1')
    expect(repo.delete(p.id)).toBe(true)
    expect(repo.delete(p.id)).toBe(false)
  })

  it('hardDelete() physically removes the row', () => {
    const p = makeProject(repo, ownerId, 'p1')
    expect(repo.hardDelete(p.id)).toBe(true)
    expect(repo.findById(p.id)).toBeUndefined()
  })

  it('findByOwnerId() filters out tombstoned rows', () => {
    makeProject(repo, ownerId, 'p1', 'A')
    const p2 = makeProject(repo, ownerId, 'p2', 'B')
    repo.delete(p2.id)
    const list = repo.findByOwnerId(ownerId)
    expect(list.map((p) => p.id)).toEqual(['p1'])
  })

  it('findById() returns the tombstone (raw access for sync layer)', () => {
    const p = makeProject(repo, ownerId, 'p1')
    repo.delete(p.id)
    const raw = repo.findById(p.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })

  it('findDefault() ignores tombstoned default project', () => {
    const def = repo.create({ id: 'p-def', owner_id: ownerId, name: 'Default', is_default: 1 })
    expect(repo.findDefault(ownerId)?.id).toBe(def.id)
    repo.delete(def.id)
    expect(repo.findDefault(ownerId)).toBeUndefined()
  })

  it('findAllByOwner() returns active rows only by default', () => {
    makeProject(repo, ownerId, 'p1')
    const p2 = makeProject(repo, ownerId, 'p2')
    repo.delete(p2.id)
    const active = repo.findAllByOwner(ownerId)
    expect(active.map((p) => p.id).sort()).toEqual(['p1'])
  })

  it('findAllByOwner({ includeTombstones: true }) returns all rows including tombstones', () => {
    makeProject(repo, ownerId, 'p1')
    const p2 = makeProject(repo, ownerId, 'p2')
    repo.delete(p2.id)
    const all = repo.findAllByOwner(ownerId, { includeTombstones: true })
    expect(all.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })

  it('findAllByOwner({ sinceUpdatedAt }) filters by updated_at', () => {
    db.prepare(
      `INSERT INTO projects (id, name, color, icon, owner_id, is_default, sidebar_order, is_shared, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('p1', 'A', '#888888', 'folder', ownerId, 0, 0, 0, '2026-04-01T10:00:00.000Z', '2026-04-01T10:00:00.000Z')
    db.prepare(
      `INSERT INTO projects (id, name, color, icon, owner_id, is_default, sidebar_order, is_shared, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('p2', 'B', '#888888', 'folder', ownerId, 0, 0, 0, '2026-04-01T11:00:00.000Z', '2026-04-01T11:00:00.000Z')
    const since = repo.findAllByOwner(ownerId, { sinceUpdatedAt: '2026-04-01T10:30:00.000Z' })
    expect(since.map((p) => p.id)).toContain('p2')
    expect(since.map((p) => p.id)).not.toContain('p1')
  })

  it('findMaxUpdatedAt() returns the max updated_at of active rows', () => {
    makeProject(repo, ownerId, 'p1')
    const p2 = makeProject(repo, ownerId, 'p2')
    expect(repo.findMaxUpdatedAt(ownerId)).toBe(p2.updated_at)
  })

  it('delete() cascades soft-delete to child statuses and tasks', () => {
    const p = makeProject(repo, ownerId, 'p1')
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO statuses (id, project_id, name, color, icon, order_index, is_done, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('s1', p.id, 'Todo', '#888888', 'circle', 0, 0, 1, now, now)
    db.prepare(
      `INSERT INTO tasks (id, project_id, owner_id, title, status_id, priority, order_index, is_template, is_archived, is_in_my_day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('t1', p.id, ownerId, 'Task', 's1', 0, 0, 0, 0, 0, now, now)

    expect(repo.delete(p.id)).toBe(true)

    const taskRow = db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get('t1') as { deleted_at: string | null }
    const statusRow = db.prepare('SELECT deleted_at FROM statuses WHERE id = ?').get('s1') as { deleted_at: string | null }
    expect(taskRow.deleted_at).not.toBeNull()
    expect(statusRow.deleted_at).not.toBeNull()
  })

  it('delete() removes project_labels (junction has no deleted_at)', () => {
    const p = makeProject(repo, ownerId, 'p1')
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO labels (id, name, color, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('lab1', 'red', '#ff0000', ownerId, now, now)
    db.prepare('INSERT INTO project_labels (project_id, label_id) VALUES (?, ?)').run(p.id, 'lab1')

    expect(repo.delete(p.id)).toBe(true)
    const row = db.prepare('SELECT * FROM project_labels WHERE project_id = ?').get(p.id)
    expect(row).toBeUndefined()
  })
})

describe('ProjectRepository — applyRemote', () => {
  let db: DatabaseSync
  let repo: ProjectRepository
  let ownerId: string

  beforeEach(() => {
    db = createTestDb()
    ownerId = seedUser(db)
    repo = new ProjectRepository(db)
  })

  it('inserts a new row from remote, preserving timestamps', () => {
    const remote: Project = {
      id: 'r1',
      name: 'Remote',
      description: null,
      color: '#888888',
      icon: 'folder',
      owner_id: ownerId,
      is_default: 0,
      is_shared: 0,
      is_archived: 0,
      sidebar_order: 0,
      area_id: null,
      auto_archive_enabled: 0,
      auto_archive_value: 3,
      auto_archive_unit: 'days',
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
  })

  it('preserves remote deleted_at on apply (tombstone propagation)', () => {
    const tombstoned: Project = {
      id: 'r2',
      name: 'Tombstoned',
      description: null,
      color: '#888888',
      icon: 'folder',
      owner_id: ownerId,
      is_default: 0,
      is_shared: 0,
      is_archived: 0,
      sidebar_order: 0,
      area_id: null,
      auto_archive_enabled: 0,
      auto_archive_value: 3,
      auto_archive_unit: 'days',
      created_at: '2026-04-25T10:00:00.000Z',
      updated_at: '2026-04-25T11:00:00.000Z',
      deleted_at: '2026-04-25T11:00:00.000Z'
    }
    repo.applyRemote(tombstoned)
    const local = repo.findById('r2')!
    expect(local.deleted_at).toBe('2026-04-25T11:00:00.000Z')
    expect(repo.findByOwnerId(ownerId).map((p) => p.id)).not.toContain('r2')
  })

  it('skips when local updated_at is newer than remote (LWW)', () => {
    const p = makeProject(repo, ownerId, 'r3', 'Original')
    const stale: Project = {
      ...p,
      name: 'Stale remote',
      updated_at: new Date(new Date(p.updated_at).getTime() - 60_000).toISOString()
    }
    repo.applyRemote(stale)
    const local = repo.findById('r3')!
    expect(local.name).toBe(p.name)
  })

  it('overwrites local row when remote updated_at is newer', () => {
    const p = makeProject(repo, ownerId, 'r4', 'Original')
    const fresh: Project = {
      ...p,
      name: 'Updated remote',
      updated_at: new Date(new Date(p.updated_at).getTime() + 60_000).toISOString()
    }
    repo.applyRemote(fresh)
    const local = repo.findById('r4')!
    expect(local.name).toBe('Updated remote')
    expect(local.updated_at).toBe(fresh.updated_at)
  })
})

describe('ProjectRepository — archive/unarchive', () => {
  let db: DatabaseSync
  let repo: ProjectRepository
  let ownerId: string

  beforeEach(() => {
    db = createTestDb()
    ownerId = seedUser(db)
    repo = new ProjectRepository(db)
  })

  function seedStatus(projectId: string, statusId = 's1'): string {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO statuses (id, project_id, name, color, icon, order_index, is_done, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(statusId, projectId, 'Todo', '#888888', 'circle', 0, 0, 1, now, now)
    return statusId
  }

  function seedTask(projectId: string, taskId: string, statusId: string): void {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO tasks (id, project_id, owner_id, title, status_id, priority, order_index, is_template, is_archived, is_in_my_day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(taskId, projectId, ownerId, 'Task', statusId, 0, 0, 0, 0, 0, now, now)
  }

  it('archiveWithTasks() sets is_archived = 1 on project', () => {
    const p = makeProject(repo, ownerId, 'p1')
    const result = repo.archiveWithTasks(p.id)
    expect(result).toBeDefined()
    expect(result!.is_archived).toBe(1)
    expect(repo.findById(p.id)!.is_archived).toBe(1)
  })

  it('archiveWithTasks() cascades is_archived = 1 to all active tasks', () => {
    const p = makeProject(repo, ownerId, 'p1')
    const sId = seedStatus(p.id)
    seedTask(p.id, 't1', sId)
    seedTask(p.id, 't2', sId)
    repo.archiveWithTasks(p.id)
    const t1 = db.prepare('SELECT is_archived FROM tasks WHERE id = ?').get('t1') as { is_archived: number }
    const t2 = db.prepare('SELECT is_archived FROM tasks WHERE id = ?').get('t2') as { is_archived: number }
    expect(t1.is_archived).toBe(1)
    expect(t2.is_archived).toBe(1)
  })

  it('archiveWithTasks() does not touch deleted tasks', () => {
    const p = makeProject(repo, ownerId, 'p1')
    const sId = seedStatus(p.id)
    seedTask(p.id, 'tAlive', sId)
    seedTask(p.id, 'tDeleted', sId)
    const now = new Date().toISOString()
    db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(now, 'tDeleted')
    repo.archiveWithTasks(p.id)
    const deleted = db.prepare('SELECT is_archived FROM tasks WHERE id = ?').get('tDeleted') as { is_archived: number }
    expect(deleted.is_archived).toBe(0)
  })

  it('unarchiveWithTasks() sets is_archived = 0 on project and tasks', () => {
    const p = makeProject(repo, ownerId, 'p1')
    const sId = seedStatus(p.id)
    seedTask(p.id, 't1', sId)
    repo.archiveWithTasks(p.id)
    const result = repo.unarchiveWithTasks(p.id)
    expect(result).toBeDefined()
    expect(result!.is_archived).toBe(0)
    const t1 = db.prepare('SELECT is_archived FROM tasks WHERE id = ?').get('t1') as { is_archived: number }
    expect(t1.is_archived).toBe(0)
  })

  it('archiveWithTasks() on nonexistent project returns undefined', () => {
    expect(repo.archiveWithTasks('does-not-exist')).toBeUndefined()
  })
})
