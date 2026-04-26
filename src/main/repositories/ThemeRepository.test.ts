import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { ThemeRepository } from './ThemeRepository'
import type { Theme } from '../../shared/types'

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

const sampleConfig = JSON.stringify({
  bg: '#000000',
  fg: '#ffffff',
  fgSecondary: '#cccccc',
  fgMuted: '#888888',
  muted: '#222222',
  accent: '#ff6600',
  accentFg: '#ffffff',
  border: '#333333'
})

describe('ThemeRepository — soft-delete', () => {
  let db: DatabaseSync
  let repo: ThemeRepository
  let ownerId: string

  beforeEach(() => {
    db = createTestDb()
    ownerId = seedUser(db)
    repo = new ThemeRepository(db)
  })

  it('delete() sets deleted_at instead of removing the row', () => {
    const t = repo.create({ id: 't1', name: 'Mine', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    expect(repo.delete(t.id)).toBe(true)
    const raw = repo.findById(t.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })

  it('delete() is idempotent — second delete on tombstoned row returns false', () => {
    const t = repo.create({ id: 't1', name: 'Mine', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    expect(repo.delete(t.id)).toBe(true)
    expect(repo.delete(t.id)).toBe(false)
  })

  it('delete() refuses to soft-delete builtin themes', () => {
    db.prepare(
      `INSERT INTO themes (id, name, mode, config, is_builtin, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NULL, ?, ?)`
    ).run('builtin-1', 'Default', 'dark', sampleConfig, new Date().toISOString(), new Date().toISOString())
    expect(repo.delete('builtin-1')).toBe(false)
    const raw = repo.findById('builtin-1')
    expect(raw!.deleted_at).toBeNull()
  })

  it('hardDelete() physically removes the row, including builtins', () => {
    db.prepare(
      `INSERT INTO themes (id, name, mode, config, is_builtin, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NULL, ?, ?)`
    ).run('builtin-1', 'Default', 'dark', sampleConfig, new Date().toISOString(), new Date().toISOString())
    expect(repo.hardDelete('builtin-1')).toBe(true)
    expect(repo.findById('builtin-1')).toBeUndefined()
  })

  it('list() filters out tombstoned themes', () => {
    repo.create({ id: 't1', name: 'A', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    const b = repo.create({ id: 't2', name: 'B', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    repo.delete(b.id)
    const ids = repo.list(ownerId).map((t) => t.id)
    expect(ids).toContain('t1')
    expect(ids).not.toContain('t2')
  })

  it('listByMode() filters out tombstoned themes', () => {
    repo.create({ id: 't1', name: 'A', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    const b = repo.create({ id: 't2', name: 'B', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    repo.delete(b.id)
    const ids = repo.listByMode('dark', ownerId).map((t) => t.id)
    expect(ids).toContain('t1')
    expect(ids).not.toContain('t2')
  })

  it('findById() returns the tombstone (raw access for sync layer)', () => {
    const t = repo.create({ id: 't1', name: 'Mine', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    repo.delete(t.id)
    const raw = repo.findById(t.id)
    expect(raw).toBeDefined()
    expect(raw!.deleted_at).not.toBeNull()
  })

  it('findAllByOwner() returns user-owned non-builtin active rows by default', () => {
    repo.create({ id: 't1', name: 'A', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    const b = repo.create({ id: 't2', name: 'B', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    repo.delete(b.id)
    db.prepare(
      `INSERT INTO themes (id, name, mode, config, is_builtin, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NULL, ?, ?)`
    ).run('builtin-1', 'Default', 'dark', sampleConfig, new Date().toISOString(), new Date().toISOString())
    const list = repo.findAllByOwner(ownerId)
    expect(list.map((t) => t.id)).toEqual(['t1'])
  })

  it('findAllByOwner({ includeTombstones: true }) returns tombstones too', () => {
    repo.create({ id: 't1', name: 'A', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    const b = repo.create({ id: 't2', name: 'B', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    repo.delete(b.id)
    const all = repo.findAllByOwner(ownerId, { includeTombstones: true })
    expect(all.map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('findAllByOwner({ sinceUpdatedAt }) filters by updated_at', () => {
    db.prepare(
      `INSERT INTO themes (id, name, mode, config, is_builtin, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
    ).run('t1', 'A', 'dark', sampleConfig, ownerId, '2026-04-01T10:00:00.000Z', '2026-04-01T10:00:00.000Z')
    db.prepare(
      `INSERT INTO themes (id, name, mode, config, is_builtin, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
    ).run('t2', 'B', 'dark', sampleConfig, ownerId, '2026-04-01T11:00:00.000Z', '2026-04-01T11:00:00.000Z')
    const since = repo.findAllByOwner(ownerId, { sinceUpdatedAt: '2026-04-01T10:30:00.000Z' })
    expect(since.map((t) => t.id)).toContain('t2')
    expect(since.map((t) => t.id)).not.toContain('t1')
  })

  it('findMaxUpdatedAt() returns max updated_at of non-builtin active rows', () => {
    repo.create({ id: 't1', name: 'A', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    const b = repo.create({ id: 't2', name: 'B', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    expect(repo.findMaxUpdatedAt(ownerId)).toBe(b.updated_at)
  })

  it('getConfig() returns null for tombstoned themes', () => {
    const t = repo.create({ id: 't1', name: 'Mine', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    expect(repo.getConfig(t.id)).toBeDefined()
    repo.delete(t.id)
    expect(repo.getConfig(t.id)).toBeUndefined()
  })
})

describe('ThemeRepository — applyRemote', () => {
  let db: DatabaseSync
  let repo: ThemeRepository
  let ownerId: string

  beforeEach(() => {
    db = createTestDb()
    ownerId = seedUser(db)
    repo = new ThemeRepository(db)
  })

  it('inserts a new row from remote, preserving timestamps', () => {
    const remote: Theme = {
      id: 'r1',
      name: 'Remote',
      mode: 'dark',
      config: sampleConfig,
      is_builtin: 0,
      owner_id: ownerId,
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

  it('preserves remote deleted_at on apply', () => {
    const tombstoned: Theme = {
      id: 'r2',
      name: 'Tombstoned',
      mode: 'dark',
      config: sampleConfig,
      is_builtin: 0,
      owner_id: ownerId,
      created_at: '2026-04-25T10:00:00.000Z',
      updated_at: '2026-04-25T11:00:00.000Z',
      deleted_at: '2026-04-25T11:00:00.000Z'
    }
    repo.applyRemote(tombstoned)
    const local = repo.findById('r2')!
    expect(local.deleted_at).toBe('2026-04-25T11:00:00.000Z')
    expect(repo.findAllByOwner(ownerId).map((t) => t.id)).not.toContain('r2')
  })

  it('skips when local updated_at is newer than remote (LWW)', () => {
    const t = repo.create({ id: 'r3', name: 'Original', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    const stale: Theme = {
      ...t,
      name: 'Stale remote',
      updated_at: new Date(new Date(t.updated_at).getTime() - 60_000).toISOString()
    }
    repo.applyRemote(stale)
    expect(repo.findById('r3')!.name).toBe('Original')
  })

  it('overwrites local row when remote updated_at is newer', () => {
    const t = repo.create({ id: 'r4', name: 'Original', mode: 'dark', config: sampleConfig, owner_id: ownerId })
    const fresh: Theme = {
      ...t,
      name: 'Updated remote',
      updated_at: new Date(new Date(t.updated_at).getTime() + 60_000).toISOString()
    }
    repo.applyRemote(fresh)
    const local = repo.findById('r4')!
    expect(local.name).toBe('Updated remote')
    expect(local.updated_at).toBe(fresh.updated_at)
  })

  it('refuses to overwrite a builtin theme', () => {
    db.prepare(
      `INSERT INTO themes (id, name, mode, config, is_builtin, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NULL, ?, ?)`
    ).run('builtin-1', 'Default', 'dark', sampleConfig, '2026-04-25T10:00:00.000Z', '2026-04-25T10:00:00.000Z')

    const remote: Theme = {
      id: 'builtin-1',
      name: 'Hacked',
      mode: 'dark',
      config: sampleConfig,
      is_builtin: 0,
      owner_id: ownerId,
      created_at: '2026-04-25T10:00:00.000Z',
      updated_at: '2026-04-26T10:00:00.000Z',
      deleted_at: null
    }
    repo.applyRemote(remote)
    expect(repo.findById('builtin-1')!.name).toBe('Default')
  })
})
