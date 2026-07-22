import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { isRemoteNewer, toCanonicalIso } from './lww'
import { StatusRepository } from './StatusRepository'
import type { Status } from '../../shared/types'

// Local SQLite writes the ISO `Z` form; PostgREST returns the `+00:00` form.
// The same instant in the two formats must compare equal numerically.
const Z = '2026-07-21T10:00:00.000Z'
const PLUS = '2026-07-21T10:00:00.000+00:00' // identical instant to Z
const Z_NEWER = '2026-07-21T10:00:01.000Z' // +1s
const PLUS_NEWER = '2026-07-21T10:00:01.000+00:00' // +1s

describe('isRemoteNewer', () => {
  it('returns false for the same instant across Z and +00:00 formats (deterministic skip)', () => {
    // Equal instant, different string form: a raw string compare would flag
    // drift; the numeric compare must treat them as equal → not newer.
    expect(isRemoteNewer(Z, PLUS)).toBe(false)
    expect(isRemoteNewer(PLUS, Z)).toBe(false)
  })

  it('returns true when the remote row is strictly newer (+00:00 remote over Z local)', () => {
    expect(isRemoteNewer(Z, PLUS_NEWER)).toBe(true)
    // and the reverse format orientation
    expect(isRemoteNewer(PLUS, Z_NEWER)).toBe(true)
  })

  it('returns false when the local row is strictly newer', () => {
    expect(isRemoteNewer(Z_NEWER, PLUS)).toBe(false)
    expect(isRemoteNewer(PLUS_NEWER, Z)).toBe(false)
  })

  it('is symmetric in format: identical epochs regardless of Z vs +00:00', () => {
    expect(isRemoteNewer(Z, Z)).toBe(false)
    expect(isRemoteNewer(PLUS, PLUS)).toBe(false)
  })
})

describe('toCanonicalIso (Story #115)', () => {
  it('converts PostgREST `+00:00` form to canonical `…Z` (same instant)', () => {
    expect(toCanonicalIso('2026-07-21T10:00:00.000+00:00')).toBe('2026-07-21T10:00:00.000Z')
    // No fractional part in the input still yields the millisecond `.000Z` form.
    expect(toCanonicalIso('2026-07-21T10:00:00+00:00')).toBe('2026-07-21T10:00:00.000Z')
  })

  it('leaves an already-canonical `…Z` value byte-for-byte unchanged', () => {
    expect(toCanonicalIso('2026-07-21T10:00:00.000Z')).toBe('2026-07-21T10:00:00.000Z')
  })

  it('normalizes a non-UTC offset to the equivalent UTC `…Z` instant', () => {
    // 15:00 at +05:00 is 10:00 UTC.
    expect(toCanonicalIso('2026-07-21T15:00:00.000+05:00')).toBe('2026-07-21T10:00:00.000Z')
  })

  it('truncates sub-millisecond precision to milliseconds, matching toISOString()', () => {
    const input = '2026-07-21T10:00:00.123456+00:00'
    expect(toCanonicalIso(input)).toBe('2026-07-21T10:00:00.123Z')
    expect(toCanonicalIso(input)).toBe(new Date(input).toISOString())
  })

  it('is null/undefined/empty safe — passes those through unchanged', () => {
    expect(toCanonicalIso(null)).toBeNull()
    expect(toCanonicalIso(undefined)).toBeUndefined()
    expect(toCanonicalIso('')).toBe('')
  })

  it('preserves an unparseable value rather than corrupting it to Invalid Date', () => {
    expect(toCanonicalIso('not-a-timestamp')).toBe('not-a-timestamp')
  })

  it('preserves the input type: a nullable column stays nullable', () => {
    const deletedAt: string | null = null
    const result: string | null = toCanonicalIso(deletedAt)
    expect(result).toBeNull()
  })
})

// End-to-end proof that applyRemote uses the numeric compare: a real repository
// guard applies a +00:00 remote row that is 1s newer than the local Z row, and
// skips equal-instant / local-newer rows. StatusRepository stands in for every
// applyRemote guard since they all share the helper.
function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  for (const migration of migrations) {
    migration(db)
  }
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('user-1', 'test@example.com', null, null, now, now)
  db.prepare(
    `INSERT INTO projects (id, owner_id, name, description, color, icon, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('proj-1', 'user-1', 'Test', null, null, null, now, now)
  return db
}

function makeStatus(overrides: Partial<Status>): Status {
  return {
    id: 'status-1',
    project_id: 'proj-1',
    name: 'Local Name',
    color: '#111111',
    icon: 'circle',
    order_index: 0,
    is_done: 0,
    is_default: 0,
    created_at: Z,
    updated_at: Z,
    deleted_at: null,
    ...overrides
  }
}

describe('applyRemote LWW guard (Date.parse) — StatusRepository', () => {
  let db: DatabaseSync
  let repo: StatusRepository

  beforeEach(() => {
    db = createTestDb()
    repo = new StatusRepository(db)
    // Seed a local row whose updated_at is in the `Z` form.
    repo.applyRemote(makeStatus({ name: 'Local Name', updated_at: Z }))
  })

  it('applies a +00:00 remote row one second newer than the local Z row', () => {
    const result = repo.applyRemote(makeStatus({ name: 'Remote Name', updated_at: PLUS_NEWER }))
    expect(result.name).toBe('Remote Name')
    expect(repo.findById('status-1')?.name).toBe('Remote Name')
  })

  it('skips an equal-instant remote row in +00:00 format (no flip-flop)', () => {
    const result = repo.applyRemote(makeStatus({ name: 'Remote Name', updated_at: PLUS }))
    expect(result.name).toBe('Local Name')
    expect(repo.findById('status-1')?.name).toBe('Local Name')
  })

  it('skips a +00:00 remote row older than the local Z row', () => {
    // Re-seed local as the newer row, then push an older remote.
    repo.applyRemote(makeStatus({ name: 'Local Newer', updated_at: Z_NEWER }))
    const result = repo.applyRemote(makeStatus({ name: 'Remote Older', updated_at: PLUS }))
    expect(result.name).toBe('Local Newer')
    expect(repo.findById('status-1')?.name).toBe('Local Newer')
  })
})
