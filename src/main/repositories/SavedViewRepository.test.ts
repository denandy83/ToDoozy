import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { SavedViewRepository } from './SavedViewRepository'
import type { SavedView } from '../../shared/types'

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

const filterConfig = JSON.stringify({ statusIds: ['todo'], priorities: [3] })

describe('SavedViewRepository — soft-delete', () => {
  let db: DatabaseSync
  let repo: SavedViewRepository
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    userId = seedUser(db)
    repo = new SavedViewRepository(db)
  })

  it('delete() sets deleted_at instead of removing the row', () => {
    const v = repo.create({ id: 'v1', user_id: userId, name: 'My view', filter_config: filterConfig })
    expect(repo.delete(v.id)).toBe(true)
    const raw = repo.findById(v.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })

  it('delete() is idempotent — second delete on tombstoned row returns false', () => {
    const v = repo.create({ id: 'v1', user_id: userId, name: 'My view', filter_config: filterConfig })
    expect(repo.delete(v.id)).toBe(true)
    expect(repo.delete(v.id)).toBe(false)
  })

  it('delete() returns false for missing rows', () => {
    expect(repo.delete('does-not-exist')).toBe(false)
  })

  it('hardDelete() physically removes the row', () => {
    const v = repo.create({ id: 'v1', user_id: userId, name: 'My view', filter_config: filterConfig })
    expect(repo.hardDelete(v.id)).toBe(true)
    expect(repo.findById(v.id)).toBeUndefined()
  })

  it('findByUserId() filters out tombstoned views', () => {
    const a = repo.create({ id: 'v1', user_id: userId, name: 'A', filter_config: filterConfig })
    const b = repo.create({ id: 'v2', user_id: userId, name: 'B', filter_config: filterConfig })
    repo.delete(b.id)
    const ids = repo.findByUserId(userId).map((v) => v.id)
    expect(ids).toContain(a.id)
    expect(ids).not.toContain(b.id)
  })

  it('findByProjectId() filters out tombstoned views', () => {
    // Need a project for the FK
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO projects (id, name, owner_id, color, icon, sidebar_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('p1', 'Project', userId, '#888', 'folder', 0, now, now)
    repo.create({ id: 'v1', user_id: userId, project_id: 'p1', name: 'A', filter_config: filterConfig })
    const b = repo.create({ id: 'v2', user_id: userId, project_id: 'p1', name: 'B', filter_config: filterConfig })
    repo.delete(b.id)
    const ids = repo.findByProjectId('p1').map((v) => v.id)
    expect(ids).toContain('v1')
    expect(ids).not.toContain('v2')
  })

  it('findById() returns the tombstone (raw access for sync layer)', () => {
    const v = repo.create({ id: 'v1', user_id: userId, name: 'My view', filter_config: filterConfig })
    repo.delete(v.id)
    const raw = repo.findById(v.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })
})

describe('SavedViewRepository — sync surface', () => {
  let db: DatabaseSync
  let repo: SavedViewRepository
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    userId = seedUser(db)
    repo = new SavedViewRepository(db)
  })

  it('findAllByUser() returns active rows for the user', () => {
    repo.create({ id: 'v1', user_id: userId, name: 'A', filter_config: filterConfig })
    repo.create({ id: 'v2', user_id: userId, name: 'B', filter_config: filterConfig })
    const otherUser = seedUser(db, 'user-2')
    repo.create({ id: 'v3', user_id: otherUser, name: 'Other', filter_config: filterConfig })
    const ids = repo.findAllByUser(userId).map((v) => v.id).sort()
    expect(ids).toEqual(['v1', 'v2'])
  })

  it('findAllByUser() excludes tombstones by default', () => {
    repo.create({ id: 'v1', user_id: userId, name: 'A', filter_config: filterConfig })
    const b = repo.create({ id: 'v2', user_id: userId, name: 'B', filter_config: filterConfig })
    repo.delete(b.id)
    const ids = repo.findAllByUser(userId).map((v) => v.id)
    expect(ids).toEqual(['v1'])
  })

  it('findAllByUser({ includeTombstones: true }) returns tombstones too', () => {
    repo.create({ id: 'v1', user_id: userId, name: 'A', filter_config: filterConfig })
    const b = repo.create({ id: 'v2', user_id: userId, name: 'B', filter_config: filterConfig })
    repo.delete(b.id)
    const all = repo.findAllByUser(userId, { includeTombstones: true })
    expect(all.map((v) => v.id).sort()).toEqual(['v1', 'v2'])
  })

  it('findAllByUser({ sinceUpdatedAt }) filters by updated_at', () => {
    db.prepare(
      `INSERT INTO saved_views (id, user_id, project_id, name, color, icon, sidebar_order, filter_config, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, 0, ?, ?, ?)`
    ).run('v1', userId, 'A', '#888', 'filter', filterConfig, '2026-04-01T10:00:00.000Z', '2026-04-01T10:00:00.000Z')
    db.prepare(
      `INSERT INTO saved_views (id, user_id, project_id, name, color, icon, sidebar_order, filter_config, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, 0, ?, ?, ?)`
    ).run('v2', userId, 'B', '#888', 'filter', filterConfig, '2026-04-01T11:00:00.000Z', '2026-04-01T11:00:00.000Z')
    const since = repo.findAllByUser(userId, { sinceUpdatedAt: '2026-04-01T10:30:00.000Z' })
    expect(since.map((v) => v.id)).toContain('v2')
    expect(since.map((v) => v.id)).not.toContain('v1')
  })

  it('findMaxUpdatedAt() returns max updated_at of active rows', () => {
    repo.create({ id: 'v1', user_id: userId, name: 'A', filter_config: filterConfig })
    const b = repo.create({ id: 'v2', user_id: userId, name: 'B', filter_config: filterConfig })
    expect(repo.findMaxUpdatedAt(userId)).toBe(b.updated_at)
  })

  it('findMaxUpdatedAt() includes tombstones (so soft-deletes bump the high-water)', () => {
    repo.create({ id: 'v1', user_id: userId, name: 'A', filter_config: filterConfig })
    const b = repo.create({ id: 'v2', user_id: userId, name: 'B', filter_config: filterConfig })
    repo.delete(b.id)
    const tombstoned = repo.findById(b.id)!
    expect(repo.findMaxUpdatedAt(userId)).toBe(tombstoned.updated_at)
  })

  it('findMaxUpdatedAt() returns null when no rows exist', () => {
    expect(repo.findMaxUpdatedAt(userId)).toBeNull()
  })
})

