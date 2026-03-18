# ToDoozy v2 — Complete Product Specification

> This document is a complete, self-contained specification for rebuilding ToDoozy from scratch.
> It is designed to be fed directly to Claude Code as an initial prompt to regenerate the entire application.
> Every feature is described in enough detail to implement without ambiguity.

---

## 1. Vision & Goals

ToDoozy is a **fast, keyboard-driven, beautifully minimal** task manager built with Electron. It is designed for power users who want a single app that handles daily planning, project organization, collaboration, and focused work sessions — without the bloat of enterprise tools.

**Core principles:**
- Speed over features. Every interaction should feel instant.
- Keyboard-first. Everything achievable without a mouse.
- Offline-first, sync-ready. Works fully offline with local SQLite. Syncs to the cloud when online for multi-device and collaboration.
- Multi-project. Organize work into separate projects (personal, work, team) with independent task lists, labels, and collaborators.
- Collaborative. Invite others by email to shared projects. Real-time updates when teammates make changes.
- Portable. The data model and API layer are designed so an iOS/iPadOS companion app can connect to the same backend with zero schema changes.
- AI-native. A built-in MCP server allows Claude (or any MCP client) to read, create, and manage tasks programmatically.

---

## 2. Branding

- **App name**: ToDoozy
- **Icon source**: `./ToDoozy.png` (in project root) — dark "TD" monogram with a checkmark integrated into the D, on a rounded square background. During scaffolding, copy this to `resources/icon.png` and generate platform-specific variants:
  - `resources/icon.png` — source (used by electron-builder)
  - `resources/icon.icns` — macOS (generate with `sips` or `iconutil`)
  - `resources/icon.ico` — Windows (generate with a converter)
  - Use in: Electron `icon` property, electron-builder.yml, tray icon, login screen, about screen.

---

## 3. Tech Stack

### Desktop App (Electron)
- **Runtime**: Electron + electron-vite
- **Frontend**: React 19 + TypeScript (strict mode, zero `any`) + Tailwind CSS 4
- **Database**: better-sqlite3 (synchronous, local, single file)
- **Drag & Drop**: @dnd-kit/core + @dnd-kit/sortable
- **Icons**: lucide-react
- **State**: Zustand for global state (tasks, settings, labels, theme) + React Context for UI-local state
- **IPC**: Typed preload bridge via electron contextBridge. Consider electron-trpc for type-safe RPC.

### Backend (Supabase)
- **Database**: PostgreSQL (hosted via Supabase) — same schema as local SQLite, mirrored
- **Auth**: Supabase Auth with email/password + Google OAuth
- **Real-time**: Supabase Realtime (Postgres changes broadcast via WebSocket) for live collaboration
- **Storage**: Supabase Storage for task images (replaces base64 in DB)
- **Edge Functions**: For invitation emails, notification dispatch, and MCP server (cloud mode)

### Data Layer (Dual-mode)
- **Local**: SQLite with versioned migrations for offline operation
- **Remote**: Supabase PostgreSQL for sync and collaboration
- **Repository pattern**: `TaskRepository`, `LabelRepository`, `ProjectRepository`, `SettingsRepository` — typed wrappers that abstract the storage backend. In offline mode, they hit SQLite. In online mode, they hit Supabase and sync back to local SQLite.
- **Sync strategy**: Offline-first. All writes go to local SQLite immediately. A background sync service pushes changes to Supabase when online. Conflicts resolved by `updated_at` last-write-wins. Supabase Realtime pushes remote changes to the local DB.

### MCP Server (Built-in)
- Runs as a local MCP server that Claude Desktop or any MCP client can connect to
- Exposes tools for: creating tasks, listing tasks, updating tasks, completing tasks, adding labels, querying by filter
- Uses the same repository layer as the IPC handlers — zero duplication

### Cross-Platform (Design for it now)
- All primary keys are UUIDs (no auto-increment)
- All timestamps are ISO 8601 UTC strings
- `updated_at` column on every table for sync conflict resolution
- `owner_id` and `project_id` on tasks/labels for multi-user scoping
- The repository layer is the sync boundary — iOS/iPadOS app connects to the same Supabase backend

---

## 4. Data Model

