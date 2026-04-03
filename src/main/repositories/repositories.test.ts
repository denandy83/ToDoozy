import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'crypto'
import { migrations } from '../database/migrations'
import { UserRepository } from './UserRepository'
import { ProjectRepository } from './ProjectRepository'
import { StatusRepository } from './StatusRepository'
import { TaskRepository } from './TaskRepository'
import { LabelRepository } from './LabelRepository'
import { ThemeRepository } from './ThemeRepository'
import { SettingsRepository } from './SettingsRepository'
import { ActivityLogRepository } from './ActivityLogRepository'
import { AttachmentRepository } from './AttachmentRepository'
import { NotificationRepository } from './NotificationRepository'
import { SyncQueueRepository } from './SyncQueueRepository'
import { createRepositories } from './index'

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  for (const migration of migrations) {
    migration(db)
  }
  return db
}

// Helper: seed a user + project + status for FK dependencies
function seedBase(db: DatabaseSync): { userId: string; projectId: string; statusId: string } {
  const userId = randomUUID()
  const projectId = randomUUID()
  const statusId = randomUUID()
  const now = new Date().toISOString()

  db.prepare(
    'INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, `test-${userId}@example.com`, 'Test User', now, now)

  db.prepare(
    'INSERT INTO projects (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(projectId, 'Test Project', userId, now, now)

  db.prepare(
    'INSERT INTO statuses (id, project_id, name, order_index, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(statusId, projectId, 'Not Started', 0, 1, now, now)

  db.prepare(
    'INSERT INTO project_members (project_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
  ).run(projectId, userId, 'owner', now)

  return { userId, projectId, statusId }
}

describe('createRepositories', () => {
  it('returns all repository instances', () => {
    const db = createTestDb()
    const repos = createRepositories(db)
    expect(repos.users).toBeInstanceOf(UserRepository)
    expect(repos.projects).toBeInstanceOf(ProjectRepository)
    expect(repos.statuses).toBeInstanceOf(StatusRepository)
    expect(repos.tasks).toBeInstanceOf(TaskRepository)
    expect(repos.labels).toBeInstanceOf(LabelRepository)
    expect(repos.themes).toBeInstanceOf(ThemeRepository)
    expect(repos.settings).toBeInstanceOf(SettingsRepository)
    expect(repos.activityLog).toBeInstanceOf(ActivityLogRepository)
    expect(repos.attachments).toBeInstanceOf(AttachmentRepository)
    expect(repos.notifications).toBeInstanceOf(NotificationRepository)
    expect(repos.syncQueue).toBeInstanceOf(SyncQueueRepository)
    db.close()
  })
})

describe('UserRepository', () => {
  let db: DatabaseSync
  let repo: UserRepository

  beforeEach(() => {
    db = createTestDb()
    repo = new UserRepository(db)
  })

  it('creates and finds a user by id', () => {
    const id = randomUUID()
    const user = repo.create({ id, email: 'alice@test.com', display_name: 'Alice' })
    expect(user.id).toBe(id)
    expect(user.email).toBe('alice@test.com')
    expect(user.display_name).toBe('Alice')

    const found = repo.findById(id)
    expect(found).toBeDefined()
    expect(found!.email).toBe('alice@test.com')
  })

  it('finds a user by email', () => {
    const id = randomUUID()
    repo.create({ id, email: 'bob@test.com' })
    const found = repo.findByEmail('bob@test.com')
    expect(found).toBeDefined()
    expect(found!.id).toBe(id)
  })

  it('updates a user', () => {
    const id = randomUUID()
    repo.create({ id, email: 'carol@test.com' })
    const updated = repo.update(id, { display_name: 'Carol' })
    expect(updated!.display_name).toBe('Carol')
  })

  it('deletes a user', () => {
    const id = randomUUID()
    repo.create({ id, email: 'dave@test.com' })
    expect(repo.delete(id)).toBe(true)
    expect(repo.findById(id)).toBeUndefined()
  })

  it('lists all users', () => {
    repo.create({ id: randomUUID(), email: 'a@test.com' })
    repo.create({ id: randomUUID(), email: 'b@test.com' })
    expect(repo.list()).toHaveLength(2)
  })

  it('returns undefined for nonexistent user', () => {
    expect(repo.findById(randomUUID())).toBeUndefined()
  })
})

describe('ProjectRepository', () => {
  let db: DatabaseSync
  let repo: ProjectRepository
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    repo = new ProjectRepository(db)
    userId = randomUUID()
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(userId, 'owner@test.com', now, now)
  })

  it('creates and finds a project', () => {
    const id = randomUUID()
    const project = repo.create({ id, name: 'My Project', owner_id: userId })
    expect(project.name).toBe('My Project')
    expect(project.color).toBe('#888888')
    expect(repo.findById(id)).toBeDefined()
  })

  it('finds projects by owner', () => {
    repo.create({ id: randomUUID(), name: 'P1', owner_id: userId })
    repo.create({ id: randomUUID(), name: 'P2', owner_id: userId })
    expect(repo.findByOwnerId(userId)).toHaveLength(2)
  })

  it('finds default project', () => {
    repo.create({ id: randomUUID(), name: 'Personal', owner_id: userId, is_default: 1 })
    const def = repo.findDefault(userId)
    expect(def).toBeDefined()
    expect(def!.is_default).toBe(1)
  })

  it('updates a project', () => {
    const id = randomUUID()
    repo.create({ id, name: 'Old', owner_id: userId })
    const updated = repo.update(id, { name: 'New', color: '#ff0000' })
    expect(updated!.name).toBe('New')
    expect(updated!.color).toBe('#ff0000')
  })

  it('deletes a project', () => {
    const id = randomUUID()
    repo.create({ id, name: 'Temp', owner_id: userId })
    expect(repo.delete(id)).toBe(true)
    expect(repo.findById(id)).toBeUndefined()
  })

  it('manages project members', () => {
    const projectId = randomUUID()
    repo.create({ id: projectId, name: 'Team', owner_id: userId })

    const memberId = randomUUID()
    const now = new Date().toISOString()
    db.prepare('INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      memberId, 'member@test.com', now, now
    )

    repo.addMember(projectId, memberId, 'member', userId)
    const members = repo.getMembers(projectId)
    expect(members).toHaveLength(1)
    expect(members[0].role).toBe('member')

    expect(repo.removeMember(projectId, memberId)).toBe(true)
    expect(repo.getMembers(projectId)).toHaveLength(0)
  })

  it('gets projects for a user via membership', () => {
    const projectId = randomUUID()
    repo.create({ id: projectId, name: 'Shared', owner_id: userId })
    repo.addMember(projectId, userId, 'owner')
    const projects = repo.getProjectsForUser(userId)
    expect(projects).toHaveLength(1)
  })
})

describe('StatusRepository', () => {
  let db: DatabaseSync
  let repo: StatusRepository
  let projectId: string

  beforeEach(() => {
    db = createTestDb()
    repo = new StatusRepository(db)
    const base = seedBase(db)
    projectId = base.projectId
    // Remove the seeded status so we start clean
    db.prepare('DELETE FROM statuses').run()
  })

  it('creates and finds a status', () => {
    const id = randomUUID()
    const status = repo.create({ id, project_id: projectId, name: 'Todo' })
    expect(status.name).toBe('Todo')
    expect(repo.findById(id)).toBeDefined()
  })

  it('finds statuses by project', () => {
    repo.create({ id: randomUUID(), project_id: projectId, name: 'A', order_index: 1 })
    repo.create({ id: randomUUID(), project_id: projectId, name: 'B', order_index: 0 })
    const statuses = repo.findByProjectId(projectId)
    expect(statuses).toHaveLength(2)
    expect(statuses[0].name).toBe('B') // ordered by order_index
  })

  it('finds default and done statuses', () => {
    repo.create({ id: randomUUID(), project_id: projectId, name: 'Default', is_default: 1 })
    repo.create({ id: randomUUID(), project_id: projectId, name: 'Done', is_done: 1 })
    expect(repo.findDefault(projectId)!.name).toBe('Default')
    expect(repo.findDone(projectId)!.name).toBe('Done')
  })

  it('updates a status', () => {
    const id = randomUUID()
    repo.create({ id, project_id: projectId, name: 'Old' })
    const updated = repo.update(id, { name: 'New', color: '#00ff00' })
    expect(updated!.name).toBe('New')
    expect(updated!.color).toBe('#00ff00')
  })

  it('reassigns tasks and deletes a status', () => {
    const oldId = randomUUID()
    const newId = randomUUID()
    repo.create({ id: oldId, project_id: projectId, name: 'Old Status' })
    repo.create({ id: newId, project_id: projectId, name: 'New Status' })

    // Create a task with the old status
    const base = seedBase(db)
    const taskId = randomUUID()
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO tasks (id, project_id, owner_id, title, status_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(taskId, base.projectId, base.userId, 'Test Task', oldId, now, now)

    expect(repo.reassignAndDelete(oldId, newId)).toBe(true)
    expect(repo.findById(oldId)).toBeUndefined()

    const task = db.prepare('SELECT status_id FROM tasks WHERE id = ?').get(taskId) as { status_id: string }
    expect(task.status_id).toBe(newId)
  })
})

describe('TaskRepository', () => {
  let db: DatabaseSync
  let repo: TaskRepository
  let userId: string
  let projectId: string
  let statusId: string

  beforeEach(() => {
    db = createTestDb()
    repo = new TaskRepository(db)
    const base = seedBase(db)
    userId = base.userId
    projectId = base.projectId
    statusId = base.statusId
  })

  it('creates and finds a task', () => {
    const id = randomUUID()
    const task = repo.create({
      id,
      project_id: projectId,
      owner_id: userId,
      title: 'Buy milk',
      status_id: statusId
    })
    expect(task.title).toBe('Buy milk')
    expect(task.priority).toBe(0)
    expect(repo.findById(id)).toBeDefined()
  })

  it('finds tasks by project (excludes archived/templates)', () => {
    repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Normal', status_id: statusId })
    repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Archived', status_id: statusId, is_archived: 1 })
    repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Template', status_id: statusId, is_template: 1 })
    expect(repo.findByProjectId(projectId)).toHaveLength(1)
  })

  it('finds archived and template tasks', () => {
    repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Archived', status_id: statusId, is_archived: 1 })
    repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Template', status_id: statusId, is_template: 1 })
    expect(repo.findArchived(projectId)).toHaveLength(1)
    expect(repo.findTemplates(projectId)).toHaveLength(1)
  })

  it('finds subtasks', () => {
    const parentId = randomUUID()
    repo.create({ id: parentId, project_id: projectId, owner_id: userId, title: 'Parent', status_id: statusId })
    repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Child 1', status_id: statusId, parent_id: parentId })
    repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Child 2', status_id: statusId, parent_id: parentId })
    expect(repo.findSubtasks(parentId)).toHaveLength(2)
  })

  it('updates a task using column whitelist', () => {
    const id = randomUUID()
    repo.create({ id, project_id: projectId, owner_id: userId, title: 'Old', status_id: statusId })
    const updated = repo.update(id, { title: 'New', priority: 3 })
    expect(updated!.title).toBe('New')
    expect(updated!.priority).toBe(3)
  })

  it('deletes a task', () => {
    const id = randomUUID()
    repo.create({ id, project_id: projectId, owner_id: userId, title: 'Temp', status_id: statusId })
    expect(repo.delete(id)).toBe(true)
    expect(repo.findById(id)).toBeUndefined()
  })

  it('reorders tasks in a batch transaction', () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()]
    for (const [i, id] of ids.entries()) {
      repo.create({ id, project_id: projectId, owner_id: userId, title: `Task ${i}`, status_id: statusId, order_index: i })
    }
    repo.reorder([ids[2], ids[0], ids[1]])
    expect(repo.findById(ids[2])!.order_index).toBe(0)
    expect(repo.findById(ids[0])!.order_index).toBe(1)
    expect(repo.findById(ids[1])!.order_index).toBe(2)
  })

  it('manages label assignments', () => {
    const taskId = randomUUID()
    repo.create({ id: taskId, project_id: projectId, owner_id: userId, title: 'Task', status_id: statusId })

    const labelId = randomUUID()
    const now = new Date().toISOString()
    db.prepare('INSERT INTO labels (id, name, color, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      labelId, 'Bug', '#ff0000', 0, now, now
    )
    db.prepare('INSERT INTO project_labels (project_id, label_id, created_at) VALUES (?, ?, ?)').run(projectId, labelId, now)

    repo.addLabel(taskId, labelId)
    expect(repo.getLabels(taskId)).toHaveLength(1)

    // Adding same label again should not error (INSERT OR IGNORE)
    repo.addLabel(taskId, labelId)
    expect(repo.getLabels(taskId)).toHaveLength(1)

    expect(repo.removeLabel(taskId, labelId)).toBe(true)
    expect(repo.getLabels(taskId)).toHaveLength(0)
  })

  it('duplicates a task', () => {
    const id = randomUUID()
    repo.create({ id, project_id: projectId, owner_id: userId, title: 'Original', status_id: statusId, priority: 2 })
    const newId = randomUUID()
    const copy = repo.duplicate(id, newId)
    expect(copy).toBeDefined()
    expect(copy!.title).toBe('Original (copy)')
    expect(copy!.priority).toBe(2)
    expect(copy!.id).toBe(newId)
  })

  it('gets subtask count', () => {
    const parentId = randomUUID()
    repo.create({ id: parentId, project_id: projectId, owner_id: userId, title: 'Parent', status_id: statusId })

    // Create a "done" status
    const doneStatusId = randomUUID()
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO statuses (id, project_id, name, is_done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(doneStatusId, projectId, 'Done', 1, now, now)

    repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'C1', status_id: statusId, parent_id: parentId })
    repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'C2', status_id: doneStatusId, parent_id: parentId })

    const count = repo.getSubtaskCount(parentId)
    expect(count.total).toBe(2)
    expect(count.done).toBe(1)
  })

  describe('search', () => {
    it('returns all non-archived, non-template tasks with no filters', () => {
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Active', status_id: statusId })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Archived', status_id: statusId, is_archived: 1 })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Template', status_id: statusId, is_template: 1 })
      const results = repo.search({})
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Active')
    })

    it('filters by project_id', () => {
      const otherProjectId = randomUUID()
      const now = new Date().toISOString()
      db.prepare(
        'INSERT INTO projects (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(otherProjectId, 'Other', userId, now, now)
      const otherStatusId = randomUUID()
      db.prepare(
        'INSERT INTO statuses (id, project_id, name, order_index, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(otherStatusId, otherProjectId, 'Default', 0, 1, now, now)

      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'A', status_id: statusId })
      repo.create({ id: randomUUID(), project_id: otherProjectId, owner_id: userId, title: 'B', status_id: otherStatusId })

      const results = repo.search({ project_id: projectId })
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('A')
    })

    it('filters by priority', () => {
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Low', status_id: statusId, priority: 1 })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'High', status_id: statusId, priority: 3 })

      const results = repo.search({ priority: 3 })
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('High')
    })

    it('filters by keyword in title and description', () => {
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Buy groceries', status_id: statusId })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Read book', status_id: statusId, description: 'Buy a new bookshelf too' })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Exercise', status_id: statusId })

      const results = repo.search({ keyword: 'buy' })
      expect(results).toHaveLength(2)
    })

    it('filters by label_id', () => {
      const labelId = randomUUID()
      const now = new Date().toISOString()
      db.prepare(
        'INSERT INTO labels (id, name, color, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(labelId, 'Bug', '#ff0000', 0, now, now)
      db.prepare(
        'INSERT INTO project_labels (project_id, label_id, created_at) VALUES (?, ?, ?)'
      ).run(projectId, labelId, now)

      const taskWithLabel = randomUUID()
      repo.create({ id: taskWithLabel, project_id: projectId, owner_id: userId, title: 'Labeled', status_id: statusId })
      repo.addLabel(taskWithLabel, labelId)
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'No label', status_id: statusId })

      const results = repo.search({ label_id: labelId })
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Labeled')
    })

    it('filters by due date range', () => {
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Past', status_id: statusId, due_date: '2025-01-01T00:00:00Z' })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Future', status_id: statusId, due_date: '2030-06-15T00:00:00Z' })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'No date', status_id: statusId })

      const before = repo.search({ due_before: '2026-01-01T00:00:00Z' })
      expect(before).toHaveLength(1)
      expect(before[0].title).toBe('Past')

      const after = repo.search({ due_after: '2026-01-01T00:00:00Z' })
      expect(after).toHaveLength(1)
      expect(after[0].title).toBe('Future')
    })

    it('combines multiple filters with AND', () => {
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'High Buy', status_id: statusId, priority: 3 })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Low Buy', status_id: statusId, priority: 1 })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'High Sell', status_id: statusId, priority: 3 })

      const results = repo.search({ priority: 3, keyword: 'buy' })
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('High Buy')
    })

    it('filters by multiple label_ids with OR logic', () => {
      const now = new Date().toISOString()
      const label1 = randomUUID()
      const label2 = randomUUID()
      db.prepare('INSERT INTO labels (id, name, color, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(label1, 'Bug', '#ff0000', 0, now, now)
      db.prepare('INSERT INTO labels (id, name, color, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(label2, 'Feature', '#00ff00', 1, now, now)
      db.prepare('INSERT INTO project_labels (project_id, label_id, created_at) VALUES (?, ?, ?)').run(projectId, label1, now)
      db.prepare('INSERT INTO project_labels (project_id, label_id, created_at) VALUES (?, ?, ?)').run(projectId, label2, now)

      const t1 = randomUUID()
      const t2 = randomUUID()
      const t3 = randomUUID()
      repo.create({ id: t1, project_id: projectId, owner_id: userId, title: 'Has Bug', status_id: statusId })
      repo.addLabel(t1, label1)
      repo.create({ id: t2, project_id: projectId, owner_id: userId, title: 'Has Feature', status_id: statusId })
      repo.addLabel(t2, label2)
      repo.create({ id: t3, project_id: projectId, owner_id: userId, title: 'No labels', status_id: statusId })

      const results = repo.search({ label_ids: [label1, label2] })
      expect(results).toHaveLength(2)
      expect(results.map((r) => r.title).sort()).toEqual(['Has Bug', 'Has Feature'])
    })

    it('filters by multiple priorities', () => {
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'None', status_id: statusId, priority: 0 })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Low', status_id: statusId, priority: 1 })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'High', status_id: statusId, priority: 3 })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Urgent', status_id: statusId, priority: 4 })

      const results = repo.search({ priorities: [3, 4] })
      expect(results).toHaveLength(2)
      expect(results.map((r) => r.title).sort()).toEqual(['High', 'Urgent'])
    })

    it('filters by multiple status_ids', () => {
      const now = new Date().toISOString()
      const status2 = randomUUID()
      db.prepare('INSERT INTO statuses (id, project_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(status2, projectId, 'In Progress', 1, now, now)

      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Default', status_id: statusId })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'In Progress', status_id: status2 })

      const results = repo.search({ status_ids: [status2] })
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('In Progress')
    })

    it('filters by multiple project_ids', () => {
      const now = new Date().toISOString()
      const proj2 = randomUUID()
      const stat2 = randomUUID()
      db.prepare('INSERT INTO projects (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(proj2, 'Proj2', userId, now, now)
      db.prepare('INSERT INTO statuses (id, project_id, name, order_index, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(stat2, proj2, 'Default', 0, 1, now, now)

      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'P1', status_id: statusId })
      repo.create({ id: randomUUID(), project_id: proj2, owner_id: userId, title: 'P2', status_id: stat2 })

      const results = repo.search({ project_ids: [projectId, proj2] })
      expect(results).toHaveLength(2)
    })

    it('filters by assigned_to_ids', () => {
      const now = new Date().toISOString()
      const user2 = randomUUID()
      db.prepare('INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(user2, 'user2@test.com', 'User 2', now, now)

      const t1 = randomUUID()
      const t2 = randomUUID()
      repo.create({ id: t1, project_id: projectId, owner_id: userId, title: 'Assigned', status_id: statusId })
      repo.update(t1, { assigned_to: user2 })
      repo.create({ id: t2, project_id: projectId, owner_id: userId, title: 'Unassigned', status_id: statusId })

      const results = repo.search({ assigned_to_ids: [user2] })
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Assigned')
    })
  })

  describe('reference_url', () => {
    it('creates a task with reference_url', () => {
      const id = randomUUID()
      const task = repo.create({
        id,
        project_id: projectId,
        owner_id: userId,
        title: 'With URL',
        status_id: statusId,
        reference_url: 'https://example.com'
      })
      expect(task.reference_url).toBe('https://example.com')
    })

    it('creates a task with null reference_url by default', () => {
      const id = randomUUID()
      const task = repo.create({
        id,
        project_id: projectId,
        owner_id: userId,
        title: 'No URL',
        status_id: statusId
      })
      expect(task.reference_url).toBeNull()
    })

    it('updates reference_url via column whitelist', () => {
      const id = randomUUID()
      repo.create({ id, project_id: projectId, owner_id: userId, title: 'Task', status_id: statusId })
      const updated = repo.update(id, { reference_url: 'https://github.com/issue/1' })
      expect(updated!.reference_url).toBe('https://github.com/issue/1')
    })

    it('clears reference_url by setting to null', () => {
      const id = randomUUID()
      repo.create({ id, project_id: projectId, owner_id: userId, title: 'Task', status_id: statusId, reference_url: 'https://example.com' })
      const updated = repo.update(id, { reference_url: null })
      expect(updated!.reference_url).toBeNull()
    })
  })

  describe('findWithUpcomingDueTimes', () => {
    // due_date is stored as local time without timezone (e.g. "2026-03-30T15:16")
    const toLocalTime = (d: Date): string => {
      const pad = (n: number): string => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    it('returns tasks with due times within the specified minutes', () => {
      const now = new Date()
      const in10Min = toLocalTime(new Date(now.getTime() + 10 * 60_000))
      const in60Min = toLocalTime(new Date(now.getTime() + 60 * 60_000))

      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Soon', status_id: statusId, due_date: in10Min })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Later', status_id: statusId, due_date: in60Min })

      const results = repo.findWithUpcomingDueTimes(15)
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Soon')
    })

    it('excludes date-only tasks (no T in due_date)', () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const dateOnly = tomorrow.toISOString().split('T')[0]
      const in10Min = toLocalTime(new Date(Date.now() + 10 * 60_000))

      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Date only', status_id: statusId, due_date: dateOnly })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'With time', status_id: statusId, due_date: in10Min })

      const results = repo.findWithUpcomingDueTimes(15)
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('With time')
    })

    it('excludes archived and template tasks', () => {
      const in10Min = toLocalTime(new Date(Date.now() + 10 * 60_000))

      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Active', status_id: statusId, due_date: in10Min })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Archived', status_id: statusId, due_date: in10Min, is_archived: 1 })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Template', status_id: statusId, due_date: in10Min, is_template: 1 })

      const results = repo.findWithUpcomingDueTimes(15)
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Active')
    })

    it('excludes completed tasks (done status)', () => {
      const doneStatusId = randomUUID()
      const now = new Date().toISOString()
      db.prepare(
        'INSERT INTO statuses (id, project_id, name, is_done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(doneStatusId, projectId, 'Done', 1, now, now)

      const in10Min = toLocalTime(new Date(Date.now() + 10 * 60_000))

      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Active', status_id: statusId, due_date: in10Min })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Done', status_id: doneStatusId, due_date: in10Min })

      const results = repo.findWithUpcomingDueTimes(15)
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Active')
    })

    it('excludes tasks already past due', () => {
      const past = toLocalTime(new Date(Date.now() - 5 * 60_000))
      const in10Min = toLocalTime(new Date(Date.now() + 10 * 60_000))

      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Past', status_id: statusId, due_date: past })
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'Future', status_id: statusId, due_date: in10Min })

      const results = repo.findWithUpcomingDueTimes(15)
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Future')
    })

    it('returns empty array when no tasks have due times', () => {
      repo.create({ id: randomUUID(), project_id: projectId, owner_id: userId, title: 'No date', status_id: statusId })
      const results = repo.findWithUpcomingDueTimes(15)
      expect(results).toHaveLength(0)
    })
  })
})

