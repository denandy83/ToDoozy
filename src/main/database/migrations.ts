import type Database from 'better-sqlite3'
import { DEFAULT_THEMES, DEFAULT_SETTINGS } from './seed'

type Migration = (db: Database.Database) => void

const migration_1: Migration = (db) => {
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT,
      avatar_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#888888',
      icon TEXT DEFAULT 'folder',
      owner_id TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(owner_id) REFERENCES users(id)
    );

    CREATE TABLE project_members (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      invited_by TEXT,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, user_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE statuses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#888888',
      icon TEXT DEFAULT 'circle',
      order_index INTEGER DEFAULT 0,
      is_done INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      assigned_to TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status_id TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      due_date TEXT,
      parent_id TEXT,
      order_index INTEGER DEFAULT 0,
      is_in_my_day INTEGER DEFAULT 0,
      is_template INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      completed_date TEXT,
      recurrence_rule TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(status_id) REFERENCES statuses(id),
      FOREIGN KEY(owner_id) REFERENCES users(id),
      FOREIGN KEY(assigned_to) REFERENCES users(id),
      FOREIGN KEY(parent_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE labels (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#888888',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE task_labels (
      task_id TEXT NOT NULL,
      label_id TEXT NOT NULL,
      PRIMARY KEY (task_id, label_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
    );

    CREATE TABLE themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE activity_log (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `)

  // Seed default themes
  const insertTheme = db.prepare(
    'INSERT INTO themes (id, name, mode, config) VALUES (?, ?, ?, ?)'
  )
  for (const theme of DEFAULT_THEMES) {
    insertTheme.run(theme.id, theme.name, theme.mode, JSON.stringify(theme.config))
  }

  // Seed default settings
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  for (const setting of DEFAULT_SETTINGS) {
    insertSetting.run(setting.key, setting.value)
  }
}

const migration_2: Migration = (db) => {
  db.exec(`ALTER TABLE themes ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0`)
  // Mark the 12 built-in themes by name
  const builtinNames = [
    'Standard Dark', 'Standard Light',
    'Warm Earth Dark', 'Warm Earth Light',
    'Ocean Blue Dark', 'Ocean Blue Light',
    'Amethyst Dark', 'Amethyst Light',
    'Forest Dark', 'Forest Light',
    'Rosewood Dark', 'Rosewood Light'
  ]
  const stmt = db.prepare('UPDATE themes SET is_builtin = 1 WHERE name = ?')
  for (const name of builtinNames) {
    stmt.run(name)
  }
}

const migration_3: Migration = (db) => {
  db.exec(`ALTER TABLE labels ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0`)
  // Set initial order based on name
  const labels = db.prepare('SELECT id FROM labels ORDER BY name ASC').all() as Array<{ id: string }>
  const stmt = db.prepare('UPDATE labels SET order_index = ? WHERE id = ?')
  labels.forEach((l, i) => stmt.run(i, l.id))
}

const migration_4: Migration = (db) => {
  db.exec(`ALTER TABLE projects ADD COLUMN sidebar_order INTEGER NOT NULL DEFAULT 0`)
  // Seed initial order based on created_at
  const projects = db.prepare('SELECT id FROM projects ORDER BY created_at ASC').all() as Array<{ id: string }>
  const stmt = db.prepare('UPDATE projects SET sidebar_order = ? WHERE id = ?')
  projects.forEach((p, i) => stmt.run(i, p.id))
}

export const migrations: Migration[] = [migration_1, migration_2, migration_3, migration_4]
