import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'path'
import { migrations } from './migrations'

let db: DatabaseSync | null = null

export function getDatabase(): DatabaseSync {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function initDatabase(): DatabaseSync {
  const dbPath = process.env.TODOOZY_DEV_DB || join(app.getPath('userData'), 'todoozy.db')

  db = new DatabaseSync(dbPath)

  // Enable WAL mode for better concurrent read performance
  db.exec('PRAGMA journal_mode = WAL')
  // Enable foreign keys
  db.exec('PRAGMA foreign_keys = ON')

  // Create schema_version table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `)

  runMigrations(db)

  return db
}

function runMigrations(database: DatabaseSync): void {
  const currentVersion = getCurrentVersion(database)

  for (let i = currentVersion; i < migrations.length; i++) {
    const version = i + 1
    console.log(`Running migration ${version}...`)

    withTransaction(database, () => {
      migrations[i](database)
      database.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version)
    })

    console.log(`Migration ${version} complete.`)
  }
}

function getCurrentVersion(database: DatabaseSync): number {
  const row = database.prepare('SELECT MAX(version) as version FROM schema_version').get() as
    | { version: number | null }
    | undefined
  return row?.version ?? 0
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