describe('LabelRepository', () => {
  let db: DatabaseSync
  let repo: LabelRepository
  let projectId: string
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    repo = new LabelRepository(db)
    const base = seedBase(db)
    projectId = base.projectId
    userId = base.userId
  })

  it('creates a global label and finds it', () => {
    const id = randomUUID()
    const label = repo.create({ id, name: 'Bug', color: '#ff0000' })
    expect(label.name).toBe('Bug')
    expect(repo.findById(id)).toBeDefined()
  })

  it('creates a label linked to a project', () => {
    const id = randomUUID()
    repo.create({ id, project_id: projectId, name: 'Feature', color: '#00ff00' })
    const labels = repo.findByProjectId(projectId)
    expect(labels).toHaveLength(1)
    expect(labels[0].name).toBe('Feature')
  })

  it('finds all labels for user', () => {
    repo.create({ id: randomUUID(), project_id: projectId, name: 'Zzz' })
    repo.create({ id: randomUUID(), project_id: projectId, name: 'Aaa' })
    const labels = repo.findAllForUser(userId)
    expect(labels).toHaveLength(2)
  })

  it('finds labels by project sorted by order_index', () => {
    repo.create({ id: randomUUID(), project_id: projectId, name: 'Zzz' })
    repo.create({ id: randomUUID(), project_id: projectId, name: 'Aaa' })
    const labels = repo.findByProjectId(projectId)
    expect(labels).toHaveLength(2)
    // Most recent is at index 0 (shifted to top)
    expect(labels[0].name).toBe('Aaa')
  })

  it('finds label by name case-insensitively', () => {
    repo.create({ id: randomUUID(), project_id: projectId, name: 'Bug' })
    expect(repo.findByName(userId, 'bug')).toBeDefined()
    expect(repo.findByName(userId, 'BUG')).toBeDefined()
    expect(repo.findByName(userId, 'nonexistent')).toBeUndefined()
  })

  it('updates a label globally', () => {
    const id = randomUUID()
    repo.create({ id, project_id: projectId, name: 'Old' })
    const updated = repo.update(id, { name: 'New', color: '#00ff00' })
    expect(updated!.name).toBe('New')
    expect(updated!.color).toBe('#00ff00')
  })

  it('deletes a label globally and cascades', () => {
    const id = randomUUID()
    repo.create({ id, project_id: projectId, name: 'Temp' })
    expect(repo.delete(id)).toBe(true)
    expect(repo.findById(id)).toBeUndefined()
    // project_labels should also be cleaned up (cascade)
    expect(repo.findByProjectId(projectId)).toHaveLength(0)
  })

  it('adds and removes labels from projects', () => {
    const id = randomUUID()
    repo.create({ id, name: 'Global' })
    // Not linked to any project initially
    expect(repo.findByProjectId(projectId)).toHaveLength(0)
    // Add to project
    repo.addToProject(projectId, id)
    expect(repo.findByProjectId(projectId)).toHaveLength(1)
    // Remove from project
    repo.removeFromProject(projectId, id)
    expect(repo.findByProjectId(projectId)).toHaveLength(0)
    // Label still exists globally
    expect(repo.findById(id)).toBeDefined()
  })

  it('removeFromProject removes task-label associations in that project', () => {
    const labelId = randomUUID()
    repo.create({ id: labelId, project_id: projectId, name: 'Feature' })

    const base = seedBase(db)
    const taskId = randomUUID()
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO tasks (id, project_id, owner_id, title, status_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(taskId, base.projectId, base.userId, 'Task', base.statusId, now, now)
    db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run(taskId, labelId)

    repo.removeFromProject(base.projectId, labelId)
    // Task should no longer have the label
    expect(repo.findByTaskId(taskId)).toHaveLength(0)
  })

  it('finds labels by task id', () => {
    const labelId = randomUUID()
    repo.create({ id: labelId, project_id: projectId, name: 'Feature' })

    const base = seedBase(db)
    const taskId = randomUUID()
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO tasks (id, project_id, owner_id, title, status_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(taskId, base.projectId, base.userId, 'Task', base.statusId, now, now)

    db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run(taskId, labelId)

    const labels = repo.findByTaskId(taskId)
    expect(labels).toHaveLength(1)
    expect(labels[0].name).toBe('Feature')
  })

  it('findAllWithUsage returns usage counts', () => {
    const labelId = randomUUID()
    repo.create({ id: labelId, project_id: projectId, name: 'Bug' })
    const usage = repo.findAllWithUsage(userId)
    expect(usage).toHaveLength(1)
    expect(usage[0].project_count).toBe(1)
    expect(usage[0].task_count).toBe(0)
  })

  it('findProjectsUsingLabel returns project info', () => {
    const labelId = randomUUID()
    repo.create({ id: labelId, project_id: projectId, name: 'Bug' })
    const projects = repo.findProjectsUsingLabel(userId, labelId)
    expect(projects).toHaveLength(1)
    expect(projects[0].project_id).toBe(projectId)
  })

  it('findActiveLabelsForProject only includes labels on non-archived tasks', () => {
    const labelId = randomUUID()
    repo.create({ id: labelId, project_id: projectId, name: 'Active' })

    const base = seedBase(db)
    const taskId = randomUUID()
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO tasks (id, project_id, owner_id, title, status_id, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
    ).run(taskId, base.projectId, base.userId, 'Active Task', base.statusId, now, now)
    db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run(taskId, labelId)

    const active = repo.findActiveLabelsForProject(base.projectId)
    expect(active).toHaveLength(1)
    expect(active[0].name).toBe('Active')
  })
})

