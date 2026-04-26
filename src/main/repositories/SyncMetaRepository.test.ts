import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { SyncMetaRepository } from './SyncMetaRepository'

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  for (const migration of migrations) {
    migration(db)
  }
  return db
}

describe('SyncMetaRepository', () => {
  let db: DatabaseSync
  let repo: SyncMetaRepository

  beforeEach(() => {
    db = createTestDb()
    repo = new SyncMetaRepository(db)
  })

  it('returns null for missing (user, scope, table)', () => {
    expect(repo.get('user-1', 'p1', 'tasks')).toBeNull()
    expect(repo.getHighWater('user-1', 'p1', 'tasks')).toBeNull()
    expect(repo.getLastReconciledAt('user-1', 'p1', 'tasks')).toBeNull()
  })

  it('stores and reads high-water', () => {
    repo.setHighWater('user-1', 'p1', 'tasks', '2026-04-25T12:00:00.000Z')
    expect(repo.getHighWater('user-1', 'p1', 'tasks')).toBe('2026-04-25T12:00:00.000Z')
  })

  it('stores and reads last_reconciled_at', () => {
    repo.setLastReconciledAt('user-1', 'p1', 'tasks', '2026-04-25T12:00:00.000Z')
    expect(repo.getLastReconciledAt('user-1', 'p1', 'tasks')).toBe('2026-04-25T12:00:00.000Z')
  })

  it('overwrites high-water on subsequent set', () => {
    repo.setHighWater('user-1', 'p1', 'tasks', '2026-04-25T12:00:00.000Z')
    repo.setHighWater('user-1', 'p1', 'tasks', '2026-04-25T13:00:00.000Z')
    expect(repo.getHighWater('user-1', 'p1', 'tasks')).toBe('2026-04-25T13:00:00.000Z')
  })

  it('high-water and last_reconciled_at coexist on same row', () => {
    repo.setHighWater('user-1', 'p1', 'tasks', '2026-04-25T12:00:00.000Z')
    repo.setLastReconciledAt('user-1', 'p1', 'tasks', '2026-04-25T12:30:00.000Z')

    const row = repo.get('user-1', 'p1', 'tasks')
    expect(row).not.toBeNull()
    expect(row!.last_high_water).toBe('2026-04-25T12:00:00.000Z')
    expect(row!.last_reconciled_at).toBe('2026-04-25T12:30:00.000Z')
  })

  it('isolates by user_id', () => {
    repo.setHighWater('user-1', 'p1', 'tasks', '2026-04-25T12:00:00.000Z')
    repo.setHighWater('user-2', 'p1', 'tasks', '2026-04-25T13:00:00.000Z')

    expect(repo.getHighWater('user-1', 'p1', 'tasks')).toBe('2026-04-25T12:00:00.000Z')
    expect(repo.getHighWater('user-2', 'p1', 'tasks')).toBe('2026-04-25T13:00:00.000Z')
  })

  it('isolates by scope_id (so projects do not shadow each other)', () => {
    repo.setHighWater('user-1', 'p1', 'tasks', '2026-04-25T12:00:00.000Z')
    repo.setHighWater('user-1', 'p2', 'tasks', '2026-04-25T13:00:00.000Z')

    expect(repo.getHighWater('user-1', 'p1', 'tasks')).toBe('2026-04-25T12:00:00.000Z')
    expect(repo.getHighWater('user-1', 'p2', 'tasks')).toBe('2026-04-25T13:00:00.000Z')
  })

  it('isolates by table_name', () => {
    repo.setHighWater('user-1', 'user-1', 'labels', '2026-04-25T12:00:00.000Z')
    repo.setHighWater('user-1', 'user-1', 'themes', '2026-04-25T13:00:00.000Z')

    expect(repo.getHighWater('user-1', 'user-1', 'labels')).toBe('2026-04-25T12:00:00.000Z')
    expect(repo.getHighWater('user-1', 'user-1', 'themes')).toBe('2026-04-25T13:00:00.000Z')
  })

  it('clearAll removes only the given user rows', () => {
    repo.setHighWater('user-1', 'p1', 'tasks', '2026-04-25T12:00:00.000Z')
    repo.setHighWater('user-1', 'p2', 'tasks', '2026-04-25T12:00:00.000Z')
    repo.setHighWater('user-1', 'user-1', 'labels', '2026-04-25T12:00:00.000Z')
    repo.setHighWater('user-2', 'p1', 'tasks', '2026-04-25T12:00:00.000Z')

    expect(repo.clearAll('user-1')).toBe(3)
    expect(repo.getHighWater('user-1', 'p1', 'tasks')).toBeNull()
    expect(repo.getHighWater('user-1', 'p2', 'tasks')).toBeNull()
    expect(repo.getHighWater('user-1', 'user-1', 'labels')).toBeNull()
    expect(repo.getHighWater('user-2', 'p1', 'tasks')).toBe('2026-04-25T12:00:00.000Z')
  })
})
