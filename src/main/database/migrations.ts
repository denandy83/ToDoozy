import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_THEMES, DEFAULT_SETTINGS } from './seed'

type Migration = (db: DatabaseSync) => void

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

const migration_5: Migration = (db) => {
  db.exec(`
    CREATE TABLE project_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#888888',
      owner_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(owner_id) REFERENCES users(id)
    )
  `)
}

const migration_6: Migration = (db) => {
  // Story #30: Global Labels — labels become global entities linked to projects via junction table

  // 1. Create project_labels junction table
  db.exec(`
    CREATE TABLE project_labels (
      project_id TEXT NOT NULL,
      label_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, label_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
    )
  `)

  // 2. Populate project_labels from existing labels (each label currently belongs to one project)
  db.exec(`
    INSERT INTO project_labels (project_id, label_id, created_at)
    SELECT project_id, id, created_at FROM labels
  `)

  // 3. Merge duplicate label names — oldest wins, reassign task references
  // Find duplicates: labels with the same name (case-insensitive) across projects
  const dupes = db.prepare(`
    SELECT name, GROUP_CONCAT(id, ',') as ids, MIN(created_at) as oldest_created
    FROM labels
    GROUP BY LOWER(name)
    HAVING COUNT(*) > 1
  `).all() as Array<{ name: string; ids: string; oldest_created: string }>

  for (const dupe of dupes) {
    const ids = dupe.ids.split(',')
    // Find the oldest label (keeper)
    const keeper = db.prepare(
      `SELECT id FROM labels WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at ASC LIMIT 1`
    ).get(...ids) as { id: string }

    const duplicateIds = ids.filter((id) => id !== keeper.id)
    for (const dupId of duplicateIds) {
      // Move project_labels links to keeper (skip if already linked)
      db.prepare(`
        INSERT OR IGNORE INTO project_labels (project_id, label_id, created_at)
        SELECT project_id, ?, created_at FROM project_labels WHERE label_id = ?
      `).run(keeper.id, dupId)

      // Reassign task_labels from duplicate to keeper (skip if already assigned)
      db.prepare(`
        UPDATE OR IGNORE task_labels SET label_id = ? WHERE label_id = ?
      `).run(keeper.id, dupId)

      // Delete orphaned task_labels that couldn't be updated (duplicate constraint)
      db.prepare(`DELETE FROM task_labels WHERE label_id = ?`).run(dupId)

      // Delete the project_labels for the duplicate
      db.prepare(`DELETE FROM project_labels WHERE label_id = ?`).run(dupId)

      // Delete the duplicate label
      db.prepare(`DELETE FROM labels WHERE id = ?`).run(dupId)
    }
  }

  // 4. Recreate labels table without project_id FK
  // SQLite doesn't support DROP COLUMN, so we need to recreate
  db.exec(`
    CREATE TABLE labels_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#888888',
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    INSERT INTO labels_new (id, name, color, order_index, created_at, updated_at)
    SELECT id, name, color, order_index, created_at, updated_at FROM labels;

    DROP TABLE labels;

    ALTER TABLE labels_new RENAME TO labels;
  `)

  // 5. Recreate task_labels with FK to new labels table
  db.exec(`
    CREATE TABLE task_labels_new (
      task_id TEXT NOT NULL,
      label_id TEXT NOT NULL,
      PRIMARY KEY (task_id, label_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
    );

    INSERT INTO task_labels_new SELECT * FROM task_labels;
    DROP TABLE task_labels;
    ALTER TABLE task_labels_new RENAME TO task_labels;
  `)
}

const migration_7: Migration = (db) => {
  // Story #32: iCloud Drive File Attachments (original, replaced by migration_8)
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      local_path TEXT NOT NULL DEFAULT '',
      icloud_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `)
}

const migration_8: Migration = (db) => {
  // Redesign attachments: store file data as BLOB in SQLite, remove filesystem paths
  db.exec(`
    DROP TABLE IF EXISTS attachments;
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      file_data BLOB NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `)
}

const migration_9: Migration = (db) => {
  db.exec(`ALTER TABLE tasks ADD COLUMN reference_url TEXT`)
}

const migration_10: Migration = (db) => {
  // Story #38: Smart Recurrence Picker — clear all existing recurrence_rule values
  // Old format ('daily', 'weekly', 'monthly', 'every:3 days') is not worth migrating
  db.exec(`UPDATE tasks SET recurrence_rule = NULL WHERE recurrence_rule IS NOT NULL`)
}

const migration_11: Migration = (db) => {
  // User-scope settings and themes for multi-user isolation
  // Settings: add user_id column, make composite key (user_id, key)
  db.exec(`
    CREATE TABLE settings_new (
      user_id TEXT NOT NULL DEFAULT '',
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (user_id, key)
    );
    INSERT INTO settings_new (user_id, key, value)
      SELECT '', key, value FROM settings;
    DROP TABLE settings;
    ALTER TABLE settings_new RENAME TO settings;
  `)

  // Themes: add owner_id column (NULL = built-in/system theme)
  db.exec(`ALTER TABLE themes ADD COLUMN owner_id TEXT`)
}

const migration_12: Migration = (db) => {
  // Story #39: Project Collaboration — local tables for notifications, sync queue, and is_shared flag

  // Add is_shared column to projects
  db.exec(`ALTER TABLE projects ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0`)

  // Notifications table — local notifications for task assignments etc.
  db.exec(`
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      task_id TEXT,
      project_id TEXT,
      from_user_id TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `)

  // Sync queue — queues offline changes for shared projects
  db.exec(`
    CREATE TABLE sync_queue (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
      payload TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // Index for efficient notification queries
  db.exec(`CREATE INDEX idx_notifications_read ON notifications(read)`)
  db.exec(`CREATE INDEX idx_notifications_project ON notifications(project_id)`)
  db.exec(`CREATE INDEX idx_sync_queue_created ON sync_queue(created_at)`)
}

const migration_13: Migration = (db) => {
  // Add customizable display properties to project members
  db.exec(`ALTER TABLE project_members ADD COLUMN display_color TEXT`)
  db.exec(`ALTER TABLE project_members ADD COLUMN display_initials TEXT`)
}

const migration_14: Migration = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_views (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1',
      icon TEXT DEFAULT 'filter',
      sidebar_order INTEGER DEFAULT 0,
      filter_config TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(user_id)`)
}

const migration_15: Migration = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_areas (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#888888',
      icon TEXT DEFAULT 'folder',
      sidebar_order INTEGER DEFAULT 0,
      is_collapsed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_project_areas_user ON project_areas(user_id)`)
  db.exec(`ALTER TABLE projects ADD COLUMN area_id TEXT REFERENCES project_areas(id) ON DELETE SET NULL`)
}

export const migrations: Migration[] = [migration_1, migration_2, migration_3, migration_4, migration_5, migration_6, migration_7, migration_8, migration_9, migration_10, migration_11, migration_12, migration_13, migration_14, migration_15]