describe('ThemeRepository', () => {
  let db: DatabaseSync
  let repo: ThemeRepository

  beforeEach(() => {
    db = createTestDb()
    repo = new ThemeRepository(db)
  })

  it('lists seeded themes', () => {
    const themes = repo.list()
    expect(themes.length).toBe(12)
  })

  it('lists themes by mode', () => {
    const dark = repo.listByMode('dark')
    const light = repo.listByMode('light')
    expect(dark.length).toBe(6)
    expect(light.length).toBe(6)
  })

  it('creates a custom theme', () => {
    const id = randomUUID()
    const config = JSON.stringify({ bg: '#000', fg: '#fff', fgSecondary: '#aaa', fgMuted: '#666', muted: '#888', accent: '#f00', accentFg: '#fff', border: '#333' })
    const theme = repo.create({ id, name: 'Custom', mode: 'dark', config })
    expect(theme.name).toBe('Custom')
    expect(repo.list().length).toBe(13)
  })

  it('updates a theme', () => {
    const themes = repo.list()
    const updated = repo.update(themes[0].id, { name: 'Renamed' })
    expect(updated!.name).toBe('Renamed')
  })

  it('gets parsed config', () => {
    const themes = repo.list()
    const config = repo.getConfig(themes[0].id)
    expect(config).toBeDefined()
    expect(config!.bg).toBeDefined()
    expect(config!.accent).toBeDefined()
  })

  it('deletes a theme', () => {
    const id = randomUUID()
    const config = JSON.stringify({ bg: '#000', fg: '#fff', fgSecondary: '#aaa', fgMuted: '#666', muted: '#888', accent: '#f00', accentFg: '#fff', border: '#333' })
    repo.create({ id, name: 'ToDelete', mode: 'dark', config })
    expect(repo.delete(id)).toBe(true)
    expect(repo.findById(id)).toBeUndefined()
  })
})

