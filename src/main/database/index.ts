import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { migrations } from './migrations'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function initDatabase(): Database.Database {
  const dbPath = process.env.TODOOZY_DEV_DB || join(app.getPath('userData'), 'todoozy.db')

  db = new Database(dbPath)

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')
  // Enable foreign keys
  db.pragma('foreign_keys = ON')

  // Create schema_version table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `)

  runMigrations(db)

  return db
}

function runMigrations(database: Database.Database): void {
  const currentVersion = getCurrentVersion(database)

  for (let i = currentVersion; i < migrations.length; i++) {
    const version = i + 1
    console.log(`Running migration ${version}...`)

    const runMigration = database.transaction(() => {
      migrations[i](database)
      database.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version)
    })

    runMigration()
    console.log(`Migration ${version} complete.`)
  }
}

function getCurrentVersion(database: Database.Database): number {
  const row = database.prepare('SELECT MAX(version) as version FROM schema_version').get() as
    | { version: number | null }
    | undefined
  return row?.version ?? 0
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
