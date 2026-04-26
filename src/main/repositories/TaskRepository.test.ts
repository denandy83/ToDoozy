import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { TaskRepository } from './TaskRepository'
import type { Task } from '../../shared/types'

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  for (const migration of migrations) {
    migration(db)
  }
  return db
}

function seedFixtures(db: DatabaseSync): { userId: string; projectId: string; statusId: string } {
  const userId = 'user-1'
  const projectId = 'proj-1'
  const statusId = 'status-1'
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, 'test@example.com', null, null, now, now)
  db.prepare(
    `INSERT INTO projects (id, owner_id, name, description, color, icon, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(projectId, userId, 'Test', null, null, null, now, now)
  db.prepare(
    `INSERT INTO statuses (id, project_id, name, color, icon, order_index, is_done, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(statusId, projectId, 'Todo', null, null, 0, 0, 1, now, now)
  return { userId, projectId, statusId }
}

function makeTask(repo: TaskRepository, projectId: string, ownerId: string, statusId: string, id: string, title = 'Test task'): Task {
  return repo.create({
    id,
    project_id: projectId,
    owner_id: ownerId,
    title,
    status_id: statusId
  })
}

describe('TaskRepository — soft-delete', () => {
  let db: DatabaseSync
  let repo: TaskRepository
  let projectId: string
  let userId: string
  let statusId: string

  beforeEach(() => {
    db = createTestDb()
    const fx = seedFixtures(db)
    projectId = fx.projectId
    userId = fx.userId
    statusId = fx.statusId
    repo = new TaskRepository(db)
  })

  it('delete() sets deleted_at instead of removing the row', () => {
    const t = makeTask(repo, projectId, userId, statusId, 't1')
    expect(repo.delete(t.id)).toBe(true)

    const raw = repo.findById(t.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
    // updated_at should be >= created updated_at (delete bumps it)
    expect(raw!.updated_at >= t.updated_at).toBe(true)
  })

  it('delete() is idempotent — second delete on tombstoned row returns false', () => {
    const t = makeTask(repo, projectId, userId, statusId, 't1')
    expect(repo.delete(t.id)).toBe(true)
    expect(repo.delete(t.id)).toBe(false)
  })

  it('hardDelete() physically removes the row', () => {
    const t = makeTask(repo, projectId, userId, statusId, 't1')
    expect(repo.hardDelete(t.id)).toBe(true)
    expect(repo.findById(t.id)).toBeUndefined()
  })

  it('findByProjectId() filters out tombstoned rows', () => {
    makeTask(repo, projectId, userId, statusId, 't1', 'A')
    const t2 = makeTask(repo, projectId, userId, statusId, 't2', 'B')
    repo.delete(t2.id)

    const list = repo.findByProjectId(projectId)
    expect(list.map((t) => t.id)).toEqual(['t1'])
  })

  it('findById() returns the tombstone (raw access for sync layer)', () => {
    const t = makeTask(repo, projectId, userId, statusId, 't1')
    repo.delete(t.id)
    const raw = repo.findById(t.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })

  it('findSubtasks() filters tombstoned subtasks', () => {
    const parent = makeTask(repo, projectId, userId, statusId, 'p1', 'Parent')
    repo.create({ id: 's1', project_id: projectId, owner_id: userId, title: 'Sub 1', status_id: statusId, parent_id: parent.id })
    repo.create({ id: 's2', project_id: projectId, owner_id: userId, title: 'Sub 2', status_id: statusId, parent_id: parent.id })
    repo.delete('s2')
    const subs = repo.findSubtasks(parent.id)
    expect(subs.map((t) => t.id)).toEqual(['s1'])
  })

  it('findAllByProject() returns active rows only by default', () => {
    makeTask(repo, projectId, userId, statusId, 't1')
    const t2 = makeTask(repo, projectId, userId, statusId, 't2')
    repo.delete(t2.id)
    const active = repo.findAllByProject(projectId)
    expect(active.map((t) => t.id).sort()).toEqual(['t1'])
  })

  it('findAllByProject({ includeTombstones: true }) returns all rows including tombstones', () => {
    makeTask(repo, projectId, userId, statusId, 't1')
    const t2 = makeTask(repo, projectId, userId, statusId, 't2')
    repo.delete(t2.id)
    const all = repo.findAllByProject(projectId, { includeTombstones: true })
    expect(all.map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('findAllByProject({ sinceUpdatedAt }) filters by updated_at', () => {
    // Set updated_at directly to avoid same-millisecond collisions.
    db.prepare(
      `INSERT INTO tasks (id, project_id, owner_id, title, status_id, priority, order_index, is_template, is_archived, is_in_my_day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('t1', projectId, userId, 'A', statusId, 0, 0, 0, 0, 0, '2026-04-01T10:00:00.000Z', '2026-04-01T10:00:00.000Z')
    db.prepare(
      `INSERT INTO tasks (id, project_id, owner_id, title, status_id, priority, order_index, is_template, is_archived, is_in_my_day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('t2', projectId, userId, 'B', statusId, 0, 0, 0, 0, 0, '2026-04-01T11:00:00.000Z', '2026-04-01T11:00:00.000Z')
    const since = repo.findAllByProject(projectId, { sinceUpdatedAt: '2026-04-01T10:30:00.000Z' })
    expect(since.map((t) => t.id)).toContain('t2')
    expect(since.map((t) => t.id)).not.toContain('t1')
  })

  it('findMaxUpdatedAt() returns the max updated_at across ALL rows including tombstones', () => {
    makeTask(repo, projectId, userId, statusId, 't1')
    const t2 = makeTask(repo, projectId, userId, statusId, 't2')
    expect(repo.findMaxUpdatedAt(projectId)).toBe(t2.updated_at)
    repo.delete(t2.id)
    // Including tombstones is required so the high-water short-circuit in
    // reconcileTable sees a fresh soft-delete and re-runs the diff.
    const t2Tombstoned = repo.findById(t2.id)!
    expect(repo.findMaxUpdatedAt(projectId)).toBe(t2Tombstoned.updated_at)
  })
})

describe('TaskRepository — applyRemoteTask', () => {
  let db: DatabaseSync
  let repo: TaskRepository
  let projectId: string
  let userId: string
  let statusId: string

  beforeEach(() => {
    db = createTestDb()
    const fx = seedFixtures(db)
    projectId = fx.projectId
    userId = fx.userId
    statusId = fx.statusId
    repo = new TaskRepository(db)
  })

  it('inserts a new row from remote, preserving timestamps', () => {
    const remote: Task = {
      id: 'r1',
      project_id: projectId,
      owner_id: userId,
      assigned_to: null,
      title: 'Remote',
      description: null,
      status_id: statusId,
      priority: 0,
      due_date: null,
      parent_id: null,
      order_index: 0,
      is_template: 0,
      is_archived: 0,
      is_in_my_day: 0,
      completed_date: null,
      recurrence_rule: null,
      reference_url: null,
      my_day_dismissed_date: null,
      created_at: '2026-04-25T10:00:00.000Z',
      updated_at: '2026-04-25T10:00:00.000Z',
      deleted_at: null
    }
    repo.applyRemoteTask(remote)
    const local = repo.findById('r1')!
    expect(local.created_at).toBe(remote.created_at)
    expect(local.updated_at).toBe(remote.updated_at)
    expect(local.deleted_at).toBeNull()
  })

  it('preserves remote deleted_at on apply (tombstone propagation)', () => {
    const tombstoned: Task = {
      id: 'r2',
      project_id: projectId,
      owner_id: userId,
      assigned_to: null,
      title: 'Tombstoned',
      description: null,
      status_id: statusId,
      priority: 0,
      due_date: null,
      parent_id: null,
      order_index: 0,
      is_template: 0,
      is_archived: 0,
      is_in_my_day: 0,
      completed_date: null,
      recurrence_rule: null,
      reference_url: null,
      my_day_dismissed_date: null,
      created_at: '2026-04-25T10:00:00.000Z',
      updated_at: '2026-04-25T11:00:00.000Z',
      deleted_at: '2026-04-25T11:00:00.000Z'
    }
    repo.applyRemoteTask(tombstoned)
    const local = repo.findById('r2')!
    expect(local.deleted_at).toBe('2026-04-25T11:00:00.000Z')
    expect(repo.findByProjectId(projectId).map((t) => t.id)).not.toContain('r2')
  })

  it('skips when local updated_at is newer than remote (LWW)', () => {
    const t = makeTask(repo, projectId, userId, statusId, 'r3')
    const stale: Task = {
      ...t,
      title: 'Stale remote',
      updated_at: new Date(new Date(t.updated_at).getTime() - 60_000).toISOString()
    }
    repo.applyRemoteTask(stale)
    const local = repo.findById('r3')!
    expect(local.title).toBe(t.title) // unchanged
  })

  it('overwrites local row when remote updated_at is newer', () => {
    const t = makeTask(repo, projectId, userId, statusId, 'r4', 'Original')
    const fresh: Task = {
      ...t,
      title: 'Updated remote',
      updated_at: new Date(new Date(t.updated_at).getTime() + 60_000).toISOString()
    }
    repo.applyRemoteTask(fresh)
    const local = repo.findById('r4')!
    expect(local.title).toBe('Updated remote')
    expect(local.updated_at).toBe(fresh.updated_at)
  })

  it('does NOT resurrect a locally tombstoned row when remote update keeps deleted_at set', () => {
    // Drift Scenario D: local soft-deleted, remote sends a newer update that
    // also has deleted_at set (e.g. the remote tombstone propagated and was
    // then edited again on the server). LWW must apply the remote fields, but
    // the row must remain tombstoned — no zombie resurrection.
    const t = makeTask(repo, projectId, userId, statusId, 'r5', 'Living')
    repo.delete(t.id)
    const localTombstoned = repo.findById(t.id)!
    expect(localTombstoned.deleted_at).not.toBeNull()
    const remoteZombie: Task = {
      ...localTombstoned,
      title: 'remote zombie',
      updated_at: new Date(new Date(localTombstoned.updated_at).getTime() + 60_000).toISOString(),
      deleted_at: localTombstoned.deleted_at
    }
    repo.applyRemoteTask(remoteZombie)
    const after = repo.findById(t.id)!
    expect(after.deleted_at).not.toBeNull()
    expect(after.title).toBe('remote zombie')
    expect(repo.findByProjectId(projectId).map((x) => x.id)).not.toContain(t.id)
  })
})
