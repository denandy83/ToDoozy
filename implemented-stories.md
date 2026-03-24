# Implemented Stories

---

### #1 — Scaffold Electron + React + TypeScript project
- **Description:** Use electron-vite to scaffold the project. Install all dependencies: better-sqlite3, @dnd-kit/core, @dnd-kit/sortable, lucide-react, tailwindcss, @tailwindcss/vite, zustand, @modelcontextprotocol/sdk, @supabase/supabase-js. Set up TypeScript strict mode, Tailwind CSS 4, and ESLint. Copy ToDoozy.png to resources/icon.png.
- **Spec Section:** §3 Tech Stack, §2 Branding
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #2 — Database layer with versioned migrations
- **Description:** Create SQLite database with schema_version table and numbered migration functions. Implement all tables from §4 Data Model: users, projects, project_members, statuses, tasks, labels, task_labels, themes, settings, activity_log. Enable PRAGMA foreign_keys. Seed default data (3 statuses, default themes, default settings).
- **Spec Section:** §4 Data Model
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #3 — Repository pattern
- **Description:** Create typed repository classes: TaskRepository, LabelRepository, StatusRepository, SettingsRepository, ThemeRepository, ActivityLogRepository, ProjectRepository, UserRepository. Each has a local SQLite implementation. No raw SQL outside repositories.
- **Spec Section:** §36 Architecture - Database Layer
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #4 — IPC layer and preload bridge
- **Description:** Set up typed preload bridge via electron contextBridge. Every repository method maps to an IPC handler. Type declarations in index.d.ts must match the actual preload API. Use TASK_UPDATABLE_COLUMNS whitelist for update queries.
- **Spec Section:** §36 Architecture - IPC Layer
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #5 — Zustand stores
- **Description:** Create Zustand stores: taskStore, labelStore, statusStore, settingsStore, projectStore, authStore. Zero prop-drilling. Components subscribe to store slices.
- **Spec Section:** §36 Architecture - State Management
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #6 — Supabase Auth - Login screen
- **Description:** Implement login screen with email/password and Google OAuth via Supabase Auth. Store session token in Electron safeStorage. Auto-login on launch if valid token exists. Create default Personal project on first login. Graceful offline fallback.
- **Spec Section:** §31 Authentication
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #7 — Projects and configurable statuses
- **Description:** Default Personal project auto-created on first login. Project switcher dropdown in sidebar header. Project settings (name, color, icon). Status CRUD in project settings - 3 defaults seeded (Not Started, In Progress, Done). Deleting a status requires reassigning tasks.
- **Spec Section:** §32 Projects, §4.4 Statuses Table
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #8 — Task CRUD with basic list view
- **Description:** Create, list, update, delete tasks (project-scoped, status-scoped). Add-task input at top of list. Tasks grouped by status sections. Status cycling on click. Completed_date auto-set on done status. is_archived flag separate from status.
- **Spec Section:** §6 Task Interactions
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #9 — Views and sidebar navigation
- **Description:** Implement sidebar (collapsible 56px-600px, pinnable, hover-expand). Views: My Day (cross-project, is_in_my_day OR due today), Backlog (project-scoped), Archive (is_archived), Templates (is_template). Nav items with count badges. Keyboard: Cmd+1-4.
- **Spec Section:** §5 Views & Navigation
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #10 — Detail Panel - Task editor
- **Description:** Resizable panel (bottom/side toggleable). Fields: title (autosave 1s), status buttons (dynamic from project statuses), priority buttons, labels section, due date picker with optional time, recurrence (None/Daily/Weekly/Monthly/Custom), snooze presets, markdown description with image paste, activity log timeline. Escape closes.
- **Spec Section:** §7 Detail Panel
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #11 — Subtasks and hierarchy
- **Description:** Parent/child via parent_id. Expand/collapse chevron. Progress bar (done/total). Subtask count badge. Sortable within parent. Cascade delete. Drag-and-drop: above (reorder), inside (make subtask), below (reorder).
- **Spec Section:** §6.3 Subtasks & Hierarchy
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #12 — Drag and drop
- **Description:** @dnd-kit with PointerSensor (8px) and KeyboardSensor. Drop intent by Y-position (top 20%=above, middle 60%=inside, bottom 20%=below). Batch SQLite transactions for reordering. Visual indicators. Ghost card overlay. Cross-view drag onto sidebar nav items.
- **Spec Section:** §6.4 Drag & Drop
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #13 — Theme system
- **Description:** 8-color palette as CSS custom properties. 12 built-in themes (6 dark, 6 light). Settings > Themes: mode toggle, preset dropdown, color pickers, live UI preview, create/apply/save. Apply button required to persist.
- **Spec Section:** §14 Theme System
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #14 — Labels with filtering
- **Description:** Label CRUD (project-scoped). Assignment via detail panel +Add, task row inline + button (portal popup with New label), context menu flyout. Label filter bar at top of views. Hide/blur filter modes. Click label chip to filter, click again to clear. Auto-clear on view switch.
- **Spec Section:** §10 Labels
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #15 — Priority system with visualizations
- **Description:** 5 levels with configurable colors. Toggleable effects: color bar (1.5px), badges (icons+labels), background tint (3%/6%), font weight, auto-sort. Each toggle has live preview in Settings > Priorities.
- **Spec Section:** §9 Priority System
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #16 — Kanban toggle
- **Description:** Cmd+L toggles list/kanban on My Day and Backlog. Columns generated dynamically from project statuses. Drag between columns changes status_id. Task cards show priority, labels, due date, assignee avatar. All interactions (click, right-click, hover preview).
- **Spec Section:** §5.6 Kanban Toggle
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #17 — Context menu with flyout submenus
- **Description:** Compact w-52 menu. Status row (dynamic from project statuses). Flyout submenus on hover (150ms delay): Priority, Recurrence, Labels, Snooze, Focus. Pin/unpin My Day, Add Subtask, Duplicate, Delete. Smart viewport positioning. Submenus open left/right based on space.
- **Spec Section:** §16 Context Menu
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #18 — Command palette with search operators
- **Description:** Cmd+K modal. Substring match by default. Operators: p:high, l:work, s:done, due:today, has:subtasks. Combinable. Results show priority dot, badge, title, labels, status, due date. Click to select. Max 12 results. Escape closes.
- **Spec Section:** §17 Command Palette
- **Passes:** true
- **Implemented:** 2026-03-20

