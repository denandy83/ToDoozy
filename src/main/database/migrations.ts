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

const migration_16: Migration = (db) => {
  db.exec(`ALTER TABLE tasks ADD COLUMN my_day_dismissed_date TEXT DEFAULT NULL`)
}

const migration_17: Migration = (db) => {
  db.exec(`ALTER TABLE projects ADD COLUMN auto_archive_enabled INTEGER NOT NULL DEFAULT 0`)
  db.exec(`ALTER TABLE projects ADD COLUMN auto_archive_value INTEGER NOT NULL DEFAULT 3`)
  db.exec(`ALTER TABLE projects ADD COLUMN auto_archive_unit TEXT NOT NULL DEFAULT 'days'`)

  // Migrate global setting to all personal projects
  const settings = db.prepare("SELECT key, value FROM settings WHERE key IN ('auto_archive_enabled', 'auto_archive_value', 'auto_archive_unit')").all() as { key: string; value: string }[]
  const settingsMap = new Map(settings.map(s => [s.key, s.value]))

  if (settingsMap.get('auto_archive_enabled') === 'true') {
    const value = parseInt(settingsMap.get('auto_archive_value') ?? '3', 10)
    const unit = settingsMap.get('auto_archive_unit') ?? 'days'
    db.prepare(`UPDATE projects SET auto_archive_enabled = 1, auto_archive_value = ?, auto_archive_unit = ? WHERE is_shared = 0`).run(value, unit)
  }

  // Delete global settings
  db.exec("DELETE FROM settings WHERE key IN ('auto_archive_enabled', 'auto_archive_value', 'auto_archive_unit')")
}

const migration_18: Migration = (db) => {
  // Add user_id to labels — labels are user-owned, not project-owned.
  // Previously findByName had to join via project_labels + project_members,
  // which produced duplicates whenever a pulled label had no project link yet.
  db.exec(`ALTER TABLE labels ADD COLUMN user_id TEXT DEFAULT NULL`)

  // Backfill: pick the user with the most owned tasks (the logged-in user on this
  // machine). The users table can also hold placeholder rows for shared-project
  // owners/assignees, so picking by tasks.owner_id frequency is more reliable
  // than ORDER BY created_at.
  const owner = db.prepare(
    `SELECT owner_id AS id FROM tasks
     WHERE owner_id IS NOT NULL
     GROUP BY owner_id
     ORDER BY COUNT(*) DESC
     LIMIT 1`
  ).get() as { id: string } | undefined
  const fallback = db.prepare(`SELECT id FROM users ORDER BY created_at LIMIT 1`).get() as
    | { id: string }
    | undefined
  const userId = owner?.id ?? fallback?.id
  if (userId) {
    db.prepare(`UPDATE labels SET user_id = ? WHERE user_id IS NULL`).run(userId)
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_labels_user_name ON labels(user_id, name COLLATE NOCASE)`)
}

const migration_19: Migration = (db) => {
  // Mirror of supabase/migrations/20260425010000_dedupe_user_labels.sql.
  // Local SQLite has the same per-user duplicate labels (e.g. "Bug" vs "bug"
  // and exact-name races from the create-or-find pattern). After the Supabase
  // unique index landed, every push of a local duplicate trips 23505 and the
  // ghost label_id stays referenced by task_labels — so tasks tagged via the
  // ghost don't appear in label-filtered views (the canonical doesn't know
  // about them locally).
  //
  // Pick canonical per (user_id, LOWER(name)) by task_labels count desc, then
  // created_at asc as tiebreaker. Rewrite task_labels + project_labels to
  // point at canonical, drop duplicates, drop sync_queue entries for removed
  // ghost rows, then add a unique index.
  db.exec(`
    CREATE TEMP TABLE label_dedup_plan AS
    WITH counts AS (
      SELECT
        l.id,
        l.user_id,
        l.name,
        LOWER(l.name) AS lname,
        l.created_at,
        (SELECT COUNT(*) FROM task_labels tl WHERE tl.label_id = l.id) AS uses
      FROM labels l
      WHERE l.user_id IS NOT NULL
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY user_id, lname
          ORDER BY uses DESC, created_at ASC
        ) AS rn,
        FIRST_VALUE(id) OVER (
          PARTITION BY user_id, lname
          ORDER BY uses DESC, created_at ASC
        ) AS canonical_id
      FROM counts
    )
    SELECT id AS duplicate_id, canonical_id
    FROM ranked
    WHERE rn > 1
  `)

  db.exec(`
    INSERT OR IGNORE INTO task_labels (task_id, label_id)
    SELECT tl.task_id, p.canonical_id
    FROM task_labels tl
    JOIN label_dedup_plan p ON p.duplicate_id = tl.label_id
  `)
  db.exec(`
    DELETE FROM task_labels
    WHERE label_id IN (SELECT duplicate_id FROM label_dedup_plan)
  `)

  db.exec(`
    INSERT OR IGNORE INTO project_labels (project_id, label_id)
    SELECT pl.project_id, p.canonical_id
    FROM project_labels pl
    JOIN label_dedup_plan p ON p.duplicate_id = pl.label_id
  `)
  db.exec(`
    DELETE FROM project_labels
    WHERE label_id IN (SELECT duplicate_id FROM label_dedup_plan)
  `)

  db.exec(`
    DELETE FROM sync_queue
    WHERE table_name = 'user_labels'
      AND row_id IN (SELECT duplicate_id FROM label_dedup_plan)
  `)

  db.exec(`
    DELETE FROM labels
    WHERE id IN (SELECT duplicate_id FROM label_dedup_plan)
  `)

  db.exec(`DROP TABLE label_dedup_plan`)

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS labels_user_name_unique
      ON labels(user_id, LOWER(name))
      WHERE user_id IS NOT NULL
  `)
}

