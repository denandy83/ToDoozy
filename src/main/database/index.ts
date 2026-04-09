import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, copyFileSync } from 'fs'
import { migrations } from './migrations'
import { withTransaction } from './transaction'

let db: DatabaseSync | null = null
let currentDbPath: string | null = null

export function getDatabase(): DatabaseSync {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function getDatabasePath(): string {
  return currentDbPath ?? join(app.getPath('userData'), 'todoozy.db')
}

function openDatabase(dbPath: string): DatabaseSync {
  const database = new DatabaseSync(dbPath)

  // Enable WAL mode for better concurrent read performance
  database.exec('PRAGMA journal_mode = WAL')
  // Enable foreign keys
  database.exec('PRAGMA foreign_keys = ON')

  // Create schema_version table if it doesn't exist
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `)

  runMigrations(database)
  currentDbPath = dbPath

  return database
}

export function initDatabase(): DatabaseSync {
  if (process.env.TODOOZY_DEV_DB) {
    db = openDatabase(process.env.TODOOZY_DEV_DB)
  } else {
    // Start with in-memory DB as placeholder until switchDatabase is called after auth
    db = new DatabaseSync(':memory:')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
    runMigrations(db)
    currentDbPath = ':memory:'
  }
  return db
}

/**
 * Switch to a per-user database file. Closes the current DB and opens
 * todoozy-{userId}.db, running migrations if needed.
 */
export function switchDatabase(userId: string, email?: string): DatabaseSync {
  // If dev DB is set, don't switch — always use the dev DB
  if (process.env.TODOOZY_DEV_DB) return getDatabase()

  // Use email prefix for friendly DB name
  const emailPrefix = email ? email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '_') : null
  const emailDbPath = emailPrefix ? join(app.getPath('userData'), `todoozy-${emailPrefix}.db`) : null
  const uuidDbPath = join(app.getPath('userData'), `todoozy-${userId}.db`)

  // Determine which DB to use (priority: email-named > UUID-named > create new)
  let userDbPath: string
  if (emailDbPath && existsSync(emailDbPath)) {
    userDbPath = emailDbPath
  } else if (existsSync(uuidDbPath)) {
    if (emailDbPath) {
      // Rename UUID DB to email-named
      console.log(`[Database] Renaming UUID DB to email-named: ${emailDbPath}`)
      copyFileSync(uuidDbPath, emailDbPath)
      const walPath = uuidDbPath + '-wal'
      const shmPath = uuidDbPath + '-shm'
      if (existsSync(walPath)) copyFileSync(walPath, emailDbPath + '-wal')
      if (existsSync(shmPath)) copyFileSync(shmPath, emailDbPath + '-shm')
      userDbPath = emailDbPath
    } else {
      userDbPath = uuidDbPath
    }
  } else if (emailDbPath) {
    userDbPath = emailDbPath
  } else {
    userDbPath = uuidDbPath
  }

  // Already using this user's DB
  if (currentDbPath === userDbPath && db) return db

  // Close current DB
  if (db) {
    db.close()
    db = null
  }

  // One-time migration: if per-user DB doesn't exist, copy the legacy todoozy.db
  // so existing users don't lose their data when upgrading
  let migratedFromLegacy = false
  if (!existsSync(userDbPath)) {
    const legacyDbPath = join(app.getPath('userData'), 'todoozy.db')
    if (existsSync(legacyDbPath)) {
      console.log(`[Database] Migrating legacy DB to per-user DB for ${userId}`)
      copyFileSync(legacyDbPath, userDbPath)
      // Also copy WAL/SHM files if they exist (ensures no data loss from uncommitted WAL entries)
      const walPath = legacyDbPath + '-wal'
      const shmPath = legacyDbPath + '-shm'
      if (existsSync(walPath)) copyFileSync(walPath, userDbPath + '-wal')
      if (existsSync(shmPath)) copyFileSync(shmPath, userDbPath + '-shm')
      migratedFromLegacy = true
    }
  }

  db = openDatabase(userDbPath)

  // Clear last_sync_at after legacy migration so fullUpload runs and pushes
  // all personal projects/tasks to Supabase for the first time
  if (migratedFromLegacy) {
    try {
      db.prepare("DELETE FROM settings WHERE key = 'last_sync_at'").run()
      console.log('[Database] Cleared last_sync_at to trigger full Supabase upload')
    } catch { /* settings table may not exist yet */ }
  }
  return db
}

function runMigrations(database: DatabaseSync): void {
  const currentVersion = getCurrentVersion(database)

  for (let i = currentVersion; i < migrations.length; i++) {
    const version = i + 1
    withTransaction(database, () => {
      migrations[i](database)
      database.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version)
    })
  }
}

function getCurrentVersion(database: DatabaseSync): number {
  const row = database.prepare('SELECT MAX(version) as version FROM schema_version').get() as
    | { version: number | null }
    | undefined
  return row?.version ?? 0
}

export { withTransaction } from './transaction'

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