---

### #20 — Global quick-add window with customizable shortcut
- **Description:** Frameless floating window triggered by global macOS keyboard shortcut (Cmd+Shift+Space) for adding tasks from anywhere.
- **Spec Section:** N/A
- **Passes:** true
- **Implemented:** 2026-03-21

---

### #21 — Smart input parsing with @label, p:priority, and d:date syntax
- **Description:** Inline smart parsing in all task creation inputs with popup suggestions for labels, priorities, and dates.
- **Spec Section:** N/A
- **Passes:** true
- **Implemented:** 2026-03-21

---

### #22 — Copy task titles to clipboard
- **Description:** Cmd+C copies selected task titles to clipboard. Single task as plain text, multiple as bulleted markdown list. Available in context menus.
- **Spec Section:** N/A
- **Passes:** true
- **Implemented:** 2026-03-21

---

### #23 — Replace Backlog with per-project sidebar navigation
- **Description:** Removed Backlog view, added per-project sidebar navigation with PROJECTS section, per-project layout memory, My Day grouped by project, drag-reorder in settings.
- **Spec Section:** N/A
- **Passes:** true
- **Implemented:** 2026-03-21

---

### #24 — macOS Tray Icon
- **Description:** Persistent macOS system tray icon with task badge, left-click menu showing My Day tasks, right-click context menu, and window-close-to-tray behavior.
- **Spec Section:** N/A
- **Acceptance Criteria:** Monochrome template icon in menu bar, badge count, left-click menu with tasks, right-click menu, close-to-tray behavior, dock icon reopen.
- **Passes:** true
- **Implemented:** 2026-03-21

---

### #25 — Task Templates & Project Templates
- **Description:** Complete template system with task templates (save/use/edit/delete, global across projects) and project templates (save/deploy via multi-step wizard/edit/delete). Templates view with searchable sections.
- **Spec Section:** N/A
- **Acceptance Criteria:** Save as Template via context menu, global task templates, Templates view with search, Use Template with project picker, Deploy project template via wizard, edit/delete for both types.
- **Passes:** true
- **Implemented:** 2026-03-22

---

### #26 — MCP Server for AI Integration
- **Description:** Standalone MCP server using @modelcontextprotocol/sdk with stdio transport. Exposes tools for tasks, subtasks, projects, labels, statuses, search, My Day, and templates. Settings UI with enable/disable toggle and config copy.
- **Spec Section:** N/A
- **Acceptance Criteria:** MCP server script via stdio, all CRUD tools for tasks/projects/labels/statuses, search with filters, template tools, Settings > MCP section with toggle and config copy.
- **Passes:** true
- **Implemented:** 2026-03-22

---

### #27 — Rich Text Editor with Tiptap
- **Description:** Replaced markdown textarea with Tiptap WYSIWYG editor. Fixed toolbar, floating bubble toolbar, slash commands, link editing with Cmd+K, image paste, interactive checklists, code blocks, attach file placeholder.
- **Spec Section:** N/A
- **Acceptance Criteria:** Tiptap replaces textarea, markdown storage, fixed+floating toolbars, slash commands, Cmd+K link editing, image paste, interactive checklists, 1s autosave, all keyboard shortcuts.
- **Passes:** true
- **Implemented:** 2026-03-22

---

### #28 — Global App Toggle Shortcut
- **Description:** Global Cmd+Shift+B shortcut to toggle main window visibility. Configurable in Settings > General via ShortcutRecorder.
- **Spec Section:** N/A
- **Acceptance Criteria:** Toggle shortcut shows/hides window, works across Spaces, configurable in settings, persists across restarts, requires auth session.
- **Passes:** true
- **Implemented:** 2026-03-22

---

### #29 — Pomodoro Timer
- **Description:** Per-task Pomodoro timer with tray countdown, configurable presets, break timer, repetition/session mode, activity logging, and Settings > Timer configuration.
- **Spec Section:** N/A
- **Acceptance Criteria:** Play button on hover, timer presets, tray countdown, pause/resume/stop, break timer, repetition mode, activity log, sound/system notifications, Settings > Timer section.
- **Passes:** true
- **Implemented:** 2026-03-22
