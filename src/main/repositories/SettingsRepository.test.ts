import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { SettingsRepository } from './SettingsRepository'
import type { Setting } from '../../shared/types'

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

describe('SettingsRepository — soft-delete', () => {
  let db: DatabaseSync
  let repo: SettingsRepository
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    userId = seedUser(db)
    repo = new SettingsRepository(db)
  })

  it('delete() sets deleted_at instead of removing the row', () => {
    repo.set(userId, 'foo', 'bar')
    expect(repo.delete(userId, 'foo')).toBe(true)
    const raw = repo.findRaw(userId, 'foo')
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })

  it('delete() is idempotent — second delete on tombstoned row returns false', () => {
    repo.set(userId, 'foo', 'bar')
    expect(repo.delete(userId, 'foo')).toBe(true)
    expect(repo.delete(userId, 'foo')).toBe(false)
  })

  it('delete() returns false for missing rows', () => {
    expect(repo.delete(userId, 'never-existed')).toBe(false)
  })

  it('hardDelete() physically removes the row', () => {
    repo.set(userId, 'foo', 'bar')
    expect(repo.hardDelete(userId, 'foo')).toBe(true)
    expect(repo.findRaw(userId, 'foo')).toBeUndefined()
  })

  it('get() returns null for tombstoned rows (no global default)', () => {
    repo.set(userId, 'foo', 'bar')
    repo.delete(userId, 'foo')
    expect(repo.get(userId, 'foo')).toBeNull()
  })

  it('get() falls back to global default when user override is tombstoned', () => {
    db.prepare(
      `INSERT INTO settings (user_id, key, value, updated_at, deleted_at)
       VALUES ('', ?, ?, ?, NULL)`
    ).run('foo', 'global-default', new Date().toISOString())
    repo.set(userId, 'foo', 'user-override')
    expect(repo.get(userId, 'foo')).toBe('user-override')
    repo.delete(userId, 'foo')
    expect(repo.get(userId, 'foo')).toBe('global-default')
  })

  it('getAll() excludes tombstoned user overrides and falls back to global defaults', () => {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO settings (user_id, key, value, updated_at, deleted_at)
       VALUES ('', ?, ?, ?, NULL)`
    ).run('foo', 'global-default', now)
    repo.set(userId, 'foo', 'user-override')
    repo.set(userId, 'bar', 'user-only')
    repo.delete(userId, 'foo')
    const all = repo.getAll(userId)
    const map = new Map(all.map((s) => [s.key, s.value]))
    expect(map.get('foo')).toBe('global-default')
    expect(map.get('bar')).toBe('user-only')
  })

  it('getMultiple() filters tombstoned overrides and falls back to global default', () => {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO settings (user_id, key, value, updated_at, deleted_at)
       VALUES ('', ?, ?, ?, NULL)`
    ).run('foo', 'global-default', now)
    repo.set(userId, 'foo', 'user-override')
    repo.delete(userId, 'foo')
    const multi = repo.getMultiple(userId, ['foo'])
    expect(multi.find((s) => s.key === 'foo')?.value).toBe('global-default')
  })

  it('set() revives a tombstoned row via ON CONFLICT', () => {
    repo.set(userId, 'foo', 'old')
    repo.delete(userId, 'foo')
    expect(repo.findRaw(userId, 'foo')!.deleted_at).not.toBeNull()
    repo.set(userId, 'foo', 'new')
    const raw = repo.findRaw(userId, 'foo')!
    expect(raw.value).toBe('new')
    expect(raw.deleted_at).toBeNull()
  })

  it('setMultiple() revives tombstones for the keys it touches', () => {
    repo.set(userId, 'a', '1')
    repo.set(userId, 'b', '2')
    repo.delete(userId, 'a')
    repo.delete(userId, 'b')
    repo.setMultiple(userId, [{ key: 'a', value: '1-new' }, { key: 'b', value: '2-new' }])
    expect(repo.findRaw(userId, 'a')!.deleted_at).toBeNull()
    expect(repo.findRaw(userId, 'b')!.deleted_at).toBeNull()
    expect(repo.get(userId, 'a')).toBe('1-new')
    expect(repo.get(userId, 'b')).toBe('2-new')
  })
})

