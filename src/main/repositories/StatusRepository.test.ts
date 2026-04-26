import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { StatusRepository } from './StatusRepository'
import type { Status } from '../../shared/types'

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  for (const migration of migrations) {
    migration(db)
  }
  return db
}

function seedFixtures(db: DatabaseSync): { userId: string; projectId: string } {
  const userId = 'user-1'
  const projectId = 'proj-1'
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, 'test@example.com', null, null, now, now)
  db.prepare(
    `INSERT INTO projects (id, owner_id, name, description, color, icon, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(projectId, userId, 'Test', null, null, null, now, now)
  return { userId, projectId }
}

function makeStatus(repo: StatusRepository, projectId: string, id: string, name = 'Todo', isDefault = 0): Status {
  return repo.create({
    id,
    project_id: projectId,
    name,
    is_default: isDefault as 0 | 1
  })
}

describe('StatusRepository — soft-delete', () => {
  let db: DatabaseSync
  let repo: StatusRepository
  let projectId: string
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    const fx = seedFixtures(db)
    projectId = fx.projectId
    userId = fx.userId
  })

  it('delete() sets deleted_at instead of removing the row', () => {
    repo = new StatusRepository(db)
    const s = makeStatus(repo, projectId, 's1')
    expect(repo.delete(s.id)).toBe(true)

    const raw = repo.findById(s.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })

  it('delete() is idempotent — second delete on tombstoned row returns false', () => {
    repo = new StatusRepository(db)
    const s = makeStatus(repo, projectId, 's1')
    expect(repo.delete(s.id)).toBe(true)
    expect(repo.delete(s.id)).toBe(false)
  })

  it('hardDelete() physically removes the row', () => {
    repo = new StatusRepository(db)
    const s = makeStatus(repo, projectId, 's1')
    expect(repo.hardDelete(s.id)).toBe(true)
    expect(repo.findById(s.id)).toBeUndefined()
  })

  it('findByProjectId() filters out tombstoned rows', () => {
    repo = new StatusRepository(db)
    makeStatus(repo, projectId, 's1', 'Todo')
    const s2 = makeStatus(repo, projectId, 's2', 'Done')
    repo.delete(s2.id)
    const list = repo.findByProjectId(projectId)
    expect(list.map((s) => s.id)).toEqual(['s1'])
  })

  it('findById() returns the tombstone (raw access for sync layer)', () => {
    repo = new StatusRepository(db)
    const s = makeStatus(repo, projectId, 's1')
    repo.delete(s.id)
    const raw = repo.findById(s.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })

  it('findDefault() ignores tombstoned default status', () => {
    repo = new StatusRepository(db)
    const def = makeStatus(repo, projectId, 's1', 'Todo', 1)
    expect(repo.findDefault(projectId)?.id).toBe(def.id)
    repo.delete(def.id)
    expect(repo.findDefault(projectId)).toBeUndefined()
  })

  it('findAllByProject() returns active rows only by default', () => {
    repo = new StatusRepository(db)
    makeStatus(repo, projectId, 's1')
    const s2 = makeStatus(repo, projectId, 's2')
    repo.delete(s2.id)
    const active = repo.findAllByProject(projectId)
    expect(active.map((s) => s.id).sort()).toEqual(['s1'])
  })

  it('findAllByProject({ includeTombstones: true }) returns all rows including tombstones', () => {
    repo = new StatusRepository(db)
    makeStatus(repo, projectId, 's1')
    const s2 = makeStatus(repo, projectId, 's2')
    repo.delete(s2.id)
    const all = repo.findAllByProject(projectId, { includeTombstones: true })
    expect(all.map((s) => s.id).sort()).toEqual(['s1', 's2'])
  })

  it('findAllByProject({ sinceUpdatedAt }) filters by updated_at', () => {
    db.prepare(
      `INSERT INTO statuses (id, project_id, name, color, icon, order_index, is_done, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('s1', projectId, 'A', '#888888', 'circle', 0, 0, 0, '2026-04-01T10:00:00.000Z', '2026-04-01T10:00:00.000Z')
    db.prepare(
      `INSERT INTO statuses (id, project_id, name, color, icon, order_index, is_done, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('s2', projectId, 'B', '#888888', 'circle', 0, 0, 0, '2026-04-01T11:00:00.000Z', '2026-04-01T11:00:00.000Z')

    repo = new StatusRepository(db)
    const since = repo.findAllByProject(projectId, { sinceUpdatedAt: '2026-04-01T10:30:00.000Z' })
    expect(since.map((s) => s.id)).toContain('s2')
    expect(since.map((s) => s.id)).not.toContain('s1')
  })

  it('findMaxUpdatedAt() returns the max updated_at of active rows', () => {
    repo = new StatusRepository(db)
    makeStatus(repo, projectId, 's1')
    const s2 = makeStatus(repo, projectId, 's2')
    expect(repo.findMaxUpdatedAt(projectId)).toBe(s2.updated_at)
  })

  it('delete() reassigns tasks holding the status to the project default', () => {
    repo = new StatusRepository(db)
    const def = makeStatus(repo, projectId, 's-default', 'Todo', 1)
    const tgt = makeStatus(repo, projectId, 's-todo2', 'Doing', 0)

    // Insert a task pointing at the to-be-deleted status
    db.prepare(
      `INSERT INTO tasks (id, project_id, owner_id, title, status_id, priority, order_index, is_template, is_archived, is_in_my_day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('t1', projectId, userId, 'Task on Doing', tgt.id, 0, 0, 0, 0, 0, '2026-04-01T10:00:00.000Z', '2026-04-01T10:00:00.000Z')

    expect(repo.delete(tgt.id)).toBe(true)

    const taskRow = db.prepare('SELECT status_id FROM tasks WHERE id = ?').get('t1') as { status_id: string }
    expect(taskRow.status_id).toBe(def.id)
  })
})

