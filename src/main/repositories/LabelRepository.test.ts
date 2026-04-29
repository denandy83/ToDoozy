import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { LabelRepository } from './LabelRepository'
import type { Label } from '../../shared/types'

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
  db.prepare(
    `INSERT INTO project_members (project_id, user_id, role, joined_at)
     VALUES (?, ?, ?, ?)`
  ).run(projectId, userId, 'owner', now)
  return { userId, projectId }
}

function seedTask(db: DatabaseSync, taskId: string, projectId: string, ownerId: string): void {
  const now = new Date().toISOString()
  let status = db.prepare('SELECT id FROM statuses WHERE project_id = ? LIMIT 1').get(projectId) as { id: string } | undefined
  if (!status) {
    const statusId = `s-${projectId}`
    db.prepare(
      `INSERT INTO statuses (id, project_id, name, color, icon, order_index, is_done, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(statusId, projectId, 'Todo', '#888888', 'circle', 0, 0, 1, now, now)
    status = { id: statusId }
  }
  db.prepare(
    `INSERT INTO tasks (id, project_id, owner_id, title, status_id, priority, order_index, is_template, is_archived, is_in_my_day, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(taskId, projectId, ownerId, 'Test task', status.id, 0, 0, 0, 0, 0, now, now)
}

describe('LabelRepository — soft-delete', () => {
  let db: DatabaseSync
  let repo: LabelRepository
  let userId: string
  let projectId: string

  beforeEach(() => {
    db = createTestDb()
    const fx = seedFixtures(db)
    userId = fx.userId
    projectId = fx.projectId
    repo = new LabelRepository(db)
  })

  it('delete() sets deleted_at instead of removing the row', () => {
    const lab = repo.create({ id: 'l1', user_id: userId, name: 'red', color: '#ff0000' })
    expect(repo.delete(lab.id)).toBe(true)

    const raw = repo.findById(lab.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })

  it('delete() is idempotent — second delete on tombstoned row returns false', () => {
    const lab = repo.create({ id: 'l1', user_id: userId, name: 'red' })
    expect(repo.delete(lab.id)).toBe(true)
    expect(repo.delete(lab.id)).toBe(false)
  })

  it('delete() cascades soft-delete to task_labels and project_labels', () => {
    const lab = repo.create({ id: 'l1', user_id: userId, name: 'red', project_id: projectId })
    seedTask(db, 't1', projectId, userId)
    db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run('t1', lab.id)

    expect(repo.delete(lab.id)).toBe(true)

    const tl = db.prepare('SELECT deleted_at FROM task_labels WHERE label_id = ?').get(lab.id) as { deleted_at: string | null }
    const pl = db.prepare('SELECT deleted_at FROM project_labels WHERE label_id = ?').get(lab.id) as { deleted_at: string | null }
    expect(tl.deleted_at).not.toBeNull()
    expect(pl.deleted_at).not.toBeNull()
  })

  it('hardDelete() physically removes the row', () => {
    const lab = repo.create({ id: 'l1', user_id: userId, name: 'red' })
    expect(repo.hardDelete(lab.id)).toBe(true)
    expect(repo.findById(lab.id)).toBeUndefined()
  })

  it('findByProjectId() filters out tombstoned labels', () => {
    const a = repo.create({ id: 'la', user_id: userId, name: 'red', project_id: projectId })
    repo.create({ id: 'lb', user_id: userId, name: 'blue', project_id: projectId })
    repo.delete(a.id)
    const list = repo.findByProjectId(projectId)
    expect(list.map((l) => l.id).sort()).toEqual(['lb'])
  })

  it('findByProjectId() filters out tombstoned project_labels junction rows', () => {
    const lab = repo.create({ id: 'l1', user_id: userId, name: 'red', project_id: projectId })
    // Tombstone just the junction (label itself stays active)
    db.prepare('UPDATE project_labels SET deleted_at = ? WHERE label_id = ?').run(new Date().toISOString(), lab.id)
    expect(repo.findByProjectId(projectId)).toEqual([])
  })

  it('findById() returns the tombstone (raw access for sync layer)', () => {
    const lab = repo.create({ id: 'l1', user_id: userId, name: 'red' })
    repo.delete(lab.id)
    const raw = repo.findById(lab.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })

  it('findByIds() filters out tombstones', () => {
    const a = repo.create({ id: 'la', user_id: userId, name: 'a' })
    const b = repo.create({ id: 'lb', user_id: userId, name: 'b' })
    repo.delete(a.id)
    const list = repo.findByIds([a.id, b.id])
    expect(list.map((l) => l.id)).toEqual(['lb'])
  })

  it('findAllByUser() returns active rows only by default', () => {
    repo.create({ id: 'la', user_id: userId, name: 'a' })
    const b = repo.create({ id: 'lb', user_id: userId, name: 'b' })
    repo.delete(b.id)
    const active = repo.findAllByUser(userId)
    expect(active.map((l) => l.id).sort()).toEqual(['la'])
  })

  it('findAllByUser({ includeTombstones: true }) returns all rows', () => {
    repo.create({ id: 'la', user_id: userId, name: 'a' })
    const b = repo.create({ id: 'lb', user_id: userId, name: 'b' })
    repo.delete(b.id)
    const all = repo.findAllByUser(userId, { includeTombstones: true })
    expect(all.map((l) => l.id).sort()).toEqual(['la', 'lb'])
  })

  it('findAllByUser({ sinceUpdatedAt }) filters by updated_at high-water', () => {
    db.prepare(
      `INSERT INTO labels (id, user_id, name, color, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('la', userId, 'a', '#888', 0, '2026-04-01T10:00:00.000Z', '2026-04-01T10:00:00.000Z')
    db.prepare(
      `INSERT INTO labels (id, user_id, name, color, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('lb', userId, 'b', '#888', 0, '2026-04-01T11:00:00.000Z', '2026-04-01T11:00:00.000Z')
    const since = repo.findAllByUser(userId, { sinceUpdatedAt: '2026-04-01T10:30:00.000Z' })
    expect(since.map((l) => l.id)).toContain('lb')
    expect(since.map((l) => l.id)).not.toContain('la')
  })

  it('findMaxUpdatedAt() returns the max updated_at of active rows', () => {
    repo.create({ id: 'la', user_id: userId, name: 'a' })
    const b = repo.create({ id: 'lb', user_id: userId, name: 'b' })
    expect(repo.findMaxUpdatedAt(userId)).toBe(b.updated_at)
  })

  it('removeFromProject() soft-deletes the project_labels junction', () => {
    const lab = repo.create({ id: 'l1', user_id: userId, name: 'red', project_id: projectId })
    expect(repo.removeFromProject(projectId, lab.id)).toBe(true)
    const pl = db.prepare('SELECT deleted_at FROM project_labels WHERE project_id = ? AND label_id = ?').get(projectId, lab.id) as { deleted_at: string | null }
    expect(pl.deleted_at).not.toBeNull()
  })

  it('removeFromProject() also soft-deletes task_labels for tasks in that project', () => {
    const lab = repo.create({ id: 'l1', user_id: userId, name: 'red', project_id: projectId })
    seedTask(db, 't1', projectId, userId)
    db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run('t1', lab.id)
    repo.removeFromProject(projectId, lab.id)
    const tl = db.prepare('SELECT deleted_at FROM task_labels WHERE task_id = ? AND label_id = ?').get('t1', lab.id) as { deleted_at: string | null }
    expect(tl.deleted_at).not.toBeNull()
  })

  it('addToProject() revives a tombstoned project_labels link', () => {
    const lab = repo.create({ id: 'l1', user_id: userId, name: 'red', project_id: projectId })
    repo.removeFromProject(projectId, lab.id)
    repo.addToProject(projectId, lab.id)
    const pl = db.prepare('SELECT deleted_at FROM project_labels WHERE project_id = ? AND label_id = ?').get(projectId, lab.id) as { deleted_at: string | null }
    expect(pl.deleted_at).toBeNull()
  })

  it('findByTaskId() hides labels with tombstoned task_labels junction', () => {
    const lab = repo.create({ id: 'l1', user_id: userId, name: 'red', project_id: projectId })
    seedTask(db, 't1', projectId, userId)
    db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run('t1', lab.id)
    expect(repo.findByTaskId('t1').map((l) => l.id)).toEqual([lab.id])

    db.prepare('UPDATE task_labels SET deleted_at = ? WHERE task_id = ? AND label_id = ?')
      .run(new Date().toISOString(), 't1', lab.id)
    expect(repo.findByTaskId('t1')).toEqual([])
  })

  it('findActiveLabelsForProject() hides labels whose only links are tombstoned', () => {
    const lab = repo.create({ id: 'l1', user_id: userId, name: 'red', project_id: projectId })
    seedTask(db, 't1', projectId, userId)
    db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run('t1', lab.id)

    expect(repo.findActiveLabelsForProject(projectId).map((l) => l.id)).toEqual([lab.id])

    db.prepare('UPDATE task_labels SET deleted_at = ? WHERE task_id = ? AND label_id = ?')
      .run(new Date().toISOString(), 't1', lab.id)
    expect(repo.findActiveLabelsForProject(projectId)).toEqual([])
  })
})

describe('LabelRepository — applyRemote', () => {
  let db: DatabaseSync
  let repo: LabelRepository
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    const fx = seedFixtures(db)
    userId = fx.userId
    repo = new LabelRepository(db)
  })

  it('inserts a new row from remote, preserving timestamps', () => {
    const remote: Label = {
      id: 'r1',
      user_id: userId,
      name: 'Remote',
      color: '#abcdef',
      order_index: 0,
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
    const tombstoned: Label = {
      id: 'r2',
      user_id: userId,
      name: 'Tombstoned',
      color: '#888',
      order_index: 0,
      created_at: '2026-04-25T10:00:00.000Z',
      updated_at: '2026-04-25T11:00:00.000Z',
      deleted_at: '2026-04-25T11:00:00.000Z'
    }
    repo.applyRemote(tombstoned)
    const local = repo.findById('r2')!
    expect(local.deleted_at).toBe('2026-04-25T11:00:00.000Z')
    expect(repo.findAllByUser(userId).map((l) => l.id)).not.toContain('r2')
  })

  it('skips when local updated_at is newer than remote (LWW)', () => {
    const lab = repo.create({ id: 'r3', user_id: userId, name: 'Original' })
    const stale: Label = {
      ...lab,
      name: 'Stale remote',
      updated_at: new Date(new Date(lab.updated_at).getTime() - 60_000).toISOString()
    }
    repo.applyRemote(stale)
    const local = repo.findById('r3')!
    expect(local.name).toBe('Original')
  })

  it('overwrites local row when remote updated_at is newer', () => {
    const lab = repo.create({ id: 'r4', user_id: userId, name: 'Original' })
    const fresh: Label = {
      ...lab,
      name: 'Updated remote',
      updated_at: new Date(new Date(lab.updated_at).getTime() + 60_000).toISOString()
    }
    repo.applyRemote(fresh)
    const local = repo.findById('r4')!
    expect(local.name).toBe('Updated remote')
    expect(local.updated_at).toBe(fresh.updated_at)
  })
})

describe('LabelRepository — consolidate', () => {
  let db: DatabaseSync
  let repo: LabelRepository
  let userId: string
  let projectId: string

  function canonical(id: string, name: string): Label {
    const now = new Date().toISOString()
    return {
      id,
      user_id: userId,
      name,
      color: '#000000',
      order_index: 0,
      created_at: now,
      updated_at: now,
      deleted_at: null
    }
  }

  beforeEach(() => {
    db = createTestDb()
    const fx = seedFixtures(db)
    userId = fx.userId
    projectId = fx.projectId
    repo = new LabelRepository(db)
  })

  it('inserts the canonical row when not present and remaps task_labels', () => {
    seedTask(db, 't1', projectId, userId)
    const local = repo.create({ id: 'L_local', user_id: userId, name: 'bug' })
    db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run('t1', local.id)

    const result = repo.consolidate('L_local', canonical('L_remote', 'bug'))
    expect(result.taskRemaps).toBe(1)
    expect(repo.findById('L_local')).toBeUndefined()
    const remote = repo.findById('L_remote')
    expect(remote).toBeDefined()
    expect(remote!.name).toBe('bug')
    const tl = db.prepare('SELECT label_id FROM task_labels WHERE task_id = ?').get('t1') as { label_id: string }
    expect(tl.label_id).toBe('L_remote')
  })

  it('refreshes an existing canonical row via ON CONFLICT update', () => {
    repo.create({ id: 'L_local', user_id: userId, name: 'bug' })
    // Pre-existing local row at canonical ID with a stale name (e.g., placeholder)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO labels (id, user_id, name, color, order_index, created_at, updated_at)
       VALUES ('L_remote', ?, '__stale__', '#888888', 0, ?, ?)`
    ).run(userId, now, now)

    repo.consolidate('L_local', canonical('L_remote', 'bug'))
    const remote = repo.findById('L_remote')!
    expect(remote.name).toBe('bug')
    expect(repo.findById('L_local')).toBeUndefined()
  })

  it('drops the duplicate task_labels row when both fromId and toId are already linked', () => {
    seedTask(db, 't1', projectId, userId)
    repo.create({ id: 'L_local', user_id: userId, name: 'bug' })
    db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run('t1', 'L_local')
    // Pre-existing canonical row + link
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO labels (id, user_id, name, color, order_index, created_at, updated_at)
       VALUES ('L_remote', ?, '__placeholder__', '#000000', 0, ?, ?)`
    ).run(userId, now, now)
    db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run('t1', 'L_remote')

    repo.consolidate('L_local', canonical('L_remote', 'bug'))
    const rows = db.prepare('SELECT label_id FROM task_labels WHERE task_id = ?').all('t1') as Array<{ label_id: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].label_id).toBe('L_remote')
  })

  it('remaps project_labels and removes the source label row', () => {
    repo.create({ id: 'L_local', user_id: userId, name: 'bug' })
    db.prepare(
      `INSERT INTO project_labels (project_id, label_id, created_at) VALUES (?, ?, ?)`
    ).run(projectId, 'L_local', new Date().toISOString())

    const result = repo.consolidate('L_local', canonical('L_remote', 'bug'))
    expect(result.projectRemaps).toBe(1)
    const pl = db.prepare('SELECT label_id FROM project_labels WHERE project_id = ?').get(projectId) as { label_id: string }
    expect(pl.label_id).toBe('L_remote')
  })

  it('idempotent: still upserts canonical when fromId does not exist', () => {
    const result = repo.consolidate('L_missing', canonical('L_remote', 'bug'))
    expect(result.taskRemaps).toBe(0)
    expect(result.projectRemaps).toBe(0)
    expect(repo.findById('L_remote')).toBeDefined()
  })
})
