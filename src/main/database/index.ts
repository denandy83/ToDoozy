import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, copyFileSync, unlinkSync, readdirSync } from 'fs'
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

  // Helper to remove UUID DB files after migration
  const removeUuidDb = (): void => {
    try {
      if (existsSync(uuidDbPath)) unlinkSync(uuidDbPath)
      if (existsSync(uuidDbPath + '-wal')) unlinkSync(uuidDbPath + '-wal')
      if (existsSync(uuidDbPath + '-shm')) unlinkSync(uuidDbPath + '-shm')
      console.log(`[Database] Removed legacy UUID DB: ${uuidDbPath}`)
    } catch (e) {
      console.warn('[Database] Failed to remove UUID DB:', e)
    }
  }

  // Safety net: if no email was passed, scan for an existing email-named DB
  // to prevent creating a new UUID DB when one already exists under the email name.
  // This handles edge cases where Supabase returns null email on token refresh.
  let resolvedEmailDbPath = emailDbPath
  if (!resolvedEmailDbPath) {
    try {
      const userDataDir = app.getPath('userData')
      const files = readdirSync(userDataDir)
      const emailDb = files.find(
        (f) => f.startsWith('todoozy-') && f.endsWith('.db') && f !== `todoozy-${userId}.db` && f !== 'todoozy.db'
      )
      if (emailDb) {
        resolvedEmailDbPath = join(userDataDir, emailDb)
        console.log(`[Database] No email provided, found existing email DB: ${emailDb}`)
      }
    } catch { /* ignore scan errors */ }
  }

  if (resolvedEmailDbPath && existsSync(resolvedEmailDbPath)) {
    userDbPath = resolvedEmailDbPath
    // Clean up leftover UUID DB if it still exists
    if (existsSync(uuidDbPath)) removeUuidDb()
  } else if (existsSync(uuidDbPath)) {
    if (resolvedEmailDbPath) {
      // Migrate UUID DB to email-named
      console.log(`[Database] Migrating UUID DB to email-named: ${resolvedEmailDbPath}`)
      copyFileSync(uuidDbPath, resolvedEmailDbPath)
      if (existsSync(uuidDbPath + '-wal')) copyFileSync(uuidDbPath + '-wal', resolvedEmailDbPath + '-wal')
      if (existsSync(uuidDbPath + '-shm')) copyFileSync(uuidDbPath + '-shm', resolvedEmailDbPath + '-shm')
      removeUuidDb()
      userDbPath = resolvedEmailDbPath
    } else {
      userDbPath = uuidDbPath
    }
  } else if (resolvedEmailDbPath) {
    userDbPath = resolvedEmailDbPath
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
