import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'crypto'
import { migrations } from '../database/migrations'
import { NotificationRepository } from './NotificationRepository'

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  for (const migration of migrations) {
    migration(db)
  }
  return db
}

describe('NotificationRepository', () => {
  let db: DatabaseSync
  let repo: NotificationRepository

  beforeEach(() => {
    db = createTestDb()
    repo = new NotificationRepository(db)
  })

  it('creates and retrieves a notification', () => {
    const id = randomUUID()
    const notification = repo.create({
      id,
      type: 'task_assigned',
      message: 'You were assigned a task'
    })

    expect(notification.id).toBe(id)
    expect(notification.type).toBe('task_assigned')
    expect(notification.message).toBe('You were assigned a task')
    expect(notification.read).toBe(0)

    const found = repo.findById(id)
    expect(found).toBeDefined()
    expect(found!.type).toBe('task_assigned')
  })

  it('finds all notifications', () => {
    repo.create({ id: randomUUID(), type: 'a', message: 'First' })
    repo.create({ id: randomUUID(), type: 'b', message: 'Second' })
    repo.create({ id: randomUUID(), type: 'c', message: 'Third' })

    const all = repo.findAll()
    expect(all).toHaveLength(3)
  })

  it('finds unread notifications', () => {
    const id1 = randomUUID()
    const id2 = randomUUID()
    repo.create({ id: id1, type: 'a', message: 'Unread' })
    repo.create({ id: id2, type: 'b', message: 'Will be read' })
    repo.markAsRead(id2)

    const unread = repo.findUnread()
    expect(unread).toHaveLength(1)
    expect(unread[0].id).toBe(id1)
  })

  it('gets unread count', () => {
    repo.create({ id: randomUUID(), type: 'a', message: 'One' })
    repo.create({ id: randomUUID(), type: 'b', message: 'Two' })
    expect(repo.getUnreadCount()).toBe(2)

    repo.markAllAsRead()
    expect(repo.getUnreadCount()).toBe(0)
  })

  it('marks a single notification as read', () => {
    const id = randomUUID()
    repo.create({ id, type: 'a', message: 'Test' })
    expect(repo.findById(id)!.read).toBe(0)

    const result = repo.markAsRead(id)
    expect(result).toBe(true)
    expect(repo.findById(id)!.read).toBe(1)
  })

  it('marks all as read', () => {
    repo.create({ id: randomUUID(), type: 'a', message: 'One' })
    repo.create({ id: randomUUID(), type: 'b', message: 'Two' })
    repo.create({ id: randomUUID(), type: 'c', message: 'Three' })

    const count = repo.markAllAsRead()
    expect(count).toBe(3)
    expect(repo.getUnreadCount()).toBe(0)
  })

  it('deletes a notification', () => {
    const id = randomUUID()
    repo.create({ id, type: 'a', message: 'Delete me' })
    expect(repo.findAll()).toHaveLength(1)

    const result = repo.delete(id)
    expect(result).toBe(true)
    expect(repo.findAll()).toHaveLength(0)
  })

  it('supports optional fields (from_user_id without FK constraint)', () => {
    const id = randomUUID()
    // from_user_id has no FK constraint, so any string works
    const notification = repo.create({
      id,
      type: 'task_assigned',
      message: 'Assigned',
      from_user_id: 'some-user-id'
    })

    expect(notification.from_user_id).toBe('some-user-id')
    expect(notification.task_id).toBeNull()
    expect(notification.project_id).toBeNull()
  })

  it('deletes all notifications', () => {
    repo.create({ id: randomUUID(), type: 'a', message: 'One' })
    repo.create({ id: randomUUID(), type: 'b', message: 'Two' })
    repo.create({ id: randomUUID(), type: 'c', message: 'Three' })
    expect(repo.findAll()).toHaveLength(3)

    const count = repo.deleteAll()
    expect(count).toBe(3)
    expect(repo.findAll()).toHaveLength(0)
    expect(repo.getUnreadCount()).toBe(0)
  })

  it('deleteAll returns 0 on empty table', () => {
    expect(repo.deleteAll()).toBe(0)
  })

  it('respects limit in findAll', () => {
    for (let i = 0; i < 10; i++) {
      repo.create({ id: randomUUID(), type: 'a', message: `Notification ${i}` })
    }

    const limited = repo.findAll(3)
    expect(limited).toHaveLength(3)
  })
})