### 3.1 Users Table (Supabase-managed, mirrored locally)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- UUID (from Supabase Auth)
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### 3.2 Projects Table

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,              -- UUID
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#888888',     -- Project accent color
  icon TEXT DEFAULT 'folder',       -- Lucide icon name
  owner_id TEXT NOT NULL,           -- User who created the project
  is_default INTEGER DEFAULT 0,    -- Each user has one default "Personal" project
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(owner_id) REFERENCES users(id)
);
```

### 3.3 Project Members Table

```sql
CREATE TABLE project_members (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',       -- 'owner' | 'admin' | 'member' | 'viewer'
  invited_by TEXT,
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Roles:
- **owner**: Full control. Can delete project, manage members, change all settings.
- **admin**: Can manage members (except owner), edit all tasks, manage labels.
- **member**: Can create/edit/delete own tasks, complete any task, use labels.
- **viewer**: Read-only. Can view tasks but not modify anything.

### 3.4 Statuses Table

```sql
CREATE TABLE statuses (
  id TEXT PRIMARY KEY,              -- UUID
  project_id TEXT NOT NULL,         -- Statuses are per-project
  name TEXT NOT NULL,               -- Display name (e.g. "In Review")
  color TEXT DEFAULT '#888888',     -- Status color for kanban column headers and badges
  icon TEXT DEFAULT 'circle',       -- Lucide icon name
  order_index INTEGER DEFAULT 0,   -- Column order in kanban view
  is_done INTEGER DEFAULT 0,       -- Marks this as a "completion" status (triggers recurrence, auto-archive)
  is_default INTEGER DEFAULT 0,    -- New tasks get this status (one per project)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

Every project has its own set of statuses. On project creation, 3 defaults are seeded: "Not Started" (default, icon: circle), "In Progress" (icon: clock), "Done" (is_done: true, icon: check-circle). Users can add, rename, reorder, recolor, and delete statuses in Project Settings. Deleting a status requires reassigning its tasks to another status.

**Kanban columns map 1:1 to statuses.** Each status becomes a column. Dragging a task between columns changes its `status_id`. The column order matches `order_index`.

**Examples of custom workflows:**
- Software: Backlog → Design → Development → Review → QA → Done
- Content: Idea → Drafting → Editing → Published
- Personal: Not Started → In Progress → Done (default)

### 3.5 Tasks Table

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,              -- UUID
  project_id TEXT NOT NULL,         -- Every task belongs to a project
  owner_id TEXT NOT NULL,           -- User who created the task
  assigned_to TEXT,                 -- User the task is assigned to (optional)
  title TEXT NOT NULL,
  description TEXT,                 -- Markdown content
  status_id TEXT NOT NULL,          -- References statuses table (configurable per project)
  priority INTEGER DEFAULT 0,       -- 0=None, 1=Low, 2=Normal, 3=High, 4=Urgent
  due_date TEXT,                    -- ISO 8601 datetime (optional)
  parent_id TEXT,                   -- Subtask relationship (CASCADE delete)
  order_index INTEGER DEFAULT 0,
  is_in_my_day INTEGER DEFAULT 0,  -- Per-user (stored locally, not synced)
  is_template INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,   -- Separate from status (auto-archive or manual)
  completed_date TEXT,              -- Auto-set when status has is_done flag
  recurrence_rule TEXT,             -- JSON: {"type":"daily"|"weekly"|"monthly"|"custom","interval":N}
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(status_id) REFERENCES statuses(id),
  FOREIGN KEY(owner_id) REFERENCES users(id),
  FOREIGN KEY(assigned_to) REFERENCES users(id),
  FOREIGN KEY(parent_id) REFERENCES tasks(id) ON DELETE CASCADE
);
```

### 3.6 Labels Table

```sql
CREATE TABLE labels (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,         -- Labels are scoped to a project
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#888888',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

### 3.7 Task-Labels Junction

```sql
CREATE TABLE task_labels (
  task_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  PRIMARY KEY (task_id, label_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);
```

### 3.8 Themes Table

```sql
CREATE TABLE themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,          -- 'dark' | 'light'
  config TEXT NOT NULL,        -- JSON ThemeConfig
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### 3.9 Settings Table

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

### 3.10 Activity Log Table

```sql
CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,       -- Who performed the action
  action TEXT NOT NULL,        -- 'created' | 'status_changed' | 'priority_changed' | 'completed' | 'label_added' | 'label_removed' | 'title_changed' | 'due_date_changed' | 'recurrence_set' | 'assigned' | 'comment'
  old_value TEXT,
  new_value TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 3.11 Schema Version

```sql
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY
);
```

Migrations are numbered functions: `migration_1()`, `migration_2()`, etc. On startup, run all migrations with `version` > current. No more try/catch ALTER TABLE.

---

## 5. Views & Navigation

### 4.1 Sidebar

Collapsible (56px icon-only ↔ configurable 120–600px expanded). Pinnable — when unpinned, expands on hover. Smooth 200ms ease-out transition. Structure:

- **Header**: App logo (accent-colored dot) + name + pin button
- **Section: Views** — My Day, Backlog, Templates (with task count badges)
- **Divider**
- **Section**: Archive
- **Section: Smart Lists** — user-created saved filters (see §7)
- **Bottom bar**: Settings, Search (Cmd+K hint), Theme toggle (sun/moon)
- **Active state**: Accent-colored background + border. Collapsed: accent bar on right edge.

Keyboard: Cmd+1–4 jumps to views. Cmd+[ and Cmd+] navigate prev/next view.

### 4.2 My Day

Tasks where `is_in_my_day === 1` OR `due_date` is today. Grouped into sections by the project's configured statuses (e.g. To Do, In Progress, Completed for the default project). Add-task input at top. Label filter bar below header (shows labels used in this view).

### 4.3 Backlog

Everything not in My Day and not due today. Same section grouping by status.

### 4.4 Templates

Tasks where `is_template === 1`. Each template has a prominent **"Use Template"** button that deep-copies it (with subtasks and labels) into the Backlog. No template actions in the context menu — templates are managed only from this view.

### 4.5 Archive

Tasks that have been archived (auto-archived after completion, or manually archived). Archiving is a separate boolean flag (`is_archived`) on the task, independent of the configurable status system. Read-only browsing. Search/filter supported. List view only (no kanban).

### 4.6 Kanban Toggle (Cmd+L)

Available on My Day and Backlog. Toggles between list view and a kanban board. **Columns are generated from the project's statuses table** — each status becomes a column, ordered by `order_index`. Drag-and-drop between columns changes the task's `status_id`. Same task cards with priority, labels, due date, assignee avatar, and all interactions (click, right-click, hover preview).

For the default project with 3 statuses, this gives the classic Not Started → In Progress → Done board. A software project with 6 statuses gets 6 columns automatically.

---

## 6. Task Interactions

### 5.1 Creating Tasks

- **Add-task input**: Always visible at top of list views. Focused with Enter key when no task is selected. Placeholder: "Add to [view name]...". Submits on Enter.
- **Quick-Add Window**: Global hotkey (default Cmd+Shift+Space). Floating, always-on-top, frameless, transparent window. Creates in My Day. Closes on submit, Escape, or blur.
- **MCP Server**: `create_task` tool (see §12).

### 5.2 Status Cycling

Click the status icon on a task row to cycle through the project's statuses in order (by `order_index`). When reaching a status with `is_done === true`:
- `completed_date` is set
- If task has `recurrence_rule`, a new copy is spawned with next due date and added to Backlog
- Auto-archive will eventually move it to Archive

The cycle wraps: clicking status on a done task returns it to the project's default status.

### 5.3 Subtasks & Hierarchy

Tasks have children via `parent_id`. Parent tasks show:
- Expand/collapse chevron
- Progress bar (done / total)
- Subtask count badge

Subtasks are sortable. Drag-and-drop supports three intents based on cursor Y-position within target: **above** (top 20%, reorder), **inside** (middle 60%, make subtask), **below** (bottom 20%, reorder). Cascade delete removes all children.

### 5.4 Drag & Drop

@dnd-kit with PointerSensor (8px activation) and KeyboardSensor. Reordering uses batch SQLite transaction. Visual indicators: above/below lines, inside highlight + scale. Drag overlay shows a ghost card.

**Cross-view drag** (NEW): Drag a task onto sidebar nav items to move it. Drag to "My Day" to pin. Drag to "Backlog" to unpin.

### 5.5 Multi-Select & Bulk Actions
- **Cmd+click**: Toggle individual selection
- **Shift+click**: Range select
- **Cmd+A**: Select all visible tasks

When multiple tasks are selected, a **floating bulk action bar** appears at the bottom with: Set Status, Set Priority, Add Label, Move to My Day, Delete. All actions apply to the selection.

### 5.6 Inline Editing

Double-click a task title to edit inline. Enter saves, Escape cancels. Tab moves to the next task's title for rapid editing.

### 5.7 Keyboard Navigation
- **↑/↓**: Move selection between tasks
- **Enter**: Open detail panel for selected task (or focus add-input if none selected)
- **Space**: Toggle status of selected task
- **Delete/Backspace**: Delete selected task (with undo toast)
- **Tab**: Move to next task, Shift+Tab to previous
- **→**: Expand subtasks, **←**: Collapse

---

## 7. Detail Panel (Task Editor)

Resizable panel, positionable at **bottom** or **side** (toggleable, persistent). Opens when a task is selected.

### Fields:
1. **Title** — Large text input, 1s autosave debounce
2. **Status** — Button row dynamically generated from the project's configured statuses. Plus an "Archive" toggle.
3. **Priority** — Button row: None, Low, Normal, High, Urgent (with colors)
4. **Labels** — Assigned labels as colored chips with X removal. "+ Add" button opens dropdown listing unassigned labels + "New label..." inline creation (color picker + name input)
5. **Due Date** — Date picker with optional time picker (toggle)
6. **Recurrence** — Button row: None, Daily, Weekly, Monthly, Custom (with interval input)
7. **Snooze** — Quick buttons: Later Today, Tomorrow, Next Week, In 3 Days, Pick Date...
8. **Description** — Markdown textarea with Cmd+V image paste (10MB limit). Toggle between edit and rendered preview.
9. **Image** — Preview with remove button
10. **Activity Log** — Collapsible timeline of changes (status, priority, labels, title, due date)

Escape closes. Resize handles on top edge (bottom mode) or left edge (side mode).

---

## 8. Smart Lists / Saved Filters
Users can save complex filter combinations as named lists that appear in the sidebar.

**Filter criteria:**
- Status (any combination)
- Priority (any combination)
- Labels (any/all/none)
- Due date (today, this week, overdue, no date, custom range)
- Has subtasks, has image, has recurrence
- Title contains text

**UI**: A "Create Smart List" button in the sidebar opens a filter builder. Saved filters appear in the sidebar under "Smart Lists" with a custom icon and color. Click to view filtered tasks.

---

## 9. Priority System

5 levels: None (0), Low (1), Normal (2), High (3), Urgent (4). Each has a configurable color.

**Visual effects (all independently toggleable in Settings > Priorities):**
- **Color Bar**: 1.5px colored stripe on left edge, rounded
- **Badges**: Icon + label chip (Low: minus, High: arrow-up + "High", Urgent: warning + "Urgent")
- **Background Tint**: 3% opacity for High, 6% for Urgent
- **Font Weight**: Light → Normal → Medium by priority
- **Auto-Sort**: Priority descending within sections, then by order_index

Each toggle has a **live preview** in settings showing the effect.

---

## 10. Labels

Labels: id, name, color. Many-to-many via junction table. Pre-joined on task fetch (no N+1).

**Assignment**: Detail panel "+ Add" dropdown, task row inline "+" button (hover-visible, fixed-position portal popup with "New label..." creation), context menu flyout.

**Filtering**: Label bar at top of each view shows all labels in use. Click to filter, click again to clear. Configurable filter mode:
- **Hide**: Remove non-matching tasks
- **Blur**: Fade non-matching to 20% opacity

Active filter label gets a ring highlight. Clearing: X button or click active label again. Auto-clears on view switch.

---

## 11. Recurrence

Rule stored as JSON: `{"type": "daily"|"weekly"|"monthly"|"custom", "interval": N}`.

When a recurring task reaches a status with `is_done === true`:
1. The original keeps its done status + `completed_date` (history)
2. A new task is spawned with: the project's default status, next due date computed, same title/description/priority/labels/recurrence, `is_in_my_day = 0` (goes to Backlog)
3. Activity log entry on both tasks

Settable via detail panel and context menu flyout.

---

## 12. Snooze
Snooze **always sets the due date**. No dual action. One click = task moves to the future.

**Presets** (in context menu flyout and detail panel):
- **Later Today** → today at 5pm or +3 hours (whichever is later)
- **Tomorrow** → tomorrow 9am
- **Next Week** → next Monday 9am
- **In 3 Days** → +3 days at 9am
- **Pick Date...** → inline mini date picker

If the task is in My Day and snoozed to a future date, it is **automatically removed from My Day**. It returns when the due date arrives (via the "due today" filter).

Snooze presets are configurable in Settings > Snooze.

---

## 13. MCP Server
A built-in MCP (Model Context Protocol) server runs locally when the app is open. It allows Claude Desktop, Claude Code, or any MCP client to interact with the task database.

### Tools Exposed:

| Tool | Description |
|------|-------------|
| `list_tasks` | List tasks with optional filters (status, priority, label, due_date, view) |
| `get_task` | Get a single task by ID with subtasks and labels |
| `create_task` | Create a task with title, priority, due_date, labels, parent_id, is_in_my_day |
| `update_task` | Update any task fields |
| `complete_task` | Move task to the project's done status (triggers recurrence if applicable) |
| `list_statuses` | List all statuses for a project |
| `delete_task` | Delete a task |
| `list_labels` | List all labels |
| `create_label` | Create a new label |
| `add_label_to_task` | Assign a label to a task |
| `remove_label_from_task` | Remove a label from a task |
| `get_my_day` | Get all My Day tasks |
| `get_overdue` | Get all tasks past their due date |
| `search_tasks` | Full-text search across titles and descriptions |
| `list_projects` | List all projects the user has access to |
| `switch_project` | Set the active project context for subsequent operations |

### Implementation:
- Uses the `@modelcontextprotocol/sdk` package
- Runs as a stdio transport (Claude Desktop compatible) or SSE transport (web compatible)
- Shares the same `TaskRepository`, `LabelRepository` as IPC handlers
- MCP server config is auto-generated in `~/.claude/claude_desktop_config.json` on first run
- Task changes via MCP trigger `tasks-updated` broadcast to the renderer (live updates)

### Example Usage (from Claude):
> "Add a task called 'Review Q1 report' with high priority, due tomorrow, labeled 'work'"
> "What's on my plate for today?"
> "Mark all tasks labeled 'sprint-3' as done"

---

## 14. Theme System

8-color palette applied as CSS custom properties: `--bg`, `--fg`, `--fg-secondary`, `--fg-muted`, `--muted`, `--accent`, `--accent-fg`, `--border`.

**12 built-in themes**: Standard Dark/Light, Warm Earth (dark/light), Ocean Blue (dark/light), Amethyst (dark/light), Forest (dark/light), Rosewood (dark/light), Claude (dark/light).

Settings > Themes: mode toggle, preset dropdown, 8 color pickers, live UI preview (mock sidebar + task cards), create/apply/save buttons. Preview is live — app updates in real-time while editing. "Apply" button required to persist a theme change.

---

## 15. Focus Timer

Two modes (configurable in Settings > Focus):

### Mode A: Full-Screen Overlay (default)
Large countdown (MM:SS in 12vw monospace), pause/resume button, close button. Dark blurred background. Escape closes.

### Mode B: Menu Bar Timer (macOS)
App minimizes. Countdown appears in the macOS menu bar (tray). Hover shows: remaining time, Pause/Resume button, Stop button. Clicking Stop resets the tray to the default menu. Timer completion triggers a native OS notification.

Configurable durations in Settings > Focus (default: Deep Work 25m, Short Sprint 15m, Quick Fix 5m). Startable from: task row play button, context menu flyout, detail panel.

---

## 16. Context Menu

Right-click opens a compact (w-52) menu with flyout submenus on hover:

- **Status row**: Compact buttons generated from the project's configured statuses
- **Divider**
- Pin/Unpin from My Day
- Add Subtask
- **Divider**
- Priority → flyout (5 options with color dots + checkmark on current)
- Recurrence → flyout (None, Daily, Weekly, Monthly, Every 3/14 Days)
- Labels → flyout (toggleable list + "New label...")
- Snooze → flyout (Later Today, Tomorrow, Next Week, In 3 Days, Pick Date...)
- Focus → flyout (timer presets)
- **Divider**
- Duplicate
- **Divider**
- Delete (red)

Smart positioning: viewport-clamped, submenus open left/right based on space. 150ms hover delay. Only one submenu open at a time.

---

## 17. Command Palette (Cmd+K)

Modal search overlay. Real-time filtering with operator support:

**Basic**: Substring match on title (default)

**Operators** (NEW):
- `p:high` or `priority:urgent` — filter by priority
- `l:work` or `label:design` — filter by label
- `s:done` or `status:review` — filter by status name (matches against project's configured statuses)
- `due:today`, `due:week`, `due:overdue` — filter by due date
- `has:subtasks`, `has:image`, `has:recurrence` — filter by properties
- Operators can be combined: `p:high l:work due:week`

Results show: priority color dot, priority badge (High/Urgent), title, labels, status, due date. Click to select + open detail panel. Max 12 results. "No results" empty state. Escape closes.

---

## 18. Notifications
Native OS notifications via Electron's `Notification` API:

- **Due date reminders**: Configurable (at time, 15m before, 1h before, 1d before). Checked every minute.
- **Focus timer completion**: "Focus session complete!" with task title.
- **Recurring task spawned**: "Recurring task created: [title]"
- **Overdue tasks**: Daily morning notification listing overdue task count.
- **Weekly Review**: Configurable day and time (default: Sunday 6pm). Notification: "Time for your weekly review — X tasks need attention". Clicking opens Review Mode.

All notification types individually toggleable in Settings > Notifications.

---

## 19. Weekly Review

A guided review mode inspired by GTD's weekly review — the single most impactful productivity habit.

### Trigger
- **Scheduled notification** at a configurable day/time (default: Sunday 6pm). Clicking the notification opens Review Mode.
- **Manual**: Accessible anytime via sidebar ("Review" button) or Cmd+R.

### Review Mode
A focused, distraction-free full-screen overlay (similar to Focus Timer) that walks through 5 steps:

**Step 1 — Inbox Zero**
Shows all tasks with no priority set (priority = 0), no due date, or still in the default status. For each: set priority, set a date, update status, or snooze. Counter: "3 tasks need triaging".

**Step 2 — Overdue**
Shows all tasks past their due date, sorted oldest first. For each: reschedule (snooze presets), complete, or delete. Counter: "5 overdue tasks".

**Step 3 — Stale Tasks**
Tasks in a non-default, non-done status for more than 7 days (configurable) with no activity log entries. For each: update status, add a note, reschedule, or archive. Counter: "2 stale tasks".

**Step 4 — This Week Ahead**
Shows tasks due in the next 7 days, grouped by day. Quick scan to see if the week is realistic. Option to snooze or reprioritize.

**Step 5 — Empty Projects**
Projects with zero active tasks (all archived or done). Prompt to add tasks, archive the project, or skip.

### Completion
After all steps: "Review complete! You reviewed X tasks." with a summary (triaged, rescheduled, completed, deleted counts). Dismisses the overlay.

### Data
Last review timestamp stored in settings. The sidebar "Review" button shows a subtle indicator if it's been >7 days since the last review.

---

## 20. Undo System
Toast-based undo for destructive actions with a 5-second window:

- **Task delete**: "Task deleted" [Undo] — restores task + subtasks + labels
- **Task archive**: "Task archived" [Undo]
- **Status change**: "Marked as Done" [Undo]
- **Bulk actions**: "5 tasks deleted" [Undo]
- **Label removal**: "Label removed from task" [Undo]

Implementation: Before each destructive action, snapshot the affected rows. The undo callback restores from the snapshot. Toast auto-dismisses after 5s. Only the most recent action is undoable (no undo stack).

---

## 21. Export/Import
Settings > Data:

- **Export JSON**: Full database dump — tasks, labels, task_labels, themes, settings. One-click download.
- **Export CSV**: Tasks only, flattened (labels as comma-separated string, subtasks as separate rows with parent title prefix).
- **Import JSON**: Upload a previously exported JSON file. Merge or replace options.
- **Import CSV**: Column mapping UI for importing from other tools (Todoist, Things, etc.).

---

## 22. Quick-Add Window

Global hotkey (default Cmd+Shift+Space). Floating, always-on-top, frameless, transparent 600×120 window. Auto-focus with retry (50/150/300ms). Creates task in My Day. Closes on submit, Escape, blur.

**Enhanced**: Supports inline syntax for quick property assignment:
- `Buy groceries !3` → priority High
- `Call dentist @tomorrow` → due tomorrow
- `Review PR #work` → label "work"
- `Weekly standup *weekly` → recurrence weekly

Parser extracts modifiers from the title, applies them, then creates the task with the clean title.

---

## 23. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+K | Command palette |
| Cmd+L | Toggle kanban/list |
| Cmd+1–4 | Switch views (My Day, Backlog, Templates, Archive) |
| Cmd+N | Focus add-task input |
| Cmd+Shift+Space | Quick-add window (global) |
| Cmd+Shift+B | Show/minimize app (global) |
| Escape | Close panel/modal/overlay |
| Enter | Open detail panel (task selected) / Focus add-input (none selected) |
| Space | Toggle status of selected task |
| ↑/↓ | Navigate tasks |
| →/← | Expand/collapse subtasks |
| Delete | Delete selected task (with undo) |
| Cmd+A | Select all visible tasks |
| Tab | Next task / Shift+Tab: Previous |

Global shortcuts configurable in Settings with recorder + validation + macOS dead key protection.

---

## 24. System Tray

Menu bar icon with context menu: My Day, Backlog, Quick Add, Settings, Quit. After tray creation, `app.dock.show()` ensures Cmd+Tab visibility. Show/minimize shortcut uses `minimize()` not `hide()`.

---

## 25. Auto-Archive

Hourly background job. Tasks with a `is_done` status and `completed_date` older than N hours (configurable, default 24) are set to `is_archived = 1`. They remain in their done status but move to the Archive view.

---

## 26. Midnight Rollover

Hourly check. On date change, clears `is_in_my_day` for completed tasks only. Manually pinned active tasks are preserved.

---

## 27. Persistent UI State

Window position/size, sidebar width/collapsed/pinned, editor width/height/position — all saved to settings table. Debounced save on resize/move (1s). Restored on launch.

---

## 28. Security & Safety

- SQL injection prevention: column whitelist for update queries
- Foreign keys enabled (`PRAGMA foreign_keys = ON`)
- Image paste size limit (10MB)
- Global crash handler with error dialog
- Safe wrappers around all `globalShortcut` API calls
- Shortcut save guard: blocks non-ASCII values
- macOS dead key protection on shortcut base keys (N, E, U, I)
- Versioned schema migrations (no try/catch ALTER TABLE)

---

## 29. Accessibility
- ARIA labels on all interactive elements
- Screen reader announcements for state changes (task completed, filter applied)
- `prefers-reduced-motion` support: disable all animations
- Logical tab order through sidebar → task list → detail panel
- Focus indicators on all focusable elements (visible ring)
- High-contrast mode: auto-detect OS preference, adjust theme
- Keyboard-only usage possible for every feature

---

## 30. Onboarding
First-run experience:
1. **Welcome screen**: App name, one-line tagline, "Get Started" button
2. **Sample tasks**: Pre-populated My Day with 3-4 example tasks demonstrating priority, labels, subtasks, and recurrence
3. **Keyboard shortcut cheat sheet**: Dismissable overlay (re-accessible via Cmd+? or Settings)
4. **MCP setup prompt**: "Connect to Claude? [Setup] [Skip]" — auto-configures MCP server

---

## 31. Authentication

### Login Screen
Shown on first launch (or when logged out). Clean, minimal design matching the app's theme.

**Methods:**
- **Email + Password**: Standard registration/login. Password minimum 8 characters. Email verification required.
- **Google OAuth**: "Continue with Google" button. Uses Supabase Auth's built-in Google provider.

**Flow:**
1. App launches → check for stored session token in local keychain (Electron `safeStorage`)
2. If valid token → auto-login, load user's projects
3. If no token → show login screen
4. After successful auth → store token securely, create default "Personal" project if first login, load My Day

**Offline mode**: If the user has logged in before, the app works fully offline using the local SQLite mirror. Changes sync when back online. The login screen is only shown on first use or explicit logout.

**Session management**: Supabase handles JWT refresh. Token stored in Electron's `safeStorage` (encrypted, OS-level keychain). Auto-refresh on app launch. Graceful fallback to offline mode if refresh fails.

---

## 32. Projects

Every task and label belongs to a **project**. Projects are the top-level organizational unit.

### Default Project
On first login, a "Personal" project is auto-created. It cannot be deleted but can be renamed. All tasks created without explicit project selection go here.

### Project Switcher
A dropdown in the sidebar header (above the nav items) shows all projects the user owns or is a member of. Click to switch. The active project determines which tasks, labels, and templates are shown in all views.

### Project Settings
Accessible from the project dropdown or Settings. Each project has:
- **Name** and **description**
- **Color** (accent color used in the sidebar indicator)
- **Icon** (picked from lucide icon library)
- **Members** tab (see §32)
- **Labels** (scoped to this project)
- **Danger zone**: Leave project / Delete project (owner only)

### Creating a Project
"+ New Project" button in the project dropdown. Modal with name, color, icon. The creator is automatically the owner.

### My Day is Cross-Project
`is_in_my_day` is stored locally (not synced) and is **not** project-scoped. My Day shows pinned tasks from ALL projects. This way a user can see their full day across work + personal projects.

### Backlog, Archive, Templates are Project-Scoped
These views show tasks from the **active project** only.

---

## 33. Collaboration

### Inviting Members
From Project Settings > Members:
1. Enter an email address
2. Select a role (Admin, Member, Viewer)
3. Click "Invite"

If the email belongs to an existing ToDoozy user, they see the project in their project switcher immediately. If not, an invitation email is sent via Supabase Edge Function with a sign-up link.

### Roles & Permissions

| Action | Owner | Admin | Member | Viewer |
|--------|-------|-------|--------|--------|
| View tasks | ✓ | ✓ | ✓ | ✓ |
| Create tasks | ✓ | ✓ | ✓ | — |
| Edit own tasks | ✓ | ✓ | ✓ | — |
| Edit any task | ✓ | ✓ | — | — |
| Delete own tasks | ✓ | ✓ | ✓ | — |
| Delete any task | ✓ | ✓ | — | — |
| Manage labels | ✓ | ✓ | — | — |
| Manage members | ✓ | ✓ | — | — |
| Remove admins | ✓ | — | — | — |
| Delete project | ✓ | — | — | — |
| Change project settings | ✓ | ✓ | — | — |

### Task Assignment
Tasks have an optional `assigned_to` field (user ID). In the detail panel and context menu, a "Assign" flyout submenu lists all project members with their avatars. Assigned user's avatar appears on the task row and kanban card.

### Real-Time Collaboration
Uses Supabase Realtime (Postgres changes):
- When a teammate creates/updates/deletes a task, the change is broadcast
- The local app receives the change via WebSocket and updates the local SQLite mirror + Zustand store
- Task list re-renders with the new data
- A subtle toast notification: "Alice completed 'Fix login bug'"

### Presence (Optional — Phase 2)
Show which teammates are currently viewing the same project. Small avatar dots in the sidebar next to the project name. "Alice is viewing this project" tooltip.

### Comments (Optional — Phase 2)
Activity log entries with `action: 'comment'` and `new_value` as the comment text. Displayed in the detail panel's activity timeline. Mentions with `@username` that trigger notifications.

---

## 34. Sync Engine

### Architecture
```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Local SQLite │ ←→  │  Sync Service │ ←→  │   Supabase   │
│  (offline)    │     │  (background) │     │  (PostgreSQL) │
└──────────────┘     └──────────────┘     └──────────────┘
```

### Sync Strategy
1. **All writes go to local SQLite first** (instant, offline-capable)
2. A background sync service watches for local changes (via `updated_at` comparison)
3. Pushes local changes to Supabase when online
4. Pulls remote changes from Supabase Realtime subscription
5. Applies remote changes to local SQLite
6. Conflicts resolved by **last-write-wins** using `updated_at` timestamp

### What Syncs
- Tasks, labels, task_labels, statuses, projects, project_members, activity_log
- NOT synced: `is_in_my_day` (per-user, local only), themes (per-device), settings (per-device), window state

### Sync Indicators
- Sidebar footer shows sync status: green dot (synced), yellow spinner (syncing), red dot (offline/error)
- Tasks with unsynced local changes show a subtle "pending" indicator
- Clicking the sync status shows a detail popup: last sync time, pending changes count, error details

---

## 35. Design System & UX Consistency

Every interaction pattern must be used consistently across the entire app. No one-off implementations.

### Shared Components (build once, use everywhere)

| Component | Used In | Behavior |
|-----------|---------|----------|
| **StatusButton** | Task row, detail panel, context menu, kanban column header, bulk action bar | Renders the status icon + optional label. Click cycles to next. Uses status color from project's statuses table. |
| **PriorityIndicator** | Task row, kanban card, detail panel, command palette results, context menu | Renders color bar, badge, tint, and/or weight. Respects all 5 priority display toggles from settings. |
| **LabelChip** | Task row, kanban card, detail panel, command palette results, label filter bar, context menu | Colored chip with name. Clickable for filtering (in list/kanban). X button for removal (in detail panel). Consistent size/padding/font everywhere. |
| **LabelPicker** | Task row (+), detail panel (+ Add), context menu flyout | Fixed-position portal popup. Lists all project labels with toggleable checkmarks. "New label..." inline creation at bottom. Same component everywhere — never 3 different implementations. |
| **DatePicker** | Detail panel (deadline), snooze (pick date), review mode (reschedule) | Consistent mini calendar. Optional time picker toggle. Used identically in all contexts. |
| **Toast** | Undo system, sync errors, teammate activity, notifications | Bottom-center, auto-dismiss after 5s, optional action button (e.g. "Undo"). Stacks if multiple. Same animation everywhere. |
| **ContextMenu** | Task right-click (list view, kanban view) | Identical menu regardless of where the task is displayed. Same flyout submenus, same positioning logic. |
| **Avatar** | Task row (assigned_to), kanban card, detail panel, member list, activity log, presence indicators | Consistent size (16px in rows, 24px in detail, 32px in member list). Shows initials if no avatar_url. |
| **Modal** | Settings, project settings, invite member, filter builder, confirm delete | Consistent backdrop (dark blur), animation (fade + zoom-in-95), escape to close, click-outside to close. |
| **EmptyState** | Every list view, kanban columns, search results, archive, labels settings | Consistent illustration style + message + optional CTA button. Never a blank void. |

### Interaction Patterns (same everywhere)

| Pattern | Rule |
|---------|------|
| **Selection** | Single click selects. Accent background at 12% opacity + accent border at 15% opacity. Same highlight in list view, kanban view, and search results. |
| **Hover** | `bg-foreground/6` with faint border. Same on task rows, kanban cards, nav items, context menu items, label chips. |
| **Destructive actions** | Always red. Always has undo toast. Always at the bottom of any menu/list. Delete, archive, remove label, remove member. |
| **Flyout submenus** | Open on hover (150ms delay). Open right unless near viewport edge (then left). Same SubMenu component everywhere (context menu, command palette operators). |
| **Autosave** | 1s debounce on all text inputs (title, description, label names in settings, project name). No save button for text. Visual save indicator optional. |
| **Loading states** | Spinner or skeleton, never a blank screen. Same spinner component. Toast for operations that take >500ms. |
| **Keyboard dismiss** | Escape always closes the topmost overlay/panel/menu. Consistent across: detail panel, settings modal, context menu, command palette, focus timer, review mode, label picker. |
| **Drag visual** | Ghost card overlay (same as task row but 80% opacity). Drop indicators: horizontal line for above/below, background highlight for inside/column. Same in list and kanban. |

### Typography Scale

| Use | Class | Example |
|-----|-------|---------|
| View title | `text-3xl font-light tracking-[0.15em] uppercase` | MY DAY |
| Section label | `text-[10px] font-bold uppercase tracking-[0.3em]` | TO DO |
| Task title | `text-[15px] font-light tracking-tight` (weight varies by priority) | Buy groceries |
| Metadata | `text-[10px] font-bold uppercase tracking-widest` | 2026-03-18 |
| Badge/chip | `text-[9px] font-bold uppercase tracking-wider` | URGENT |
| Button label | `text-[11px] font-bold uppercase tracking-widest` | APPLY |
| Body text | `text-sm font-light` | Task description content |
| Hint text | `text-[10px] opacity-40` | Cmd+V to paste |

### Spacing

- Task row padding: `py-3.5 px-4`
- Kanban card padding: `p-3.5`
- Section gaps: `mb-6` between sections, `mb-1` between task rows
- Panel padding: `p-6`
- Modal padding: `p-10`
- Button padding: `px-4 py-2` (standard), `px-3 py-1.5` (compact), `p-2` (icon-only)

### Animation

All animations respect `prefers-reduced-motion`. When reduced motion is on, replace all transitions with instant state changes.

- **Panel open**: `animate-in slide-in-from-bottom/right duration-300`
- **Modal open**: `animate-in fade-in zoom-in-95 duration-200`
- **Context menu**: `animate-in fade-in zoom-in duration-100`
- **Toast**: `animate-in slide-in-from-bottom duration-200`, auto-dismiss with fade-out
- **Drag**: No animation on drop (instant snap). Ghost overlay follows cursor.
- **Theme change**: `transition-colors duration-300` on root element
- **Sidebar expand/collapse**: `transition-[width] duration-200 ease-out`

---

## 36. Architecture
### State Management
- **Zustand** store for global state: tasks, labels, statuses, settings, theme, filters, auth, projects
- **React Context** for UI-local state: sidebar hover, drag state, editing ID
- Zero prop-drilling. Components subscribe to store slices.

### Type Safety
- Strict TypeScript. Zero `any`. Every component prop has a defined interface.
- Shared types in `src/shared/types.ts` used by main, preload, renderer, and MCP server.

### Component Architecture
Feature-based folders:
```
src/renderer/src/
  features/
    auth/        (LoginScreen, AuthProvider, useAuth hook)
    projects/    (ProjectSwitcher, ProjectSettings, MemberList, InviteModal)
    tasks/       (TaskRow, TaskList, KanbanView, DetailPanel, SubtaskTree)
    labels/      (LabelPicker, LabelFilterBar, LabelChip)
    settings/    (SettingsModal, ThemeEditor, PrioritySettings, LabelSettings, ShortcutRecorder)
    focus/       (FocusOverlay, MenuBarTimer)
    search/      (CommandPalette, FilterBuilder)
    sidebar/     (Sidebar, NavItem, SmartListItem, ProjectDropdown)
    review/      (ReviewOverlay, ReviewStep)
    sync/        (SyncIndicator, SyncService)
  shared/
    components/  (ContextMenu, Toast, Button, Input, Modal, Avatar)
    hooks/       (useTaskActions, useTheme, useLabels, useDragAndDrop, useKeyboardNav, useSync)
    context/     (UIContext)
    stores/      (taskStore, settingsStore, labelStore, statusStore, authStore, projectStore)
```

Components under 150 lines. Extract hooks for reusable logic.

### Database Layer
Repository pattern: `TaskRepository`, `LabelRepository`, `StatusRepository`, `SettingsRepository`, `ThemeRepository`, `ActivityLogRepository`, `ProjectRepository`, `UserRepository`. Typed methods, no raw SQL in IPC handlers. Versioned migrations. Each repository has a local (SQLite) and remote (Supabase) implementation behind a common interface.

### IPC Layer
Typed preload bridge. Consider electron-trpc for compile-time type safety. Every repository method maps to an IPC handler.

### Error Handling
- Toast notification system for user-facing errors
- Structured logging (timestamps, context) to file
- No empty catch blocks
- Crash recovery: save state before crash, restore on relaunch

### Performance
- Virtual scrolling for 1000+ task lists (@tanstack/react-virtual)
- View-scoped queries (only fetch tasks for current view + active project)
- Debounced autosave (1s)
- Memoized filtered lists (useMemo)
- Batch SQLite transactions for drag-and-drop reordering
- Deferred rendering (useDeferredValue for large lists)
- Supabase queries use Row Level Security for server-side filtering

### Testing
- **Vitest**: Unit tests for repositories, filter logic, recurrence computation, snooze date calculation, search operator parsing, sync conflict resolution
- **Playwright**: E2E tests for create/edit/delete tasks, drag-and-drop, theme switching, keyboard navigation, login flow
- **IPC tests**: Mock database for handler testing

---

## 37. Build Instructions — How to Start the Rebuild with Claude Code

**Prerequisites**: Complete `SETUP_GUIDE.md` first — it covers installing tools, creating the Supabase project, configuring permissions, and opening Claude Code. This section assumes you're inside Claude Code with a fresh project directory.

### Step 1: Initialize with Claude Code

Run `/init` to create `CLAUDE.md`. Replace its contents with:

```markdown
# ToDoozy v2

## Project Overview
Electron desktop todo app built with React 19, TypeScript (strict), Tailwind CSS 4, better-sqlite3, and @dnd-kit.

## Key Commands
- `npm run dev` — Start development server
- `npm run build` — Production build
- `npm run typecheck` — TypeScript type checking
- `npm run test` — Run Vitest tests
- `npm run lint` — ESLint check

## Architecture Rules
- Zero `any` types. Strict TypeScript. Every prop interface must be defined.
- Feature-based folder structure under `src/renderer/src/features/`.
- All database access goes through repository classes (TaskRepository, LabelRepository, etc.). Never write raw SQL in IPC handlers.
- All state management via Zustand stores. No prop-drilling beyond 1 level. No useState for shared state.
- Components must be under 150 lines. Extract hooks for reusable logic.
- Every IPC handler must have a matching typed method in the preload bridge.
- Use versioned migrations (schema_version table), never try/catch ALTER TABLE.
- All primary keys are UUIDs. All timestamps are ISO 8601 UTC.
- Empty catch blocks are forbidden. All errors must be logged or surfaced to the user.

## Testing
- Write Vitest unit tests for all repository methods, filter logic, and utility functions.
- Test files live next to source files: `TaskRepository.test.ts` alongside `TaskRepository.ts`.

## Style
- Minimal, monochrome-first design. Color comes from themes and priority/label accents.
- All animations respect `prefers-reduced-motion`.
- Keyboard-first: every feature must be usable without a mouse.
```

### Step 2: Scaffold the project

Give Claude Code this initial prompt:

> Read REBUILD_SPEC.md in this directory. It contains the complete product specification for ToDoozy v2.
>
> Start by:
> 1. Scaffold the Electron + React + TypeScript project using electron-vite
> 2. Install all dependencies (better-sqlite3, @dnd-kit/core, @dnd-kit/sortable, lucide-react, tailwindcss, @tailwindcss/vite, zustand, @modelcontextprotocol/sdk, @supabase/supabase-js)
> 3. Set up the database layer: schema with versioned migrations, repository classes
> 4. Set up the IPC layer: typed preload bridge with all handlers
> 5. Set up the Zustand stores: taskStore, labelStore, statusStore, settingsStore, projectStore, authStore
> 6. Create the basic app shell: sidebar, main content area, routing between views
>
> Don't build features yet — just the skeleton with proper architecture. I'll request features one at a time after that.

### Step 3: Build features in this order

This order minimizes rework — each feature builds on the previous:

**Phase 1 — Core (offline, single-user)**
1. **Supabase Setup** — Initialize Supabase project, configure Auth (email + Google), create tables with RLS policies.
2. **Auth** — Login screen (email/password + Google), session storage in Electron safeStorage, offline fallback.
3. **Projects + Statuses** — Default "Personal" project on first login with 3 default statuses. Project switcher in sidebar. Status CRUD in project settings.
4. **Task CRUD** — Create, list, update, delete tasks (project-scoped, status-scoped). Basic list view.
5. **Views** — My Day (cross-project), Backlog, Archive, Templates navigation.
6. **Detail Panel** — Task editor (title, status, priority, description, assignment).
7. **Subtasks** — Parent/child hierarchy, expand/collapse, progress bar.
8. **Drag & Drop** — Reordering, subtask nesting, batch updates, cross-view drag.
9. **Theme System** — CSS variables, dark/light, theme editor, built-in presets.
10. **Labels** — CRUD (project-scoped), assignment, filtering (hide/blur), label bar.
11. **Priority Visualizations** — Color bar, badges, tint, weight, sort toggles.
12. **Kanban Toggle** — Dynamic columns from project statuses, drag between columns.
13. **Context Menu** — Compact with flyout submenus.
14. **Command Palette** — Search with operator support.

**Phase 2 — Productivity features**
15. **Recurrence** — Rule editor, spawn-on-done logic.
16. **Snooze** — Preset date shifting, auto-remove from My Day.
17. **Focus Timer** — Full-screen overlay + menu bar mode.
18. **Quick-Add Window** — Global hotkey, floating window, inline syntax parsing.
19. **Settings Panel** — All tabs (General, Themes, Priorities, Labels, Snooze, Focus, Notifications, Shortcuts, Data).
20. **Global Shortcuts** — Recorder, validation, macOS dead key protection.
21. **Auto-Archive & Midnight Rollover** — Background jobs.
22. **Undo System** — Toast-based with snapshot/restore.
23. **Multi-Select & Bulk Actions** — Selection model, action bar.
24. **Smart Lists** — Filter builder, saved filters in sidebar.
25. **Activity Log** — Change tracking (with user attribution), timeline in detail panel.
26. **Notifications** — Due reminders, timer completion, overdue alerts.
27. **Keyboard Navigation** — Arrow keys, Enter, Space, Tab flow.

**Phase 3 — Collaboration & Cloud**
28. **Sync Engine** — Local SQLite ↔ Supabase background sync, conflict resolution, sync status indicator.
29. **Collaboration** — Invite members, roles (owner/admin/member/viewer), permissions enforcement.
30. **Task Assignment** — Assign to project members, avatar on task rows/cards.
31. **Real-Time Updates** — Supabase Realtime subscriptions, live task list updates, teammate activity toasts.
32. **Project Settings** — Members tab, role management, invite by email, danger zone.

**Phase 4 — Polish & Ecosystem**
33. **Export/Import** — JSON/CSV backup and restore.
34. **MCP Server** — Tool definitions, stdio transport, auto-config, project-aware queries.
35. **Accessibility** — ARIA, focus indicators, reduced motion.
36. **Onboarding** — Welcome screen, sample tasks, shortcut cheat sheet, MCP setup.
37. **Testing** — Unit tests (Vitest) + E2E tests (Playwright) + sync integration tests.

### Step 4: Skills to use

Claude Code skills (`/` commands) that would help during this build:

- **`/commit`** — Auto-generate conventional commit messages after each feature.
- **`/review-pr`** — Self-review code before committing to catch issues.
- **`/simplify`** — Run after completing a feature to check for code quality, reuse, and efficiency.
- **`/mcp-builder`** — Use when building the MCP server (Phase 4, step 34). Helps scaffold MCP tool definitions, transports, and configuration.

### Step 5: Subagent strategies

Use Claude Code's Agent tool effectively:

- **Research agents** — Before implementing a complex feature (MCP server, virtual scrolling, menu bar timer), spawn a research agent to read documentation and find the best approach.
- **Test agents** — After implementing a feature, spawn an agent in background to write tests while you move on to the next feature.
- **Validation agents (worktree)** — Use `isolation: "worktree"` to have an agent try an experimental approach without affecting your main branch.

### Step 6: Vibe Coding Workflow

The key to high-quality output with Claude Code is **tight iteration loops**, not one giant prompt. Here's the expert workflow:

#### The Loop (for each feature)

```
1. PROMPT  → Describe the feature clearly (reference the spec section)
2. BUILD   → Claude implements it
3. TEST    → Run `npm run dev`, test manually, check TypeScript (`npm run typecheck`)
4. REVIEW  → Run `/simplify` to catch code quality issues
5. FIX     → Address any issues found
6. COMMIT  → Run `/commit` for a clean conventional commit
7. REPEAT  → Next feature
```

#### The Ralph Wiggum Loop (Autonomous Mode)

For features that are well-specified, you can let Claude work autonomously:

> Implement [feature X] from REBUILD_SPEC.md §[N]. After implementing:
> 1. Run `npm run typecheck` and fix any errors
> 2. Run `/simplify` on the files you changed
> 3. List what you built and any decisions you made
> 4. Do NOT commit — I'll review first

This lets Claude self-correct without you babysitting each step.

#### The Babysit Loop (Complex Features)

For complex features (drag-and-drop, sync engine, MCP server), break them into micro-steps:

> We're building [feature X]. Let's do this in steps.
> Step 1: [specific sub-task]
> Don't proceed to step 2 until I confirm.

This prevents Claude from going down a wrong path for 500 lines before you notice.

#### Iteration Accelerators

1. **TodoWrite for task tracking**: At the start of each phase, create a task list:
   > Create a task list for Phase 1. Each feature from the build order should be a task.

   Claude will track progress and know what's done vs. remaining.

2. **Parallel agents for testing**: After implementing a feature, spawn a test agent in background:
   > In background: Write Vitest tests for the TaskRepository I just created. Check src/main/repositories/TaskRepository.ts.

   You keep building while tests are written in parallel.

3. **Worktree agents for experiments**: When unsure about an approach:
   > In a worktree: Try implementing the sync engine using Supabase Realtime subscriptions. Show me the approach before I commit to it.

   This explores without touching your main branch.

4. **Context anchoring**: When starting a new session, anchor Claude immediately:
   > Read REBUILD_SPEC.md and CLAUDE.md. We're in Phase [N], working on feature [X]. Last session we completed [Y]. Continue from there.

5. **Checkpoint commits**: After every 2-3 features, commit and push. If Claude goes sideways, you can always revert.

#### Quality Gates (run between phases)

Between each build phase, do a full quality pass:

```bash
npm run typecheck          # Zero errors
npm run lint               # Zero warnings
npm run test               # All tests pass
```

Then review with Claude:
> Review all code written in Phase [N]. Check for:
> - Any `any` types that snuck in
> - Components over 150 lines
> - Raw SQL outside repositories
> - Missing error handling
> - UX consistency with §34 of the spec

#### Session Management

- **Start each session** by reading REBUILD_SPEC.md + CLAUDE.md + checking git status
- **End each session** with a commit + push + brief note of where you stopped
- **Long sessions**: After ~20 features, start a new conversation. Context windows fill up and quality degrades. The spec file + CLAUDE.md + git log give the new session everything it needs.

### Step 7: After the build

- Run `/simplify` on the whole codebase
- Run the full test suite
- Do a manual walkthrough of every feature
- Build for macOS: `npm run build:mac`
- Test the packaged app (not just dev mode)
- Set up auto-updates if distributing
