import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from '../database/migrations'
import { SettingsRepository } from '../repositories/SettingsRepository'

// Test the markdown concatenation logic and local cache behavior
// The actual Supabase calls are integration-tested via the running app

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  for (const migration of migrations) {
    migration(db)
  }
  return db
}

describe('ReleaseNotesService — local cache format', () => {
  let db: DatabaseSync
  let settings: SettingsRepository

  beforeEach(() => {
    db = createTestDb()
    settings = new SettingsRepository(db)
  })

  it('should store concatenated markdown in whats_new setting', () => {
    // Simulate what syncReleaseNotes does after fetching from Supabase
    const rows = [
      { version: 'v1.1.0', content: '- **New Feature** — Something cool' },
      { version: 'v1.0.0', content: '- **Auto-Update** — Auto-update mechanism' }
    ]

    const markdown = rows
      .map((row) => `## ${row.version}\n${row.content}`)
      .join('\n\n')

    settings.set('', 'whats_new', markdown)

    const result = settings.get('', 'whats_new')
    expect(result).toBe('## v1.1.0\n- **New Feature** — Something cool\n\n## v1.0.0\n- **Auto-Update** — Auto-update mechanism')
  })

  it('should preserve version ordering (most recent first)', () => {
    const rows = [
      { version: 'v2.0.0', content: '- **Breaking** — Major change' },
      { version: 'v1.1.0', content: '- **Feature** — Minor feature' },
      { version: 'v1.0.0', content: '- **Initial** — First release' }
    ]

    const markdown = rows
      .map((row) => `## ${row.version}\n${row.content}`)
      .join('\n\n')

    settings.set('', 'whats_new', markdown)

    const result = settings.get('', 'whats_new')!
    const sections = result.split('\n\n')
    expect(sections).toHaveLength(3)
    expect(sections[0]).toContain('v2.0.0')
    expect(sections[1]).toContain('v1.1.0')
    expect(sections[2]).toContain('v1.0.0')
  })

  it('should handle single version', () => {
    const rows = [
      { version: 'v1.0.0', content: '- **Only item** — Description' }
    ]

    const markdown = rows
      .map((row) => `## ${row.version}\n${row.content}`)
      .join('\n\n')

    settings.set('', 'whats_new', markdown)

    const result = settings.get('', 'whats_new')
    expect(result).toBe('## v1.0.0\n- **Only item** — Description')
  })

  it('whats_new_seen comparison works with version headers', () => {
    const markdown = '## v1.1.0\n- **Feature** — New\n\n## v1.0.0\n- **Old** — Existing'
    settings.set('', 'whats_new', markdown)

    // Simulate user seeing the latest version
    const firstHeader = markdown.split('\n').find((l) => l.startsWith('## ')) ?? ''
    settings.set('test-user', 'whats_new_seen', firstHeader)

    const seen = settings.get('test-user', 'whats_new_seen')
    expect(seen).toBe('## v1.1.0')

    // No notification dot when seen matches latest
    const current = settings.get('', 'whats_new')!
    const currentFirst = current.split('\n').find((l) => l.startsWith('## ')) ?? ''
    expect(currentFirst).toBe(seen)
  })

  it('notification dot appears when new version is added', () => {
    // User has seen v1.0.0
    settings.set('test-user', 'whats_new_seen', '## v1.0.0')

    // New version added
    const markdown = '## v1.1.0\n- **New** — Something\n\n## v1.0.0\n- **Old** — Existing'
    settings.set('', 'whats_new', markdown)

    const seen = settings.get('test-user', 'whats_new_seen')
    const current = settings.get('', 'whats_new')!
    const currentFirst = current.split('\n').find((l) => l.startsWith('## ')) ?? ''

    // Seen doesn't match latest — dot should show
    expect(currentFirst).not.toBe(seen)
    expect(currentFirst).toBe('## v1.1.0')
    expect(seen).toBe('## v1.0.0')
  })
})