describe('SettingsRepository', () => {
  let db: DatabaseSync
  let repo: SettingsRepository

  beforeEach(() => {
    db = createTestDb()
    repo = new SettingsRepository(db)
  })

  it('gets seeded settings via global fallback', () => {
    const themeMode = repo.get('testuser', 'theme_mode')
    expect(themeMode).toBe('dark')
  })

  it('gets all settings', () => {
    const all = repo.getAll('testuser')
    expect(all.length).toBeGreaterThanOrEqual(12)
  })

  it('sets and gets a value', () => {
    repo.set('testuser', 'custom_key', 'custom_value')
    expect(repo.get('testuser', 'custom_key')).toBe('custom_value')
  })

  it('upserts on set', () => {
    repo.set('testuser', 'theme_mode', 'light')
    expect(repo.get('testuser', 'theme_mode')).toBe('light')
  })

  it('gets multiple keys', () => {
    const settings = repo.getMultiple('testuser', ['theme_mode', 'sidebar_pinned'])
    expect(settings).toHaveLength(2)
  })

  it('sets multiple at once in a transaction', () => {
    repo.setMultiple('testuser', [
      { key: 'a', value: '1' },
      { key: 'b', value: '2' }
    ])
    expect(repo.get('testuser', 'a')).toBe('1')
    expect(repo.get('testuser', 'b')).toBe('2')
  })

  it('deletes a setting', () => {
    repo.set('testuser', 'temp', 'val')
    expect(repo.delete('testuser', 'temp')).toBe(true)
    expect(repo.get('testuser', 'temp')).toBeNull()
  })

  it('returns null for nonexistent key', () => {
    expect(repo.get('testuser', 'nonexistent')).toBeNull()
  })

  it('returns empty array for empty keys list', () => {
    expect(repo.getMultiple('testuser', [])).toEqual([])
  })
})

