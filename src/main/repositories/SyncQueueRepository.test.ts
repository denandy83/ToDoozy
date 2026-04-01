import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { SyncQueueRepository } from './SyncQueueRepository'

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  for (const migration of migrations) {
    migration(db)
  }
  return db
}

describe('SyncQueueRepository', () => {
  let db: DatabaseSync
  let repo: SyncQueueRepository

  beforeEach(() => {
    db = createTestDb()
    repo = new SyncQueueRepository(db)
  })

  it('enqueues and retrieves entries', () => {
    const entry = repo.enqueue('shared_tasks', 'task-1', 'INSERT', '{"title":"Test"}')

    expect(entry.table_name).toBe('shared_tasks')
    expect(entry.row_id).toBe('task-1')
    expect(entry.operation).toBe('INSERT')
    expect(entry.payload).toBe('{"title":"Test"}')
    expect(entry.id).toBeDefined()

    const all = repo.findAll()
    expect(all).toHaveLength(1)
    expect(all[0].row_id).toBe('task-1')
  })

  it('dequeues entries', () => {
    const entry = repo.enqueue('shared_tasks', 'task-1', 'INSERT', '{}')
    expect(repo.count()).toBe(1)

    const result = repo.dequeue(entry.id)
    expect(result).toBe(true)
    expect(repo.count()).toBe(0)
  })

  it('returns entries in FIFO order (oldest first)', () => {
    repo.enqueue('shared_tasks', 'first', 'INSERT', '{}')
    repo.enqueue('shared_tasks', 'second', 'UPDATE', '{}')
    repo.enqueue('shared_tasks', 'third', 'DELETE', '{}')

    const all = repo.findAll()
    expect(all).toHaveLength(3)
    expect(all[0].row_id).toBe('first')
    expect(all[1].row_id).toBe('second')
    expect(all[2].row_id).toBe('third')
  })

  it('clears all entries', () => {
    repo.enqueue('shared_tasks', 'task-1', 'INSERT', '{}')
    repo.enqueue('shared_tasks', 'task-2', 'UPDATE', '{}')
    expect(repo.count()).toBe(2)

    const cleared = repo.clear()
    expect(cleared).toBe(2)
    expect(repo.count()).toBe(0)
  })

  it('counts entries correctly', () => {
    expect(repo.count()).toBe(0)
    repo.enqueue('shared_tasks', 'a', 'INSERT', '{}')
    repo.enqueue('shared_statuses', 'b', 'UPDATE', '{}')
    expect(repo.count()).toBe(2)
  })

  it('validates operation type', () => {
    // The CHECK constraint should reject invalid operations
    expect(() => {
      repo.enqueue('shared_tasks', 'x', 'INVALID' as 'INSERT', '{}')
    }).toThrow()
  })
})
