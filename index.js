"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const path = require("path");
const fs = require("fs");
const electron = require("electron");
const node_sqlite = require("node:sqlite");
const crypto$1 = require("crypto");
const child_process = require("child_process");
const electronUpdater = require("electron-updater");
const supabaseJs = require("@supabase/supabase-js");
const is = {
  dev: !electron.app.isPackaged
};
const platform = {
  isWindows: process.platform === "win32",
  isMacOS: process.platform === "darwin",
  isLinux: process.platform === "linux"
};
const electronApp = {
  setAppUserModelId(id) {
    if (platform.isWindows)
      electron.app.setAppUserModelId(is.dev ? process.execPath : id);
  },
  setAutoLaunch(auto) {
    if (platform.isLinux)
      return false;
    const isOpenAtLogin = () => {
      return electron.app.getLoginItemSettings().openAtLogin;
    };
    if (isOpenAtLogin() !== auto) {
      electron.app.setLoginItemSettings({ openAtLogin: auto });
      return isOpenAtLogin() === auto;
    } else {
      return true;
    }
  },
  skipProxy() {
    return electron.session.defaultSession.setProxy({ mode: "direct" });
  }
};
const optimizer = {
  watchWindowShortcuts(window, shortcutOptions) {
    if (!window)
      return;
    const { webContents } = window;
    const { escToCloseWindow = false, zoom = false } = shortcutOptions || {};
    webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown") {
        if (!is.dev) {
          if (input.code === "KeyR" && (input.control || input.meta))
            event.preventDefault();
          if (input.code === "KeyI" && (input.alt && input.meta || input.control && input.shift)) {
            event.preventDefault();
          }
        } else {
          if (input.code === "F12") {
            if (webContents.isDevToolsOpened()) {
              webContents.closeDevTools();
            } else {
              webContents.openDevTools({ mode: "undocked" });
              console.log("Open dev tool...");
            }
          }
        }
        if (escToCloseWindow) {
          if (input.code === "Escape" && input.key !== "Process") {
            window.close();
            event.preventDefault();
          }
        }
        if (!zoom) {
          if (input.code === "Minus" && (input.control || input.meta))
            event.preventDefault();
          if (input.code === "Equal" && input.shift && (input.control || input.meta))
            event.preventDefault();
        }
      }
    });
  },
  registerFramelessWindowIpc() {
    electron.ipcMain.on("win:invoke", (event, action) => {
      const win = electron.BrowserWindow.fromWebContents(event.sender);
      if (win) {
        if (action === "show") {
          win.show();
        } else if (action === "showInactive") {
          win.showInactive();
        } else if (action === "min") {
          win.minimize();
        } else if (action === "max") {
          const isMaximized = win.isMaximized();
          if (isMaximized) {
            win.unmaximize();
          } else {
            win.maximize();
          }
        } else if (action === "close") {
          win.close();
        }
      }
    });
  }
};
const DEFAULT_THEMES = [
  {
    id: crypto$1.randomUUID(),
    name: "Standard Dark",
    mode: "dark",
    config: {
      bg: "#1a1a2e",
      fg: "#e0e0e0",
      fgSecondary: "#b0b0b0",
      fgMuted: "#666666",
      muted: "#888888",
      accent: "#6366f1",
      accentFg: "#ffffff",
      border: "#2a2a4a"
    }
  },
  {
    id: crypto$1.randomUUID(),
    name: "Standard Light",
    mode: "light",
    config: {
      bg: "#f8f9fa",
      fg: "#1a1a2e",
      fgSecondary: "#4a4a6a",
      fgMuted: "#999999",
      muted: "#888888",
      accent: "#6366f1",
      accentFg: "#ffffff",
      border: "#e0e0e8"
    }
  },
  {
    id: crypto$1.randomUUID(),
    name: "Warm Earth Dark",
    mode: "dark",
    config: {
      bg: "#1c1410",
      fg: "#e8ddd0",
      fgSecondary: "#b8a898",
      fgMuted: "#7a6a5a",
      muted: "#8a7a6a",
      accent: "#d4915e",
      accentFg: "#1c1410",
      border: "#3a2a1e"
    }
  },
  {
    id: crypto$1.randomUUID(),
    name: "Warm Earth Light",
    mode: "light",
    config: {
      bg: "#faf5ef",
      fg: "#3a2a1e",
      fgSecondary: "#6a5a4a",
      fgMuted: "#a09080",
      muted: "#8a7a6a",
      accent: "#c07830",
      accentFg: "#ffffff",
      border: "#e0d5c8"
    }
  },
  {
    id: crypto$1.randomUUID(),
    name: "Ocean Blue Dark",
    mode: "dark",
    config: {
      bg: "#0d1b2a",
      fg: "#d0e0f0",
      fgSecondary: "#8ab0d0",
      fgMuted: "#4a6a8a",
      muted: "#5a7a9a",
      accent: "#2196f3",
      accentFg: "#ffffff",
      border: "#1b3a5a"
    }
  },
  {
    id: crypto$1.randomUUID(),
    name: "Ocean Blue Light",
    mode: "light",
    config: {
      bg: "#f0f6fc",
      fg: "#0d1b2a",
      fgSecondary: "#2a4a6a",
      fgMuted: "#7a9abc",
      muted: "#5a7a9a",
      accent: "#1976d2",
      accentFg: "#ffffff",
      border: "#c8daf0"
    }
  },
  {
    id: crypto$1.randomUUID(),
    name: "Amethyst Dark",
    mode: "dark",
    config: {
      bg: "#1a1024",
      fg: "#e0d0f0",
      fgSecondary: "#b090d0",
      fgMuted: "#6a4a8a",
      muted: "#7a5a9a",
      accent: "#9c27b0",
      accentFg: "#ffffff",
      border: "#2a1a3e"
    }
  },
  {
    id: crypto$1.randomUUID(),
    name: "Amethyst Light",
    mode: "light",
    config: {
      bg: "#f8f0fc",
      fg: "#2a1a3e",
      fgSecondary: "#5a3a7a",
      fgMuted: "#9a7aba",
      muted: "#7a5a9a",
      accent: "#8e24aa",
      accentFg: "#ffffff",
      border: "#e0c8f0"
    }
  },
  {
    id: crypto$1.randomUUID(),
    name: "Forest Dark",
    mode: "dark",
    config: {
      bg: "#0e1a10",
      fg: "#d0e8d0",
      fgSecondary: "#90b890",
      fgMuted: "#4a7a4a",
      muted: "#5a8a5a",
      accent: "#4caf50",
      accentFg: "#ffffff",
      border: "#1a3a1a"
    }
  },
  {
    id: crypto$1.randomUUID(),
    name: "Forest Light",
    mode: "light",
    config: {
      bg: "#f0faf0",
      fg: "#1a3a1a",
      fgSecondary: "#3a6a3a",
      fgMuted: "#7aaa7a",
      muted: "#5a8a5a",
      accent: "#388e3c",
      accentFg: "#ffffff",
      border: "#c0e0c0"
    }
  },
  {
    id: crypto$1.randomUUID(),
    name: "Rosewood Dark",
    mode: "dark",
    config: {
      bg: "#1a0e10",
      fg: "#f0d0d8",
      fgSecondary: "#d090a0",
      fgMuted: "#8a4a5a",
      muted: "#9a5a6a",
      accent: "#e91e63",
      accentFg: "#ffffff",
      border: "#3a1a22"
    }
  },
  {
    id: crypto$1.randomUUID(),
    name: "Rosewood Light",
    mode: "light",
    config: {
      bg: "#fcf0f2",
      fg: "#3a1a22",
      fgSecondary: "#7a3a4a",
      fgMuted: "#ba7a8a",
      muted: "#9a5a6a",
      accent: "#c2185b",
      accentFg: "#ffffff",
      border: "#f0c8d0"
    }
  }
];
const DEFAULT_SETTINGS = [
  { key: "theme_id", value: DEFAULT_THEMES[0].id },
  { key: "theme_mode", value: "dark" },
  { key: "sidebar_pinned", value: "true" },
  { key: "sidebar_width", value: "240" },
  { key: "detail_panel_position", value: "side" },
  { key: "detail_panel_width", value: "400" },
  { key: "view_mode", value: "list" },
  { key: "priority_color_bar", value: "true" },
  { key: "priority_badges", value: "false" },
  { key: "priority_background_tint", value: "false" },
  { key: "priority_font_weight", value: "false" },
  { key: "priority_auto_sort", value: "false" }
];
const migration_1 = (db2) => {
  db2.exec(`
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
  `);
  const insertTheme = db2.prepare(
    "INSERT INTO themes (id, name, mode, config) VALUES (?, ?, ?, ?)"
  );
  for (const theme of DEFAULT_THEMES) {
    insertTheme.run(theme.id, theme.name, theme.mode, JSON.stringify(theme.config));
  }
  const insertSetting = db2.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
  for (const setting of DEFAULT_SETTINGS) {
    insertSetting.run(setting.key, setting.value);
  }
};
const migration_2 = (db2) => {
  db2.exec(`ALTER TABLE themes ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0`);
  const builtinNames = [
    "Standard Dark",
    "Standard Light",
    "Warm Earth Dark",
    "Warm Earth Light",
    "Ocean Blue Dark",
    "Ocean Blue Light",
    "Amethyst Dark",
    "Amethyst Light",
    "Forest Dark",
    "Forest Light",
    "Rosewood Dark",
    "Rosewood Light"
  ];
  const stmt = db2.prepare("UPDATE themes SET is_builtin = 1 WHERE name = ?");
  for (const name of builtinNames) {
    stmt.run(name);
  }
};
const migration_3 = (db2) => {
  db2.exec(`ALTER TABLE labels ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0`);
  const labels = db2.prepare("SELECT id FROM labels ORDER BY name ASC").all();
  const stmt = db2.prepare("UPDATE labels SET order_index = ? WHERE id = ?");
  labels.forEach((l, i) => stmt.run(i, l.id));
};
const migration_4 = (db2) => {
  db2.exec(`ALTER TABLE projects ADD COLUMN sidebar_order INTEGER NOT NULL DEFAULT 0`);
  const projects = db2.prepare("SELECT id FROM projects ORDER BY created_at ASC").all();
  const stmt = db2.prepare("UPDATE projects SET sidebar_order = ? WHERE id = ?");
  projects.forEach((p, i) => stmt.run(i, p.id));
};
const migration_5 = (db2) => {
  db2.exec(`
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
  `);
};
const migration_6 = (db2) => {
  db2.exec(`
    CREATE TABLE project_labels (
      project_id TEXT NOT NULL,
      label_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, label_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
    )
  `);
  db2.exec(`
    INSERT INTO project_labels (project_id, label_id, created_at)
    SELECT project_id, id, created_at FROM labels
  `);
  const dupes = db2.prepare(`
    SELECT name, GROUP_CONCAT(id, ',') as ids, MIN(created_at) as oldest_created
    FROM labels
    GROUP BY LOWER(name)
    HAVING COUNT(*) > 1
  `).all();
  for (const dupe of dupes) {
    const ids = dupe.ids.split(",");
    const keeper = db2.prepare(
      `SELECT id FROM labels WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at ASC LIMIT 1`
    ).get(...ids);
    const duplicateIds = ids.filter((id) => id !== keeper.id);
    for (const dupId of duplicateIds) {
      db2.prepare(`
        INSERT OR IGNORE INTO project_labels (project_id, label_id, created_at)
        SELECT project_id, ?, created_at FROM project_labels WHERE label_id = ?
      `).run(keeper.id, dupId);
      db2.prepare(`
        UPDATE OR IGNORE task_labels SET label_id = ? WHERE label_id = ?
      `).run(keeper.id, dupId);
      db2.prepare(`DELETE FROM task_labels WHERE label_id = ?`).run(dupId);
      db2.prepare(`DELETE FROM project_labels WHERE label_id = ?`).run(dupId);
      db2.prepare(`DELETE FROM labels WHERE id = ?`).run(dupId);
    }
  }
  db2.exec(`
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
  `);
  db2.exec(`
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
  `);
};
const migration_7 = (db2) => {
  db2.exec(`
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
  `);
};
const migration_8 = (db2) => {
  db2.exec(`
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
  `);
};
const migration_9 = (db2) => {
  db2.exec(`ALTER TABLE tasks ADD COLUMN reference_url TEXT`);
};
const migration_10 = (db2) => {
  db2.exec(`UPDATE tasks SET recurrence_rule = NULL WHERE recurrence_rule IS NOT NULL`);
};
const migration_11 = (db2) => {
  db2.exec(`
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
  `);
  db2.exec(`ALTER TABLE themes ADD COLUMN owner_id TEXT`);
};
const migration_12 = (db2) => {
  db2.exec(`ALTER TABLE projects ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0`);
  db2.exec(`
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
  `);
  db2.exec(`
    CREATE TABLE sync_queue (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
      payload TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db2.exec(`CREATE INDEX idx_notifications_read ON notifications(read)`);
  db2.exec(`CREATE INDEX idx_notifications_project ON notifications(project_id)`);
  db2.exec(`CREATE INDEX idx_sync_queue_created ON sync_queue(created_at)`);
};
const migration_13 = (db2) => {
  db2.exec(`ALTER TABLE project_members ADD COLUMN display_color TEXT`);
  db2.exec(`ALTER TABLE project_members ADD COLUMN display_initials TEXT`);
};
const migration_14 = (db2) => {
  db2.exec(`
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
  `);
  db2.exec(`CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(user_id)`);
};
const migration_15 = (db2) => {
  db2.exec(`
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
  `);
  db2.exec(`CREATE INDEX IF NOT EXISTS idx_project_areas_user ON project_areas(user_id)`);
  db2.exec(`ALTER TABLE projects ADD COLUMN area_id TEXT REFERENCES project_areas(id) ON DELETE SET NULL`);
};
const migration_16 = (db2) => {
  db2.exec(`ALTER TABLE tasks ADD COLUMN my_day_dismissed_date TEXT DEFAULT NULL`);
};
const migration_17 = (db2) => {
  db2.exec(`ALTER TABLE projects ADD COLUMN auto_archive_enabled INTEGER NOT NULL DEFAULT 0`);
  db2.exec(`ALTER TABLE projects ADD COLUMN auto_archive_value INTEGER NOT NULL DEFAULT 3`);
  db2.exec(`ALTER TABLE projects ADD COLUMN auto_archive_unit TEXT NOT NULL DEFAULT 'days'`);
  const settings = db2.prepare("SELECT key, value FROM settings WHERE key IN ('auto_archive_enabled', 'auto_archive_value', 'auto_archive_unit')").all();
  const settingsMap = new Map(settings.map((s) => [s.key, s.value]));
  if (settingsMap.get("auto_archive_enabled") === "true") {
    const value = parseInt(settingsMap.get("auto_archive_value") ?? "3", 10);
    const unit = settingsMap.get("auto_archive_unit") ?? "days";
    db2.prepare(`UPDATE projects SET auto_archive_enabled = 1, auto_archive_value = ?, auto_archive_unit = ? WHERE is_shared = 0`).run(value, unit);
  }
  db2.exec("DELETE FROM settings WHERE key IN ('auto_archive_enabled', 'auto_archive_value', 'auto_archive_unit')");
};
const migrations = [migration_1, migration_2, migration_3, migration_4, migration_5, migration_6, migration_7, migration_8, migration_9, migration_10, migration_11, migration_12, migration_13, migration_14, migration_15, migration_16, migration_17];
function withTransaction(db2, fn) {
  db2.exec("BEGIN");
  try {
    const result = fn();
    db2.exec("COMMIT");
    return result;
  } catch (err) {
    db2.exec("ROLLBACK");
    throw err;
  }
}
let db = null;
let currentDbPath = null;
function getDatabase() {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}
function getDatabasePath() {
  return currentDbPath ?? path.join(electron.app.getPath("userData"), "todoozy.db");
}
function openDatabase(dbPath) {
  const database = new node_sqlite.DatabaseSync(dbPath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);
  runMigrations(database);
  currentDbPath = dbPath;
  return database;
}
function initDatabase() {
  if (process.env.TODOOZY_DEV_DB) {
    db = openDatabase(process.env.TODOOZY_DEV_DB);
  } else {
    db = new node_sqlite.DatabaseSync(":memory:");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)");
    runMigrations(db);
    currentDbPath = ":memory:";
  }
  return db;
}
function switchDatabase(userId, email) {
  if (process.env.TODOOZY_DEV_DB) return getDatabase();
  const emailPrefix = email ? email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "_") : null;
  const emailDbPath = emailPrefix ? path.join(electron.app.getPath("userData"), `todoozy-${emailPrefix}.db`) : null;
  const uuidDbPath = path.join(electron.app.getPath("userData"), `todoozy-${userId}.db`);
  let userDbPath;
  const removeUuidDb = () => {
    try {
      if (fs.existsSync(uuidDbPath)) fs.unlinkSync(uuidDbPath);
      if (fs.existsSync(uuidDbPath + "-wal")) fs.unlinkSync(uuidDbPath + "-wal");
      if (fs.existsSync(uuidDbPath + "-shm")) fs.unlinkSync(uuidDbPath + "-shm");
      console.log(`[Database] Removed legacy UUID DB: ${uuidDbPath}`);
    } catch (e) {
      console.warn("[Database] Failed to remove UUID DB:", e);
    }
  };
  let resolvedEmailDbPath = emailDbPath;
  if (!resolvedEmailDbPath) {
    try {
      const userDataDir = electron.app.getPath("userData");
      const files = fs.readdirSync(userDataDir);
      const emailDb = files.find(
        (f) => f.startsWith("todoozy-") && f.endsWith(".db") && f !== `todoozy-${userId}.db` && f !== "todoozy.db"
      );
      if (emailDb) {
        resolvedEmailDbPath = path.join(userDataDir, emailDb);
        console.log(`[Database] No email provided, found existing email DB: ${emailDb}`);
      }
    } catch {
    }
  }
  if (resolvedEmailDbPath && fs.existsSync(resolvedEmailDbPath)) {
    userDbPath = resolvedEmailDbPath;
    if (fs.existsSync(uuidDbPath)) removeUuidDb();
  } else if (fs.existsSync(uuidDbPath)) {
    if (resolvedEmailDbPath) {
      console.log(`[Database] Migrating UUID DB to email-named: ${resolvedEmailDbPath}`);
      fs.copyFileSync(uuidDbPath, resolvedEmailDbPath);
      if (fs.existsSync(uuidDbPath + "-wal")) fs.copyFileSync(uuidDbPath + "-wal", resolvedEmailDbPath + "-wal");
      if (fs.existsSync(uuidDbPath + "-shm")) fs.copyFileSync(uuidDbPath + "-shm", resolvedEmailDbPath + "-shm");
      removeUuidDb();
      userDbPath = resolvedEmailDbPath;
    } else {
      userDbPath = uuidDbPath;
    }
  } else if (resolvedEmailDbPath) {
    userDbPath = resolvedEmailDbPath;
  } else {
    userDbPath = uuidDbPath;
  }
  if (currentDbPath === userDbPath && db) return db;
  if (db) {
    db.close();
    db = null;
  }
  let migratedFromLegacy = false;
  if (!fs.existsSync(userDbPath)) {
    const legacyDbPath = path.join(electron.app.getPath("userData"), "todoozy.db");
    if (fs.existsSync(legacyDbPath)) {
      console.log(`[Database] Migrating legacy DB to per-user DB for ${userId}`);
      fs.copyFileSync(legacyDbPath, userDbPath);
      const walPath = legacyDbPath + "-wal";
      const shmPath = legacyDbPath + "-shm";
      if (fs.existsSync(walPath)) fs.copyFileSync(walPath, userDbPath + "-wal");
      if (fs.existsSync(shmPath)) fs.copyFileSync(shmPath, userDbPath + "-shm");
      migratedFromLegacy = true;
    }
  }
  db = openDatabase(userDbPath);
  if (migratedFromLegacy) {
    try {
      db.prepare("DELETE FROM settings WHERE key = 'last_sync_at'").run();
      console.log("[Database] Cleared last_sync_at to trigger full Supabase upload");
    } catch {
    }
  }
  return db;
}
function runMigrations(database) {
  const currentVersion = getCurrentVersion(database);
  for (let i = currentVersion; i < migrations.length; i++) {
    const version = i + 1;
    withTransaction(database, () => {
      migrations[i](database);
      database.prepare("INSERT INTO schema_version (version) VALUES (?)").run(version);
    });
  }
}
function getCurrentVersion(database) {
  const row = database.prepare("SELECT MAX(version) as version FROM schema_version").get();
  return row?.version ?? 0;
}
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
class UserRepository {
  constructor(db2) {
    this.db = db2;
  }
  findById(id) {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  }
  findByEmail(email) {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  }
  create(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(input.id, input.email, input.display_name ?? null, input.avatar_url ?? null, now, now);
    return this.findById(input.id);
  }
  update(id, input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const sets = ["updated_at = ?"];
    const values = [now];
    if (input.email !== void 0) {
      sets.push("email = ?");
      values.push(input.email);
    }
    if (input.display_name !== void 0) {
      sets.push("display_name = ?");
      values.push(input.display_name);
    }
    if (input.avatar_url !== void 0) {
      sets.push("avatar_url = ?");
      values.push(input.avatar_url);
    }
    values.push(id);
    this.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.findById(id);
  }
  delete(id) {
    const result = this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return result.changes > 0;
  }
  list() {
    return this.db.prepare("SELECT * FROM users ORDER BY created_at ASC").all();
  }
}
class ProjectRepository {
  constructor(db2) {
    this.db = db2;
  }
  findById(id) {
    return this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  }
  findByOwnerId(ownerId) {
    return this.db.prepare("SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at ASC").all(ownerId);
  }
  findDefault(ownerId) {
    return this.db.prepare("SELECT * FROM projects WHERE owner_id = ? AND is_default = 1").get(ownerId);
  }
  create(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO projects (id, name, description, color, icon, owner_id, is_default, sidebar_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.name,
      input.description ?? null,
      input.color ?? "#888888",
      input.icon ?? "folder",
      input.owner_id,
      input.is_default ?? 0,
      input.sidebar_order ?? 0,
      now,
      now
    );
    return this.findById(input.id);
  }
  update(id, input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const sets = ["updated_at = ?"];
    const values = [now];
    if (input.name !== void 0) {
      sets.push("name = ?");
      values.push(input.name);
    }
    if (input.description !== void 0) {
      sets.push("description = ?");
      values.push(input.description);
    }
    if (input.color !== void 0) {
      sets.push("color = ?");
      values.push(input.color);
    }
    if (input.icon !== void 0) {
      sets.push("icon = ?");
      values.push(input.icon);
    }
    if (input.sidebar_order !== void 0) {
      sets.push("sidebar_order = ?");
      values.push(String(input.sidebar_order));
    }
    if (input.is_default !== void 0) {
      sets.push("is_default = ?");
      values.push(String(input.is_default));
    }
    if (input.is_shared !== void 0) {
      sets.push("is_shared = ?");
      values.push(String(input.is_shared));
    }
    if (input.auto_archive_enabled !== void 0) {
      sets.push("auto_archive_enabled = ?");
      values.push(String(input.auto_archive_enabled));
    }
    if (input.auto_archive_value !== void 0) {
      sets.push("auto_archive_value = ?");
      values.push(String(input.auto_archive_value));
    }
    if (input.auto_archive_unit !== void 0) {
      sets.push("auto_archive_unit = ?");
      values.push(input.auto_archive_unit);
    }
    values.push(id);
    this.db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.findById(id);
  }
  delete(id) {
    return withTransaction(this.db, () => {
      this.db.prepare("DELETE FROM tasks WHERE status_id IN (SELECT id FROM statuses WHERE project_id = ?)").run(id);
      this.db.prepare("DELETE FROM tasks WHERE project_id = ?").run(id);
      const result = this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
      return result.changes > 0;
    });
  }
  list() {
    return this.db.prepare("SELECT * FROM projects ORDER BY created_at ASC").all();
  }
  // Project members
  addMember(projectId, userId, role, invitedBy) {
    this.db.prepare(
      `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(projectId, userId, role, invitedBy ?? null, (/* @__PURE__ */ new Date()).toISOString());
  }
  updateMember(projectId, userId, updates) {
    const sets = [];
    const values = [];
    if (updates.display_color !== void 0) {
      sets.push("display_color = ?");
      values.push(updates.display_color);
    }
    if (updates.display_initials !== void 0) {
      sets.push("display_initials = ?");
      values.push(updates.display_initials);
    }
    if (sets.length === 0) return;
    this.db.prepare(`UPDATE project_members SET ${sets.join(", ")} WHERE project_id = ? AND user_id = ?`).run(...values, projectId, userId);
  }
  removeMember(projectId, userId) {
    const result = this.db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(projectId, userId);
    return result.changes > 0;
  }
  getMembers(projectId) {
    return this.db.prepare("SELECT * FROM project_members WHERE project_id = ? ORDER BY joined_at ASC").all(projectId);
  }
  getProjectsForUser(userId) {
    return this.db.prepare(
      `SELECT p.* FROM projects p
         INNER JOIN project_members pm ON pm.project_id = p.id
         WHERE pm.user_id = ?
         ORDER BY p.sidebar_order ASC, p.created_at ASC`
    ).all(userId);
  }
  updateSidebarOrder(updates) {
    const stmt = this.db.prepare("UPDATE projects SET sidebar_order = ?, updated_at = ? WHERE id = ?");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    withTransaction(this.db, () => {
      for (const u of updates) {
        stmt.run(u.sidebar_order, now, u.id);
      }
    });
  }
}
class StatusRepository {
  constructor(db2) {
    this.db = db2;
  }
  findById(id) {
    return this.db.prepare("SELECT * FROM statuses WHERE id = ?").get(id);
  }
  findByProjectId(projectId) {
    return this.db.prepare("SELECT * FROM statuses WHERE project_id = ? ORDER BY order_index ASC").all(projectId);
  }
  findDefault(projectId) {
    return this.db.prepare("SELECT * FROM statuses WHERE project_id = ? AND is_default = 1").get(projectId);
  }
  findDone(projectId) {
    return this.db.prepare("SELECT * FROM statuses WHERE project_id = ? AND is_done = 1").get(projectId);
  }
  create(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO statuses (id, project_id, name, color, icon, order_index, is_done, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.project_id,
      input.name,
      input.color ?? "#888888",
      input.icon ?? "circle",
      input.order_index ?? 0,
      input.is_done ?? 0,
      input.is_default ?? 0,
      now,
      now
    );
    return this.findById(input.id);
  }
  update(id, input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const sets = ["updated_at = ?"];
    const values = [now];
    if (input.name !== void 0) {
      sets.push("name = ?");
      values.push(input.name);
    }
    if (input.color !== void 0) {
      sets.push("color = ?");
      values.push(input.color);
    }
    if (input.icon !== void 0) {
      sets.push("icon = ?");
      values.push(input.icon);
    }
    if (input.order_index !== void 0) {
      sets.push("order_index = ?");
      values.push(input.order_index);
    }
    if (input.is_done !== void 0) {
      sets.push("is_done = ?");
      values.push(input.is_done);
    }
    if (input.is_default !== void 0) {
      sets.push("is_default = ?");
      values.push(input.is_default);
    }
    values.push(id);
    this.db.prepare(`UPDATE statuses SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.findById(id);
  }
  delete(id) {
    const result = this.db.prepare("DELETE FROM statuses WHERE id = ?").run(id);
    return result.changes > 0;
  }
  reassignAndDelete(statusId, targetStatusId) {
    return withTransaction(this.db, () => {
      this.db.prepare("UPDATE tasks SET status_id = ? WHERE status_id = ?").run(targetStatusId, statusId);
      return this.db.prepare("DELETE FROM statuses WHERE id = ?").run(statusId).changes > 0;
    });
  }
}
const TASK_UPDATABLE_COLUMNS = [
  "title",
  "description",
  "project_id",
  "status_id",
  "priority",
  "due_date",
  "assigned_to",
  "parent_id",
  "order_index",
  "is_in_my_day",
  "is_template",
  "is_archived",
  "completed_date",
  "recurrence_rule",
  "reference_url",
  "my_day_dismissed_date"
];
const WEEK_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEK_DAY_SET = new Set(WEEK_DAYS);
const ORDINALS = ["1st", "2nd", "3rd", "4th", "last"];
const ORDINAL_SET = new Set(ORDINALS);
function parseRecurrence(rule) {
  if (!rule) return null;
  let untilDate;
  let mainPart = rule;
  const untilIdx = rule.indexOf("|until:");
  if (untilIdx !== -1) {
    untilDate = rule.slice(untilIdx + 7);
    mainPart = rule.slice(0, untilIdx);
  }
  const afterCompletion = mainPart.startsWith("every!:");
  const prefix = afterCompletion ? "every!:" : "every:";
  if (!mainPart.startsWith(prefix)) return null;
  const rest = mainPart.slice(prefix.length);
  const parts = rest.split(":");
  if (parts.length < 2) return null;
  const interval = parseInt(parts[0], 10);
  if (isNaN(interval) || interval < 1) return null;
  const unit = parts[1];
  if (!["days", "weeks", "months", "years"].includes(unit)) return null;
  const config = { interval, unit, afterCompletion };
  if (untilDate) config.untilDate = untilDate;
  if (unit === "weeks" && parts.length >= 3) {
    const days = parts[2].split(",").filter((d) => WEEK_DAY_SET.has(d));
    if (days.length > 0) config.weekDays = days;
  }
  if (unit === "months" && parts.length >= 3) {
    if (parts.length >= 4 && ORDINAL_SET.has(parts[2])) {
      const nth = parts[2];
      const day = parts[3];
      if (WEEK_DAY_SET.has(day)) {
        config.monthOrdinal = { nth, day };
      }
    } else {
      const day = parseInt(parts[2], 10);
      if (!isNaN(day) && day >= 1 && day <= 31) config.monthDay = day;
    }
  }
  if (unit === "years" && parts.length >= 4) {
    const month = parseInt(parts[2], 10);
    const day = parseInt(parts[3], 10);
    if (!isNaN(month) && month >= 1 && month <= 12) config.yearMonth = month;
    if (!isNaN(day) && day >= 1 && day <= 31) config.yearDay = day;
  }
  return config;
}
function getNextOccurrence(rule, fromDate) {
  const config = parseRecurrence(rule);
  if (!config) return null;
  const next = new Date(fromDate);
  switch (config.unit) {
    case "days":
      next.setDate(next.getDate() + config.interval);
      break;
    case "weeks": {
      if (config.weekDays && config.weekDays.length > 0) {
        const targetDays = config.weekDays.map((d) => WEEK_DAYS.indexOf(d)).sort((a, b) => a - b);
        const currentDay = fromDate.getDay();
        const laterThisWeek = targetDays.find((d) => d > currentDay);
        if (laterThisWeek !== void 0 && config.interval === 1) {
          next.setDate(next.getDate() + (laterThisWeek - currentDay));
        } else {
          const daysUntilNextWeekStart = 7 - currentDay;
          next.setDate(next.getDate() + daysUntilNextWeekStart + (config.interval - 1) * 7 + targetDays[0]);
        }
      } else {
        next.setDate(next.getDate() + config.interval * 7);
      }
      break;
    }
    case "months": {
      if (config.monthOrdinal) {
        next.setMonth(next.getMonth() + config.interval);
        const targetDay = WEEK_DAYS.indexOf(config.monthOrdinal.day);
        if (config.monthOrdinal.nth === "last") {
          const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0);
          const dayDiff = (lastDay.getDay() - targetDay + 7) % 7;
          lastDay.setDate(lastDay.getDate() - dayDiff);
          next.setDate(lastDay.getDate());
        } else {
          const nthMap = { "1st": 1, "2nd": 2, "3rd": 3, "4th": 4 };
          const nth = nthMap[config.monthOrdinal.nth] ?? 1;
          next.setDate(1);
          const firstDayOfWeek = next.getDay();
          let offset = (targetDay - firstDayOfWeek + 7) % 7;
          offset += (nth - 1) * 7;
          next.setDate(1 + offset);
        }
      } else {
        const targetMonth = next.getMonth() + config.interval;
        next.setDate(1);
        next.setMonth(targetMonth);
        if (config.monthDay !== void 0) {
          const lastDayOfMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
          next.setDate(Math.min(config.monthDay, lastDayOfMonth));
        }
      }
      break;
    }
    case "years": {
      next.setFullYear(next.getFullYear() + config.interval);
      if (config.yearMonth !== void 0 && config.yearDay !== void 0) {
        next.setMonth(config.yearMonth - 1);
        const lastDay = new Date(next.getFullYear(), config.yearMonth, 0).getDate();
        next.setDate(Math.min(config.yearDay, lastDay));
      }
      break;
    }
  }
  if (config.untilDate) {
    const until = /* @__PURE__ */ new Date(config.untilDate + "T23:59:59");
    if (next > until) return null;
  }
  return next;
}
class TaskRepository {
  constructor(db2) {
    this.db = db2;
  }
  /**
   * Resets any tasks in the given project whose status_id doesn't match
   * a valid status for that project back to the project's default status.
   */
  repairOrphanedStatuses(projectId) {
    const result = this.db.prepare(
      `UPDATE tasks SET status_id = (
           SELECT id FROM statuses WHERE project_id = ? AND is_default = 1 LIMIT 1
         ), updated_at = ?
         WHERE project_id = ? AND is_template = 0
         AND status_id NOT IN (SELECT id FROM statuses WHERE project_id = ?)`
    ).run(projectId, (/* @__PURE__ */ new Date()).toISOString(), projectId, projectId);
    return Number(result.changes);
  }
  findById(id) {
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  }
  findByProjectId(projectId) {
    this.repairOrphanedStatuses(projectId);
    return this.db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND is_archived = 0 AND is_template = 0 ORDER BY order_index ASC"
    ).all(projectId);
  }
  findByStatusId(statusId) {
    return this.db.prepare(
      "SELECT * FROM tasks WHERE status_id = ? AND is_archived = 0 AND is_template = 0 ORDER BY order_index ASC"
    ).all(statusId);
  }
  findMyDay(userId) {
    this.db.prepare(
      `UPDATE tasks SET status_id = (
           SELECT s.id FROM statuses s WHERE s.project_id = tasks.project_id AND s.is_default = 1 LIMIT 1
         ), updated_at = ?
         WHERE owner_id = ? AND is_template = 0
         AND status_id NOT IN (SELECT id FROM statuses WHERE project_id = tasks.project_id)`
    ).run((/* @__PURE__ */ new Date()).toISOString(), userId);
    return this.db.prepare(
      `SELECT * FROM tasks
         WHERE owner_id = ? AND is_archived = 0 AND is_template = 0
         AND is_in_my_day = 1
         ORDER BY order_index ASC`
    ).all(userId);
  }
  findArchived(projectId) {
    return this.db.prepare("SELECT * FROM tasks WHERE project_id = ? AND is_archived = 1 ORDER BY updated_at DESC").all(projectId);
  }
  findTemplates(projectId) {
    return this.db.prepare("SELECT * FROM tasks WHERE project_id = ? AND is_template = 1 ORDER BY created_at ASC").all(projectId);
  }
  findSubtasks(parentId) {
    return this.db.prepare("SELECT * FROM tasks WHERE parent_id = ? ORDER BY order_index ASC").all(parentId);
  }
  getSubtaskCount(parentId) {
    const row = this.db.prepare(
      `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status_id IN (SELECT id FROM statuses WHERE is_done = 1) THEN 1 ELSE 0 END) as done
         FROM tasks WHERE parent_id = ?`
    ).get(parentId);
    return { total: row.total, done: row.done ?? 0 };
  }
  create(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO tasks (id, project_id, owner_id, title, status_id, assigned_to, description,
         priority, due_date, parent_id, order_index, is_in_my_day, is_template, is_archived,
         completed_date, recurrence_rule, reference_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.project_id,
      input.owner_id,
      input.title,
      input.status_id,
      input.assigned_to ?? null,
      input.description ?? null,
      input.priority ?? 0,
      input.due_date ?? null,
      input.parent_id ?? null,
      input.order_index ?? 0,
      input.is_in_my_day ?? 0,
      input.is_template ?? 0,
      input.is_archived ?? 0,
      input.completed_date ?? null,
      input.recurrence_rule ?? null,
      input.reference_url ?? null,
      now,
      now
    );
    return this.findById(input.id);
  }
  update(id, input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const sets = ["updated_at = ?"];
    const values = [now];
    for (const col of TASK_UPDATABLE_COLUMNS) {
      if (input[col] !== void 0) {
        sets.push(`${col} = ?`);
        values.push(input[col]);
      }
    }
    values.push(id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    if (input.is_archived !== void 0) {
      const subtasks = this.findSubtasks(id);
      for (const subtask of subtasks) {
        this.update(subtask.id, { is_archived: input.is_archived });
      }
    }
    return this.findById(id);
  }
  delete(id) {
    const result = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return result.changes > 0;
  }
  reorder(taskIds) {
    withTransaction(this.db, () => {
      const stmt = this.db.prepare("UPDATE tasks SET order_index = ? WHERE id = ?");
      for (let i = 0; i < taskIds.length; i++) {
        stmt.run(i, taskIds[i]);
      }
    });
  }
  // Label assignments
  addLabel(taskId, labelId) {
    this.db.prepare("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)").run(taskId, labelId);
  }
  removeLabel(taskId, labelId) {
    const result = this.db.prepare("DELETE FROM task_labels WHERE task_id = ? AND label_id = ?").run(taskId, labelId);
    return result.changes > 0;
  }
  getLabels(taskId) {
    return this.db.prepare("SELECT * FROM task_labels WHERE task_id = ?").all(taskId);
  }
  findAllTemplates(userId) {
    return this.db.prepare(
      `SELECT t.* FROM tasks t
         INNER JOIN project_members pm ON pm.project_id = t.project_id
         WHERE t.is_template = 1 AND pm.user_id = ?
         ORDER BY t.created_at ASC`
    ).all(userId);
  }
  saveAsTemplate(id, newId) {
    const original = this.findById(id);
    if (!original) return void 0;
    const defaultStatusStmt = this.db.prepare(
      "SELECT id FROM statuses WHERE project_id = ? AND is_default = 1 LIMIT 1"
    );
    const defaultStatus = defaultStatusStmt.get(original.project_id);
    const statusId = defaultStatus?.id ?? original.status_id;
    return withTransaction(this.db, () => {
      const template = this.create({
        id: newId,
        project_id: original.project_id,
        owner_id: original.owner_id,
        title: original.title,
        status_id: statusId,
        description: original.description,
        priority: original.priority,
        is_template: 1,
        is_in_my_day: 0,
        is_archived: 0,
        recurrence_rule: original.recurrence_rule,
        order_index: 0
        // Strips: due_date, completed_date, snooze (no snooze field — just omit due_date)
      });
      const labels = this.getLabels(id);
      for (const label of labels) {
        this.addLabel(template.id, label.label_id);
      }
      this.copySubtasksAsTemplate(id, template.id, original.project_id, statusId);
      return template;
    });
  }
  copySubtasksAsTemplate(originalParentId, newParentId, projectId, defaultStatusId) {
    const subtasks = this.findSubtasks(originalParentId);
    for (const subtask of subtasks) {
      const subtaskId = crypto$1.randomUUID();
      this.create({
        id: subtaskId,
        project_id: projectId,
        owner_id: subtask.owner_id,
        title: subtask.title,
        status_id: defaultStatusId,
        description: subtask.description,
        priority: subtask.priority,
        parent_id: newParentId,
        order_index: subtask.order_index,
        is_template: 1,
        is_in_my_day: 0,
        is_archived: 0,
        recurrence_rule: subtask.recurrence_rule
      });
      const labels = this.getLabels(subtask.id);
      for (const label of labels) {
        this.addLabel(subtaskId, label.label_id);
      }
      this.copySubtasksAsTemplate(subtask.id, subtaskId, projectId, defaultStatusId);
    }
  }
  findWithUpcomingDueTimes(minutesAhead) {
    const now = /* @__PURE__ */ new Date();
    const cutoff = new Date(now.getTime() + minutesAhead * 60 * 1e3);
    const pad = (n) => String(n).padStart(2, "0");
    const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return this.db.prepare(
      `SELECT * FROM tasks
         WHERE is_archived = 0
         AND is_template = 0
         AND due_date IS NOT NULL
         AND due_date LIKE '%T%'
         AND due_date >= ?
         AND due_date <= ?
         AND status_id NOT IN (SELECT id FROM statuses WHERE is_done = 1)
         ORDER BY due_date ASC`
    ).all(toLocal(now), toLocal(cutoff));
  }
  search(filters) {
    let sql = "SELECT DISTINCT t.* FROM tasks t";
    const conditions = ["t.is_template = 0"];
    const params = [];
    if (filters.label_ids && filters.label_ids.length > 0) {
      if (filters.label_logic === "all") {
        const placeholders = filters.label_ids.map(() => "?").join(", ");
        conditions.push(`t.id IN (
          SELECT task_id FROM task_labels
          WHERE label_id IN (${placeholders})
          GROUP BY task_id
          HAVING COUNT(DISTINCT label_id) = ?
        )`);
        params.push(...filters.label_ids, filters.label_ids.length);
      } else {
        sql += " INNER JOIN task_labels tl ON tl.task_id = t.id";
        const placeholders = filters.label_ids.map(() => "?").join(", ");
        conditions.push(`tl.label_id IN (${placeholders})`);
        params.push(...filters.label_ids);
      }
    } else if (filters.label_id) {
      sql += " INNER JOIN task_labels tl ON tl.task_id = t.id";
      conditions.push("tl.label_id = ?");
      params.push(filters.label_id);
    }
    if (filters.project_ids && filters.project_ids.length > 0) {
      const placeholders = filters.project_ids.map(() => "?").join(", ");
      conditions.push(`t.project_id IN (${placeholders})`);
      params.push(...filters.project_ids);
    } else if (filters.project_id) {
      conditions.push("t.project_id = ?");
      params.push(filters.project_id);
    }
    if (filters.status_ids && filters.status_ids.length > 0) {
      const placeholders = filters.status_ids.map(() => "?").join(", ");
      conditions.push(`t.status_id IN (${placeholders})`);
      params.push(...filters.status_ids);
    } else if (filters.status_id) {
      conditions.push("t.status_id = ?");
      params.push(filters.status_id);
    }
    if (filters.priorities && filters.priorities.length > 0) {
      const placeholders = filters.priorities.map(() => "?").join(", ");
      conditions.push(`t.priority IN (${placeholders})`);
      params.push(...filters.priorities);
    } else if (filters.priority !== void 0) {
      conditions.push("t.priority = ?");
      params.push(filters.priority);
    }
    if (filters.assigned_to_ids && filters.assigned_to_ids.length > 0) {
      const placeholders = filters.assigned_to_ids.map(() => "?").join(", ");
      conditions.push(`t.assigned_to IN (${placeholders})`);
      params.push(...filters.assigned_to_ids);
    }
    if (filters.due_before) {
      conditions.push("t.due_date IS NOT NULL AND t.due_date <= ?");
      params.push(filters.due_before);
    }
    if (filters.due_after) {
      conditions.push("t.due_date IS NOT NULL AND t.due_date >= ?");
      params.push(filters.due_after);
    }
    if (filters.keyword) {
      conditions.push("(t.title LIKE ? OR t.description LIKE ?)");
      const kw = `%${filters.keyword}%`;
      params.push(kw, kw);
    }
    if (filters.is_archived !== void 0) {
      conditions.push("t.is_archived = ?");
      params.push(filters.is_archived);
    } else {
      conditions.push("t.is_archived = 0");
    }
    if (filters.owner_id) {
      conditions.push("t.owner_id = ?");
      params.push(filters.owner_id);
    }
    if (filters.exclude_label_ids && filters.exclude_label_ids.length > 0) {
      const placeholders = filters.exclude_label_ids.map(() => "?").join(", ");
      conditions.push(`t.id NOT IN (SELECT task_id FROM task_labels WHERE label_id IN (${placeholders}))`);
      params.push(...filters.exclude_label_ids);
    }
    if (filters.exclude_status_ids && filters.exclude_status_ids.length > 0) {
      const placeholders = filters.exclude_status_ids.map(() => "?").join(", ");
      conditions.push(`t.status_id NOT IN (${placeholders})`);
      params.push(...filters.exclude_status_ids);
    }
    if (filters.exclude_priorities && filters.exclude_priorities.length > 0) {
      const placeholders = filters.exclude_priorities.map(() => "?").join(", ");
      conditions.push(`t.priority NOT IN (${placeholders})`);
      params.push(...filters.exclude_priorities);
    }
    if (filters.exclude_assigned_to_ids && filters.exclude_assigned_to_ids.length > 0) {
      const placeholders = filters.exclude_assigned_to_ids.map(() => "?").join(", ");
      conditions.push(`(t.assigned_to IS NULL OR t.assigned_to NOT IN (${placeholders}))`);
      params.push(...filters.exclude_assigned_to_ids);
    }
    if (filters.exclude_project_ids && filters.exclude_project_ids.length > 0) {
      const placeholders = filters.exclude_project_ids.map(() => "?").join(", ");
      conditions.push(`t.project_id NOT IN (${placeholders})`);
      params.push(...filters.exclude_project_ids);
    }
    sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY t.order_index ASC";
    return this.db.prepare(sql).all(...params);
  }
  duplicate(id, newId) {
    const original = this.findById(id);
    if (!original) return void 0;
    const newTask = this.create({
      id: newId,
      project_id: original.project_id,
      owner_id: original.owner_id,
      title: `${original.title} (copy)`,
      status_id: original.status_id,
      assigned_to: original.assigned_to,
      description: original.description,
      priority: original.priority,
      due_date: original.due_date,
      parent_id: original.parent_id,
      order_index: original.order_index + 1,
      is_in_my_day: original.is_in_my_day,
      recurrence_rule: original.recurrence_rule
    });
    if (!newTask) return void 0;
    const labels = this.getLabels(id);
    for (const label of labels) {
      this.addLabel(newTask.id, label.label_id);
    }
    const subtasks = this.findSubtasks(id);
    for (const subtask of subtasks) {
      const subtaskNewId = crypto$1.randomUUID();
      const dupSubtask = this.findById(subtask.id);
      if (dupSubtask) {
        this.create({
          id: subtaskNewId,
          project_id: dupSubtask.project_id,
          owner_id: dupSubtask.owner_id,
          title: `${dupSubtask.title} (copy)`,
          status_id: dupSubtask.status_id,
          assigned_to: dupSubtask.assigned_to,
          description: dupSubtask.description,
          priority: dupSubtask.priority,
          due_date: dupSubtask.due_date,
          parent_id: newTask.id,
          order_index: dupSubtask.order_index,
          is_in_my_day: dupSubtask.is_in_my_day,
          recurrence_rule: dupSubtask.recurrence_rule
        });
        const subtaskLabels = this.getLabels(subtask.id);
        for (const label of subtaskLabels) {
          this.addLabel(subtaskNewId, label.label_id);
        }
      }
    }
    return newTask;
  }
  completeRecurringTask(taskId) {
    const task = this.findById(taskId);
    if (!task || !task.recurrence_rule) return null;
    const config = parseRecurrence(task.recurrence_rule);
    if (!config) return null;
    const fromDate = config.afterCompletion ? /* @__PURE__ */ new Date() : task.due_date ? new Date(task.due_date) : /* @__PURE__ */ new Date();
    const nextDate = getNextOccurrence(task.recurrence_rule, fromDate);
    if (!nextDate) return null;
    const nextDueDate = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}-${String(nextDate.getDate()).padStart(2, "0")}`;
    return withTransaction(this.db, () => {
      const defaultStatus = this.db.prepare(
        `SELECT id FROM statuses WHERE project_id = ? AND is_done = 0
           ORDER BY is_default DESC, order_index ASC LIMIT 1`
      ).get(task.project_id);
      const statusId = defaultStatus?.id ?? task.status_id;
      const newId = crypto$1.randomUUID();
      const clonedTask = this.create({
        id: newId,
        project_id: task.project_id,
        owner_id: task.owner_id,
        title: task.title,
        status_id: statusId,
        assigned_to: task.assigned_to,
        description: task.description,
        priority: task.priority,
        due_date: nextDueDate,
        parent_id: task.parent_id,
        order_index: task.order_index,
        recurrence_rule: task.recurrence_rule,
        reference_url: task.reference_url
      });
      const labels = this.getLabels(taskId);
      for (const label of labels) {
        this.addLabel(clonedTask.id, label.label_id);
      }
      this.copySubtasksForRecurrence(taskId, clonedTask.id, task.project_id, statusId);
      return { id: clonedTask.id, dueDate: nextDueDate };
    });
  }
  copySubtasksForRecurrence(originalParentId, newParentId, projectId, defaultStatusId) {
    const subtasks = this.findSubtasks(originalParentId);
    for (const subtask of subtasks) {
      const subtaskId = crypto$1.randomUUID();
      this.create({
        id: subtaskId,
        project_id: projectId,
        owner_id: subtask.owner_id,
        title: subtask.title,
        status_id: defaultStatusId,
        description: subtask.description,
        priority: subtask.priority,
        parent_id: newParentId,
        order_index: subtask.order_index,
        is_in_my_day: 0,
        is_archived: 0,
        completed_date: null
      });
      const labels = this.getLabels(subtask.id);
      for (const label of labels) {
        this.addLabel(subtaskId, label.label_id);
      }
      this.copySubtasksForRecurrence(subtask.id, subtaskId, projectId, defaultStatusId);
    }
  }
  // ── Stats Methods ───────────────────────────────────────────────
  getCompletionStats(userId, projectIds, startDate, endDate) {
    let sql = `
      SELECT date(t.completed_date) as date, COUNT(*) as count
      FROM tasks t
      INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      WHERE t.completed_date IS NOT NULL
        AND t.completed_date >= ? AND t.completed_date <= ?
        AND t.is_template = 0
    `;
    const params = [userId, startDate, endDate];
    if (projectIds && projectIds.length > 0) {
      sql += ` AND t.project_id IN (${projectIds.map(() => "?").join(",")})`;
      params.push(...projectIds);
    }
    sql += " GROUP BY date(t.completed_date) ORDER BY date ASC";
    return this.db.prepare(sql).all(...params);
  }
  getStreakStats(userId) {
    const rows = this.db.prepare(
      `SELECT DISTINCT date(al.created_at) as date
         FROM activity_log al
         INNER JOIN tasks t ON t.id = al.task_id
         INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
         ORDER BY date DESC`
    ).all(userId);
    if (rows.length === 0) return { current: 0, best: 0 };
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    let current = 0;
    let best = 0;
    let streak = 0;
    let prev = null;
    for (const row of rows) {
      if (!prev) {
        const diff = Math.floor((new Date(today).getTime() - new Date(row.date).getTime()) / 864e5);
        if (diff <= 1) {
          streak = 1;
          current = 1;
        } else {
          streak = 1;
        }
      } else {
        const diff = Math.floor((new Date(prev).getTime() - new Date(row.date).getTime()) / 864e5);
        if (diff === 1) {
          streak++;
          if (current > 0) current = streak;
        } else {
          best = Math.max(best, streak);
          streak = 1;
          current = current > 0 ? current : 0;
        }
      }
      prev = row.date;
    }
    best = Math.max(best, streak);
    return { current, best };
  }
  getStatsTaskList(userId, filter, projectIds, startDate, endDate) {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const weekStartDate = /* @__PURE__ */ new Date();
    weekStartDate.setDate(weekStartDate.getDate() - weekStartDate.getDay());
    const weekStart = weekStartDate.toISOString().slice(0, 10);
    let where;
    switch (filter) {
      case "completed_today":
        where = `AND s.is_done = 1 AND date(t.completed_date) = '${today}'`;
        break;
      case "completed_week":
        where = `AND s.is_done = 1 AND date(t.completed_date) >= '${weekStart}'`;
        break;
      case "completed_range":
        where = `AND s.is_done = 1 AND t.completed_date >= ? AND t.completed_date <= ?`;
        break;
      case "open":
        where = "AND s.is_done = 0";
        break;
      case "overdue":
        where = `AND s.is_done = 0 AND t.due_date IS NOT NULL AND date(t.due_date) < '${today}'`;
        break;
    }
    let sql = `
      SELECT t.id, t.project_id as projectId, t.title, p.name as projectName, t.completed_date as completedDate, t.due_date as dueDate, t.priority
      FROM tasks t
      INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      INNER JOIN statuses s ON s.id = t.status_id
      INNER JOIN projects p ON p.id = t.project_id
      WHERE t.is_template = 0 AND t.is_archived = 0 ${where}
    `;
    const params = [userId];
    if (filter === "completed_range" && startDate && endDate) {
      params.push(startDate, endDate);
    }
    if (projectIds && projectIds.length > 0) {
      sql += ` AND t.project_id IN (${projectIds.map(() => "?").join(",")})`;
      params.push(...projectIds);
    }
    sql += " ORDER BY t.updated_at DESC LIMIT 200";
    return this.db.prepare(sql).all(...params);
  }
  getTaskSummaryStats(userId, projectIds) {
    let baseSql = `
      FROM tasks t
      INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      INNER JOIN statuses s ON s.id = t.status_id
      WHERE t.is_template = 0 AND t.is_archived = 0
    `;
    const params = [userId];
    if (projectIds && projectIds.length > 0) {
      baseSql += ` AND t.project_id IN (${projectIds.map(() => "?").join(",")})`;
      params.push(...projectIds);
    }
    const total = this.db.prepare(`SELECT COUNT(*) as c ${baseSql}`).get(...params).c;
    const open = this.db.prepare(`SELECT COUNT(*) as c ${baseSql} AND s.is_done = 0`).get(...params).c;
    const completed = this.db.prepare(`SELECT COUNT(*) as c ${baseSql} AND s.is_done = 1`).get(...params).c;
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const overdue = this.db.prepare(
      `SELECT COUNT(*) as c ${baseSql} AND s.is_done = 0 AND t.due_date IS NOT NULL AND date(t.due_date) < ?`
    ).get(...params, today).c;
    const avgRow = this.db.prepare(
      `SELECT AVG(julianday(t.completed_date) - julianday(t.created_at)) as avg_days ${baseSql} AND t.completed_date IS NOT NULL`
    ).get(...params);
    return { total, open, overdue, completed, avgCompletionDays: Math.round((avgRow.avg_days ?? 0) * 10) / 10 };
  }
  getPriorityBreakdown(userId, projectIds) {
    let sql = `
      SELECT t.priority, COUNT(*) as count
      FROM tasks t
      INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      INNER JOIN statuses s ON s.id = t.status_id
      WHERE t.is_template = 0 AND t.is_archived = 0 AND s.is_done = 0
    `;
    const params = [userId];
    if (projectIds && projectIds.length > 0) {
      sql += ` AND t.project_id IN (${projectIds.map(() => "?").join(",")})`;
      params.push(...projectIds);
    }
    sql += " GROUP BY t.priority ORDER BY t.priority DESC";
    return this.db.prepare(sql).all(...params);
  }
  getCompletionsByDayOfWeek(userId, projectIds, startDate, endDate) {
    let sql = `
      SELECT CAST(strftime('%w', t.completed_date) AS INTEGER) as dayOfWeek, COUNT(*) as count
      FROM tasks t
      INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      WHERE t.completed_date IS NOT NULL
        AND t.completed_date >= ? AND t.completed_date <= ?
        AND t.is_template = 0
    `;
    const params = [userId, startDate, endDate];
    if (projectIds && projectIds.length > 0) {
      sql += ` AND t.project_id IN (${projectIds.map(() => "?").join(",")})`;
      params.push(...projectIds);
    }
    sql += " GROUP BY dayOfWeek ORDER BY dayOfWeek ASC";
    return this.db.prepare(sql).all(...params);
  }
  getProjectBreakdown(userId) {
    return this.db.prepare(`
      SELECT t.project_id as projectId, p.name as projectName,
        SUM(CASE WHEN s.is_done = 0 THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN s.is_done = 1 THEN 1 ELSE 0 END) as completed
      FROM tasks t
      INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      INNER JOIN statuses s ON s.id = t.status_id
      INNER JOIN projects p ON p.id = t.project_id
      WHERE t.is_template = 0 AND t.is_archived = 0
      GROUP BY t.project_id
      ORDER BY (open + completed) DESC
    `).all(userId);
  }
  autoAddMyDayTasks(userId, mode) {
    if (mode === "off") return [];
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const dateCondition = mode === "due_today" ? `date(t.due_date) = date('now')` : `date(t.due_date) <= date('now')`;
    const sql = `
      SELECT t.id, t.parent_id FROM tasks t
      JOIN statuses s ON t.status_id = s.id
      WHERE t.owner_id = ?
        AND t.is_archived = 0
        AND t.is_template = 0
        AND t.is_in_my_day = 0
        AND s.is_done = 0
        AND t.due_date IS NOT NULL
        AND ${dateCondition}
        AND (
          t.my_day_dismissed_date IS NULL
          OR (t.my_day_dismissed_date != '9999-12-31' AND t.my_day_dismissed_date != ?)
        )
    `;
    const rows = this.db.prepare(sql).all(userId, today);
    if (rows.length === 0) return [];
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const updateStmt = this.db.prepare(
      `UPDATE tasks SET is_in_my_day = 1, my_day_dismissed_date = NULL, updated_at = ? WHERE id = ?`
    );
    const ids = [];
    const parentIds = /* @__PURE__ */ new Set();
    for (const row of rows) {
      updateStmt.run(now, row.id);
      ids.push(row.id);
      if (row.parent_id) parentIds.add(row.parent_id);
    }
    for (const parentId of parentIds) {
      if (!ids.includes(parentId)) {
        const parent = this.db.prepare(`SELECT is_in_my_day FROM tasks WHERE id = ?`).get(parentId);
        if (parent && parent.is_in_my_day !== 1) {
          updateStmt.run(now, parentId);
          ids.push(parentId);
        }
      }
    }
    return ids;
  }
}
class LabelRepository {
  constructor(db2) {
    this.db = db2;
  }
  findById(id) {
    return this.db.prepare("SELECT * FROM labels WHERE id = ?").get(id);
  }
  findByIds(ids) {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    return this.db.prepare(`SELECT * FROM labels WHERE id IN (${placeholders})`).all(...ids);
  }
  /** Get all labels accessible to a user (linked to any of their projects) */
  findAllForUser(userId) {
    return this.db.prepare(
      `SELECT DISTINCT l.* FROM labels l
       INNER JOIN project_labels pl ON pl.label_id = l.id
       INNER JOIN project_members pm ON pm.project_id = pl.project_id
       WHERE pm.user_id = ?
       ORDER BY l.order_index ASC`
    ).all(userId);
  }
  /** Get labels linked to a specific project via project_labels junction */
  findByProjectId(projectId) {
    return this.db.prepare(
      `SELECT l.* FROM labels l
         INNER JOIN project_labels pl ON pl.label_id = l.id
         WHERE pl.project_id = ?
         ORDER BY l.order_index ASC`
    ).all(projectId);
  }
  /** Find a label by exact name scoped to user's projects (case-insensitive) */
  findByName(userId, name) {
    return this.db.prepare(
      `SELECT DISTINCT l.* FROM labels l
         INNER JOIN project_labels pl ON pl.label_id = l.id
         INNER JOIN project_members pm ON pm.project_id = pl.project_id
         WHERE pm.user_id = ? AND LOWER(l.name) = LOWER(?)
         LIMIT 1`
    ).get(userId, name);
  }
  /** Create a new global label. If project_id is provided, also links to that project. */
  create(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare("UPDATE labels SET order_index = order_index + 1").run();
    this.db.prepare(
      `INSERT INTO labels (id, name, color, order_index, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`
    ).run(input.id, input.name, input.color ?? "#888888", now, now);
    if (input.project_id) {
      this.addToProject(input.project_id, input.id);
    }
    return this.findById(input.id);
  }
  reorder(labelIds) {
    withTransaction(this.db, () => {
      const stmt = this.db.prepare("UPDATE labels SET order_index = ? WHERE id = ?");
      for (let i = 0; i < labelIds.length; i++) {
        stmt.run(i, labelIds[i]);
      }
    });
  }
  update(id, input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const sets = ["updated_at = ?"];
    const values = [now];
    if (input.name !== void 0) {
      sets.push("name = ?");
      values.push(input.name);
    }
    if (input.color !== void 0) {
      sets.push("color = ?");
      values.push(input.color);
    }
    values.push(id);
    this.db.prepare(`UPDATE labels SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.findById(id);
  }
  /** Delete a label globally — removes from all projects and all tasks */
  delete(id) {
    const result = this.db.prepare("DELETE FROM labels WHERE id = ?").run(id);
    return result.changes > 0;
  }
  /** Remove a label from a specific project. Tasks in that project lose the label. */
  removeFromProject(projectId, labelId) {
    this.db.prepare(
      `DELETE FROM task_labels WHERE label_id = ? AND task_id IN (
        SELECT id FROM tasks WHERE project_id = ?
      )`
    ).run(labelId, projectId);
    const result = this.db.prepare(
      "DELETE FROM project_labels WHERE project_id = ? AND label_id = ?"
    ).run(projectId, labelId);
    return result.changes > 0;
  }
  /** Link an existing label to a project */
  addToProject(projectId, labelId) {
    this.db.prepare(
      `INSERT OR IGNORE INTO project_labels (project_id, label_id, created_at)
       VALUES (?, ?, datetime('now'))`
    ).run(projectId, labelId);
  }
  findByTaskId(taskId) {
    return this.db.prepare(
      `SELECT l.* FROM labels l
         INNER JOIN task_labels tl ON tl.label_id = l.id
         WHERE tl.task_id = ?
         ORDER BY l.order_index ASC`
    ).all(taskId);
  }
  /** Get task-label mappings for tasks in a specific project */
  findTaskLabelsByProject(projectId) {
    return this.db.prepare(
      `SELECT tl.task_id, l.id, l.name, l.color, l.order_index, l.created_at, l.updated_at
         FROM task_labels tl
         INNER JOIN labels l ON l.id = tl.label_id
         INNER JOIN tasks t ON t.id = tl.task_id
         WHERE t.project_id = ?
         ORDER BY l.order_index ASC`
    ).all(projectId);
  }
  /** Get all labels accessible to a user with usage counts */
  findAllWithUsage(userId) {
    return this.db.prepare(
      `SELECT l.*,
           COALESCE(pc.cnt, 0) as project_count,
           COALESCE(tc.cnt, 0) as task_count
         FROM labels l
         INNER JOIN project_labels pl ON pl.label_id = l.id
         INNER JOIN project_members pm ON pm.project_id = pl.project_id
         LEFT JOIN (
           SELECT label_id, COUNT(*) as cnt FROM project_labels
           WHERE project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
           GROUP BY label_id
         ) pc ON pc.label_id = l.id
         LEFT JOIN (
           SELECT tl.label_id, COUNT(*) as cnt FROM task_labels tl
           INNER JOIN tasks t ON t.id = tl.task_id
           WHERE t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
           GROUP BY tl.label_id
         ) tc ON tc.label_id = l.id
         WHERE pm.user_id = ?
         GROUP BY l.id
         ORDER BY l.order_index ASC`
    ).all(userId, userId, userId);
  }
  /** Get projects (that the user has access to) that use a specific label, with task count per project */
  findProjectsUsingLabel(userId, labelId) {
    return this.db.prepare(
      `SELECT pl.project_id, p.name as project_name,
           (SELECT COUNT(*) FROM task_labels tl
            INNER JOIN tasks t ON t.id = tl.task_id
            WHERE tl.label_id = ? AND t.project_id = pl.project_id) as task_count
         FROM project_labels pl
         INNER JOIN projects p ON p.id = pl.project_id
         INNER JOIN project_members pm ON pm.project_id = pl.project_id
         WHERE pl.label_id = ? AND pm.user_id = ?
         ORDER BY p.name ASC`
    ).all(labelId, labelId, userId);
  }
  /** Get labels assigned to active (non-archived) tasks in a project */
  findActiveLabelsForProject(projectId) {
    return this.db.prepare(
      `SELECT DISTINCT l.* FROM labels l
         INNER JOIN task_labels tl ON tl.label_id = l.id
         INNER JOIN tasks t ON t.id = tl.task_id
         WHERE t.project_id = ? AND t.is_archived = 0
         ORDER BY l.order_index ASC`
    ).all(projectId);
  }
}
class ThemeRepository {
  constructor(db2) {
    this.db = db2;
  }
  findById(id) {
    return this.db.prepare("SELECT * FROM themes WHERE id = ?").get(id);
  }
  list(userId) {
    if (userId) {
      return this.db.prepare("SELECT * FROM themes WHERE is_builtin = 1 OR owner_id = ? ORDER BY name ASC").all(userId);
    }
    return this.db.prepare("SELECT * FROM themes ORDER BY name ASC").all();
  }
  listByMode(mode, userId) {
    if (userId) {
      return this.db.prepare("SELECT * FROM themes WHERE mode = ? AND (is_builtin = 1 OR owner_id = ?) ORDER BY name ASC").all(mode, userId);
    }
    return this.db.prepare("SELECT * FROM themes WHERE mode = ? ORDER BY name ASC").all(mode);
  }
  create(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO themes (id, name, mode, config, owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(input.id, input.name, input.mode, input.config, input.owner_id ?? null, now, now);
    return this.findById(input.id);
  }
  update(id, input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const sets = ["updated_at = ?"];
    const values = [now];
    if (input.name !== void 0) {
      sets.push("name = ?");
      values.push(input.name);
    }
    if (input.mode !== void 0) {
      sets.push("mode = ?");
      values.push(input.mode);
    }
    if (input.config !== void 0) {
      sets.push("config = ?");
      values.push(input.config);
    }
    values.push(id);
    this.db.prepare(`UPDATE themes SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.findById(id);
  }
  delete(id) {
    const result = this.db.prepare("DELETE FROM themes WHERE id = ?").run(id);
    return result.changes > 0;
  }
  getConfig(id) {
    const theme = this.findById(id);
    if (!theme) return void 0;
    return JSON.parse(theme.config);
  }
}
class SettingsRepository {
  constructor(db2) {
    this.db = db2;
  }
  get(userId, key) {
    const row = this.db.prepare("SELECT value FROM settings WHERE user_id = ? AND key = ?").get(userId, key);
    if (row) return row.value ?? null;
    const fallback = this.db.prepare("SELECT value FROM settings WHERE user_id = ? AND key = ?").get("", key);
    return fallback?.value ?? null;
  }
  set(userId, key, value) {
    this.db.prepare(
      `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
    ).run(userId, key, value);
  }
  getAll(userId) {
    return this.db.prepare(
      `SELECT COALESCE(u.key, g.key) as key, COALESCE(u.value, g.value) as value
       FROM settings g
       LEFT JOIN settings u ON u.key = g.key AND u.user_id = ?
       WHERE g.user_id = ''
       UNION
       SELECT key, value FROM settings WHERE user_id = ? AND key NOT IN (SELECT key FROM settings WHERE user_id = '')
       ORDER BY key ASC`
    ).all(userId, userId);
  }
  getMultiple(userId, keys) {
    if (keys.length === 0) return [];
    const placeholders = keys.map(() => "?").join(", ");
    return this.db.prepare(
      `SELECT key, COALESCE(
           (SELECT value FROM settings WHERE user_id = ? AND key = s.key),
           s.value
         ) as value
         FROM settings s
         WHERE s.user_id = '' AND s.key IN (${placeholders})
         ORDER BY key ASC`
    ).all(userId, ...keys);
  }
  setMultiple(userId, settings) {
    withTransaction(this.db, () => {
      const stmt = this.db.prepare(
        `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
      );
      for (const setting of settings) {
        stmt.run(userId, setting.key, setting.value);
      }
    });
  }
  delete(userId, key) {
    const result = this.db.prepare("DELETE FROM settings WHERE user_id = ? AND key = ?").run(userId, key);
    return result.changes > 0;
  }
}
class ActivityLogRepository {
  constructor(db2) {
    this.db = db2;
  }
  findById(id) {
    return this.db.prepare("SELECT * FROM activity_log WHERE id = ?").get(id);
  }
  findByTaskId(taskId) {
    return this.db.prepare("SELECT * FROM activity_log WHERE task_id = ? ORDER BY created_at DESC").all(taskId);
  }
  findByUserId(userId) {
    return this.db.prepare("SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC").all(userId);
  }
  create(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO activity_log (id, task_id, user_id, action, old_value, new_value, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.task_id,
      input.user_id,
      input.action,
      input.old_value ?? null,
      input.new_value ?? null,
      now
    );
    return this.findById(input.id);
  }
  deleteByTaskId(taskId) {
    const result = this.db.prepare("DELETE FROM activity_log WHERE task_id = ?").run(taskId);
    return Number(result.changes);
  }
  getRecent(userId, limit) {
    return this.db.prepare(
      `SELECT al.* FROM activity_log al
         INNER JOIN tasks t ON t.id = al.task_id
         INNER JOIN project_members pm ON pm.project_id = t.project_id
         WHERE pm.user_id = ?
         ORDER BY al.created_at DESC LIMIT ?`
    ).all(userId, limit);
  }
  getFocusStats(userId, projectId, startDate, endDate) {
    let sql = `
      SELECT date(al.created_at) as date, al.action
      FROM activity_log al
      INNER JOIN tasks t ON t.id = al.task_id
      INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      WHERE al.action LIKE 'Completed % min focus session'
        AND al.created_at >= ? AND al.created_at <= ?
    `;
    const params = [userId, startDate, endDate];
    if (projectId) {
      sql += " AND t.project_id = ?";
      params.push(projectId);
    }
    sql += " ORDER BY al.created_at ASC";
    const rows = this.db.prepare(sql).all(...params);
    const byDate = {};
    for (const row of rows) {
      const match = row.action.match(/^Completed (\d+) min focus session$/);
      if (match) {
        byDate[row.date] = (byDate[row.date] ?? 0) + Number(match[1]);
      }
    }
    return Object.entries(byDate).map(([date, minutes]) => ({ date, minutes }));
  }
  getFocusTaskList(userId, startDate, endDate, projectIds) {
    let sql = `
      SELECT t.id, t.project_id as projectId, t.title, p.name as projectName,
             t.completed_date as completedDate, t.due_date as dueDate, t.priority,
             SUM(CAST(SUBSTR(al.action, 11, INSTR(SUBSTR(al.action, 11), ' ') - 1) AS INTEGER)) as focusMinutes
      FROM activity_log al
      INNER JOIN tasks t ON t.id = al.task_id
      INNER JOIN projects p ON p.id = t.project_id
      INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      WHERE al.action LIKE 'Completed % min focus session'
        AND al.created_at >= ? AND al.created_at <= ?
    `;
    const params = [userId, startDate, endDate];
    if (projectIds && projectIds.length > 0) {
      sql += ` AND t.project_id IN (${projectIds.map(() => "?").join(",")})`;
      params.push(...projectIds);
    }
    sql += " GROUP BY t.id ORDER BY focusMinutes DESC LIMIT 200";
    return this.db.prepare(sql).all(...params);
  }
  getCookieStats(userId, startDate, endDate) {
    const sql = `
      SELECT al.action
      FROM activity_log al
      INNER JOIN tasks t ON t.id = al.task_id
      INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
      WHERE al.action LIKE 'Cookie break: earned%'
        AND al.created_at >= ? AND al.created_at <= ?
    `;
    const rows = this.db.prepare(sql).all(userId, startDate, endDate);
    let earnedSeconds = 0;
    let spentSeconds = 0;
    for (const row of rows) {
      const match = row.action.match(/^Cookie break: earned (\d+)s, spent (\d+)s$/);
      if (match) {
        earnedSeconds += Number(match[1]);
        spentSeconds += Number(match[2]);
      }
    }
    return { earnedSeconds, spentSeconds };
  }
  getActivityHeatmap(userId, startDate, endDate) {
    return this.db.prepare(
      `SELECT date(al.created_at) as date,
                COUNT(*) as count,
                SUM(CASE WHEN al.action = 'created' THEN 1 ELSE 0 END) as created,
                SUM(CASE WHEN al.action = 'status_changed' AND al.new_value IN (
                  SELECT s.name FROM statuses s WHERE s.is_done = 1
                ) THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN al.action != 'created' AND NOT (al.action = 'status_changed' AND al.new_value IN (
                  SELECT s.name FROM statuses s WHERE s.is_done = 1
                )) THEN 1 ELSE 0 END) as updated
         FROM activity_log al
         INNER JOIN tasks t ON t.id = al.task_id
         INNER JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
         WHERE al.created_at >= ? AND al.created_at <= ?
         GROUP BY date(al.created_at)
         ORDER BY date ASC`
    ).all(userId, startDate, endDate);
  }
}
const UPDATABLE_COLUMNS$2 = ["name", "color", "data"];
class ProjectTemplateRepository {
  constructor(db2) {
    this.db = db2;
  }
  findById(id) {
    return this.db.prepare("SELECT * FROM project_templates WHERE id = ?").get(id);
  }
  findByOwnerId(ownerId) {
    return this.db.prepare("SELECT * FROM project_templates WHERE owner_id = ? ORDER BY created_at DESC").all(ownerId);
  }
  findAll() {
    return this.db.prepare("SELECT * FROM project_templates ORDER BY created_at DESC").all();
  }
  create(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO project_templates (id, name, color, owner_id, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(input.id, input.name, input.color, input.owner_id, input.data, now, now);
    return this.findById(input.id);
  }
  update(id, input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const sets = ["updated_at = ?"];
    const values = [now];
    for (const col of UPDATABLE_COLUMNS$2) {
      if (input[col] !== void 0) {
        sets.push(`${col} = ?`);
        values.push(input[col]);
      }
    }
    values.push(id);
    this.db.prepare(`UPDATE project_templates SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.findById(id);
  }
  delete(id) {
    const result = this.db.prepare("DELETE FROM project_templates WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
class AttachmentRepository {
  constructor(db2) {
    this.db = db2;
  }
  findByTaskId(taskId) {
    return this.db.prepare(
      "SELECT id, task_id, filename, mime_type, size_bytes, created_at, updated_at FROM attachments WHERE task_id = ? ORDER BY created_at ASC"
    ).all(taskId);
  }
  getFileData(id) {
    const row = this.db.prepare("SELECT filename, mime_type, file_data FROM attachments WHERE id = ?").get(id);
    if (!row) return void 0;
    return { filename: row.filename, mime_type: row.mime_type, file_data: Buffer.from(row.file_data) };
  }
  create(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO attachments (id, task_id, filename, mime_type, size_bytes, file_data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(input.id, input.task_id, input.filename, input.mime_type, input.size_bytes, input.file_data, now, now);
    return this.db.prepare(
      "SELECT id, task_id, filename, mime_type, size_bytes, created_at, updated_at FROM attachments WHERE id = ?"
    ).get(input.id);
  }
  delete(id) {
    const result = this.db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
    return result.changes > 0;
  }
  deleteByTaskId(taskId) {
    const result = this.db.prepare("DELETE FROM attachments WHERE task_id = ?").run(taskId);
    return Number(result.changes);
  }
}
class NotificationRepository {
  constructor(db2) {
    this.db = db2;
  }
  findById(id) {
    return this.db.prepare("SELECT * FROM notifications WHERE id = ?").get(id);
  }
  findAll(limit = 50) {
    return this.db.prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?").all(limit);
  }
  findUnread() {
    return this.db.prepare("SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC").all();
  }
  getUnreadCount() {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM notifications WHERE read = 0").get();
    return row.count;
  }
  create(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO notifications (id, type, message, task_id, project_id, from_user_id, read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      input.id,
      input.type,
      input.message,
      input.task_id ?? null,
      input.project_id ?? null,
      input.from_user_id ?? null,
      now
    );
    return this.findById(input.id);
  }
  markAsRead(id) {
    const result = this.db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
    return result.changes > 0;
  }
  markAllAsRead() {
    const result = this.db.prepare("UPDATE notifications SET read = 1 WHERE read = 0").run();
    return Number(result.changes);
  }
  delete(id) {
    const result = this.db.prepare("DELETE FROM notifications WHERE id = ?").run(id);
    return result.changes > 0;
  }
  deleteByProjectId(projectId) {
    const result = this.db.prepare("DELETE FROM notifications WHERE project_id = ?").run(projectId);
    return Number(result.changes);
  }
}
class SyncQueueRepository {
  constructor(db2) {
    this.db = db2;
  }
  findAll() {
    return this.db.prepare("SELECT * FROM sync_queue ORDER BY created_at ASC").all();
  }
  enqueue(tableName, rowId, operation, payload) {
    const id = crypto.randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO sync_queue (id, table_name, row_id, operation, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, tableName, rowId, operation, payload, now);
    return { id, table_name: tableName, row_id: rowId, operation, payload, created_at: now };
  }
  dequeue(id) {
    const result = this.db.prepare("DELETE FROM sync_queue WHERE id = ?").run(id);
    return result.changes > 0;
  }
  clear() {
    const result = this.db.prepare("DELETE FROM sync_queue").run();
    return Number(result.changes);
  }
  count() {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM sync_queue").get();
    return row.count;
  }
}
const UPDATABLE_COLUMNS$1 = ["name", "color", "icon", "sidebar_order", "filter_config", "project_id"];
class SavedViewRepository {
  constructor(db2) {
    this.db = db2;
  }
  findById(id) {
    return this.db.prepare("SELECT * FROM saved_views WHERE id = ?").get(id);
  }
  findByUserId(userId) {
    return this.db.prepare("SELECT * FROM saved_views WHERE user_id = ? ORDER BY sidebar_order ASC").all(userId);
  }
  findByProjectId(projectId) {
    return this.db.prepare("SELECT * FROM saved_views WHERE project_id = ? ORDER BY sidebar_order ASC").all(projectId);
  }
  create(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO saved_views (id, user_id, project_id, name, color, icon, sidebar_order, filter_config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.user_id,
      input.project_id ?? null,
      input.name,
      input.color ?? "#6366f1",
      input.icon ?? "filter",
      input.sidebar_order ?? 0,
      input.filter_config,
      now,
      now
    );
    return this.findById(input.id);
  }
  update(id, input) {
    const sets = [];
    const params = [];
    for (const col of UPDATABLE_COLUMNS$1) {
      const val = input[col];
      if (val !== void 0) {
        sets.push(`${col} = ?`);
        params.push(val);
      }
    }
    if (sets.length === 0) return this.findById(id) ?? null;
    sets.push("updated_at = ?");
    params.push((/* @__PURE__ */ new Date()).toISOString());
    params.push(id);
    this.db.prepare(`UPDATE saved_views SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    return this.findById(id) ?? null;
  }
  delete(id) {
    const result = this.db.prepare("DELETE FROM saved_views WHERE id = ?").run(id);
    return result.changes > 0;
  }
  reorder(viewIds) {
    withTransaction(this.db, () => {
      const stmt = this.db.prepare("UPDATE saved_views SET sidebar_order = ? WHERE id = ?");
      for (let i = 0; i < viewIds.length; i++) {
        stmt.run(i, viewIds[i]);
      }
    });
  }
  countMatchingTasks(filterConfig, _userId) {
    try {
      const config = JSON.parse(filterConfig);
      let sql = "SELECT COUNT(DISTINCT t.id) as count FROM tasks t";
      const conditions = ["t.is_template = 0", "t.is_archived = 0", "t.parent_id IS NULL", "t.status_id NOT IN (SELECT id FROM statuses WHERE is_done = 1)"];
      const params = [];
      const labelIds = config.labelIds;
      if (labelIds && labelIds.length > 0) {
        sql += " INNER JOIN task_labels tl ON tl.task_id = t.id";
        const placeholders = labelIds.map(() => "?").join(", ");
        conditions.push(`tl.label_id IN (${placeholders})`);
        params.push(...labelIds);
      }
      const projectIds = config.projectIds;
      if (projectIds && projectIds.length > 0) {
        const placeholders = projectIds.map(() => "?").join(", ");
        conditions.push(`t.project_id IN (${placeholders})`);
        params.push(...projectIds);
      }
      const statusIds = config.statusIds;
      if (statusIds && statusIds.length > 0) {
        const placeholders = statusIds.map(() => "?").join(", ");
        conditions.push(`t.status_id IN (${placeholders})`);
        params.push(...statusIds);
      }
      const priorities = config.priorities;
      if (priorities && priorities.length > 0) {
        const placeholders = priorities.map(() => "?").join(", ");
        conditions.push(`t.priority IN (${placeholders})`);
        params.push(...priorities);
      }
      const keyword = config.keyword;
      if (keyword) {
        conditions.push("(t.title LIKE ? OR t.description LIKE ?)");
        const kw = `%${keyword}%`;
        params.push(kw, kw);
      }
      const excludeLabelIds = config.excludeLabelIds;
      if (excludeLabelIds && excludeLabelIds.length > 0) {
        const placeholders = excludeLabelIds.map(() => "?").join(", ");
        conditions.push(`t.id NOT IN (SELECT task_id FROM task_labels WHERE label_id IN (${placeholders}))`);
        params.push(...excludeLabelIds);
      }
      const excludeStatusIds = config.excludeStatusIds;
      if (excludeStatusIds && excludeStatusIds.length > 0) {
        const placeholders = excludeStatusIds.map(() => "?").join(", ");
        conditions.push(`t.status_id NOT IN (${placeholders})`);
        params.push(...excludeStatusIds);
      }
      const excludePriorities = config.excludePriorities;
      if (excludePriorities && excludePriorities.length > 0) {
        const placeholders = excludePriorities.map(() => "?").join(", ");
        conditions.push(`t.priority NOT IN (${placeholders})`);
        params.push(...excludePriorities);
      }
      const excludeProjectIds = config.excludeProjectIds;
      if (excludeProjectIds && excludeProjectIds.length > 0) {
        const placeholders = excludeProjectIds.map(() => "?").join(", ");
        conditions.push(`t.project_id NOT IN (${placeholders})`);
        params.push(...excludeProjectIds);
      }
      sql += " WHERE " + conditions.join(" AND ");
      const row = this.db.prepare(sql).get(...params);
      return row?.count ?? 0;
    } catch {
      return 0;
    }
  }
}
const UPDATABLE_COLUMNS = ["name", "color", "icon", "sidebar_order", "is_collapsed"];
class ProjectAreaRepository {
  constructor(db2) {
    this.db = db2;
  }
  findById(id) {
    return this.db.prepare("SELECT * FROM project_areas WHERE id = ?").get(id);
  }
  findByUserId(userId) {
    return this.db.prepare("SELECT * FROM project_areas WHERE user_id = ? ORDER BY sidebar_order ASC").all(userId);
  }
  create(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(
      `INSERT INTO project_areas (id, user_id, name, color, icon, sidebar_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.user_id,
      input.name,
      input.color ?? "#888888",
      input.icon ?? "folder",
      input.sidebar_order ?? 0,
      now,
      now
    );
    return this.findById(input.id);
  }
  update(id, input) {
    const sets = [];
    const params = [];
    for (const col of UPDATABLE_COLUMNS) {
      const val = input[col];
      if (val !== void 0) {
        sets.push(`${col} = ?`);
        params.push(val);
      }
    }
    if (sets.length === 0) return this.findById(id) ?? null;
    sets.push("updated_at = ?");
    params.push((/* @__PURE__ */ new Date()).toISOString());
    params.push(id);
    this.db.prepare(`UPDATE project_areas SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    return this.findById(id) ?? null;
  }
  delete(id) {
    const result = this.db.prepare("DELETE FROM project_areas WHERE id = ?").run(id);
    return result.changes > 0;
  }
  reorder(areaIds) {
    withTransaction(this.db, () => {
      const stmt = this.db.prepare("UPDATE project_areas SET sidebar_order = ? WHERE id = ?");
      for (let i = 0; i < areaIds.length; i++) {
        stmt.run(i, areaIds[i]);
      }
    });
  }
  assignProject(projectId, areaId) {
    this.db.prepare("UPDATE projects SET area_id = ? WHERE id = ?").run(areaId, projectId);
  }
}
function createRepositories(db2) {
  return {
    users: new UserRepository(db2),
    projects: new ProjectRepository(db2),
    statuses: new StatusRepository(db2),
    tasks: new TaskRepository(db2),
    labels: new LabelRepository(db2),
    themes: new ThemeRepository(db2),
    settings: new SettingsRepository(db2),
    activityLog: new ActivityLogRepository(db2),
    projectTemplates: new ProjectTemplateRepository(db2),
    attachments: new AttachmentRepository(db2),
    notifications: new NotificationRepository(db2),
    syncQueue: new SyncQueueRepository(db2),
    savedViews: new SavedViewRepository(db2),
    projectAreas: new ProjectAreaRepository(db2)
  };
}
let quickAddWindow = null;
function createQuickAddWindow() {
  quickAddWindow = new electron.BrowserWindow({
    width: 500,
    height: 300,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    type: "panel",
    hasShadow: false,
    backgroundColor: "#00000000",
    vibrancy: void 0,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  quickAddWindow.on("closed", () => {
    quickAddWindow = null;
  });
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    quickAddWindow.loadURL(process.env["ELECTRON_RENDERER_URL"] + "?window=quickadd");
  } else {
    quickAddWindow.loadFile(path.join(__dirname, "../renderer/index.html"), {
      search: "window=quickadd"
    });
  }
  electron.ipcMain.once("quickadd:ready", () => {
    if (!quickAddWindow || quickAddWindow.isDestroyed()) return;
    centerOnActiveDisplay(quickAddWindow);
    quickAddWindow.show();
    quickAddWindow.focus();
    quickAddWindow.on("blur", () => {
      if (quickAddWindow && !quickAddWindow.isDestroyed()) {
        quickAddWindow.destroy();
        quickAddWindow = null;
      }
    });
  });
  return quickAddWindow;
}
function centerOnActiveDisplay(win) {
  const cursor = electron.screen.getCursorScreenPoint();
  const display = electron.screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  const [winWidth, winHeight] = win.getSize();
  win.setPosition(
    Math.round(x + (width - winWidth) / 2),
    Math.round(y + (height - winHeight) / 3)
    // Upper third looks better than dead center
  );
}
function showQuickAddWindow() {
  if (quickAddWindow && !quickAddWindow.isDestroyed()) {
    quickAddWindow.destroy();
    quickAddWindow = null;
  }
  createQuickAddWindow();
}
function hideQuickAddWindow() {
  if (quickAddWindow && !quickAddWindow.isDestroyed()) {
    quickAddWindow.destroy();
    quickAddWindow = null;
  }
}
const RESERVED_MACOS_SHORTCUTS = {
  // macOS system shortcuts
  "CommandOrControl+Space": "Spotlight",
  "Command+Space": "Spotlight",
  "CommandOrControl+Shift+3": "Screenshot (Full Screen)",
  "Command+Shift+3": "Screenshot (Full Screen)",
  "CommandOrControl+Shift+4": "Screenshot (Selection)",
  "Command+Shift+4": "Screenshot (Selection)",
  "CommandOrControl+Shift+5": "Screenshot (Options)",
  "Command+Shift+5": "Screenshot (Options)",
  "Command+Tab": "App Switcher",
  "CommandOrControl+Tab": "App Switcher",
  "Command+Option+Escape": "Force Quit",
  "CommandOrControl+Alt+Escape": "Force Quit",
  // Essential app/system shortcuts
  "CommandOrControl+C": "Copy",
  "CommandOrControl+V": "Paste",
  "CommandOrControl+X": "Cut",
  "CommandOrControl+Z": "Undo",
  "CommandOrControl+Shift+Z": "Redo",
  "CommandOrControl+A": "Select All",
  "CommandOrControl+Q": "Quit",
  "CommandOrControl+W": "Close Window",
  "CommandOrControl+H": "Hide App",
  "CommandOrControl+M": "Minimize",
  "CommandOrControl+N": "New Window",
  "CommandOrControl+K": "Command Palette",
  "CommandOrControl+L": "Toggle Layout",
  "CommandOrControl+1": "My Day",
  "CommandOrControl+2": "Projects",
  "CommandOrControl+3": "Archive",
  "CommandOrControl+4": "Templates"
};
function getReservedShortcutName(accelerator) {
  return RESERVED_MACOS_SHORTCUTS[accelerator] ?? null;
}
const DEFAULT_QUICK_ADD_SHORTCUT = "CommandOrControl+Shift+Space";
const DEFAULT_APP_TOGGLE_SHORTCUT = "CommandOrControl+Shift+B";
function getBucketForStatus(status) {
  if (!status) return "not_started";
  if (status.is_done === 1) return "done";
  if (status.is_default === 1) return "not_started";
  return "in_progress";
}
function truncateTitle(title, maxLength = 40) {
  if (title.length <= maxLength) return title;
  return title.slice(0, maxLength - 1) + "…";
}
const TRAY_MAX_TASKS = 15;
const STATUS_ICONS = {
  not_started: "○",
  in_progress: "◑",
  done: "●"
};
function classifyMyDayTasks(tasks, getStatus) {
  const notStarted = [];
  const inProgress = [];
  for (const task of tasks) {
    if (task.parent_id) continue;
    const bucket = getBucketForStatus(getStatus(task.status_id));
    if (bucket === "done") continue;
    if (bucket === "in_progress") {
      inProgress.push(task);
    } else {
      notStarted.push(task);
    }
  }
  const totalNonDone = notStarted.length + inProgress.length;
  const ordered = [
    ...notStarted.map((t) => ({ id: t.id, title: t.title, bucket: "not_started" })),
    ...inProgress.map((t) => ({ id: t.id, title: t.title, bucket: "in_progress" }))
  ].slice(0, TRAY_MAX_TASKS);
  return { tasks: ordered, totalNonDone };
}
let tray = null;
let currentUserId = null;
let timerState = null;
function getMyDayTrayData() {
  if (!currentUserId) return { tasks: [], totalNonDone: 0 };
  const db2 = getDatabase();
  const taskRepo = new TaskRepository(db2);
  const statusRepo = new StatusRepository(db2);
  const allMyDayTasks = taskRepo.findMyDay(currentUserId);
  const statusCache = {};
  const getStatus = (statusId) => {
    if (!statusCache[statusId]) {
      const s = statusRepo.findById(statusId);
      if (s) statusCache[statusId] = s;
    }
    return statusCache[statusId];
  };
  return classifyMyDayTasks(allMyDayTasks, getStatus);
}
function showMainWindow() {
  const mainWindow2 = getMainWindow();
  if (mainWindow2 && !mainWindow2.isDestroyed()) {
    mainWindow2.show();
    mainWindow2.focus();
  }
}
function navigateToTask(taskId) {
  const mainWindow2 = getMainWindow();
  if (mainWindow2 && !mainWindow2.isDestroyed()) {
    mainWindow2.show();
    mainWindow2.focus();
    mainWindow2.webContents.send("tray:navigate-to-task", taskId);
  }
}
function formatTimerDisplay(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function formatCookieDisplay(seconds) {
  const abs = Math.abs(Math.floor(seconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const prefix = seconds < 0 ? "-" : "";
  return `${prefix}${m}:${s.toString().padStart(2, "0")}`;
}
function sendToRenderer(channel) {
  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel);
    }
  }
}
function buildTimerMenu() {
  if (!timerState) return buildLeftClickMenu();
  const menuItems = [];
  menuItems.push({
    label: truncateTitle(timerState.taskTitle),
    enabled: false
  });
  menuItems.push({ type: "separator" });
  if (timerState.isCookieBreakPhase) {
    menuItems.push({
      label: `🍪 Cookie Time: ${formatCookieDisplay(timerState.cookiePoolSeconds)}`,
      click: () => {
        sendToRenderer("timer:backToWork");
      }
    });
  } else if (timerState.isFlowtime && timerState.cookiePoolSeconds > 0) {
    menuItems.push({
      label: `🍪 Cookie Time: ${formatCookieDisplay(timerState.cookiePoolSeconds)}`,
      click: () => {
        sendToRenderer("timer:cookieBreak");
      }
    });
  } else if (timerState.isFlowtime) {
    menuItems.push({
      label: `🍪 Cookies: ${formatCookieDisplay(timerState.cookiePoolSeconds)}`,
      enabled: false
    });
  }
  menuItems.push({
    label: "Stop",
    click: () => {
      sendToRenderer("timer:stop");
    }
  });
  menuItems.push({ type: "separator" });
  menuItems.push({
    label: "Open ToDoozy",
    click: () => showMainWindow()
  });
  return electron.Menu.buildFromTemplate(menuItems);
}
function buildLeftClickMenu() {
  const { tasks, totalNonDone } = getMyDayTrayData();
  const menuItems = [];
  menuItems.push({
    label: "Quick Add Task",
    click: () => {
      showQuickAddWindow();
    }
  });
  menuItems.push({ type: "separator" });
  if (tasks.length === 0) {
    menuItems.push({
      label: "No tasks for today",
      enabled: false
    });
  } else {
    if (totalNonDone > tasks.length) {
      menuItems.push({
        label: `Tasks: [${tasks.length}/${totalNonDone}]`,
        enabled: false
      });
    }
    let prevBucket = null;
    for (const task of tasks) {
      if (prevBucket && prevBucket !== task.bucket) {
        menuItems.push({ type: "separator" });
      }
      prevBucket = task.bucket;
      const icon = STATUS_ICONS[task.bucket];
      menuItems.push({
        label: `${icon} ${truncateTitle(task.title)}`,
        click: () => navigateToTask(task.id)
      });
    }
    menuItems.push({ type: "separator" });
    menuItems.push({
      label: "Open My Day",
      click: () => {
        showMainWindow();
        const mainWindow2 = getMainWindow();
        if (mainWindow2 && !mainWindow2.isDestroyed()) {
          mainWindow2.webContents.send("tray:navigate-to-myday");
        }
      }
    });
  }
  return electron.Menu.buildFromTemplate(menuItems);
}
function buildRightClickMenu() {
  return electron.Menu.buildFromTemplate([
    {
      label: "Open ToDoozy",
      click: () => showMainWindow()
    },
    {
      label: "Add Task",
      click: () => showQuickAddWindow()
    },
    { type: "separator" },
    {
      label: "Quit ToDoozy",
      click: () => {
        electron.app.quit();
      }
    }
  ]);
}
function getResourcePath(filename) {
  if (electron.app.isPackaged) {
    return path.join(process.resourcesPath, filename);
  }
  return path.join(__dirname, "../../resources", filename);
}
function createTray() {
  const iconPath = getResourcePath("iconTemplate.png");
  const icon = electron.nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new electron.Tray(icon);
  tray.setToolTip("ToDoozy");
  let clickTimer = null;
  tray.on("click", () => {
    if (clickTimer) return;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      if (!tray) return;
      const menu = timerState ? buildTimerMenu() : buildLeftClickMenu();
      tray.popUpContextMenu(menu);
    }, 150);
  });
  tray.on("double-click", () => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    showMainWindow();
  });
  tray.on("right-click", () => {
    if (!tray) return;
    const menu = buildRightClickMenu();
    tray.popUpContextMenu(menu);
  });
  updateTrayBadge();
}
function updateTrayBadge() {
  if (!tray) return;
  if (timerState) {
    let displaySeconds;
    let phaseIcon;
    if (timerState.isCookieBreakPhase) {
      displaySeconds = timerState.cookiePoolSeconds;
      phaseIcon = "🍪";
    } else if (timerState.isFlowtime && timerState.phase === "work") {
      displaySeconds = timerState.elapsedSeconds;
      phaseIcon = "🌊";
    } else if (timerState.phase === "break") {
      displaySeconds = timerState.remainingSeconds;
      phaseIcon = timerState.isLongBreak ? "🧘" : "☕";
    } else {
      displaySeconds = timerState.remainingSeconds;
      phaseIcon = "⏱";
    }
    const timeStr = timerState.isCookieBreakPhase ? formatCookieDisplay(displaySeconds) : formatTimerDisplay(displaySeconds);
    const repStr = timerState.isPerpetual ? ` ${timerState.currentRep}` : timerState.totalReps > 1 ? ` ${timerState.currentRep}/${timerState.totalReps}` : "";
    tray.setTitle(`${phaseIcon} ${timeStr}${repStr}`);
  } else {
    try {
      const { totalNonDone } = getMyDayTrayData();
      tray.setTitle(totalNonDone > 0 ? `[${totalNonDone}]` : "");
    } catch {
    }
  }
}
function setTrayUserId(userId) {
  currentUserId = userId;
  updateTrayBadge();
}
function refreshTray() {
  updateTrayBadge();
}
function setTimerState(state) {
  timerState = state;
  updateTrayBadge();
}
function clearTimerState() {
  timerState = null;
  updateTrayBadge();
}
function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
let repos = null;
function getRepos() {
  if (!repos) {
    repos = createRepositories(getDatabase());
  }
  return repos;
}
const getTokenPath = () => {
  const suffix = is.dev ? ".dev" : "";
  return path.join(electron.app.getPath("userData"), `.auth-session${suffix}`);
};
function storeEncryptedSession(sessionJson) {
  if (electron.safeStorage.isEncryptionAvailable()) {
    const encrypted = electron.safeStorage.encryptString(sessionJson);
    fs.writeFileSync(getTokenPath(), encrypted);
  } else {
    fs.writeFileSync(getTokenPath(), sessionJson, "utf-8");
  }
}
function getEncryptedSession() {
  const tokenPath = getTokenPath();
  if (!fs.existsSync(tokenPath)) return null;
  try {
    const data = fs.readFileSync(tokenPath);
    if (electron.safeStorage.isEncryptionAvailable()) {
      return electron.safeStorage.decryptString(data);
    }
    return data.toString("utf-8");
  } catch (err) {
    console.error("Failed to read stored session:", err);
    return null;
  }
}
function clearEncryptedSession() {
  const tokenPath = getTokenPath();
  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
  }
}
function registerAuthHandlers() {
  electron.ipcMain.handle("auth:storeSession", (_e, sessionJson) => {
    storeEncryptedSession(sessionJson);
  });
  electron.ipcMain.handle("auth:getSession", () => {
    return getEncryptedSession();
  });
  electron.ipcMain.handle("auth:clearSession", () => {
    clearEncryptedSession();
  });
  electron.ipcMain.handle("auth:switchDatabase", (_e, userId, email) => {
    switchDatabase(userId, email);
    repos = null;
  });
  electron.ipcMain.handle("auth:getSupabaseConfig", () => {
    return {
      url: "https://znmgsyjkaftbnhtlcxrm.supabase.co",
      anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpubWdzeWprYWZ0Ym5odGxjeHJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MjA2MTUsImV4cCI6MjA4OTM5NjYxNX0.FzDK5NRvauwrwgM7oaMqZqosYaY2nSeBlFsSQfzoDM0"
    };
  });
  electron.ipcMain.handle("auth:openOAuthWindow", async (_e, url) => {
    return new Promise((resolve) => {
      const authWindow = new electron.BrowserWindow({
        width: 500,
        height: 700,
        show: true,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      let resolved = false;
      const handleNavigation = async (navUrl) => {
        if (resolved) return;
        if (navUrl.includes("code=") || navUrl.includes("access_token=")) {
          resolved = true;
          try {
            const fullUrl = await authWindow.webContents.executeJavaScript(
              "window.location.href"
            );
            resolve(fullUrl);
          } catch {
            resolve(navUrl);
          }
          authWindow.close();
        }
      };
      authWindow.webContents.on("will-navigate", (_event, navUrl) => {
        handleNavigation(navUrl);
      });
      authWindow.webContents.on("did-navigate", (_event, navUrl) => {
        handleNavigation(navUrl);
      });
      authWindow.webContents.on("will-redirect", (_event, navUrl) => {
        handleNavigation(navUrl);
      });
      authWindow.on("closed", () => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      });
      authWindow.loadURL(url);
    });
  });
}
function registerIpcHandlers() {
  registerAuthHandlers();
  electron.ipcMain.handle("tasks:findById", (_e, id) => {
    return getRepos().tasks.findById(id) ?? null;
  });
  electron.ipcMain.handle("tasks:findByProjectId", (_e, projectId) => {
    return getRepos().tasks.findByProjectId(projectId);
  });
  electron.ipcMain.handle("tasks:findByStatusId", (_e, statusId) => {
    return getRepos().tasks.findByStatusId(statusId);
  });
  electron.ipcMain.handle("tasks:findMyDay", (_e, userId) => {
    return getRepos().tasks.findMyDay(userId);
  });
  electron.ipcMain.handle("tasks:autoAddMyDay", (_e, userId, mode) => {
    return getRepos().tasks.autoAddMyDayTasks(userId, mode);
  });
  electron.ipcMain.handle("tasks:findArchived", (_e, projectId) => {
    return getRepos().tasks.findArchived(projectId);
  });
  electron.ipcMain.handle("tasks:findTemplates", (_e, projectId) => {
    return getRepos().tasks.findTemplates(projectId);
  });
  electron.ipcMain.handle("tasks:findSubtasks", (_e, parentId) => {
    return getRepos().tasks.findSubtasks(parentId);
  });
  electron.ipcMain.handle("tasks:getSubtaskCount", (_e, parentId) => {
    return getRepos().tasks.getSubtaskCount(parentId);
  });
  electron.ipcMain.handle("tasks:create", (_e, input) => {
    return getRepos().tasks.create(input);
  });
  electron.ipcMain.handle(
    "tasks:update",
    (_e, id, input) => {
      return getRepos().tasks.update(id, input) ?? null;
    }
  );
  electron.ipcMain.handle("tasks:delete", (_e, id) => {
    return getRepos().tasks.delete(id);
  });
  electron.ipcMain.handle("tasks:reorder", (_e, taskIds) => {
    return getRepos().tasks.reorder(taskIds);
  });
  electron.ipcMain.handle("tasks:addLabel", (_e, taskId, labelId) => {
    return getRepos().tasks.addLabel(taskId, labelId);
  });
  electron.ipcMain.handle("tasks:removeLabel", (_e, taskId, labelId) => {
    return getRepos().tasks.removeLabel(taskId, labelId);
  });
  electron.ipcMain.handle("tasks:getLabels", (_e, taskId) => {
    return getRepos().tasks.getLabels(taskId);
  });
  electron.ipcMain.handle("tasks:duplicate", (_e, id, newId) => {
    return getRepos().tasks.duplicate(id, newId) ?? null;
  });
  electron.ipcMain.handle("tasks:findAllTemplates", (_e, userId) => {
    return getRepos().tasks.findAllTemplates(userId);
  });
  electron.ipcMain.handle("tasks:saveAsTemplate", (_e, id, newId) => {
    return getRepos().tasks.saveAsTemplate(id, newId) ?? null;
  });
  electron.ipcMain.handle("tasks:completeRecurring", (_e, taskId) => {
    return getRepos().tasks.completeRecurringTask(taskId);
  });
  electron.ipcMain.handle("labels:findById", (_e, id) => {
    return getRepos().labels.findById(id) ?? null;
  });
  electron.ipcMain.handle("labels:findByIds", (_e, ids) => {
    return getRepos().labels.findByIds(ids);
  });
  electron.ipcMain.handle("labels:findAll", (_e, userId) => {
    return getRepos().labels.findAllForUser(userId);
  });
  electron.ipcMain.handle("labels:findByProjectId", (_e, projectId) => {
    return getRepos().labels.findByProjectId(projectId);
  });
  electron.ipcMain.handle("labels:findByName", (_e, userId, name) => {
    return getRepos().labels.findByName(userId, name) ?? null;
  });
  electron.ipcMain.handle(
    "labels:create",
    (_e, input) => {
      return getRepos().labels.create(input);
    }
  );
  electron.ipcMain.handle(
    "labels:update",
    (_e, id, input) => {
      return getRepos().labels.update(id, input) ?? null;
    }
  );
  electron.ipcMain.handle("labels:delete", (_e, id) => {
    return getRepos().labels.delete(id);
  });
  electron.ipcMain.handle("labels:removeFromProject", (_e, projectId, labelId) => {
    return getRepos().labels.removeFromProject(projectId, labelId);
  });
  electron.ipcMain.handle("labels:addToProject", (_e, projectId, labelId) => {
    return getRepos().labels.addToProject(projectId, labelId);
  });
  electron.ipcMain.handle("labels:findByTaskId", (_e, taskId) => {
    return getRepos().labels.findByTaskId(taskId);
  });
  electron.ipcMain.handle("labels:findTaskLabelsByProject", (_e, projectId) => {
    return getRepos().labels.findTaskLabelsByProject(projectId);
  });
  electron.ipcMain.handle("labels:reorder", (_e, labelIds) => {
    return getRepos().labels.reorder(labelIds);
  });
  electron.ipcMain.handle("labels:findAllWithUsage", (_e, userId) => {
    return getRepos().labels.findAllWithUsage(userId);
  });
  electron.ipcMain.handle("labels:findProjectsUsingLabel", (_e, userId, labelId) => {
    return getRepos().labels.findProjectsUsingLabel(userId, labelId);
  });
  electron.ipcMain.handle("labels:findActiveLabelsForProject", (_e, projectId) => {
    return getRepos().labels.findActiveLabelsForProject(projectId);
  });
  electron.ipcMain.handle("projects:findById", (_e, id) => {
    return getRepos().projects.findById(id) ?? null;
  });
  electron.ipcMain.handle("projects:findByOwnerId", (_e, ownerId) => {
    return getRepos().projects.findByOwnerId(ownerId);
  });
  electron.ipcMain.handle("projects:findDefault", (_e, ownerId) => {
    return getRepos().projects.findDefault(ownerId) ?? null;
  });
  electron.ipcMain.handle(
    "projects:create",
    (_e, input) => {
      return getRepos().projects.create(input);
    }
  );
  electron.ipcMain.handle(
    "projects:update",
    (_e, id, input) => {
      return getRepos().projects.update(id, input) ?? null;
    }
  );
  electron.ipcMain.handle("projects:delete", (_e, id) => {
    return getRepos().projects.delete(id);
  });
  electron.ipcMain.handle("projects:list", (_e, userId) => {
    return getRepos().projects.getProjectsForUser(userId);
  });
  electron.ipcMain.handle(
    "projects:addMember",
    (_e, projectId, userId, role, invitedBy) => {
      return getRepos().projects.addMember(projectId, userId, role, invitedBy);
    }
  );
  electron.ipcMain.handle("projects:removeMember", (_e, projectId, userId) => {
    return getRepos().projects.removeMember(projectId, userId);
  });
  electron.ipcMain.handle("projects:updateMember", (_e, projectId, userId, updates) => {
    return getRepos().projects.updateMember(projectId, userId, updates);
  });
  electron.ipcMain.handle("projects:getMembers", (_e, projectId) => {
    return getRepos().projects.getMembers(projectId);
  });
  electron.ipcMain.handle("projects:getProjectsForUser", (_e, userId) => {
    return getRepos().projects.getProjectsForUser(userId);
  });
  electron.ipcMain.handle(
    "projects:updateSidebarOrder",
    (_e, updates) => {
      return getRepos().projects.updateSidebarOrder(updates);
    }
  );
  electron.ipcMain.handle("statuses:findById", (_e, id) => {
    return getRepos().statuses.findById(id) ?? null;
  });
  electron.ipcMain.handle("statuses:findByProjectId", (_e, projectId) => {
    return getRepos().statuses.findByProjectId(projectId);
  });
  electron.ipcMain.handle("statuses:findDefault", (_e, projectId) => {
    return getRepos().statuses.findDefault(projectId) ?? null;
  });
  electron.ipcMain.handle("statuses:findDone", (_e, projectId) => {
    return getRepos().statuses.findDone(projectId) ?? null;
  });
  electron.ipcMain.handle(
    "statuses:create",
    (_e, input) => {
      return getRepos().statuses.create(input);
    }
  );
  electron.ipcMain.handle(
    "statuses:update",
    (_e, id, input) => {
      return getRepos().statuses.update(id, input) ?? null;
    }
  );
  electron.ipcMain.handle("statuses:delete", (_e, id) => {
    return getRepos().statuses.delete(id);
  });
  electron.ipcMain.handle(
    "statuses:reassignAndDelete",
    (_e, statusId, targetStatusId) => {
      return getRepos().statuses.reassignAndDelete(statusId, targetStatusId);
    }
  );
  electron.ipcMain.handle("users:findById", (_e, id) => {
    return getRepos().users.findById(id) ?? null;
  });
  electron.ipcMain.handle("users:findByEmail", (_e, email) => {
    return getRepos().users.findByEmail(email) ?? null;
  });
  electron.ipcMain.handle("users:create", (_e, input) => {
    return getRepos().users.create(input);
  });
  electron.ipcMain.handle(
    "users:update",
    (_e, id, input) => {
      return getRepos().users.update(id, input) ?? null;
    }
  );
  electron.ipcMain.handle("users:delete", (_e, id) => {
    return getRepos().users.delete(id);
  });
  electron.ipcMain.handle("users:list", () => {
    return getRepos().users.list();
  });
  electron.ipcMain.handle("activityLog:findById", (_e, id) => {
    return getRepos().activityLog.findById(id) ?? null;
  });
  electron.ipcMain.handle("activityLog:findByTaskId", (_e, taskId) => {
    return getRepos().activityLog.findByTaskId(taskId);
  });
  electron.ipcMain.handle("activityLog:findByUserId", (_e, userId) => {
    return getRepos().activityLog.findByUserId(userId);
  });
  electron.ipcMain.handle(
    "activityLog:create",
    (_e, input) => {
      return getRepos().activityLog.create(input);
    }
  );
  electron.ipcMain.handle("activityLog:deleteByTaskId", (_e, taskId) => {
    return getRepos().activityLog.deleteByTaskId(taskId);
  });
  electron.ipcMain.handle("activityLog:getRecent", (_e, userId, limit) => {
    return getRepos().activityLog.getRecent(userId, limit);
  });
  electron.ipcMain.handle("settings:get", (_e, userId, key) => {
    return getRepos().settings.get(userId, key);
  });
  electron.ipcMain.handle("settings:set", (_e, userId, key, value) => {
    return getRepos().settings.set(userId, key, value);
  });
  electron.ipcMain.handle("settings:getAll", (_e, userId) => {
    return getRepos().settings.getAll(userId);
  });
  electron.ipcMain.handle(
    "settings:getMultiple",
    (_e, userId, keys) => {
      return getRepos().settings.getMultiple(userId, keys);
    }
  );
  electron.ipcMain.handle(
    "settings:setMultiple",
    (_e, userId, settings) => {
      return getRepos().settings.setMultiple(userId, settings);
    }
  );
  electron.ipcMain.handle("settings:delete", (_e, userId, key) => {
    return getRepos().settings.delete(userId, key);
  });
  electron.ipcMain.handle("themes:findById", (_e, id) => {
    return getRepos().themes.findById(id) ?? null;
  });
  electron.ipcMain.handle("themes:list", (_e, userId) => {
    return getRepos().themes.list(userId);
  });
  electron.ipcMain.handle("themes:listByMode", (_e, mode, userId) => {
    return getRepos().themes.listByMode(mode, userId);
  });
  electron.ipcMain.handle(
    "themes:create",
    (_e, input) => {
      return getRepos().themes.create(input);
    }
  );
  electron.ipcMain.handle(
    "themes:update",
    (_e, id, input) => {
      return getRepos().themes.update(id, input) ?? null;
    }
  );
  electron.ipcMain.handle("themes:delete", (_e, id) => {
    return getRepos().themes.delete(id);
  });
  electron.ipcMain.handle("themes:getConfig", (_e, id) => {
    return getRepos().themes.getConfig(id) ?? null;
  });
  electron.ipcMain.handle("projectTemplates:findById", (_e, id) => {
    return getRepos().projectTemplates.findById(id) ?? null;
  });
  electron.ipcMain.handle("projectTemplates:findByOwnerId", (_e, ownerId) => {
    return getRepos().projectTemplates.findByOwnerId(ownerId);
  });
  electron.ipcMain.handle("projectTemplates:findAll", (_e, userId) => {
    return getRepos().projectTemplates.findByOwnerId(userId);
  });
  electron.ipcMain.handle(
    "projectTemplates:create",
    (_e, input) => {
      return getRepos().projectTemplates.create(input);
    }
  );
  electron.ipcMain.handle(
    "projectTemplates:update",
    (_e, id, input) => {
      return getRepos().projectTemplates.update(id, input) ?? null;
    }
  );
  electron.ipcMain.handle("projectTemplates:delete", (_e, id) => {
    return getRepos().projectTemplates.delete(id);
  });
  electron.ipcMain.handle("quickadd:hide", () => {
    hideQuickAddWindow();
  });
  electron.ipcMain.handle("quickadd:notifyTaskCreated", (event) => {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents !== event.sender) {
        win.webContents.send("tasks-changed");
      }
    }
  });
  electron.ipcMain.handle(
    "quickadd:updateShortcut",
    (_e, accelerator) => {
      const reservedBy = getReservedShortcutName(accelerator);
      if (reservedBy) {
        return {
          success: false,
          error: `This shortcut is reserved by macOS (${reservedBy}) and can't be used.`,
          reservedBy
        };
      }
      const result = registerQuickAddShortcut(accelerator);
      if (result.success) {
        getRepos().settings.set("", "quick_add_shortcut", accelerator);
      }
      return result;
    }
  );
  electron.ipcMain.handle(
    "app-toggle:updateShortcut",
    (_e, accelerator) => {
      const reservedBy = getReservedShortcutName(accelerator);
      if (reservedBy) {
        return {
          success: false,
          error: `This shortcut is reserved by macOS (${reservedBy}) and can't be used.`,
          reservedBy
        };
      }
      const result = registerAppToggleShortcut(accelerator);
      if (result.success) {
        getRepos().settings.set("", "app_toggle_shortcut", accelerator);
      }
      return result;
    }
  );
  electron.ipcMain.handle("tray:setUserId", (_e, userId) => {
    setTrayUserId(userId);
  });
  electron.ipcMain.handle("tray:refresh", () => {
    refreshTray();
  });
  electron.ipcMain.handle("timer:updateTimer", (_e, state) => {
    setTimerState(state);
  });
  electron.ipcMain.handle("timer:clearTimer", () => {
    clearTimerState();
  });
  electron.ipcMain.handle("timer:minimizeToTray", () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.hide();
    }
  });
  electron.ipcMain.handle("timer:navigateToTask", (_e, taskId) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      win.webContents.send("tray:navigate-to-task", taskId);
    }
  });
  electron.ipcMain.handle("attachments:findByTaskId", (_e, taskId) => {
    return getRepos().attachments.findByTaskId(taskId);
  });
  electron.ipcMain.handle("attachments:createFromFile", (_e, taskId, filePath) => {
    const fileData = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);
    const filename = path.basename(filePath);
    const ext = path.extname(filename);
    return getRepos().attachments.create({
      id: crypto.randomUUID(),
      task_id: taskId,
      filename,
      mime_type: getMimeType(ext),
      size_bytes: stat.size,
      file_data: fileData
    });
  });
  electron.ipcMain.handle("attachments:open", async (_e, id) => {
    const data = getRepos().attachments.getFileData(id);
    if (!data) return;
    const tmpPath = path.join(electron.app.getPath("temp"), data.filename);
    fs.writeFileSync(tmpPath, data.file_data);
    await electron.shell.openPath(tmpPath);
  });
  electron.ipcMain.handle("attachments:delete", (_e, id) => {
    return getRepos().attachments.delete(id);
  });
  electron.ipcMain.handle("shell:openExternal", (_e, url) => {
    return electron.shell.openExternal(url);
  });
  electron.ipcMain.handle("app:getLoginItemSettings", () => {
    return electron.app.getLoginItemSettings();
  });
  electron.ipcMain.handle("app:setLoginItemSettings", (_e, openAtLogin) => {
    electron.app.setLoginItemSettings({ openAtLogin });
  });
  electron.ipcMain.handle("app:getDatabasePath", () => {
    return getDatabasePath();
  });
  electron.ipcMain.handle("app:getChangelog", async () => {
    try {
      const { syncReleaseNotes: syncReleaseNotes2 } = await Promise.resolve().then(() => ReleaseNotesService);
      await syncReleaseNotes2();
    } catch {
    }
    try {
      return getRepos().settings.get("", "whats_new") ?? "";
    } catch {
      return "";
    }
  });
  electron.ipcMain.handle("notifications:findAll", (_e, limit) => {
    return getRepos().notifications.findAll(limit);
  });
  electron.ipcMain.handle("notifications:findUnread", () => {
    return getRepos().notifications.findUnread();
  });
  electron.ipcMain.handle("notifications:getUnreadCount", () => {
    return getRepos().notifications.getUnreadCount();
  });
  electron.ipcMain.handle(
    "notifications:create",
    (_e, input) => {
      return getRepos().notifications.create(input);
    }
  );
  electron.ipcMain.handle("notifications:markAsRead", (_e, id) => {
    return getRepos().notifications.markAsRead(id);
  });
  electron.ipcMain.handle("notifications:markAllAsRead", () => {
    return getRepos().notifications.markAllAsRead();
  });
  electron.ipcMain.handle("notifications:deleteNotification", (_e, id) => {
    return getRepos().notifications.delete(id);
  });
  electron.ipcMain.handle("sync:getQueue", () => {
    return getRepos().syncQueue.findAll();
  });
  electron.ipcMain.handle("sync:enqueue", (_e, tableName, rowId, operation, payload) => {
    return getRepos().syncQueue.enqueue(tableName, rowId, operation, payload);
  });
  electron.ipcMain.handle("sync:dequeue", (_e, id) => {
    return getRepos().syncQueue.dequeue(id);
  });
  electron.ipcMain.handle("sync:clear", () => {
    return getRepos().syncQueue.clear();
  });
  electron.ipcMain.handle("sync:count", () => {
    return getRepos().syncQueue.count();
  });
  electron.ipcMain.handle("projectAreas:findByUserId", (_e, userId) => {
    return getRepos().projectAreas.findByUserId(userId);
  });
  electron.ipcMain.handle("projectAreas:create", (_e, input) => {
    return getRepos().projectAreas.create(input);
  });
  electron.ipcMain.handle("projectAreas:update", (_e, id, input) => {
    return getRepos().projectAreas.update(id, input);
  });
  electron.ipcMain.handle("projectAreas:delete", (_e, id) => {
    return getRepos().projectAreas.delete(id);
  });
  electron.ipcMain.handle("projectAreas:reorder", (_e, areaIds) => {
    return getRepos().projectAreas.reorder(areaIds);
  });
  electron.ipcMain.handle("projectAreas:assignProject", (_e, projectId, areaId) => {
    return getRepos().projectAreas.assignProject(projectId, areaId);
  });
  electron.ipcMain.handle("stats:completions", (_e, userId, projectIds, startDate, endDate) => {
    return getRepos().tasks.getCompletionStats(userId, projectIds, startDate, endDate);
  });
  electron.ipcMain.handle("stats:streaks", (_e, userId) => {
    return getRepos().tasks.getStreakStats(userId);
  });
  electron.ipcMain.handle("stats:focus", (_e, userId, projectIds, startDate, endDate) => {
    return getRepos().activityLog.getFocusStats(userId, projectIds?.[0] ?? null, startDate, endDate);
  });
  electron.ipcMain.handle("stats:heatmap", (_e, userId, startDate, endDate) => {
    return getRepos().activityLog.getActivityHeatmap(userId, startDate, endDate);
  });
  electron.ipcMain.handle("stats:focusTaskList", (_e, userId, startDate, endDate, projectIds) => {
    return getRepos().activityLog.getFocusTaskList(userId, startDate, endDate, projectIds);
  });
  electron.ipcMain.handle("stats:taskList", (_e, userId, filter, projectIds, startDate, endDate) => {
    return getRepos().tasks.getStatsTaskList(userId, filter, projectIds, startDate, endDate);
  });
  electron.ipcMain.handle("stats:summary", (_e, userId, projectIds) => {
    return getRepos().tasks.getTaskSummaryStats(userId, projectIds);
  });
  electron.ipcMain.handle("stats:priorityBreakdown", (_e, userId, projectIds) => {
    return getRepos().tasks.getPriorityBreakdown(userId, projectIds);
  });
  electron.ipcMain.handle("stats:completionsByDayOfWeek", (_e, userId, projectIds, startDate, endDate) => {
    return getRepos().tasks.getCompletionsByDayOfWeek(userId, projectIds, startDate, endDate);
  });
  electron.ipcMain.handle("stats:projectBreakdown", (_e, userId) => {
    return getRepos().tasks.getProjectBreakdown(userId);
  });
  electron.ipcMain.handle("stats:cookieBalance", (_e, userId, startDate, endDate) => {
    return getRepos().activityLog.getCookieStats(userId, startDate, endDate);
  });
  electron.ipcMain.handle("savedViews:findById", (_e, id) => {
    return getRepos().savedViews.findById(id) ?? null;
  });
  electron.ipcMain.handle("savedViews:findByUserId", (_e, userId) => {
    return getRepos().savedViews.findByUserId(userId);
  });
  electron.ipcMain.handle("savedViews:create", (_e, input) => {
    return getRepos().savedViews.create(input);
  });
  electron.ipcMain.handle("savedViews:update", (_e, id, input) => {
    return getRepos().savedViews.update(id, input);
  });
  electron.ipcMain.handle("savedViews:delete", (_e, id) => {
    return getRepos().savedViews.delete(id);
  });
  electron.ipcMain.handle("savedViews:reorder", (_e, viewIds) => {
    return getRepos().savedViews.reorder(viewIds);
  });
  electron.ipcMain.handle("savedViews:countMatching", (_e, filterConfig, userId) => {
    return getRepos().savedViews.countMatchingTasks(filterConfig, userId);
  });
  electron.ipcMain.handle("releaseNotes:sync", async () => {
    const { syncReleaseNotes: syncReleaseNotes2 } = await Promise.resolve().then(() => ReleaseNotesService);
    return syncReleaseNotes2();
  });
  electron.ipcMain.handle("releaseNotes:fetchVersion", async (_e, version) => {
    const { fetchVersionNotes: fetchVersionNotes2 } = await Promise.resolve().then(() => ReleaseNotesService);
    return fetchVersionNotes2(version);
  });
  electron.ipcMain.handle("fs:showOpenDialog", async () => {
    const win = getMainWindow();
    if (!win) return { canceled: true, filePaths: [] };
    const result = await electron.dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
      title: "Select files to attach"
    });
    return result;
  });
}
function getMimeType(ext) {
  const map = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tar": "application/x-tar",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".ts": "application/typescript",
    ".md": "text/markdown"
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}
const isDev = !electron.app.isPackaged;
const sentNotifications = /* @__PURE__ */ new Set();
let checkInterval = null;
function startNotificationChecker() {
  if (checkInterval) return;
  checkInterval = setInterval(() => {
    checkAndSendNotifications();
  }, 6e4);
  checkAndSendNotifications();
}
function stopNotificationChecker() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}
function checkAndSendNotifications() {
  try {
    const db2 = getDatabase();
    const repos2 = createRepositories(db2);
    const enabled = repos2.settings.get("", "notifications_enabled");
    if (enabled === "false") return;
    const leadTimeStr = repos2.settings.get("", "notifications_lead_time") ?? "15";
    const leadMinutes = parseInt(leadTimeStr, 10);
    if (isNaN(leadMinutes) || leadMinutes <= 0) return;
    const maxMinutes = Math.max(leadMinutes, 1) + 1;
    const upcomingTasks = repos2.tasks.findWithUpcomingDueTimes(maxMinutes);
    const now = Date.now();
    for (const task of upcomingTasks) {
      if (!task.due_date || !task.due_date.includes("T")) continue;
      const dueTime = new Date(task.due_date).getTime();
      if (isNaN(dueTime)) continue;
      const minutesUntilDue = Math.round((dueTime - now) / 6e4);
      if (minutesUntilDue <= leadMinutes && minutesUntilDue > 1) {
        sendNotification(task, minutesUntilDue, leadMinutes);
      }
      if (minutesUntilDue <= 1 && minutesUntilDue >= 0) {
        sendNotification(task, minutesUntilDue, 1);
      }
    }
  } catch (err) {
    console.error("Notification check failed:", err);
  }
}
function sendNotification(task, minutesUntilDue, leadKey) {
  const key = `${task.id}:${leadKey}`;
  if (sentNotifications.has(key)) return;
  sentNotifications.add(key);
  const body = minutesUntilDue <= 1 ? "Due in 1 minute" : `Due in ${minutesUntilDue} minutes`;
  if (isDev) {
    const escapedTitle = task.title.replace(/'/g, "'\\''");
    const escapedBody = body.replace(/'/g, "'\\''");
    try {
      child_process.execSync(`osascript -e 'display notification "${escapedBody}" with title "${escapedTitle}"'`);
    } catch {
    }
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("notification:navigate-to-task", task.id, task.project_id);
    }
  } else {
    const notification = new electron.Notification({
      title: task.title,
      body,
      silent: false
    });
    notification.on("click", () => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
        win.webContents.send("notification:navigate-to-task", task.id, task.project_id);
      }
    });
    notification.show();
  }
}
const SUPABASE_TABLE = "release_notes";
let supabase = null;
function getClient() {
  if (!supabase) {
    const url = "https://znmgsyjkaftbnhtlcxrm.supabase.co";
    const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpubWdzeWprYWZ0Ym5odGxjeHJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MjA2MTUsImV4cCI6MjA4OTM5NjYxNX0.FzDK5NRvauwrwgM7oaMqZqosYaY2nSeBlFsSQfzoDM0";
    supabase = supabaseJs.createClient(url, key);
  }
  return supabase;
}
function getSettings() {
  return new SettingsRepository(getDatabase());
}
async function syncReleaseNotes() {
  try {
    const client = getClient();
    const { data, error } = await client.from(SUPABASE_TABLE).select("version, content, published_at").order("published_at", { ascending: false });
    if (error) {
      console.error("[ReleaseNotes] Failed to fetch from Supabase:", error.message);
      return;
    }
    const releases = data;
    if (releases.length === 0) return;
    const markdown = releases.map((r) => `## ${r.version}
${r.content.trim()}`).join("\n\n");
    getSettings().set("", "whats_new", markdown);
  } catch (err) {
    console.error("[ReleaseNotes] Sync error:", err instanceof Error ? err.message : err);
  }
}
async function fetchVersionNotes(version) {
  try {
    const client = getClient();
    const versions = version.startsWith("v") ? [version, version.slice(1)] : [`v${version}`, version];
    for (const v of versions) {
      const { data, error } = await client.from(SUPABASE_TABLE).select("content").eq("version", v).single();
      if (!error && data) return data.content;
    }
    return null;
  } catch (err) {
    console.error("[ReleaseNotes] Failed to fetch version notes:", err instanceof Error ? err.message : err);
    return null;
  }
}
async function upsertReleaseNotes(version, content) {
  try {
    const client = getClient();
    const { error } = await client.from(SUPABASE_TABLE).upsert({ version, content, published_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "version" });
    if (error) {
      console.error("[ReleaseNotes] Failed to upsert:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[ReleaseNotes] Upsert error:", err instanceof Error ? err.message : err);
    return false;
  }
}
const ReleaseNotesService = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  fetchVersionNotes,
  syncReleaseNotes,
  upsertReleaseNotes
}, Symbol.toStringTag, { value: "Module" }));
let currentStatus = { state: "idle" };
let checkInProgress = false;
let dismissedVersion = null;
let periodicTimer = null;
let manualCheck = false;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1e3;
function broadcastStatus(status) {
  currentStatus = status;
  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("updater:status", status);
    }
  }
}
function extractReleaseNotes(info) {
  if (!info.releaseNotes) return "";
  if (typeof info.releaseNotes === "string") return info.releaseNotes;
  if (Array.isArray(info.releaseNotes)) {
    return info.releaseNotes.map((n) => typeof n === "string" ? n : n.note).join("\n\n");
  }
  return "";
}
function initUpdater() {
  electronUpdater.autoUpdater.autoDownload = false;
  electronUpdater.autoUpdater.autoInstallOnAppQuit = true;
  electronUpdater.autoUpdater.on("checking-for-update", () => {
    broadcastStatus({ state: "checking" });
  });
  electronUpdater.autoUpdater.on("update-available", (info) => {
    checkInProgress = false;
    const version = info.version;
    const ghReleaseNotes = extractReleaseNotes(info);
    if (dismissedVersion === version && !manualCheck) {
      broadcastStatus({ state: "idle" });
      return;
    }
    fetchVersionNotes(version).then((supabaseNotes) => {
      broadcastStatus({ state: "available", version, releaseNotes: supabaseNotes || ghReleaseNotes });
    }).catch(() => {
      broadcastStatus({ state: "available", version, releaseNotes: ghReleaseNotes });
    });
  });
  electronUpdater.autoUpdater.on("update-not-available", () => {
    checkInProgress = false;
    broadcastStatus({ state: "not-available" });
    setTimeout(() => {
      if (currentStatus.state === "not-available") {
        broadcastStatus({ state: "idle" });
      }
    }, 3e3);
  });
  electronUpdater.autoUpdater.on("download-progress", (progress) => {
    broadcastStatus({
      state: "downloading",
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond
    });
  });
  electronUpdater.autoUpdater.on("update-downloaded", (info) => {
    broadcastStatus({ state: "downloaded", version: info.version });
  });
  electronUpdater.autoUpdater.on("error", (err) => {
    checkInProgress = false;
    broadcastStatus({ state: "error", message: err.message });
  });
  electron.ipcMain.handle("updater:check", () => {
    manualCheck = true;
    return checkForUpdates();
  });
  electron.ipcMain.handle("updater:download", () => {
    electronUpdater.autoUpdater.downloadUpdate();
  });
  electron.ipcMain.handle("updater:install", () => {
    setQuitting();
    electronUpdater.autoUpdater.quitAndInstall(false, true);
  });
  electron.ipcMain.handle("updater:dismiss", (_e, version) => {
    dismissedVersion = version;
    broadcastStatus({ state: "idle" });
  });
  electron.ipcMain.handle("updater:getStatus", () => {
    return currentStatus;
  });
  electron.ipcMain.handle("updater:getVersion", () => {
    const { app } = require("electron");
    return app.getVersion();
  });
  setTimeout(() => {
    manualCheck = false;
    checkForUpdates();
  }, 5e3);
  periodicTimer = setInterval(() => {
    manualCheck = false;
    checkForUpdates();
  }, FOUR_HOURS_MS);
}
function checkForUpdates() {
  if (checkInProgress) return;
  checkInProgress = true;
  electronUpdater.autoUpdater.checkForUpdates().catch((err) => {
    checkInProgress = false;
    broadcastStatus({ state: "error", message: err.message });
  });
}
function stopUpdater() {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}
if (process.env.TODOOZY_USER_DATA) {
  electron.app.setPath("userData", process.env.TODOOZY_USER_DATA);
}
let mainWindow = null;
exports.isQuitting = false;
function setQuitting() {
  exports.isQuitting = true;
}
let currentShortcut = null;
let currentAppToggleShortcut = null;
function getMainWindow() {
  return mainWindow;
}
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon: electron.app.isPackaged ? path.join(process.resourcesPath, "icon.png") : path.join(__dirname, "../../resources/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      backgroundThrottling: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("close", (e) => {
    if (process.platform === "darwin" && !exports.isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
function hasAuthSession() {
  const tokenPath = path.join(electron.app.getPath("userData"), is.dev ? ".auth-session.dev" : ".auth-session");
  return fs.existsSync(tokenPath);
}
function registerQuickAddShortcut(accelerator) {
  if (currentShortcut) {
    electron.globalShortcut.unregister(currentShortcut);
    currentShortcut = null;
  }
  const shortcut = accelerator ?? DEFAULT_QUICK_ADD_SHORTCUT;
  try {
    const registered = electron.globalShortcut.register(shortcut, () => {
      if (!hasAuthSession()) return;
      showQuickAddWindow();
    });
    if (registered) {
      currentShortcut = shortcut;
      return { success: true };
    }
    return {
      success: false,
      error: `Shortcut "${shortcut}" is already in use by another application. Would you like to override it?`
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to register shortcut"
    };
  }
}
function loadAndRegisterShortcut() {
  try {
    const db2 = getDatabase();
    const settingsRepo = new SettingsRepository(db2);
    const savedShortcut = settingsRepo.get("", "quick_add_shortcut");
    registerQuickAddShortcut(savedShortcut ?? void 0);
  } catch (err) {
    console.error("Failed to load quick-add shortcut setting:", err);
    registerQuickAddShortcut();
  }
}
function registerAppToggleShortcut(accelerator) {
  if (currentAppToggleShortcut) {
    electron.globalShortcut.unregister(currentAppToggleShortcut);
    currentAppToggleShortcut = null;
  }
  const shortcut = accelerator ?? DEFAULT_APP_TOGGLE_SHORTCUT;
  try {
    const registered = electron.globalShortcut.register(shortcut, () => {
      if (!hasAuthSession()) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      }
    });
    if (registered) {
      currentAppToggleShortcut = shortcut;
      return { success: true };
    }
    return {
      success: false,
      error: `Shortcut "${shortcut}" is already in use by another application.`
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to register shortcut"
    };
  }
}
function loadAndRegisterAppToggleShortcut() {
  try {
    const db2 = getDatabase();
    const settingsRepo = new SettingsRepository(db2);
    const savedShortcut = settingsRepo.get("", "app_toggle_shortcut");
    registerAppToggleShortcut(savedShortcut ?? void 0);
  } catch (err) {
    console.error("Failed to load app-toggle shortcut setting:", err);
    registerAppToggleShortcut();
  }
}
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    electron.app.setAsDefaultProtocolClient("todoozy", process.execPath, [process.argv[1]]);
  }
} else {
  electron.app.setAsDefaultProtocolClient("todoozy");
}
let pendingInviteToken = null;
function handleDeepLink(url) {
  const match = url.match(/^todoozy:\/\/invite\/([a-f0-9-]+)$/i);
  if (match) {
    const token = match[1];
    const win = mainWindow ?? electron.BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      win.webContents.send("invite:received", token);
    } else {
      pendingInviteToken = token;
    }
  }
}
electron.app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});
electron.app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.todoozy");
  initDatabase();
  registerIpcHandlers();
  electron.app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });
  createWindow();
  createTray();
  loadAndRegisterShortcut();
  loadAndRegisterAppToggleShortcut();
  startNotificationChecker();
  initUpdater();
  const deepLinkUrl = process.argv.find((arg) => arg.startsWith("todoozy://"));
  if (deepLinkUrl) {
    setTimeout(() => handleDeepLink(deepLinkUrl), 1e3);
  }
  if (pendingInviteToken && mainWindow) {
    mainWindow.webContents.once("did-finish-load", () => {
      if (pendingInviteToken) {
        mainWindow?.webContents.send("invite:received", pendingInviteToken);
        pendingInviteToken = null;
      }
    });
  }
  let lastWalPath = getDatabasePath() + "-wal";
  let lastMtime = 0;
  try {
    const { statSync } = require("fs");
    lastMtime = statSync(lastWalPath).mtimeMs;
  } catch {
  }
  setInterval(() => {
    try {
      const walPath = getDatabasePath() + "-wal";
      if (walPath !== lastWalPath) {
        lastWalPath = walPath;
        lastMtime = 0;
      }
      const { statSync } = require("fs");
      const mtime = statSync(walPath).mtimeMs;
      if (mtime > lastMtime) {
        lastMtime = mtime;
        for (const win of electron.BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send("tasks-changed");
          }
        }
      }
    } catch {
    }
  }, 1e3);
  electron.app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    } else {
      createWindow();
    }
  });
});
electron.app.on("before-quit", () => {
  exports.isQuitting = true;
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("will-quit", () => {
  electron.globalShortcut.unregisterAll();
  stopNotificationChecker();
  stopUpdater();
  destroyTray();
  closeDatabase();
});
exports.getMainWindow = getMainWindow;
exports.registerAppToggleShortcut = registerAppToggleShortcut;
exports.registerQuickAddShortcut = registerQuickAddShortcut;
exports.setQuitting = setQuitting;