describe('SettingsRepository — sync surface', () => {
  let db: DatabaseSync
  let repo: SettingsRepository
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    userId = seedUser(db)
    repo = new SettingsRepository(db)
  })

  it('findAllByUser() returns active rows for the user, excluding global defaults', () => {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO settings (user_id, key, value, updated_at, deleted_at)
       VALUES ('', ?, ?, ?, NULL)`
    ).run('global-key', 'global-default', now)
    repo.set(userId, 'foo', '1')
    repo.set(userId, 'bar', '2')
    const list = repo.findAllByUser(userId)
    const ids = list.map((s) => s.key).sort()
    expect(ids).toEqual(['bar', 'foo'])
    expect(ids).not.toContain('global-key')
  })

  it('findAllByUser() excludes tombstones by default', () => {
    repo.set(userId, 'foo', '1')
    repo.set(userId, 'bar', '2')
    repo.delete(userId, 'foo')
    const list = repo.findAllByUser(userId)
    expect(list.map((s) => s.key)).toEqual(['bar'])
  })

  it('findAllByUser({ includeTombstones: true }) returns tombstones too', () => {
    repo.set(userId, 'foo', '1')
    repo.set(userId, 'bar', '2')
    repo.delete(userId, 'foo')
    const all = repo.findAllByUser(userId, { includeTombstones: true })
    expect(all.map((s) => s.key).sort()).toEqual(['bar', 'foo'])
  })

  it('findAllByUser({ sinceUpdatedAt }) filters by updated_at', () => {
    db.prepare(
      `INSERT INTO settings (user_id, key, value, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL)`
    ).run(userId, 'a', '1', '2026-04-01T10:00:00.000Z')
    db.prepare(
      `INSERT INTO settings (user_id, key, value, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL)`
    ).run(userId, 'b', '2', '2026-04-01T11:00:00.000Z')
    const since = repo.findAllByUser(userId, { sinceUpdatedAt: '2026-04-01T10:30:00.000Z' })
    expect(since.map((s) => s.key)).toContain('b')
    expect(since.map((s) => s.key)).not.toContain('a')
  })

  it('findMaxUpdatedAt() ignores global defaults but INCLUDES tombstones', () => {
    // Global default rows live under user_id='' and never participate in sync.
    db.prepare(
      `INSERT INTO settings (user_id, key, value, updated_at, deleted_at)
       VALUES ('', ?, ?, '2099-12-31T00:00:00.000Z', NULL)`
    ).run('global-key', 'global-default')
    repo.set(userId, 'foo', '1')
    repo.set(userId, 'tomb', 'x')
    repo.delete(userId, 'tomb')
    // Tombstoning bumps updated_at; the high-water needs to surface that bump
    // so the next reconcile retries any failed tombstone push.
    const tombUpdatedAt = repo.findRaw(userId, 'tomb')!.updated_at
    expect(repo.findMaxUpdatedAt(userId)).toBe(tombUpdatedAt)
  })

  it('findMaxUpdatedAt() returns null when no rows exist for the user', () => {
    expect(repo.findMaxUpdatedAt(userId)).toBeNull()
  })

  it('findRaw() returns tombstoned rows so the sync layer can compare timestamps', () => {
    repo.set(userId, 'foo', '1')
    repo.delete(userId, 'foo')
    const raw = repo.findRaw(userId, 'foo')
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })
})

describe('SettingsRepository — applyRemote', () => {
  let db: DatabaseSync
  let repo: SettingsRepository
  let userId: string

  beforeEach(() => {
    db = createTestDb()
    userId = seedUser(db)
    repo = new SettingsRepository(db)
  })

  it('inserts a new row from remote, preserving timestamps', () => {
    const remote: Setting = {
      user_id: userId,
      key: 'foo',
      value: 'remote-value',
      updated_at: '2026-04-25T10:00:00.000Z',
      deleted_at: null
    }
    repo.applyRemote(remote)
    const local = repo.findRaw(userId, 'foo')!
    expect(local.value).toBe('remote-value')
    expect(local.updated_at).toBe('2026-04-25T10:00:00.000Z')
    expect(local.deleted_at).toBeNull()
  })

  it('preserves remote deleted_at on apply (tombstone propagation)', () => {
    const tombstoned: Setting = {
      user_id: userId,
      key: 'foo',
      value: 'gone',
      updated_at: '2026-04-25T11:00:00.000Z',
      deleted_at: '2026-04-25T11:00:00.000Z'
    }
    repo.applyRemote(tombstoned)
    const local = repo.findRaw(userId, 'foo')!
    expect(local.deleted_at).toBe('2026-04-25T11:00:00.000Z')
    expect(repo.findAllByUser(userId).map((s) => s.key)).not.toContain('foo')
  })

  it('skips when local updated_at is newer than remote (LWW)', () => {
    repo.set(userId, 'foo', 'local-newest')
    const localRow = repo.findRaw(userId, 'foo')!
    const stale: Setting = {
      ...localRow,
      value: 'stale-remote',
      updated_at: new Date(new Date(localRow.updated_at).getTime() - 60_000).toISOString()
    }
    repo.applyRemote(stale)
    expect(repo.findRaw(userId, 'foo')!.value).toBe('local-newest')
  })

  it('overwrites local row when remote updated_at is newer', () => {
    repo.set(userId, 'foo', 'local')
    const localRow = repo.findRaw(userId, 'foo')!
    const fresh: Setting = {
      ...localRow,
      value: 'fresh-remote',
      updated_at: new Date(new Date(localRow.updated_at).getTime() + 60_000).toISOString()
    }
    repo.applyRemote(fresh)
    const local = repo.findRaw(userId, 'foo')!
    expect(local.value).toBe('fresh-remote')
    expect(local.updated_at).toBe(fresh.updated_at)
  })

  it('idempotent — applying the same remote twice yields the same row', () => {
    const remote: Setting = {
      user_id: userId,
      key: 'foo',
      value: 'v1',
      updated_at: '2026-04-25T10:00:00.000Z',
      deleted_at: null
    }
    repo.applyRemote(remote)
    repo.applyRemote(remote)
    const local = repo.findRaw(userId, 'foo')!
    expect(local.value).toBe('v1')
    expect(local.updated_at).toBe('2026-04-25T10:00:00.000Z')
  })
})