describe('StatusRepository — applyRemote', () => {
  let db: DatabaseSync
  let repo: StatusRepository
  let projectId: string

  beforeEach(() => {
    db = createTestDb()
    const fx = seedFixtures(db)
    projectId = fx.projectId
    repo = new StatusRepository(db)
  })

  it('inserts a new row from remote, preserving timestamps', () => {
    const remote: Status = {
      id: 'r1',
      project_id: projectId,
      name: 'Remote',
      color: '#ff0000',
      icon: 'circle',
      order_index: 0,
      is_done: 0,
      is_default: 0,
      created_at: '2026-04-25T10:00:00.000Z',
      updated_at: '2026-04-25T10:00:00.000Z',
      deleted_at: null
    }
    repo.applyRemote(remote)
    const local = repo.findById('r1')!
    expect(local.created_at).toBe(remote.created_at)
    expect(local.updated_at).toBe(remote.updated_at)
    expect(local.deleted_at).toBeNull()
    expect(local.color).toBe('#ff0000')
  })

  it('preserves remote deleted_at on apply (tombstone propagation)', () => {
    const tombstoned: Status = {
      id: 'r2',
      project_id: projectId,
      name: 'Tombstoned',
      color: '#888888',
      icon: 'circle',
      order_index: 0,
      is_done: 0,
      is_default: 0,
      created_at: '2026-04-25T10:00:00.000Z',
      updated_at: '2026-04-25T11:00:00.000Z',
      deleted_at: '2026-04-25T11:00:00.000Z'
    }
    repo.applyRemote(tombstoned)
    const local = repo.findById('r2')!
    expect(local.deleted_at).toBe('2026-04-25T11:00:00.000Z')
    expect(repo.findByProjectId(projectId).map((s) => s.id)).not.toContain('r2')
  })

  it('skips when local updated_at is newer than remote (LWW)', () => {
    const s = makeStatus(repo, projectId, 'r3', 'Original')
    const stale: Status = {
      ...s,
      name: 'Stale remote',
      updated_at: new Date(new Date(s.updated_at).getTime() - 60_000).toISOString()
    }
    repo.applyRemote(stale)
    const local = repo.findById('r3')!
    expect(local.name).toBe(s.name)
  })

  it('overwrites local row when remote updated_at is newer', () => {
    const s = makeStatus(repo, projectId, 'r4', 'Original')
    const fresh: Status = {
      ...s,
      name: 'Updated remote',
      updated_at: new Date(new Date(s.updated_at).getTime() + 60_000).toISOString()
    }
    repo.applyRemote(fresh)
    const local = repo.findById('r4')!
    expect(local.name).toBe('Updated remote')
    expect(local.updated_at).toBe(fresh.updated_at)
  })
})