describe('SavedViewRepository — countMatchingTasks', () => {
  let db: DatabaseSync
  let repo: SavedViewRepository
  let userId: string

  // Status ids
  const TODO = 'st-todo'
  const DONE = 'st-done'
  // Label ids
  const BUG = 'lbl-bug'
  const FEATURE = 'lbl-feature'

  function seedProjectStatusesLabels(): void {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO projects (id, name, owner_id, color, icon, sidebar_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('p1', 'Project', userId, '#888', 'folder', 0, now, now)
    db.prepare(
      `INSERT INTO statuses (id, project_id, name, order_index, is_done, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(TODO, 'p1', 'To Do', 0, 0, 1, now, now)
    db.prepare(
      `INSERT INTO statuses (id, project_id, name, order_index, is_done, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(DONE, 'p1', 'Done', 1, 1, 0, now, now)
    // Labels (post-migration labels table has no project_id column)
    db.prepare(
      'INSERT INTO labels (id, name, color, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(BUG, 'Bug', '#ff0000', 0, now, now)
    db.prepare(
      'INSERT INTO labels (id, name, color, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(FEATURE, 'Feature', '#00ff00', 1, now, now)
  }

  function addTask(
    id: string,
    opts: { status?: string; archived?: number; parent?: string | null; labels?: string[] } = {}
  ): void {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO tasks (id, project_id, owner_id, title, status_id, priority, parent_id, is_archived, is_template, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, 'p1', userId, id, opts.status ?? TODO, 0, opts.parent ?? null, opts.archived ?? 0, 0, now, now)
    for (const lbl of opts.labels ?? []) {
      db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run(id, lbl)
    }
  }

  beforeEach(() => {
    db = createTestDb()
    userId = seedUser(db)
    repo = new SavedViewRepository(db)
    seedProjectStatusesLabels()
    // t1: Bug | t2: Bug+Feature | t3: Feature | t4: none
    addTask('t1', { labels: [BUG] })
    addTask('t2', { labels: [BUG, FEATURE] })
    addTask('t3', { labels: [FEATURE] })
    addTask('t4', {})
    // Excluded rows: done, archived, subtask — all carry Bug
    addTask('t5', { status: DONE, labels: [BUG] })
    addTask('t6', { archived: 1, labels: [BUG] })
    addTask('t7', { parent: 't1', labels: [BUG] })
  })

  it('counts tasks matching a single label (filter stores lowercased name)', () => {
    expect(repo.countMatchingTasks(JSON.stringify({ labelIds: ['bug'] }), userId)).toBe(2) // t1, t2
  })

  it("labelLogic 'all' (default) requires every label", () => {
    // t2 is the only task carrying BOTH Bug and Feature
    expect(repo.countMatchingTasks(JSON.stringify({ labelIds: ['bug', 'feature'] }), userId)).toBe(1)
  })

  it("labelLogic 'any' matches tasks carrying at least one label", () => {
    expect(
      repo.countMatchingTasks(JSON.stringify({ labelIds: ['bug', 'feature'], labelLogic: 'any' }), userId)
    ).toBe(3) // t1, t2, t3
  })

  it('matches label names case-insensitively', () => {
    expect(repo.countMatchingTasks(JSON.stringify({ labelIds: ['BUG'] }), userId)).toBe(2)
  })

  it('excludeLabelIds drops tasks carrying the excluded label', () => {
    // Tasks without Bug, not done/archived/subtask: t3, t4
    expect(repo.countMatchingTasks(JSON.stringify({ excludeLabelIds: ['bug'] }), userId)).toBe(2)
  })

  it('ignores done, archived, and subtask rows in label counts', () => {
    // Only top-level, non-archived, non-done Bug tasks count (t1, t2) — never t5/t6/t7
    expect(repo.countMatchingTasks(JSON.stringify({ labelIds: ['bug'] }), userId)).toBe(2)
  })

  it('combines a label filter with a priority filter', () => {
    // Give t1 a high priority; only it should match Bug + priority 3
    db.prepare('UPDATE tasks SET priority = 3 WHERE id = ?').run('t1')
    expect(
      repo.countMatchingTasks(JSON.stringify({ labelIds: ['bug'], priorities: [3] }), userId)
    ).toBe(1)
  })

  it('returns 0 for an unknown label name', () => {
    expect(repo.countMatchingTasks(JSON.stringify({ labelIds: ['nonexistent'] }), userId)).toBe(0)
  })

  it('excludes soft-deleted tasks from label counts', () => {
    // Baseline: t1, t2 carry Bug and are active → 2
    expect(repo.countMatchingTasks(JSON.stringify({ labelIds: ['bug'] }), userId)).toBe(2)
    // Soft-delete t1 → count drops to 1 (only t2 remains)
    db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), 't1')
    expect(repo.countMatchingTasks(JSON.stringify({ labelIds: ['bug'] }), userId)).toBe(1)
  })

  it('excludes soft-deleted tasks from unfiltered (status-only) counts', () => {
    // t1..t4 are active, non-done, non-archived, top-level → 4
    expect(repo.countMatchingTasks(JSON.stringify({}), userId)).toBe(4)
    db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), 't4')
    expect(repo.countMatchingTasks(JSON.stringify({}), userId)).toBe(3)
  })

  it('drops tasks whose matching label link is tombstoned', () => {
    // Baseline: t1, t2 carry Bug → 2
    expect(repo.countMatchingTasks(JSON.stringify({ labelIds: ['bug'] }), userId)).toBe(2)
    // Tombstone t1's Bug link (soft-remove) → t1 no longer matches → 1
    db.prepare(
      'UPDATE task_labels SET deleted_at = ? WHERE task_id = ? AND label_id = ?'
    ).run(new Date().toISOString(), 't1', BUG)
    expect(repo.countMatchingTasks(JSON.stringify({ labelIds: ['bug'] }), userId)).toBe(1)
  })

  it('ignores a tombstoned label definition in label counts', () => {
    expect(repo.countMatchingTasks(JSON.stringify({ labelIds: ['bug'] }), userId)).toBe(2)
    // Soft-delete the Bug label itself → no task matches by that name → 0
    db.prepare('UPDATE labels SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), BUG)
    expect(repo.countMatchingTasks(JSON.stringify({ labelIds: ['bug'] }), userId)).toBe(0)
  })

  it('a tombstoned label link no longer excludes a task in excludeLabelIds', () => {
    // Baseline: excluding Bug leaves t3, t4 → 2
    expect(repo.countMatchingTasks(JSON.stringify({ excludeLabelIds: ['bug'] }), userId)).toBe(2)
    // Tombstone t1's Bug link → t1 is no longer excluded → t1, t3, t4 → 3
    db.prepare(
      'UPDATE task_labels SET deleted_at = ? WHERE task_id = ? AND label_id = ?'
    ).run(new Date().toISOString(), 't1', BUG)
    expect(repo.countMatchingTasks(JSON.stringify({ excludeLabelIds: ['bug'] }), userId)).toBe(3)
  })
})

describe('SavedViewRepository — applyRemote', () => {
  let db: DatabaseSync
  let repo: SavedViewRepository
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    userId = seedUser(db)
    repo = new SavedViewRepository(db)
  })

  it('inserts a new row from remote, preserving timestamps', () => {
    const remote: SavedView = {
      id: 'r1',
      user_id: userId,
      project_id: null,
      name: 'Remote',
      color: '#abcdef',
      icon: 'star',
      sidebar_order: 3,
      filter_config: filterConfig,
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
    expect(local.color).toBe('#abcdef')
    expect(local.sidebar_order).toBe(3)
  })

  it('preserves remote deleted_at on apply (tombstone propagation)', () => {
    const tombstoned: SavedView = {
      id: 'r2',
      user_id: userId,
      project_id: null,
      name: 'Tombstoned',
      color: '#888',
      icon: 'filter',
      sidebar_order: 0,
      filter_config: filterConfig,
      created_at: '2026-04-25T10:00:00.000Z',
      updated_at: '2026-04-25T11:00:00.000Z',
      deleted_at: '2026-04-25T11:00:00.000Z'
    }
    repo.applyRemote(tombstoned)
    const local = repo.findById('r2')!
    expect(local.deleted_at).toBe('2026-04-25T11:00:00.000Z')
    expect(repo.findAllByUser(userId).map((v) => v.id)).not.toContain('r2')
  })

  it('skips when local updated_at is newer than remote (LWW)', () => {
    const v = repo.create({ id: 'r3', user_id: userId, name: 'Original', filter_config: filterConfig })
    const stale: SavedView = {
      ...v,
      name: 'Stale remote',
      updated_at: new Date(new Date(v.updated_at).getTime() - 60_000).toISOString()
    }
    repo.applyRemote(stale)
    expect(repo.findById('r3')!.name).toBe('Original')
  })

  it('overwrites local row when remote updated_at is newer', () => {
    const v = repo.create({ id: 'r4', user_id: userId, name: 'Original', filter_config: filterConfig })
    const fresh: SavedView = {
      ...v,
      name: 'Updated remote',
      updated_at: new Date(new Date(v.updated_at).getTime() + 60_000).toISOString()
    }
    repo.applyRemote(fresh)
    const local = repo.findById('r4')!
    expect(local.name).toBe('Updated remote')
    expect(local.updated_at).toBe(fresh.updated_at)
  })

  it('idempotent — applying the same remote twice yields the same row', () => {
    const remote: SavedView = {
      id: 'r5',
      user_id: userId,
      project_id: null,
      name: 'Remote',
      color: '#888',
      icon: 'filter',
      sidebar_order: 0,
      filter_config: filterConfig,
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