const migration_20: Migration = (db) => {
  // Soft-delete foundation: mirror Supabase schema landed in migration
  // `soft_delete_foundation` (2026-04-25). Adds `deleted_at` to every syncable
  // table so the reconcile layer can use a uniform tombstone model instead of
  // hard DELETE + ad-hoc tombstone tracking.
  //
  // Also adds `updated_at` to `settings` because Supabase `user_settings`
  // already has it, and incremental sync (task 9) needs a comparable column.
  // No `id` column added — local settings PK is (user_id, key); the Supabase
  // `id` UUID is reconciled in task 9.
  // SQLite ALTER TABLE ADD COLUMN cannot use non-constant defaults (datetime('now')).
  // Add updated_at to settings with a constant default, then backfill via UPDATE.
  // Repository writes (SettingsRepository.set/setMultiple) bump updated_at explicitly
  // on every mutation — see task 9 (settings vertical slice).
  db.exec(`
    ALTER TABLE tasks ADD COLUMN deleted_at TEXT NULL;
    ALTER TABLE statuses ADD COLUMN deleted_at TEXT NULL;
    ALTER TABLE projects ADD COLUMN deleted_at TEXT NULL;
    ALTER TABLE labels ADD COLUMN deleted_at TEXT NULL;
    ALTER TABLE themes ADD COLUMN deleted_at TEXT NULL;
    ALTER TABLE settings ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE settings ADD COLUMN deleted_at TEXT NULL;
    ALTER TABLE saved_views ADD COLUMN deleted_at TEXT NULL;
    ALTER TABLE project_areas ADD COLUMN deleted_at TEXT NULL;
    ALTER TABLE task_labels ADD COLUMN deleted_at TEXT NULL;
    ALTER TABLE project_labels ADD COLUMN deleted_at TEXT NULL;
    UPDATE settings SET updated_at = datetime('now') WHERE updated_at = '';
  `)

  // Active-row partial indexes — power the reconcile high-water-mark query.
  // task_labels / project_labels have no updated_at and reconcile via key-set
  // diff, so they don't get an active_idx.
  // themes uses owner_id (not user_id) — that's a local-only schism; the
  // reconcile will scope by owner.
  db.exec(`
    CREATE INDEX IF NOT EXISTS tasks_active_idx ON tasks(project_id, updated_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS statuses_active_idx ON statuses(project_id, updated_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS projects_active_idx ON projects(owner_id, updated_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS labels_active_idx ON labels(user_id, updated_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS themes_active_idx ON themes(owner_id, updated_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS settings_active_idx ON settings(user_id, updated_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS saved_views_active_idx ON saved_views(user_id, updated_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS project_areas_active_idx ON project_areas(user_id, updated_at) WHERE deleted_at IS NULL;
  `)
}

const migration_21: Migration = (db) => {
  // sync_meta tracks per-table reconcile state for the uniform sync layer.
  //   last_high_water — max(updated_at) seen the last successful reconcile pass;
  //                     short-circuit when remote max <= this value.
  //   last_reconciled_at — wall clock of the last finished pass (for debug/UI).
  // Keyed by (user_id, table_name) — owner-scoped tables key by user; project-
  // scoped tables (tasks, statuses) key by user too because reconcile runs per
  // user and iterates that user's projects internally.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      user_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      last_high_water TEXT,
      last_reconciled_at TEXT,
      PRIMARY KEY (user_id, table_name)
    );
  `)
}

const migration_22: Migration = (db) => {
  // Add scope_id so project-scoped tables (tasks, statuses) get a per-project
  // high-water — without it, reconciling project A would short-circuit project
  // B on the next pass even though B has its own pending drift.
  // For user-scoped tables (labels, themes, settings, saved_views, project_areas,
  // projects) scope_id == user_id, so the keying is unchanged in practice.
  // sync_meta is recoverable state — a fresh reconcile rebuilds it — so we
  // drop+recreate rather than try to migrate values.
  db.exec(`
    DROP TABLE IF EXISTS sync_meta;
    CREATE TABLE sync_meta (
      user_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      last_high_water TEXT,
      last_reconciled_at TEXT,
      PRIMARY KEY (user_id, scope_id, table_name)
    );
  `)
}

const migration_23: Migration = (db) => {
  // project_templates was a local-only feature in the v1.5.0 sync rebuild.
  // v1.5.1 promotes it to a synced table — same shape on Supabase.
  // Add deleted_at locally so reconcile can use the uniform tombstone model.
  db.exec(`
    ALTER TABLE project_templates ADD COLUMN deleted_at TEXT NULL;
    CREATE INDEX IF NOT EXISTS project_templates_active_idx
      ON project_templates(owner_id, updated_at) WHERE deleted_at IS NULL;
  `)
}

export const migrations: Migration[] = [migration_1, migration_2, migration_3, migration_4, migration_5, migration_6, migration_7, migration_8, migration_9, migration_10, migration_11, migration_12, migration_13, migration_14, migration_15, migration_16, migration_17, migration_18, migration_19, migration_20, migration_21, migration_22, migration_23]
