import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrations } from './migrations'
import { BUILTIN_THEMES } from '../../shared/themeCatalog'

// migration_25 (the project_labels backfill) lives at index 24. Running
// migrations[0..23] builds the schema up to v24 — project_labels already has
// its deleted_at column by then (migration_20) — so we can seed the drift
// state and then run the backfill in isolation.
const BACKFILL_INDEX = 24

function dbUpToBackfill(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  for (const m of migrations.slice(0, BACKFILL_INDEX)) m(db)
  return db
}

function runBackfill(db: DatabaseSync): void {
  migrations[BACKFILL_INDEX](db)
}

function seed(db: DatabaseSync): void {
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)`).run('u1', 'e@x.com', now, now)
  db.prepare(`INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('p1', 'u1', 'P', now, now)
  db.prepare(
    `INSERT INTO statuses (id, project_id, name, order_index, is_done, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('s1', 'p1', 'Todo', 0, 0, 1, now, now)
  db.prepare(`INSERT INTO labels (id, user_id, name, color, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('l1', 'u1', 'Later', '#888', 0, now, now)
}

function makeTask(db: DatabaseSync, id: string, opts: { archived?: number; deleted?: string | null } = {}): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO tasks (id, project_id, owner_id, title, status_id, priority, order_index, is_template, is_archived, is_in_my_day, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, 'p1', 'u1', 'T', 's1', 0, 0, 0, opts.archived ?? 0, 0, now, now, opts.deleted ?? null)
}

describe('migration_25 — project_labels backfill', () => {
  it('creates a junction row for a label applied to a task but missing from project_labels', () => {
    const db = dbUpToBackfill()
    seed(db)
    makeTask(db, 't1')
    db.prepare(`INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)`).run('t1', 'l1')
    expect((db.prepare('SELECT COUNT(*) c FROM project_labels').get() as { c: number }).c).toBe(0)

    runBackfill(db)

    const pl = db.prepare('SELECT deleted_at FROM project_labels WHERE project_id = ? AND label_id = ?').get('p1', 'l1') as { deleted_at: string | null } | undefined
    expect(pl).toBeDefined()
    expect(pl!.deleted_at).toBeNull()
  })

  it('backfills from an archived (but not deleted) task — the label still belongs to the project palette', () => {
    const db = dbUpToBackfill()
    seed(db)
    makeTask(db, 't1', { archived: 1 })
    db.prepare(`INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)`).run('t1', 'l1')

    runBackfill(db)

    const pl = db.prepare('SELECT 1 FROM project_labels WHERE project_id = ? AND label_id = ?').get('p1', 'l1')
    expect(pl).toBeDefined()
  })

  it('does NOT resurrect a deliberately tombstoned junction row', () => {
    const db = dbUpToBackfill()
    seed(db)
    makeTask(db, 't1')
    db.prepare(`INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)`).run('t1', 'l1')
    const removedAt = new Date().toISOString()
    db.prepare(`INSERT INTO project_labels (project_id, label_id, created_at, deleted_at) VALUES (?, ?, datetime('now'), ?)`).run('p1', 'l1', removedAt)

    runBackfill(db)

    const pl = db.prepare('SELECT deleted_at FROM project_labels WHERE project_id = ? AND label_id = ?').get('p1', 'l1') as { deleted_at: string | null }
    expect(pl.deleted_at).toBe(removedAt) // untouched
  })

  it('ignores soft-deleted task_labels and tombstoned labels', () => {
    const db = dbUpToBackfill()
    seed(db)
    makeTask(db, 't1')
    // task_labels row is itself tombstoned → no junction should be created
    db.prepare(`INSERT INTO task_labels (task_id, label_id, deleted_at) VALUES (?, ?, ?)`).run('t1', 'l1', new Date().toISOString())

    runBackfill(db)

    expect((db.prepare('SELECT COUNT(*) c FROM project_labels').get() as { c: number }).c).toBe(0)
  })

  it('is idempotent — a second run inserts nothing new', () => {
    const db = dbUpToBackfill()
    seed(db)
    makeTask(db, 't1')
    db.prepare(`INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)`).run('t1', 'l1')

    runBackfill(db)
    runBackfill(db)

    expect((db.prepare('SELECT COUNT(*) c FROM project_labels WHERE label_id = ?').get('l1') as { c: number }).c).toBe(1)
  })
})

describe('soft theme installation', () => {
  it.each(BUILTIN_THEMES.slice(12))('preserves a preexisting custom $name and its selection through every upgrade', (preset) => {
    const db = new DatabaseSync(':memory:')
    try {
      for (const migration of migrations.slice(0, 29)) migration(db)
      const config = ' { "accent": "#abcDEF", "bg": "#123456", "extra": "keep me" } '
      db.prepare('INSERT INTO themes (id,name,mode,config,is_builtin,owner_id,created_at,updated_at) VALUES (?,?,?,?,0,?,?,?)')
        .run('custom-soft', preset.name, preset.mode, config, 'u1', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')
      db.prepare("INSERT INTO settings (user_id,key,value,updated_at) VALUES ('u1','theme_id','custom-soft','2026-01-02T00:00:00.000Z')").run()
      const theme = db.prepare("SELECT * FROM themes WHERE id='custom-soft'").get()
      const selection = db.prepare("SELECT * FROM settings WHERE user_id='u1' AND key='theme_id'").get()
      for (const migration of migrations.slice(29)) migration(db)
      expect(db.prepare("SELECT * FROM themes WHERE id='custom-soft'").get()).toEqual(theme)
      expect(db.prepare("SELECT * FROM settings WHERE user_id='u1' AND key='theme_id'").get()).toEqual(selection)
      expect(db.prepare("SELECT * FROM theme_duplicate_archive WHERE id='custom-soft'").get()).toBeUndefined()
    } finally { db.close() }
  })

  it('adds three pairs once without changing custom colors or the selected theme', () => {
    const db = new DatabaseSync(':memory:')
    try {
      for (const migration of migrations.slice(0, 29)) migration(db)
      const selected = db.prepare("SELECT id, config FROM themes WHERE name='Standard Dark'").get() as { id: string; config: string }
      const custom = JSON.stringify({ bg: '#e7b7c8', accent: '#b6d9c7' })
      db.prepare("INSERT INTO themes (id,name,mode,config,is_builtin) VALUES ('custom-pastel','Soft Sage Dark','dark',?,0)").run(custom)
      db.prepare("UPDATE settings SET value=? WHERE key='theme_id'").run(selected.id)
      migrations[29](db)
      migrations[29](db)
      expect((db.prepare("SELECT COUNT(*) AS count FROM themes WHERE is_builtin=1 AND name LIKE 'Soft %'").get() as { count: number }).count).toBe(6)
      expect((db.prepare("SELECT config FROM themes WHERE id='custom-pastel'").get() as { config: string }).config).toBe(custom)
      expect((db.prepare("SELECT value FROM settings WHERE key='theme_id'").get() as { value: string }).value).toBe(selected.id)
      expect((db.prepare('SELECT config FROM themes WHERE id=?').get(selected.id) as { config: string }).config).toBe(selected.config)
    } finally { db.close() }
  })
})