describe('ActivityLogRepository', () => {
  let db: DatabaseSync
  let repo: ActivityLogRepository
  let userId: string
  let taskId: string

  beforeEach(() => {
    db = createTestDb()
    repo = new ActivityLogRepository(db)
    const base = seedBase(db)
    userId = base.userId
    taskId = randomUUID()
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO tasks (id, project_id, owner_id, title, status_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(taskId, base.projectId, base.userId, 'Log Test', base.statusId, now, now)
  })

  it('creates and finds a log entry', () => {
    const id = randomUUID()
    const entry = repo.create({ id, task_id: taskId, user_id: userId, action: 'created' })
    expect(entry.action).toBe('created')
    expect(repo.findById(id)).toBeDefined()
  })

  it('finds entries by task', () => {
    repo.create({ id: randomUUID(), task_id: taskId, user_id: userId, action: 'created' })
    repo.create({ id: randomUUID(), task_id: taskId, user_id: userId, action: 'updated', old_value: 'old', new_value: 'new' })
    expect(repo.findByTaskId(taskId)).toHaveLength(2)
  })

  it('finds entries by user', () => {
    repo.create({ id: randomUUID(), task_id: taskId, user_id: userId, action: 'created' })
    expect(repo.findByUserId(userId)).toHaveLength(1)
  })

  it('deletes entries by task', () => {
    repo.create({ id: randomUUID(), task_id: taskId, user_id: userId, action: 'created' })
    repo.create({ id: randomUUID(), task_id: taskId, user_id: userId, action: 'updated' })
    expect(repo.deleteByTaskId(taskId)).toBe(2)
    expect(repo.findByTaskId(taskId)).toHaveLength(0)
  })

  it('gets recent entries with limit', () => {
    for (let i = 0; i < 5; i++) {
      repo.create({ id: randomUUID(), task_id: taskId, user_id: userId, action: `action_${i}` })
    }
    expect(repo.getRecent(userId, 3)).toHaveLength(3)
  })
})

describe('AttachmentRepository', () => {
  let db: DatabaseSync
  let repo: AttachmentRepository
  let taskId: string

  beforeEach(() => {
    db = createTestDb()
    repo = new AttachmentRepository(db)
    const base = seedBase(db)
    taskId = randomUUID()
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO tasks (id, project_id, owner_id, title, status_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(taskId, base.projectId, base.userId, 'Attachment Test', base.statusId, now, now)
  })

  const makeFileData = (): Buffer => Buffer.from('fake file content')

  it('creates and finds an attachment', () => {
    const id = randomUUID()
    const att = repo.create({
      id,
      task_id: taskId,
      filename: 'report.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
      file_data: makeFileData()
    })
    expect(att.filename).toBe('report.pdf')
    expect(att.mime_type).toBe('application/pdf')
    expect(att.size_bytes).toBe(1024)
  })

  it('returns file data via getFileData', () => {
    const id = randomUUID()
    repo.create({
      id,
      task_id: taskId,
      filename: 'report.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
      file_data: makeFileData()
    })
    const data = repo.getFileData(id)
    expect(data).toBeDefined()
    expect(data!.filename).toBe('report.pdf')
    expect(Buffer.isBuffer(data!.file_data)).toBe(true)
  })

  it('does not include file_data in findByTaskId results', () => {
    repo.create({
      id: randomUUID(),
      task_id: taskId,
      filename: 'a.pdf',
      mime_type: 'application/pdf',
      size_bytes: 100,
      file_data: makeFileData()
    })
    const results = repo.findByTaskId(taskId)
    expect(results).toHaveLength(1)
    expect((results[0] as unknown as Record<string, unknown>).file_data).toBeUndefined()
  })

  it('finds attachments by task id', () => {
    repo.create({ id: randomUUID(), task_id: taskId, filename: 'a.pdf', mime_type: 'application/pdf', size_bytes: 100, file_data: makeFileData() })
    repo.create({ id: randomUUID(), task_id: taskId, filename: 'b.png', mime_type: 'image/png', size_bytes: 200, file_data: makeFileData() })
    expect(repo.findByTaskId(taskId)).toHaveLength(2)
  })

  it('deletes an attachment', () => {
    const id = randomUUID()
    repo.create({ id, task_id: taskId, filename: 'temp.txt', mime_type: 'text/plain', size_bytes: 10, file_data: makeFileData() })
    expect(repo.delete(id)).toBe(true)
    expect(repo.getFileData(id)).toBeUndefined()
  })

  it('deletes all attachments by task id', () => {
    repo.create({ id: randomUUID(), task_id: taskId, filename: 'a.pdf', mime_type: 'application/pdf', size_bytes: 100, file_data: makeFileData() })
    repo.create({ id: randomUUID(), task_id: taskId, filename: 'b.pdf', mime_type: 'application/pdf', size_bytes: 200, file_data: makeFileData() })
    expect(repo.deleteByTaskId(taskId)).toBe(2)
    expect(repo.findByTaskId(taskId)).toHaveLength(0)
  })

  it('cascades on task delete', () => {
    repo.create({ id: randomUUID(), task_id: taskId, filename: 'cascade.pdf', mime_type: 'application/pdf', size_bytes: 100, file_data: makeFileData() })
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
    expect(repo.findByTaskId(taskId)).toHaveLength(0)
  })

  it('returns empty array for task with no attachments', () => {
    expect(repo.findByTaskId(randomUUID())).toHaveLength(0)
  })
})
