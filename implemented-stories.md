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

---

### #30 — Global Labels — Shared Across All Projects
- **Description:** Labels become global entities with a many-to-many relationship to projects. A label is created once (with a globally unique name and color) and can be added to multiple projects. Each project only sees labels explicitly added to it. New `project_labels` junction table. Migration merges duplicate label names. Label picker shows project-scoped labels. Label settings shows global labels with usage counts. Delete flow with per-project and global options. Filter by label shows only labels assigned to active tasks in that project.
- **Spec Section:** N/A
- **Acceptance Criteria:** Labels exist as global entities with unique names per user, project_labels junction table links labels to projects, Label picker only shows labels added to current project, Creating a label that matches an existing global label silently adds it with toast, Label settings shows all labels with project/task usage counts, Editing a label name or color applies globally, Delete shows projects where used with per-project remove and global delete options, All destructive actions are red with undo toast, Migration merges duplicate names (oldest wins), Filter by label shows only labels assigned to active tasks.
- **Passes:** true
- **Implemented:** 2026-03-25

---

### #31 — Fix Tab Order and Focus Management
- **Description:** Fixed tab order, added focus trapping to overlays, and ensured focus restoration when overlays close. Shared useFocusTrap and useFocusRestore hooks applied to all overlay components.
- **Spec Section:** N/A
- **Acceptance Criteria:** First tab stop is first task, Tab/Shift+Tab cycles tasks, Enter opens detail with title focus, Tab cycles detail fields, Escape closes panel and restores focus, Sidebar not in tab order, All overlays trap focus, Focus restored on overlay close, Interactive elements focusable, Consistent focus-visible ring.
- **Passes:** true
- **Implemented:** 2026-03-30

---

### #32 — iCloud Drive File Attachments
- **Description:** File attachments stored locally and synced to iCloud Drive. Tiptap toolbar attachment button, file picker, attachment cards with open/remove actions.
- **Spec Section:** N/A
- **Acceptance Criteria:** Settings iCloud link/unlink toggle, Tiptap toolbar attachment button, File picker saves locally + to iCloud, Attachment cards with filename/icon/remove, Click opens file, Keyboard accessible, Works offline.
- **Passes:** true
- **Implemented:** 2026-03-30

---

### #33 — In-App Help & Keyboard Shortcuts
- **Description:** Help modal with keyboard shortcuts reference and help tab in settings with full documentation.
- **Spec Section:** N/A
- **Acceptance Criteria:** ? button in sidebar opens help modal, Shortcuts shown in 4 sections, Help tab in Settings with full docs, ? keyboard shortcut opens modal, Escape closes modal.
- **Passes:** true
- **Implemented:** 2026-03-30

---

### #34 — Task Reference URL
- **Description:** Add a single reference URL field to each task, displayed directly below the title in the task detail panel. Clickable link with auto https:// prefix, X button to clear, 1s debounce autosave.
- **Spec Section:** N/A
- **Acceptance Criteria:** Reference URL field below title, 1s debounce autosave, clickable with auto https:// prefix, X button clears, keyboard accessible in Tab order, persists in SQLite, works in project views and My Day.
- **Passes:** true
- **Implemented:** 2026-03-30

---

### #35 — Calendar View
- **Description:** Cross-project Calendar view showing all tasks organized by due date. Monthly grid and weekly layout with toggle. Sidebar navigation with ⌘2 shortcut. Click/drag/context menu interactions. Today highlighted, overdue in red.
- **Spec Section:** N/A
- **Acceptance Criteria:** Calendar in sidebar with ⌘2, monthly grid with project color indicators, weekly view with day columns, toggle persists, click opens detail panel, drag updates due_date, today highlighted, overdue in red, empty state, works with detail panel/context menu/keyboard shortcuts.
- **Passes:** true
- **Implemented:** 2026-03-30

---

### #36 — Template Wizard — Relative Due Date Offsets
- **Description:** When saving a project as a template, the wizard asks whether to include due dates as relative offsets. When deploying, compute actual due dates from a deploy date.
- **Spec Section:** N/A
- **Acceptance Criteria:** Save wizard shows due dates step, toggle controls offset inclusion, deploy wizard shows due dates step, deploy date picker defaults to today, preview shows computed dates, correct due_date on created tasks, subtasks carry offsets, backward compat, tasks without due dates skipped.
- **Passes:** true
- **Implemented:** 2026-03-30

---

### #37 — Due Date Notifications
- **Description:** Native macOS notifications that fire when a task's due date+time approaches. Configurable lead time, 1-minute warning, click-to-navigate. Settings toggle and lead time dropdown.
- **Spec Section:** N/A
- **Acceptance Criteria:** Native notification at configurable lead time, 1-minute warning, only tasks with time component, click focuses app and navigates to task, settings toggle, lead time dropdown, no notifications for completed/archived/template tasks, no duplicates.
- **Passes:** true
- **Implemented:** 2026-03-30

---

### #38 — Smart Recurrence Picker
- **Description:** Structured recurrence picker replacing free-text input. Canonical storage format, shared utility functions, preset buttons, conditional picker rows, live preview, task completion clone logic, task row indicator, context menu updates, MCP updates.
- **Spec Section:** N/A
- **Acceptance Criteria:** Preset expansion, number input, unit dropdown, weekday toggles, month options, year options, fixed/after-completion toggle, end date picker, live preview, escape collapse, recurring task cloning, end date enforcement, toast with navigation, repeat icon with tooltip, context menu presets, auto-set due date, MCP format update, migration clears old values, full test coverage, keyboard navigation, typecheck passes.
- **Passes:** true
- **Implemented:** 2026-04-01

---

### #39 — Project Collaboration
- **Description:** Enable real-time collaboration on projects between ToDoozy users. Projects are personal/local by default and become shared when the owner generates an invite link. Shared project data syncs through Supabase Postgres with Realtime subscriptions.
- **Spec Section:** N/A
- **Acceptance Criteria:** Owner can share projects with invite links, real-time sync via Supabase, member management, task assignment, notifications, offline support, RLS enforcement.
- **Passes:** true
- **Implemented:** 2026-04-01

---

### #40 — Auto-Update Mechanism
- **Description:** Sparkle-style auto-update system using electron-updater with GitHub Releases. Checks on launch, every 4 hours, and manual trigger from Settings. Update dialog shows version, release notes, download progress. Settings section displays current version and check button.
- **Spec Section:** N/A
- **Acceptance Criteria:** electron-updater configured with GitHub Releases, checks on launch + 4h interval, update dialog with release notes, Install & Restart / Not Now buttons, download progress bar, Settings version display + check button, macOS only, typecheck passes.
- **Passes:** true
- **Implemented:** 2026-04-02

---

### #41 — Versioned Release Notes on Supabase
- **Description:** Migrate What's New from local SQLite to Supabase release_notes table. App fetches on launch and caches locally. /fix and /feature skills upsert to Supabase. Update dialog pulls per-version notes. whats_new_seen stays local per-user.
- **Spec Section:** N/A
- **Acceptance Criteria:** Supabase release_notes table, skills write to Supabase, MCP set_whats_new writes to Supabase, app fetches + caches on launch, What's New displays all versions, offline fallback, notification dot works, update dialog fetches per-version notes, typecheck passes.
- **Passes:** true
- **Implemented:** 2026-04-02

---

### #42 — Settings Menu Reorganization
- **Description:** Reorganized Settings modal from 11 tabs to 7: General (absorbed Notifications), Projects, Appearance (Theme + Priority Display subtabs), Labels, Timer, About (Updates + What's New + Integrations + Help subtabs) + Logout. Added section labels throughout. Extracted large components into separate files.
- **Spec Section:** N/A
- **Acceptance Criteria:** 7 tabs instead of 11, Appearance subtabs for Theme and Priority Display, About subtabs for Updates/What's New/Integrations/Help, section labels in General and Timer, no settings removed or renamed, typecheck passes.
- **Passes:** true
- **Implemented:** 2026-04-03

---

### #43 — MCP Activity Logging
- **Description:** Added activity log entries to all 22 mutating MCP tools so AI-made changes appear in the activity timeline. Covers task CRUD, subtask CRUD, label assignment/removal, status changes, project operations, template deployment, and My Day management.
- **Spec Section:** N/A
- **Acceptance Criteria:** All 22 mutating MCP tools create activity log entries, activity timeline shows AI-made changes alongside user actions, no regressions in MCP tool functionality, typecheck passes.
- **Passes:** true
- **Implemented:** 2026-04-03

---

### #44 — MCP Task Reorder Tool
- **Description:** Added reorder_tasks MCP tool that accepts an ordered array of task IDs and sets order_index sequentially. Validates all IDs exist, warns if priority auto-sort is enabled.
- **Spec Section:** N/A
- **Acceptance Criteria:** reorder_tasks tool accepts task ID array, calls TaskRepository.reorder(), validates IDs exist, warns about priority auto-sort, typecheck passes.
- **Passes:** true
- **Implemented:** 2026-04-03

---

### #45 — Command Palette Clears Filters on Navigation
- **Description:** Fixed Cmd+K navigation not clearing active label/assignee filters, which caused the target task to be invisible after navigation. Now calls clearLabelFilters() before setSelectedProject().
- **Spec Section:** N/A
- **Acceptance Criteria:** Cmd+K clears label and assignee filters on navigation, target task is visible and scrolled into view, typecheck passes.
- **Passes:** true
- **Implemented:** 2026-04-03

---

### #46 — Expanded Filter System
- **Description:** Expanded filter bar from labels-only to support priority, due date range, status, assignee, keyword, and project scope filters. All filters combine with AND logic. "+ Filter" button reveals additional filter options.
- **Spec Section:** N/A
- **Acceptance Criteria:** Filter bar supports labels, priority, due date, status, assignee, keyword, project scope. TaskRepository.search() enhanced for array filters. Works in project views, My Day, Calendar. Typecheck passes.
- **Passes:** true
- **Implemented:** 2026-04-03

---

### #47 — Saved Views / Smart Lists
- **Description:** Persist filter combinations as named views in the sidebar. Save as View button, collapsible sidebar section, Update View when filters change, broken filter warnings, MCP tools.
- **Spec Section:** N/A
- **Acceptance Criteria:** saved_views table, Save as View button, sidebar section with count badges, filter restoration, Update View button, broken filter warnings, MCP tools, typecheck passes.
- **Passes:** true
- **Implemented:** 2026-04-03

---

### #48 — Productivity Stats Dashboard
- **Description:** Stats view with completion trends, focus time charts, streaks with gamification, calendar heatmap, and team stats. Uses Recharts for visualizations.
- **Spec Section:** N/A
- **Acceptance Criteria:** Stats view with ⌘3 shortcut, overview cards, completion and focus charts, streaks with fire icon, 90-day heatmap, time range and project filters, team stats for shared projects, typecheck passes.
- **Passes:** true
- **Implemented:** 2026-04-03

---

### #49 — Project Areas / Folders
- **Description:** Group projects into collapsible single-level areas in the sidebar. Per-user area assignments, drag-drop assignment, MCP tools.
- **Spec Section:** N/A
- **Acceptance Criteria:** project_areas table, create/rename/reorder/delete areas, sidebar grouping, collapsible with persistence, drag between areas, per-user scoping, MCP tools, typecheck passes.
- **Passes:** true
- **Implemented:** 2026-04-03

---

### #50 — Exclusion Filters for Saved Views and Filter Bar
- **Description:** Add "is not" (exclusion) filter support across all filter types — labels, status, priority, assignee, and projects.
- **Spec Section:** N/A
- **Acceptance Criteria:** is-not filters for all types, separate FilterBar rows, muted-red styling, last-action-wins conflict resolution, works in all views, saved view persistence, TaskRepository.search exclusion support, MCP search_tasks exclusion params.
- **Passes:** true
- **Implemented:** 2026-04-08

---

### #51 — Supabase Full Sync Engine
- **Description:** Sync all data (personal and shared projects, settings, themes, saved views, areas) to Supabase automatically. SQLite local source of truth, background push, Realtime pull.
- **Spec Section:** N/A
- **Acceptance Criteria:** All data syncs automatically, new device pull, renamed Supabase tables, Realtime subscriptions, offline detection, personal projects editable offline, shared projects read-only offline, sync status icon, delete propagation.
- **Passes:** true
- **Implemented:** 2026-04-08

---

### #52 — Sidebar Customization
- **Description:** Show/hide and reorder sidebar navigation items, move Stats to footer, replace collapse toggle with light/dark mode toggle.
- **Spec Section:** N/A
- **Acceptance Criteria:** Toggle Calendar/Stats/Views/Archive/Templates, reorder via drag, My Day always visible, dynamic keyboard shortcuts, Stats in footer, light/dark toggle replaces collapse, sidebar always expanded.
- **Passes:** true
- **Implemented:** 2026-04-08

---

### #53 — Full Task Rows in Saved Views + Multi-Sort
- **Description:** Replace minimal SavedViewTaskRow with full TaskRow component, add multi-sort to saved views and project views, add colored dots to saved view sidebar items.
- **Spec Section:** N/A
- **Acceptance Criteria:** Full TaskRow in saved views, multi-sort dropdown, stackable sort rules, Custom sort enables drag, sort persistence, saved view color dots, auto-color assignment.
- **Passes:** true
- **Implemented:** 2026-04-08

---

### #54 — ToDoozy Telegram Bot
- **Description:** Node.js Telegram bot as Docker container on Raspberry Pi. Smart input parser for task creation, project listing, My Day, task completion via Supabase.
- **Spec Section:** N/A
- **Acceptance Criteria:** Smart input parser syntax, formatted confirmations, /project listing with done buttons, /done command, /myday command, whitelisted user IDs, label auto-creation, Docker deployment.
- **Passes:** true
- **Implemented:** 2026-04-08


---

### #55 — My Day Auto-Add
- **Description:** Automatically add tasks to My Day based on their due date, controlled by a global user setting.
- **Spec Section:** N/A
- **Acceptance Criteria:** myday_auto_add setting, myday_readd_dismissed setting, auto-add on launch, dismissed date tracking, simplified findMyDay queries
- **Passes:** true
- **Implemented:** 2026-04-11

---

### #56 — Per-Integration Default Project
- **Description:** Split shared Default Project setting into per-integration defaults for Telegram and iOS Shortcut.
- **Spec Section:** N/A
- **Acceptance Criteria:** Per-integration dropdowns, iOS follow Telegram option, updated /default command, quick_add_task RPC update
- **Passes:** true
- **Implemented:** 2026-04-11

---

### #57 — AND/OR Label Filter Logic
- **Description:** Add "is all of" (AND) mode for label filters, matching Linear's pattern.
- **Spec Section:** N/A
- **Acceptance Criteria:** Three-way operator toggle, AND filtering across all views, saved view persistence, MCP search support
- **Passes:** true
- **Implemented:** 2026-04-11

---

### #58 — Per-Project Auto-Archive
- **Description:** Auto-archive completed tasks per project with configurable timeframe.
- **Spec Section:** N/A
- **Acceptance Criteria:** Per-project auto-archive settings, configurable timeframe, auto-archive on app launch
- **Passes:** true
- **Implemented:** 2026-04-11

---

### #59 — Remote MCP Server via Supabase Edge Function
- **Description:** Deploy the ToDoozy MCP server as a Supabase Edge Function using Streamable HTTP transport. Remove the local stdio server entirely. Restructure the Integrations settings UI with shared API key section and simplified setup instructions.

---

## 1. Create `api_keys` table (Supabase migration)

Create migration `supabase/migrations/003_create_api_keys.sql`:

```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  key TEXT NOT NULL UNIQUE,
  name TEXT DEFAULT 'Default',
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  request_count INTEGER DEFAULT 0
);
CREATE INDEX idx_api_keys_key ON api_keys(key);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own keys" ON api_keys FOR ALL USING (user_id = auth.uid());

-- Migrate existing keys from user_settings
INSERT INTO api_keys (user_id, key)
SELECT user_id, value FROM user_settings WHERE key = 'api_key' AND value IS NOT NULL
ON CONFLICT (key) DO NOTHING;
```

Apply via Supabase CLI: `supabase db push` or `supabase migration up`.

## 2. Create Edge Function `supabase/functions/mcp/index.ts`

Create the directory `supabase/functions/mcp/`.

The Edge Function must:
- Use `@modelcontextprotocol/sdk` with `StreamableHTTPServerTransport` (import from npm: specifier in Deno)
- Read `Authorization: Bearer <api-key>` header from each request
- Look up user via: `SELECT user_id FROM api_keys WHERE key = $1` and increment request_count + update last_used_at in the same query: `UPDATE api_keys SET request_count = request_count + 1, last_used_at = now() WHERE key = $1 RETURNING user_id`
- Create a Supabase client with the service role key (from env `SUPABASE_SERVICE_ROLE_KEY`)
- Create repositories using `createSupabaseRepositories(client, userId)` pattern
- Register all 43 tool handlers — port directly from `src/main/mcp-server.ts` handler map (the `handlers` object starting at ~line 700)
- Handle CORS: respond to OPTIONS with appropriate headers
- Return 401 for invalid/missing API key
- Return 400 for malformed MCP requests

The tool definitions (names, descriptions, inputSchemas) are in the `tools` array in `src/main/mcp-server.ts` starting at ~line 200. Port them exactly.

The handler implementations are in the `handlers` object starting at ~line 700. They all follow the pattern: `async handlerName(args) { const repos = getRepos(); ... return result }`. Port them, replacing `getRepos()` with the repos created from the authenticated client, and `getUser()` with the user ID from the API key lookup.

The Supabase repos are in `src/main/supabase-repos/` — these files need to be copied/adapted for Deno imports. The key files:
- `src/main/supabase-repos/index.ts` — `createSupabaseRepositories` factory and interfaces
- `src/main/supabase-repos/TaskRepository.ts`
- `src/main/supabase-repos/ProjectRepository.ts`
- `src/main/supabase-repos/StatusRepository.ts`
- `src/main/supabase-repos/LabelRepository.ts`
- `src/main/supabase-repos/SettingsRepository.ts`
- `src/main/supabase-repos/SavedViewRepository.ts`
- `src/main/supabase-repos/ProjectAreaRepository.ts`
- `src/main/supabase-repos/ActivityLogRepository.ts`
- `src/main/supabase-repos/ProjectTemplateRepository.ts`

These repos use `@supabase/supabase-js` which works in Deno. Copy the repo files into `supabase/functions/mcp/repos/` and adapt imports for Deno (use npm: specifiers). The shared types from `src/shared/types.ts` also need to be copied/imported.

Reference the Supabase docs for Edge Function MCP deployment: https://supabase.com/docs/guides/getting-started/byo-mcp

## 3. Remove local MCP server

Delete these files/code:
- `src/main/mcp-server.ts` — the entire file
- In `electron.vite.config.ts` — remove `'mcp-server': resolve('src/main/mcp-server.ts')` from rollupOptions.input
- In `src/main/ipc-handlers.ts`:
  - Remove `mcp:getInfo` handler (~line 648-668)
  - Remove `mcp:isRunning` handler (~line 671-679)
  - Remove `writeMcpSession()` function (~line 68-89)
  - Remove `deleteMcpSession()` function (search for it near writeMcpSession)
  - Remove `writeMcpSession(sessionJson)` call from `auth:storeSession` handler (~line 95)
  - Remove `deleteMcpSession()` call from `auth:clearSession` handler (~line 102-104 area)
  - Remove `getMcpSessionPath` (~line 66)
- In `src/preload/index.d.ts` — remove `McpAPI` interface (~line 202-205) and `mcp` property from the main API interface
- In `src/preload/index.ts` — remove `mcp` object from the preload bridge
- Remove `mcp_enabled` setting handling from wherever it's used

## 4. Restructure Settings > Integrations UI

### 4a. Shared API key section at top of IntegrationsSettingsContent.tsx

Move the API key generate/revoke/copy UI from the iOS Shortcut sub-tab to a shared section above the sub-tabs. This section is always visible regardless of which sub-tab is selected.

Current API key UI is in `IntegrationsSettingsContent.tsx` lines 272-292 (inside the iOS Shortcut tab). Move it above the sub-tab bar (line 142).

### 4b. Rewrite McpSettingsContent.tsx

Replace the entire content. Remove the on/off toggle. Show setup instructions for:

**Claude Code** — copyable one-liner:
```
claude mcp add ToDoozy --transport http https://znmgsyjkaftbnhtlcxrm.supabase.co/functions/v1/mcp --header "Authorization: Bearer {apiKey}"
```

**Gemini CLI** — copyable one-liner:
```
gemini mcp add --transport http ToDoozy https://znmgsyjkaftbnhtlcxrm.supabase.co/functions/v1/mcp --header "Authorization: Bearer {apiKey}"
```

**Codex CLI** — copyable one-liner:
```
codex mcp add ToDoozy --url https://znmgsyjkaftbnhtlcxrm.supabase.co/functions/v1/mcp
```
With note: "Set TODOOZY_API_KEY environment variable to your API key above"

**JSON config** — copyable block for desktop clients:
```json
{
  "url": "https://znmgsyjkaftbnhtlcxrm.supabase.co/functions/v1/mcp",
  "headers": {
    "Authorization": "Bearer {apiKey}"
  }
}
```
With note: "Paste this into Claude Desktop, ChatGPT, or any MCP client that supports Streamable HTTP"

Each section uses `CopyField` or similar copy-to-clipboard pattern with the user's API key auto-filled.

Remove: `useSetting('mcp_enabled')`, the on/off toggle, the `Server ready` indicator, `window.api.mcp.getInfo()`, all ELECTRON_RUN_AS_NODE references.

### 4c. iOS Shortcut tab

Remove the API key section (now in shared area above). Keep the default project dropdown and setup steps, but update step references to say "use your API key from above".

## 5. Update `.mcp.json`

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=znmgsyjkaftbnhtlcxrm"
    },
    "ToDoozy": {
      "type": "http",
      "url": "https://znmgsyjkaftbnhtlcxrm.supabase.co/functions/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${TODOOZY_API_KEY}"
      }
    }
  }
}
```

## 6. Deploy

After implementation, deploy with:
```bash
supabase functions deploy mcp
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<key>
```

## 7. Update `quick_add_task` to use `api_keys` table

Update the Supabase `quick_add_task` function to look up API keys from the new `api_keys` table instead of `user_settings`:

```sql
-- Replace the existing lookup:
SELECT us.user_id INTO v_user_id
FROM user_settings us
WHERE us.key = 'api_key' AND us.value = p_api_key::text;

-- With:
SELECT ak.user_id INTO v_user_id
FROM api_keys ak
WHERE ak.key = p_api_key;

-- Also increment request count:
UPDATE api_keys SET request_count = request_count + 1, last_used_at = now()
WHERE key = p_api_key;
```

## 8. Update IntegrationsSettingsContent.tsx API key handlers

The `handleGenerateApiKey` and `handleRevokeApiKey` functions currently write to `user_settings`. Update them to write to the `api_keys` table instead:

- Generate: `INSERT INTO api_keys (user_id, key, name) VALUES (userId, newKey, 'Default')`
- Revoke: `DELETE FROM api_keys WHERE user_id = userId AND key = currentKey`
- Read: `SELECT key FROM api_keys WHERE user_id = userId LIMIT 1`

Keep the local `setSetting('api_key', key)` for the settings store cache, but the source of truth moves to `api_keys`.

Before marking passes: true: read ui-reference.md and debug-learnings.md. Write tests for any new repository methods or utility functions. Run npm run test — all existing and new tests must pass. Run npm run typecheck — zero errors.
- **Spec Section:** N/A
- **Acceptance Criteria:**
  - Edge Function deployed at https://znmgsyjkaftbnhtlcxrm.supabase.co/functions/v1/mcp
  - All 43 MCP tools work via Streamable HTTP with API key auth
  - api_keys table created with request_count and last_used_at tracking
  - Existing API keys migrated from user_settings to api_keys
  - request_count increments on each MCP request
  - Local stdio MCP server removed (mcp-server.ts, IPC handlers, preload bridge, session file handling)
  - Settings > Integrations shows shared API key section above sub-tabs
  - MCP Server tab shows setup instructions for Claude Code, Gemini CLI, Codex CLI, and JSON config
  - iOS Shortcut tab no longer has its own API key section
  - MCP on/off toggle removed
  - .mcp.json updated with ToDoozy remote entry using env var for API key
  - claude mcp add command from the UI works to connect Claude Code
  - No ELECTRON_RUN_AS_NODE anywhere in the setup flow
  - quick_add_task Supabase function uses api_keys table instead of user_settings
  - Invalid/missing API key returns 401
  - npm run typecheck passes with zero errors
  - npm run test passes with all existing and new tests
- **Passes:** true
- **Tested:** true
- **Implemented:** 2026-04-20

---

### #60 — Natural Language Date & Recurrence Parsing
- **Description:** Add chrono-node and rrule.js NLP to parse natural language dates and recurring patterns from task input text. Todoist-style: dates are detected and highlighted inline as the user types, clickable to dismiss false positives. On submit, date text is stripped from the title and set as due_date (and recurrence_rule for recurring patterns). Works in: Electron quick-add bar (all views), Telegram bot, and MCP set_task_recurrence.

---

## 1. Install dependencies

**Electron app:**
```bash
npm install chrono-node rrule
```

**Telegram bot:**
```bash
cd packages/telegram-bot && npm install chrono-node rrule
```

## 2. Create shared NLP date parser utility

Create `src/shared/nlpDateParser.ts` (shared between renderer and potentially main process):

```typescript
import * as chrono from 'chrono-node'
import { RRule } from 'rrule'
import { serializeRecurrence, type RecurrenceConfig } from './recurrenceUtils'

export interface NlpDateResult {
  date: Date                    // Parsed date (or next occurrence for recurring)
  text: string                  // The matched text span ("tomorrow at 2pm")
  index: number                 // Start index in original text
  endIndex: number              // End index in original text
  recurrenceRule: string | null // Canonical recurrence rule if recurring, null otherwise
}

/**
 * Parse natural language dates and recurring patterns from text.
 * Returns null if no date found. Recurring patterns checked first.
 */
export function parseNlpDate(text: string, referenceDate?: Date): NlpDateResult | null {
  const ref = referenceDate ?? new Date()
  
  // 1. Check for recurring patterns first (rrule NLP)
  const recurResult = parseRecurring(text, ref)
  if (recurResult) return recurResult
  
  // 2. Try chrono-node for one-time dates
  const results = chrono.parse(text, ref, { forwardDate: true })
  if (results.length === 0) return null
  
  // Use the first (most confident) result
  const r = results[0]
  return {
    date: r.start.date(),
    text: r.text,
    index: r.index,
    endIndex: r.index + r.text.length,
    recurrenceRule: null
  }
}

/**
 * Parse "every ..." recurring patterns using rrule.js NLP.
 * Maps rrule output to our canonical recurrence format.
 */
function parseRecurring(text: string, ref: Date): NlpDateResult | null {
  // Find "every ..." pattern in text
  const match = text.match(/\b(every\s+(?:other\s+)?(?:day|week(?:day)?|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+\s+(?:days?|weeks?|months?|years?))(?:\s+(?:on|at)\s+[\w,\s]+)?)\b/i)
  if (!match) return null
  
  const phrase = match[0]
  const idx = match.index!
  
  try {
    const rrule = RRule.parseText(phrase)
    if (!rrule) return null
    
    // Convert rrule options to our canonical format
    const config = rruleToCanonical(rrule)
    if (!config) return null
    
    const rule = serializeRecurrence(config)
    
    // Get next occurrence as initial due date
    const rr = new RRule({ ...rrule, dtstart: ref })
    const next = rr.after(ref, true)
    
    return {
      date: next ?? ref,
      text: phrase,
      index: idx,
      endIndex: idx + phrase.length,
      recurrenceRule: rule
    }
  } catch {
    return null
  }
}

const RRULE_DAY_MAP: Record<number, string> = {
  0: 'mon', 1: 'tue', 2: 'wed', 3: 'thu', 4: 'fri', 5: 'sat', 6: 'sun'
}

function rruleToCanonical(opts: Partial<InstanceType<typeof RRule>['options']>): RecurrenceConfig | null {
  const freq = opts.freq
  const interval = opts.interval ?? 1
  
  if (freq === RRule.DAILY) {
    return { interval, unit: 'days', afterCompletion: false }
  }
  if (freq === RRule.WEEKLY) {
    const days = opts.byweekday?.map((d: number) => RRULE_DAY_MAP[d]).filter(Boolean)
    const config: RecurrenceConfig = { interval, unit: 'weeks', afterCompletion: false }
    if (days && days.length > 0) config.weekDays = days
    return config
  }
  if (freq === RRule.MONTHLY) {
    const config: RecurrenceConfig = { interval, unit: 'months', afterCompletion: false }
    if (opts.bymonthday?.length) config.monthDay = opts.bymonthday[0]
    return config
  }
  if (freq === RRule.YEARLY) {
    return { interval, unit: 'years', afterCompletion: false }
  }
  return null
}

/**
 * Strip the detected date text from the task title, cleaning up whitespace.
 */
export function stripDateFromTitle(title: string, result: NlpDateResult): string {
  const before = title.slice(0, result.index)
  const after = title.slice(result.endIndex)
  return (before + ' ' + after).replace(/\s+/g, ' ').trim()
}
```

## 3. Integrate NLP into smartInputParser.ts

In `src/renderer/src/shared/hooks/smartInputParser.ts`:

### 3a. Add import at top:
```typescript
import { parseNlpDate, type NlpDateResult } from '../../../../shared/nlpDateParser'
```

### 3b. Add NLP fallback to `filterDates()` (lines 184-272)

After the existing preset/explicit format matching (which returns early if matched), add at the end before the final return:

```typescript
// NLP fallback via chrono-node
const nlpResult = parseNlpDate(query)
if (nlpResult) {
  results.push({
    label: nlpResult.text,
    date: formatIso(nlpResult.date),
    formatted: formatDateDisplay(nlpResult.date)
  })
}
```

This way `d:tomorrow at 2pm` or `d:next friday` work through the operator popup.

### 3c. Add always-on NLP detection to useSmartInput.ts

In `src/renderer/src/shared/hooks/useSmartInput.ts`, add a new state field:

```typescript
// Add to state
nlpDateResult: NlpDateResult | null
```

In `handleInputChange()` (line 96), after updating input value, run NLP detection on the full text:

```typescript
// Only run NLP if no explicit d: operator and no date already selected
if (!state.selectedDate && !text.includes('d:')) {
  const nlpResult = parseNlpDate(text)
  // Only accept if the detected text is not the entire input (avoid matching bare task titles like "call May")
  if (nlpResult && nlpResult.text.length < text.length * 0.8) {
    set({ nlpDateResult: nlpResult })
  } else {
    set({ nlpDateResult: null })
  }
}
```

In `getSubmitData()` (line 245), use NLP result if no explicit date:

```typescript
const dueDate = state.selectedDate ?? (state.nlpDateResult ? formatIso(state.nlpDateResult.date) : null)
const recurrenceRule = state.nlpDateResult?.recurrenceRule ?? null
const title = state.nlpDateResult ? stripDateFromTitle(state.inputValue, state.nlpDateResult) : state.inputValue
```

In `reset()` (line 233), clear NLP state:
```typescript
nlpDateResult: null
```

## 4. Add inline highlighting to AddTaskInput.tsx

In `src/renderer/src/features/tasks/AddTaskInput.tsx`:

The input is a plain `<input>` element. To highlight detected date text inline, we need to overlay styled spans on top of it. This is the Todoist pattern: a transparent input on top, with a styled div behind showing the same text with highlights.

Add a ref to track the NLP result from useSmartInput:
```typescript
const nlpResult = smart.nlpDateResult
```

Add a highlight overlay behind the input:
```typescript
{nlpResult && (
  <div className="pointer-events-none absolute inset-0 flex items-center px-3 font-light text-[15px] tracking-tight whitespace-pre overflow-hidden" aria-hidden>
    <span className="invisible">{inputValue.slice(0, nlpResult.index)}</span>
    <span 
      className="rounded bg-accent/15 text-accent cursor-pointer pointer-events-auto"
      onClick={() => smart.dismissNlpDate()}
    >
      {inputValue.slice(nlpResult.index, nlpResult.endIndex)}
    </span>
    <span className="invisible">{inputValue.slice(nlpResult.endIndex)}</span>
  </div>
)}
```

The input element needs `className="... relative"` and `color: transparent` when NLP is active (so the overlay text shows through, but cursor and selection still work), or use a simpler approach: just show a date chip below/beside the input (like the label chips) that the user can click to dismiss.

**Simpler approach (recommended):** Show an NLP date chip next to any existing label/priority chips below the input:

```typescript
{nlpResult && (
  <button
    onClick={() => smart.dismissNlpDate()}
    className="inline-flex items-center gap-1 rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-bold text-accent"
    title="Click to remove detected date"
  >
    {nlpResult.recurrenceRule ? '🔄' : '📅'} {nlpResult.text} → {formatDateDisplay(nlpResult.date)}
    <X size={10} />
  </button>
)}
```

Add `dismissNlpDate()` to useSmartInput:
```typescript
dismissNlpDate(): void {
  set({ nlpDateResult: null })
  // Add current NLP text span to suppressed positions so it doesn't re-detect
  suppressedNlpRef.current = true
}
```

## 5. Integrate NLP into Telegram bot parser

In `packages/telegram-bot/src/parser.ts`:

### 5a. Add import:
```typescript
import * as chrono from 'chrono-node'
import { RRule } from 'rrule'
```

### 5b. Update parseMessage()

After processing all tokens and extracting any explicit `d:` date, if no date was found, run chrono-node on the remaining title text:

```typescript
// After token loop, if no explicit date found:
if (!result.dueDate) {
  const chronoResults = chrono.parse(result.title, new Date(), { forwardDate: true })
  if (chronoResults.length > 0) {
    const r = chronoResults[0]
    result.dueDate = r.start.date().toISOString().slice(0, 10)
    // Include time if detected
    if (r.start.isCertain('hour')) {
      result.dueDate = r.start.date().toISOString()
    }
    // Strip the date text from the title
    result.title = (result.title.slice(0, r.index) + result.title.slice(r.index + r.text.length)).replace(/\s+/g, ' ').trim()
  }
}

// Check for recurring patterns in original title
if (!result.recurrenceRule) {
  const everyMatch = result.title.match(/\b(every\s+.+?)(?:\s+@|\s+#|\s+\/|\s+d:|\s+p:|\s+r:|\s+s:|$)/i)
  if (everyMatch) {
    try {
      const rruleOpts = RRule.parseText(everyMatch[1])
      if (rruleOpts) {
        // Convert to canonical format (reuse the mapping logic)
        result.recurrenceRule = rruleOptsToCanonical(rruleOpts)
        result.title = result.title.replace(everyMatch[1], '').replace(/\s+/g, ' ').trim()
        // Set due date to next occurrence if not already set
        if (!result.dueDate) {
          const rr = new RRule({ ...rruleOpts, dtstart: new Date() })
          const next = rr.after(new Date(), true)
          if (next) result.dueDate = next.toISOString().slice(0, 10)
        }
      }
    } catch { /* ignore parse failures */ }
  }
}
```

### 5c. Add recurrenceRule to ParsedMessage interface and return object

In the `ParsedMessage` interface, add:
```typescript
recurrenceRule: string | null
```

Initialize in parseMessage: `recurrenceRule: null`

### 5d. Update task creation in index.ts

Where the bot creates tasks from parsed messages, pass `recurrence_rule: parsed.recurrenceRule` to the task creation call.

## 6. MCP set_task_recurrence NLP fallback

In `src/main/mcp-server.ts`, in the `set_task_recurrence` handler:

Currently it takes `recurrence_rule` as a canonical string. Add rrule NLP as a fallback:

```typescript
async set_task_recurrence(args) {
  const repos = getRepos()
  let rule = optStr(args, 'recurrence_rule')
  
  // Try rrule NLP if the rule doesn't match canonical format
  if (rule && !rule.startsWith('every:') && !rule.startsWith('every!:')) {
    try {
      const rruleOpts = RRule.parseText(rule)
      if (rruleOpts) {
        rule = rruleOptsToCanonical(rruleOpts)
      }
    } catch { /* use as-is */ }
  }
  
  // ... rest of handler
}
```

## 7. Due date with time support

Currently `due_date` stores `YYYY-MM-DD` (date only). Chrono-node can detect times ("tomorrow at 2pm"). We need to decide: store times in `due_date` as full ISO string, or add a separate `due_time` field?

**Recommendation:** Store as full ISO string when time is present (`2026-04-12T14:00:00.000Z`), keep `YYYY-MM-DD` when no time. The existing code checks `.slice(0, 10)` for date comparisons, so this is backwards compatible. Update the UI to show time when present.

In `smartInputParser.ts filterDates()`, when chrono detects a time component:
```typescript
if (nlpResult.date.getHours() !== 0 || nlpResult.date.getMinutes() !== 0) {
  // Include time in ISO string
  date = nlpResult.date.toISOString()
} else {
  date = formatIso(nlpResult.date)  // YYYY-MM-DD only
}
```

## 8. Edge Cases

- **False positives**: "Call May" → chrono might detect "May" as the month. The 80% length check in useSmartInput helps. Also, single-word matches at the start of input should be ignored.
- **Explicit `d:` wins**: If the user typed `d:tomorrow`, skip NLP entirely
- **Existing label `@` syntax conflict**: chrono-node might try to parse `@3pm`. Run NLP only on text that doesn't contain our operator prefixes, or strip operators before running chrono.
- **Timezone**: chrono-node uses local timezone by default. This matches the existing behavior.
- **Empty title after stripping**: If the entire input is a date ("tomorrow"), create task with title "Untitled" or reject with a toast.
- **Multiple dates in text**: Use only the first chrono result.
- **Recurring + one-time**: If both "every Monday" and "at 3pm" are detected, the recurring pattern sets the rule, and chrono sets the time on the next occurrence.

Before marking passes: true: read ui-reference.md and debug-learnings.md. Write tests for any new repository methods or utility functions. Run npm run test — all existing and new tests must pass. Run npm run typecheck — zero errors.
- **Spec Section:** N/A
- **Acceptance Criteria:**
  - chrono-node and rrule installed in both Electron app and Telegram bot
  - Typing 'buy groceries tomorrow at 2pm' in quick-add detects and highlights 'tomorrow at 2pm'
  - Date chip/highlight shown as user types (Todoist-style always-on detection)
  - Clicking the date chip dismisses the detected date (opt-out for false positives)
  - On Enter, date text stripped from title, due_date set to detected date
  - Time preserved in due_date as full ISO string when chrono detects time
  - Explicit d: operator takes priority over NLP detection
  - 'every Monday' sets recurrence_rule to every:1:weeks:mon and due_date to next Monday
  - 'every 2 weeks' sets recurrence_rule to every:2:weeks and due_date to 2 weeks from now
  - 'every day' sets recurrence_rule to every:1:days and due_date to tomorrow
  - 'every weekday' sets recurrence_rule to every:1:weeks:mon,tue,wed,thu,fri
  - Telegram bot: 'buy milk tomorrow' without d: prefix detects tomorrow as due date
  - Telegram bot: 'standup every monday' sets recurrence_rule and due_date
  - Telegram bot: explicit d:tomorrow still works and takes priority over NLP
  - MCP set_task_recurrence accepts natural language like 'every Monday' as fallback
  - False positive 'Call May' does NOT set May as due date (length/confidence check)
  - Empty title after date stripping shows error or uses 'Untitled'
  - NLP works in all project quick-add bars and My Day quick-add
  - npm run typecheck passes with zero errors
  - npm run test passes with all existing and new tests
- **Passes:** true
- **Tested:** true
- **Implemented:** 2026-04-20

---

### #61 — Enhanced Timer: Long Break, Flowtime Mode, Session Stats
- **Description:** Close three gaps between ToDoozy's timer and Super Productivity's pomodoro: (1) long break after N work sessions, (2) flowtime mode (open-ended stopwatch counting up), (3) daily session stats display in overlay and tray.

---

## 1. Extend TimerState interface

In `src/renderer/src/shared/stores/timerStore.ts`, the `TimerState` interface is at lines 21-39. Add these fields after `autoBreak` (line 39):

```typescript
isFlowtime: boolean            // Flowtime: counts up instead of down
elapsedSeconds: number          // Flowtime: seconds elapsed in work phase
longBreakSeconds: number        // Long break duration in seconds
longBreakInterval: number       // Work sessions before long break (0 = disabled)
isLongBreak: boolean            // Currently in a long break
sessionsCompleted: number       // Work sessions completed today
totalFocusSecondsToday: number  // Total focus seconds today
statsDate: string | null        // ISO date for daily reset
```

## 2. Extend StartTimerParams

In the same file, `StartTimerParams` is at lines 49-60. Add:

```typescript
isFlowtime?: boolean
longBreakMinutes?: number
longBreakInterval?: number
```

## 3. Update initialState

The initial state is set in the store creation (search for `isRunning: false` near line 85-100). Add defaults for all new fields:

```typescript
isFlowtime: false,
elapsedSeconds: 0,
longBreakSeconds: 900,  // 15 min
longBreakInterval: 0,   // disabled
isLongBreak: false,
sessionsCompleted: 0,
totalFocusSecondsToday: 0,
statsDate: null,
```

## 4. Update startTimer()

At lines 105-134, the `startTimer` function calls `set({...})`. Add new fields to the set call:

```typescript
isFlowtime: params.isFlowtime ?? false,
elapsedSeconds: 0,
longBreakSeconds: (params.longBreakMinutes ?? 15) * 60,
longBreakInterval: params.longBreakInterval ?? 0,
isLongBreak: false,
```

Also add daily stats reset check at the start of `startTimer()`, before the existing `clearTickInterval()`:

```typescript
const today = new Date().toISOString().slice(0, 10)
const prevState = get()
if (prevState.statsDate !== today) {
  set({ sessionsCompleted: 0, totalFocusSecondsToday: 0, statsDate: today })
}
```

## 5. Update tick()

At lines 164-175, the `tick()` function decrements `remainingSeconds`. Replace the body with:

```typescript
tick(): void {
  const state = get()
  if (!state.isRunning || state.isPaused) return

  if (state.isFlowtime && state.phase === 'work') {
    // Flowtime: count UP
    const next = state.elapsedSeconds + 1
    set({ elapsedSeconds: next })
    // Sync tray every 5 seconds to avoid excessive IPC
    if (next % 5 === 0) syncTrayTimer({ ...state, elapsedSeconds: next })
  } else {
    // Normal: count DOWN
    const next = state.remainingSeconds - 1
    if (next <= 0) {
      completePhase(get, set)
    } else {
      set({ remainingSeconds: next })
      syncTrayTimer({ ...state, remainingSeconds: next })
    }
  }
}
```

## 6. Update completePhase()

At lines 180-216. After the activity log call (line ~197), add session tracking:

```typescript
// After logFocusSession call:
const elapsed = state.workSeconds
set((s) => ({
  sessionsCompleted: s.sessionsCompleted + 1,
  totalFocusSecondsToday: s.totalFocusSecondsToday + elapsed
}))
```

Replace the break transition logic (lines 200-206) with long break awareness:

```typescript
if (state.autoBreak) {
  const updatedState = get()
  const isLongBreak = state.longBreakInterval > 0
    && updatedState.sessionsCompleted > 0
    && updatedState.sessionsCompleted % state.longBreakInterval === 0

  const breakDuration = isLongBreak ? state.longBreakSeconds : state.breakSeconds

  if (breakDuration > 0) {
    set({
      phase: 'break',
      remainingSeconds: breakDuration,
      isLongBreak
    })
    syncTrayTimer(get())
    return
  }
}
```

## 7. Update stop()

At lines 148-162. Add flowtime logging. Before the existing `if (state.isRunning && ...)` block:

```typescript
if (state.isRunning && state.isFlowtime && state.phase === 'work' && state.elapsedSeconds > 60) {
  const minutes = Math.round(state.elapsedSeconds / 60)
  if (state.taskId && cachedUserId && minutes > 0) {
    logFocusSession(state.taskId, cachedUserId, minutes)
  }
  set((s) => ({
    sessionsCompleted: s.sessionsCompleted + 1,
    totalFocusSecondsToday: s.totalFocusSecondsToday + state.elapsedSeconds
  }))
} else if (state.isRunning && state.taskId && cachedUserId && state.phase === 'work') {
  // existing stop-during-work logging (lines 153-158)
  ...
}
```

Make sure the existing else branch handles the normal countdown stop case.

## 8. Update TimerOverlay

`src/renderer/src/shared/components/TimerOverlay.tsx` is 81 lines. Make these changes:

### 8a. Add store subscriptions (after line 12):
```typescript
const isFlowtime = useTimerStore((s) => s.isFlowtime)
const elapsedSeconds = useTimerStore((s) => s.elapsedSeconds)
const isLongBreak = useTimerStore((s) => s.isLongBreak)
const sessionsCompleted = useTimerStore((s) => s.sessionsCompleted)
const totalFocusSecondsToday = useTimerStore((s) => s.totalFocusSecondsToday)
```

### 8b. Update time display (replace lines 19-21):
```typescript
const displaySeconds = (isFlowtime && phase === 'work') ? elapsedSeconds : remainingSeconds
const minutes = Math.floor(displaySeconds / 60)
const seconds = displaySeconds % 60
const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`
```

### 8c. Update phase label (replace lines 30-35):
```typescript
const phaseLabel = phase === 'work'
  ? (isFlowtime ? 'Flowtime' : 'Focus')
  : isLongBreak
    ? 'Long Break'
    : 'Break'

const phaseColor = phase === 'work'
  ? 'text-accent'
  : isLongBreak
    ? 'text-amber-400'
    : 'text-emerald-400'
```

Use `phaseColor` in the phase label `<p>` and the countdown `<p>` class.

### 8d. Add session stats footer (after controls div, before closing `</div>`):
```typescript
{sessionsCompleted > 0 && (
  <p className="mt-8 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
    {sessionsCompleted} {sessionsCompleted === 1 ? 'session' : 'sessions'} &middot; {Math.round(totalFocusSecondsToday / 60)}m focused today
  </p>
)}
```

## 9. Update TimerPlayButton

In `src/renderer/src/shared/components/TimerPlayButton.tsx`:

### 9a. Read new settings in the component

In `useTimerSettings.ts` (lines 1-52), add to the `TimerSettings` interface:
```typescript
flowtimeEnabled: boolean
longBreakEnabled: boolean
longBreakMinutes: number
longBreakInterval: number
```

Add to `useTimerSettings()`:
```typescript
const flowtimeEnabled = useSetting('timer_flowtime_enabled')
const longBreakEnabled = useSetting('timer_long_break_enabled')
const longBreakMinutesRaw = useSetting('timer_long_break_minutes')
const longBreakIntervalRaw = useSetting('timer_long_break_interval')
```

Add to the return object:
```typescript
flowtimeEnabled: flowtimeEnabled === 'true',
longBreakEnabled: longBreakEnabled === 'true',
longBreakMinutes: parseInt(longBreakMinutesRaw ?? '15', 10) || 15,
longBreakInterval: parseInt(longBreakIntervalRaw ?? '4', 10) || 4,
```

Add these to the `useMemo` dependency array.

### 9b. Update handleStartTimer in TimerPlayButton

The `handleStartTimer` call (lines 46-57) needs new params:
```typescript
startTimer({
  ...existing params,
  isFlowtime: isFlowtime,  // from popup state
  longBreakMinutes: settings.longBreakEnabled ? settings.longBreakMinutes : 0,
  longBreakInterval: settings.longBreakEnabled ? settings.longBreakInterval : 0,
})
```

### 9c. Update TimerPopup (lines 155-230)

Add flowtime toggle state:
```typescript
const [isFlowtime, setIsFlowtime] = useState(false)
```

Add flowtime toggle UI before the preset info (after the "Start Timer" heading):
```typescript
{settings.flowtimeEnabled && (
  <div className="mb-3 flex items-center justify-between">
    <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Flowtime</span>
    <button
      onClick={() => setIsFlowtime(!isFlowtime)}
      className={`relative h-5 w-9 rounded-full transition-colors ${isFlowtime ? 'bg-accent' : 'bg-border'}`}
    >
      <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${isFlowtime ? 'translate-x-4' : ''}`} />
    </button>
  </div>
)}
```

When flowtime is on, hide preset info and rep controls:
```typescript
{!isFlowtime && (
  <>
    <p className="mb-3 text-sm font-light text-foreground">
      {settings.defaultPreset.name} ({settings.defaultPreset.minutes}m)
    </p>
    {/* existing rep selector or perpetual label */}
  </>
)}
```

Update `handleConfirm` to pass flowtime:
```typescript
onStart(
  settings.defaultPreset.minutes,
  isFlowtime ? 0 : (settings.perpetualMode ? 0 : reps),
  isFlowtime ? false : settings.perpetualMode,
  isFlowtime  // new param
)
```

Update `onStart` prop type and the non-popup direct start path (line 63-76) to also pass `isFlowtime: false`.

### 9d. Non-popup direct start

When repetition is NOT enabled (lines 68-75), also check if flowtime should be the default:
```typescript
if (!settings.repetitionEnabled && !settings.flowtimeEnabled) {
  handleStartTimer(settings.defaultPreset.minutes, 1, false, false)
  return
}
// If either enabled, show popup
```

## 10. Update Tray

In `src/main/tray.ts`, the timer display is at lines 226-239.

### 10a. Update TimerTrayState type

Search for `TimerTrayState` interface (likely in tray.ts or a shared type). Add:
```typescript
isFlowtime?: boolean
elapsedSeconds?: number
isLongBreak?: boolean
sessionsCompleted?: number
totalFocusSecondsToday?: number
```

### 10b. Update display logic (lines 226-239):

```typescript
if (timerState) {
  const displaySeconds = (timerState.isFlowtime && timerState.phase === 'work')
    ? (timerState.elapsedSeconds ?? 0)
    : timerState.remainingSeconds
  const timeStr = formatTimerDisplay(displaySeconds)
  const phaseIcon = timerState.phase === 'break'
    ? (timerState.isLongBreak ? '🧘' : '☕')
    : (timerState.isFlowtime ? '🌊' : '⏱')
  const repStr = timerState.isPerpetual
    ? ` ${timerState.currentRep}`
    : timerState.totalReps > 1
      ? ` ${timerState.currentRep}/${timerState.totalReps}`
      : ''
  tray.setTitle(`${phaseIcon} ${timeStr}${repStr}`)
}
```

### 10c. Update syncTrayTimer calls

In `timerStore.ts`, the `syncTrayTimer()` function sends state to tray via IPC. Make sure it includes the new fields (`isFlowtime`, `elapsedSeconds`, `isLongBreak`, `sessionsCompleted`, `totalFocusSecondsToday`).

## 11. Timer Settings UI

In `src/renderer/src/features/settings/TimerSettingsContent.tsx`, add after the auto-break toggle (line ~218) and before "Repetition" section:

```typescript
{/* Long Break */}
{autoBreak === 'true' && (
  <>
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-light text-foreground">Long break</p>
        <p className="text-[10px] text-muted">Longer rest after several work sessions</p>
      </div>
      <ToggleButton settingKey="timer_long_break_enabled" defaultValue="false" />
    </div>

    {longBreakEnabled === 'true' && (
      <>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-light text-foreground">Long break duration</p>
            <p className="text-[10px] text-muted">Duration of the long break</p>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number" min={1} max={60}
              value={longBreakMinutes}
              onChange={(e) => setSetting('timer_long_break_minutes', e.target.value)}
              className="w-14 rounded-lg border border-border bg-transparent px-2 py-1.5 text-center text-sm font-light text-foreground focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">min</span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-light text-foreground">Long break every</p>
            <p className="text-[10px] text-muted">Work sessions before long break</p>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number" min={2} max={10}
              value={longBreakInterval}
              onChange={(e) => setSetting('timer_long_break_interval', e.target.value)}
              className="w-14 rounded-lg border border-border bg-transparent px-2 py-1.5 text-center text-sm font-light text-foreground focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">sessions</span>
          </div>
        </div>
      </>
    )}
  </>
)}
```

Add after perpetual mode (line ~256):
```typescript
{/* Flowtime */}
<div className="flex items-center justify-between">
  <div>
    <p className="text-sm font-light text-foreground">Flowtime mode</p>
    <p className="text-[10px] text-muted">Open-ended focus — timer counts up, you decide when to stop</p>
  </div>
  <ToggleButton settingKey="timer_flowtime_enabled" defaultValue="false" />
</div>
```

Add the necessary `useSetting` calls at the top of the component:
```typescript
const longBreakEnabled = useSetting('timer_long_break_enabled')
const longBreakMinutes = useSetting('timer_long_break_minutes') ?? '15'
const longBreakInterval = useSetting('timer_long_break_interval') ?? '4'
const autoBreak = useSetting('timer_auto_break')
```

## 12. Edge Cases

- Long break interval = 0 or disabled: never trigger long break, use normal break
- Flowtime + perpetual: flowtime doesn't use reps — hide rep/perpetual controls when flowtime is on
- Flowtime + auto-break: after manual stop, if auto-break enabled, start a normal break
- Session stats reset: check date in startTimer(), not on app launch (avoids stale state)
- Stop during long break: don't log as focus time (phase is 'break')
- Pause in flowtime: pause the elapsedSeconds counter (existing isPaused check in tick() handles this)
- Flowtime direct start (no popup): if flowtime is the only mode enabled (no repetition), start flowtime directly without popup
- Stats not persisted to DB: resets on app restart — acceptable for v1

Before marking passes: true: read ui-reference.md and debug-learnings.md. Write tests for any new repository methods or utility functions. Run npm run test — all existing and new tests must pass. Run npm run typecheck — zero errors.
- **Spec Section:** N/A
- **Acceptance Criteria:**
  - Long break toggle in Timer settings, visible only when auto-break is on
  - Long break duration (1-60 min) and interval (2-10 sessions) configurable
  - After N work sessions, break phase uses long break duration with amber 'Long Break' label
  - Overlay shows 'Long Break' in amber-400 color, distinct from normal break (emerald-400)
  - Tray shows yoga emoji for long break, wave emoji for flowtime, coffee for normal break
  - Flowtime toggle in Timer settings
  - When flowtime enabled, play button popup shows Flowtime on/off switch
  - Flowtime hides preset and rep controls in popup
  - In flowtime mode, overlay timer counts UP (stopwatch style)
  - Overlay shows 'Flowtime' label in accent color during flowtime work phase
  - Manual stop in flowtime logs elapsed time as focus session if > 1 minute
  - Session stats shown in overlay footer: 'N sessions · Xm focused today'
  - Session stats reset when date changes (checked on timer start)
  - Tray countdown displays correctly for all modes: normal, flowtime (count up), long break
  - Pausing in flowtime freezes the elapsed counter
  - Long break disabled by default, flowtime disabled by default
  - Flowtime direct start (no popup) when repetition is also disabled
  - npm run typecheck passes with zero errors
  - npm run test passes with all existing and new tests
- **Passes:** true
- **Tested:** true
- **Implemented:** 2026-04-20

---

### #62 — Import and export themes as JSON
- **Description:** Users can export any theme from Settings → Theme to a `.todoozy-theme.json` file and import theme files back. Both flows live as Download/Upload icon buttons next to the theme selector. Exports bundle both dark and light counterparts. Imports always create both counterparts. Name collisions auto-resolve with `(Imported)` suffix. New `themeIO.ts` utility with full Vitest coverage.
- **Spec Section:** N/A
- **Acceptance Criteria:** Download/Upload icon buttons, native Save/Open dialogs, valid JSON schema with both configs, collision resolution, error modal for validation failures, imported themes sync like custom themes, Vitest tests pass.
- **Passes:** true
- **Implemented:** 2026-04-30

---

### #63 — Theme save icon only appears when color values actually differ from saved theme
- **Description:** Fixed `handlePresetChange` setting `configEdited = true` on any dropdown switch even without color edits. Now auto-persists dropdown selection and only shows the Save icon when colors have actually been edited via `colorsEdited`. Mode toggle also auto-persists.
- **Spec Section:** N/A
- **Acceptance Criteria:** Save icon not shown on dropdown switch, shown only after color edit, dropdown switch persists theme_id/theme_mode immediately, Apply Theme button still works.
- **Passes:** true
- **Implemented:** 2026-04-30

---

### #64 — Cmd+K command palette matches against task UUID
- **Description:** Extended text-search in `useCommandPaletteSearch.ts` to also match against `task.id` (substring). Extracted `matchesTextTerms(task, textTerms)` pure helper for testability. Full Vitest coverage: full UUID, partial UUID, middle-substring, no false positives, title regression, multi-term AND.
- **Spec Section:** N/A
- **Acceptance Criteria:** Full/partial/middle UUID search works, no false positives, title search unchanged, AND semantics preserved, all tests pass.
- **Passes:** true
- **Implemented:** 2026-04-30

---

### #65 — Profile Settings (Display Name + Password Change + Forgot Password)
- **Description:** Added Profile tab as first tab in `UnifiedSettingsModal`. `ProfileSettingsContent` component with three sections: Account (email read-only), Display Name (first/last autosave 1s debounce, offline fallback via `profile_sync_pending` setting), Password (change password with validation, Eye/EyeOff toggles). Deployed `send-password-reset` edge function. Created `docs/reset-password.html` and `docs/no-password.html` for OAuth redirect flows. Added profile sync retry in both `onRecovered` callbacks in `authStore`.
- **Spec Section:** N/A
- **Acceptance Criteria:** Profile tab visible, display name autosaves, password can be changed, forgot password flow works.
- **Passes:** true
- **Implemented:** 2026-05-01

---

### #66 — Save Login Credentials (Email Pre-Fill + Keychain Password)
- **Description:** Installed `keytar`. Added 5 IPC handlers (`auth:saveEmail`, `auth:getSavedEmail`, `auth:savePassword`, `auth:getSavedPassword`, `auth:clearCredentials`). `authStore.signInWithEmail` returns `Promise<boolean>` and saves credentials on success. `AppLayout` shows "Save password to Keychain?" persistent toast on first login. `LoginScreen` pre-fills saved email/password on mount.
- **Spec Section:** N/A
- **Acceptance Criteria:** Email pre-filled on re-open, password from Keychain, toast to save password shown after first login.
- **Passes:** true
- **Implemented:** 2026-05-01

---

### #67 — Project Archive & Restore
- **Description:** Added `is_archived` column via SQLite migration_24 (Supabase column already existed). Added `archiveWithTasks`/`unarchiveWithTasks` repository methods using `withTransaction`. Added IPC handlers and preload bridge. Added `archiveProject`/`unarchiveProject` store actions + `selectActiveProjects` selector. Updated `PersonalSyncService` with `pushProjectArchive` function. Replaced trash icon with Archive icon in AppLayout header (disabled for default + last project). Sidebar now uses `selectActiveProjects` to hide archived projects. ArchiveView shows archived projects as group headers with Restore/Delete buttons. `ProjectGeneralSettings` and `ProjectsSettingsContent` archive section replace delete with archive + undo toast pattern.
- **Spec Section:** N/A
- **Acceptance Criteria:** Archive icon replaces trash, archived projects hidden from sidebar, archive restores via undo toast, Archive view shows archived project groups with restore/delete, settings archive section with undo toast.
- **Passes:** true
- **Implemented:** 2026-05-01

---

### #65 — Profile Settings — Display Name, Password Management, and Forgot Password
- **Description:** Add a "Profile" tab as the first tab in the Settings modal. It has three sections: Account (email read-only), Display Name (first + last name, autosave), and Password (set or change, with validation, explicit save button). Also add a Forgot Password flow on the login screen, and a Supabase Edge Function to differentiate reset emails between email/password users and Google-only users.

---

## Part A — UnifiedSettingsModal.tsx

**File:** `src/renderer/src/features/settings/UnifiedSettingsModal.tsx`

**Line 16** — extend Tab union (profile first):
```ts
type Tab = 'profile' | 'general' | 'projects' | 'appearance' | 'labels' | 'timer' | 'integrations' | 'logs' | 'about'
```

**Line 31** — change default tab:
```ts
const [activeTab, setActiveTab] = useState<Tab>((initialTab as Tab) ?? 'profile')
```

**Lines 76–82 (handleClose)** — both `setActiveTab('general')` calls become `setActiveTab('profile')`.

**Lines 89–94** — tabs array, Profile first:
```ts
const tabs: { key: Tab; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'general', label: 'General' },
  { key: 'projects', label: 'Projects' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'labels', label: 'Labels' },
  { key: 'timer', label: 'Timer' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'logs', label: 'Logs' },
  { key: 'about', label: 'About' }
]
```

In the content area, add before `{activeTab === 'general' && ...}`:
```tsx
{activeTab === 'profile' && <ProfileSettingsContent />}
```

Add import:
```ts
import { ProfileSettingsContent } from './ProfileSettingsContent'
```

---

## Part B — New ProfileSettingsContent.tsx

**File:** `src/renderer/src/features/settings/ProfileSettingsContent.tsx` (create new)

Sections: Account (email read-only), Display Name (first + last autosave), Password (change/add with validation + explicit save).

```tsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, Eye, EyeOff } from 'lucide-react'
import { useAuthStore } from '../../shared/stores/authStore'
import { getSupabase } from '../../lib/supabase'

function SectionLabel({ children, first }: { children: string; first?: boolean }): React.JSX.Element {
  return (
    <p className={`text-[10px] font-bold uppercase tracking-[0.3em] text-muted ${first ? '' : 'mt-6'}`}>
      {children}
    </p>
  )
}

function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'At least 8 characters required'
  if (!/[A-Z]/.test(pw)) return 'Must contain at least one uppercase letter'
  if (!/[a-z]/.test(pw)) return 'Must contain at least one lowercase letter'
  if (!/[0-9]/.test(pw)) return 'Must contain at least one number'
  return null
}

export function ProfileSettingsContent(): React.JSX.Element {
  const currentUser = useAuthStore((s) => s.currentUser)
  const updateUser = useAuthStore((s) => s.updateUser)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nameSaved, setNameSaved] = useState(false)
  const [nameOffline, setNameOffline] = useState(false)
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [hasEmailIdentity, setHasEmailIdentity] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)

  useEffect(() => {
    if (!currentUser) return
    const init = async (): Promise<void> => {
      try {
        const sb = await getSupabase()
        const { data: { user } } = await sb.auth.getUser()
        if (user) {
          const meta = user.user_metadata ?? {}
          setFirstName((meta.first_name as string | undefined) ?? (meta.full_name as string | undefined)?.split(' ')[0] ?? '')
          setLastName((meta.last_name as string | undefined) ?? (meta.full_name as string | undefined)?.split(' ').slice(1).join(' ') ?? '')
          setHasEmailIdentity(user.identities?.some((i) => i.provider === 'email') ?? false)
          return
        }
      } catch { /* offline */ }
      if (currentUser.display_name) {
        const parts = currentUser.display_name.split(' ')
        setFirstName(parts[0] ?? '')
        setLastName(parts.slice(1).join(' '))
      }
    }
    void init()
  }, [currentUser])

  const doSaveName = useCallback(async (fn: string, ln: string): Promise<void> => {
    if (!currentUser) return
    const display_name = [fn.trim(), ln.trim()].filter(Boolean).join(' ') || null
    await updateUser(currentUser.id, { display_name })
    try {
      const sb = await getSupabase()
      await sb.auth.updateUser({ data: { display_name, first_name: fn.trim(), last_name: ln.trim() } })
      await window.api.settings.set(currentUser.id, 'profile_sync_pending', '')
      setNameSaved(true)
      setNameOffline(false)
    } catch {
      await window.api.settings.set(currentUser.id, 'profile_sync_pending', 'true')
      setNameOffline(true)
      setNameSaved(false)
    }
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
    nameTimerRef.current = setTimeout(() => { setNameSaved(false); setNameOffline(false) }, 2000)
  }, [currentUser, updateUser])

  const scheduleSave = useCallback((fn: string, ln: string): void => {
    if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current)
    nameDebounceRef.current = setTimeout(() => { void doSaveName(fn, ln) }, 1000)
  }, [doSaveName])

  const handlePasswordSave = useCallback(async (): Promise<void> => {
    const err = validatePassword(newPassword)
    if (err) { setPasswordError(err); return }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return }
    setPasswordError(null)
    setPasswordSaving(true)
    try {
      const sb = await getSupabase()
      const { error } = await sb.auth.updateUser({ password: newPassword })
      if (error) { setPasswordError(error.message); return }
      setHasEmailIdentity(true)
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSaved(true)
      setTimeout(() => setPasswordSaved(false), 2000)
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Failed to update password')
    } finally {
      setPasswordSaving(false)
    }
  }, [newPassword, confirmPassword])

  return (
    <div className="flex flex-col gap-4">
      <SectionLabel first>Account</SectionLabel>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Email</p>
        <p className="text-sm font-light text-foreground">{currentUser?.email ?? '—'}</p>
      </div>

      <SectionLabel>Display Name</SectionLabel>
      <p className="text-[10px] text-muted -mt-2">Shown to other members in shared projects. Leave blank to use your email.</p>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">First name</p>
          <input type="text" value={firstName}
            onChange={(e) => { setFirstName(e.target.value); scheduleSave(e.target.value, lastName) }}
            placeholder="First"
            className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm font-light text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/50" />
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Last name</p>
          <input type="text" value={lastName}
            onChange={(e) => { setLastName(e.target.value); scheduleSave(firstName, e.target.value) }}
            placeholder="Last"
            className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm font-light text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/50" />
        </div>
        <div className="h-[38px] w-6 flex items-center justify-center flex-shrink-0">
          {nameSaved && <Check size={16} className="text-success" />}
          {nameOffline && <span className="text-[9px] text-muted">Local</span>}
        </div>
      </div>
      {nameOffline && <p className="text-[10px] text-muted -mt-2">Saved locally — will sync when reconnected</p>}

      <SectionLabel>{hasEmailIdentity ? 'Change Password' : 'Add Password Login'}</SectionLabel>
      {!hasEmailIdentity && (
        <p className="text-[10px] text-muted -mt-2">Set a password to also log in with your email, in addition to Google.</p>
      )}
      <p className="text-[10px] text-muted -mt-2">Requirements: 8+ characters, one uppercase, one lowercase, one number.</p>
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">New password</p>
          <div className="relative">
            <input type={showNew ? 'text' : 'password'} value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setPasswordError(null) }}
              placeholder="New password"
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 pr-10 text-sm font-light text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/50" />
            <button type="button" onClick={() => setShowNew((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors">
              {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Confirm password</p>
          <div className="relative">
            <input type={showConfirm ? 'text' : 'password'} value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(null) }}
              placeholder="Confirm password"
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 pr-10 text-sm font-light text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/50" />
            <button type="button" onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors">
              {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        {passwordError && <p className="text-[10px] text-danger">{passwordError}</p>}
        <div className="flex items-center gap-3">
          <button onClick={() => { void handlePasswordSave() }}
            disabled={passwordSaving || !newPassword || !confirmPassword}
            className="rounded-lg border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 disabled:opacity-40">
            {passwordSaving ? 'Saving...' : hasEmailIdentity ? 'Change Password' : 'Set Password'}
          </button>
          {passwordSaved && <Check size={16} className="text-success" />}
        </div>
      </div>
    </div>
  )
}
```

---

## Part C — LoginScreen.tsx — Forgot Password flow

**File:** `src/renderer/src/features/auth/LoginScreen.tsx`

Add `'forgot'` to AuthMode:
```ts
type AuthMode = 'login' | 'signup' | 'forgot'
```

Add state and handler at the top of the component:
```ts
const [resetEmail, setResetEmail] = useState('')
const [resetSent, setResetSent] = useState(false)
const [resetLoading, setResetLoading] = useState(false)
const [resetError, setResetError] = useState<string | null>(null)

const handleForgotPassword = useCallback(async (): Promise<void> => {
  if (!resetEmail.trim()) return
  setResetLoading(true)
  setResetError(null)
  try {
    const sb = await getSupabase()
    const { error } = await sb.functions.invoke('send-password-reset', {
      body: { email: resetEmail.trim() }
    })
    if (error) { setResetError('Something went wrong. Please try again.'); return }
    setResetSent(true)
  } catch {
    setResetError('Something went wrong. Please try again.')
  } finally {
    setResetLoading(false)
  }
}, [resetEmail])
```

Add import: `import { getSupabase } from '../../lib/supabase'`

Below the password input (inside the form, login mode only), add "Forgot password?" link:
```tsx
{mode === 'login' && (
  <div className="flex justify-end -mt-2">
    <button type="button" onClick={() => { setMode('forgot'); clearError() }}
      className="text-[10px] font-bold uppercase tracking-widest text-muted hover:text-accent transition-colors">
      Forgot password?
    </button>
  </div>
)}
```

Update the subtitle `<p>` to handle forgot mode:
```tsx
<p className="text-sm font-light text-muted">
  {mode === 'login' ? 'Sign in to continue' : mode === 'signup' ? 'Create your account' : 'Reset your password'}
</p>
```

Wrap the form, divider, Google button, and toggle link in `{mode !== 'forgot' && (...)}` so they hide in forgot mode.

Add forgot mode UI (renders when `mode === 'forgot'`):
```tsx
{mode === 'forgot' && (
  <div className="flex w-full flex-col gap-4">
    {!resetSent ? (
      <>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Email</label>
          <input type="email" value={resetEmail}
            onChange={(e) => setResetEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleForgotPassword() }}
            placeholder="you@example.com" autoFocus
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm font-light text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none" />
        </div>
        {resetError && (
          <div className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-[11px] font-light text-danger">{resetError}</div>
        )}
        <button onClick={() => void handleForgotPassword()}
          disabled={resetLoading || !resetEmail.trim()}
          className="mt-1 rounded-lg bg-accent px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/80 disabled:opacity-40">
          {resetLoading ? 'Sending...' : 'Send Reset Email'}
        </button>
      </>
    ) : (
      <div className="rounded-lg border border-border bg-surface/50 px-4 py-4 text-sm font-light text-foreground">
        If an account exists for <span className="font-medium">{resetEmail}</span>, you&apos;ll receive an email shortly with instructions.
      </div>
    )}
    <p className="text-sm font-light text-muted text-center">
      <button onClick={() => { setMode('login'); setResetSent(false); setResetEmail(''); setResetError(null) }}
        className="font-medium text-accent hover:underline">
        Back to sign in
      </button>
    </p>
  </div>
)}
```

---

## Part D — Supabase Edge Function send-password-reset

**File:** `supabase/functions/send-password-reset/index.ts` (create new)

This function receives `{ email }`, uses the admin client to check `auth.identities` for provider type, then:
- Email/password user → `adminClient.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: 'https://denandy83.github.io/ToDoozy/reset-password.html' } })`
- Google-only user → `adminClient.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: 'https://denandy83.github.io/ToDoozy/no-password.html' } })`
- Not found → return OK silently

For checking identities, use:
```ts
const { data: identities } = await adminClient
  .schema('auth')
  .from('identities')
  .select('provider, user_id, users!inner(email)')
  .eq('users.email', email)
```
If `.schema('auth').from('identities')` is unavailable via the JS client, fall back to `adminClient.auth.admin.listUsers()` and filter in JS.

Full function:
```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { email } = await req.json() as { email: string }
    if (!email) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Determine if user has email identity
    let hasEmailIdentity = false
    let userExists = false
    try {
      const { data: rows } = await adminClient
        .schema('auth')
        .from('identities')
        .select('provider, users!inner(email)')
        .eq('users.email', email)
      if (rows && rows.length > 0) {
        userExists = true
        hasEmailIdentity = rows.some((r: { provider: string }) => r.provider === 'email')
      }
    } catch {
      // Fallback: listUsers
      const { data: { users } } = await adminClient.auth.admin.listUsers()
      const user = users.find((u) => u.email === email)
      if (user) {
        userExists = true
        hasEmailIdentity = user.identities?.some((i) => i.provider === 'email') ?? false
      }
    }

    if (!userExists) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })

    if (hasEmailIdentity) {
      await adminClient.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: 'https://denandy83.github.io/ToDoozy/reset-password.html' }
      })
    } else {
      await adminClient.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: 'https://denandy83.github.io/ToDoozy/no-password.html' }
      })
    }

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
  } catch (e) {
    console.error('send-password-reset error:', e)
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
  }
})
```

---

## Part E — GitHub Pages files

Check if the project has a `docs/` folder (GitHub Pages source). Create two HTML files:

**`docs/reset-password.html`** — reads `access_token` from URL fragment, shows "Set new password" + "Confirm" fields with same validation rules (8+ chars, 1 upper, 1 lower, 1 number), calls Supabase JS CDN client to `setSession` then `updateUser({ password })`, shows success message. Use the Supabase JS CDN: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js`. Supabase URL: `https://znmgsyjkaftbnhtlcxrm.supabase.co`, anon key from env or hardcoded (anon key is public-safe).

**`docs/no-password.html`** — static page with message: "Your ToDoozy account uses Google Sign-In. Open the ToDoozy app and click 'Continue with Google' to sign in. Once signed in, go to Settings → Profile to add a password for email login."

---

## Part F — authStore.ts — Profile sync retry on reconnect

**File:** `src/renderer/src/shared/stores/authStore.ts`

In BOTH `onRecovered` callbacks (one around line 375, one around line 424), after the `processSyncQueue` try/catch block, add:

```ts
try {
  const pending = await window.api.settings.get(user.id, 'profile_sync_pending')
  if (pending === 'true') {
    const localUser2 = await window.api.users.findById(user.id)
    if (localUser2 !== null) {
      const dn = localUser2.display_name ?? ''
      const parts = dn.split(' ')
      await sb.auth.updateUser({ data: { display_name: dn || null, first_name: parts[0] ?? '', last_name: parts.slice(1).join(' ') } })
      await window.api.settings.set(user.id, 'profile_sync_pending', '')
    }
  }
} catch (e) {
  console.warn('[Auth] Profile sync retry failed:', e)
}
```

`sb` is already in scope (`const sb = await getSupabase()`) in both callbacks. `user` is the Supabase user already fetched at the top of each callback.

---

## Edge cases

- Empty name fields → `display_name: null`, member display falls back to email
- Google user with `full_name` pre-populates first/last on mount
- Offline on init → falls back to splitting local `display_name` from SQLite
- Password fields mismatch → inline error, no Supabase call
- Password too short / missing case / no digit → specific rule shown inline
- Password save fails (offline) → error shown, fields NOT cleared
- Forgot password: non-existent email → silent OK
- Forgot password: Google-only → magic link to no-password.html
- Forgot password: email/password user → recovery link to reset-password.html
- `.schema('auth').from('identities')` may fail → use listUsers fallback
- Do NOT try to queue password updates offline — auth API requires live session

---

Before marking passes: true: read ui-reference.md and debug-learnings.md. Write tests for any new repository methods or utility functions. Run npm run test — all existing and new tests must pass. Run npm run typecheck — zero errors.
- **Spec Section:** N/A
- **Acceptance Criteria:** 
  - Settings modal's first tab is 'Profile'; it opens by default when Settings is launched
  - Profile tab shows: email (read-only), First name input, Last name input, password section
  - First/last name pre-populated from Google OAuth metadata for Google users; from stored display_name (split) for email users
  - Editing name then pausing 1 second autosaves to local SQLite + Supabase auth metadata; green check icon appears then fades after 2s
  - Offline name save: local saved, 'Local' indicator and 'Saved locally — will sync when reconnected' shown; Supabase auth metadata updated automatically on reconnect via onRecovered callback
  - Password section header reads 'Add Password Login' for Google-only users (with explanation text), 'Change Password' for users who already have a password
  - Password requirements text always visible: '8+ characters, one uppercase, one lowercase, one number'
  - Each password input has an independent Eye/EyeOff toggle
  - Clicking Save with mismatched passwords shows inline error 'Passwords do not match'
  - Clicking Save with a password failing any rule shows the specific rule that failed
  - Successful password save: fields clear, green check appears, hasEmailIdentity becomes true (section relabels to 'Change Password')
  - Login screen shows 'Forgot password?' link below the password field in login mode only
  - Clicking 'Forgot password?' switches to a reset form with email input, 'Send Reset Email' button, and 'Back to sign in' link
  - Submitting the reset form always shows the same confirmation message regardless of whether the email exists
  - Email/password users receive a Supabase recovery email linking to reset-password.html where they can set a new password in the browser
  - Google-only users receive a magic link to no-password.html explaining to use Google auth and then add a password in Settings → Profile
  - reset-password.html lets the user set a new password in the browser with the same validation rules
  - no-password.html is a static info page explaining the Google auth flow
  - npm run typecheck passes with zero errors
- **Passes:** true
- **Implemented:** 2026-06-10

---

### #66 — Save Login Credentials (Email Pre-fill + Keychain Password)
- **Description:** After a successful email/password login, silently save the email to `userData/saved-email.json` and show a persistent toast: "Save password to Keychain?" with Save/No thanks actions. If the user chooses Save, store the password via `keytar` in the OS Keychain (visible in macOS Keychain Access under "ToDoozy"). On the next login screen load, pre-fill both fields. For Google OAuth logins, save only the email (no password prompt). On logout, clear both the saved email JSON and the Keychain entry.

---

## Change 1 — Install keytar

```bash
npm install keytar
npm install --save-dev @types/keytar
```

`keytar` is a native module that creates named entries in the OS Keychain (macOS Keychain Access / Windows Credential Manager / libsecret on Linux). It goes in `dependencies` — electron-builder rebuilds it automatically for the Electron binary during `dist:mac`.

---

## Change 2 — IPC handlers (`src/main/ipc-handlers.ts`)

Add import at the top (line 1 area):
```ts
import keytar from 'keytar'
```

Add file path helpers after `getTokenPath()` (~line 28):
```ts
const getSavedEmailPath = (): string => {
  const suffix = is.dev ? '.dev' : ''
  return join(app.getPath('userData'), `saved-email${suffix}.json`)
}
const KEYTAR_SERVICE = 'ToDoozy'
```

Add five new IPC handlers inside `registerAuthHandlers()` (after `auth:clearSession` handler at ~line 74):
```ts
ipcMain.handle('auth:saveEmail', (_e, email: string) => {
  try {
    writeFileSync(getSavedEmailPath(), JSON.stringify({ email }), 'utf-8')
  } catch (err) {
    console.error('Failed to save email:', err)
  }
})

ipcMain.handle('auth:getSavedEmail', () => {
  const path = getSavedEmailPath()
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as { email?: string }
    return parsed.email ?? null
  } catch {
    return null
  }
})

ipcMain.handle('auth:savePassword', async (_e, email: string, password: string) => {
  try {
    await keytar.setPassword(KEYTAR_SERVICE, email, password)
  } catch (err) {
    console.error('Failed to save password to Keychain:', err)
  }
})

ipcMain.handle('auth:getSavedPassword', async (_e, email: string) => {
  try {
    return await keytar.getPassword(KEYTAR_SERVICE, email)
  } catch {
    return null
  }
})

ipcMain.handle('auth:clearCredentials', async () => {
  const path = getSavedEmailPath()
  let savedEmail: string | null = null
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf-8')
      savedEmail = (JSON.parse(raw) as { email?: string }).email ?? null
      unlinkSync(path)
    } catch {
      // ignore
    }
  }
  if (savedEmail) {
    try {
      await keytar.deletePassword(KEYTAR_SERVICE, savedEmail)
    } catch {
      // ignore
    }
  }
})
```

---

## Change 3 — Preload bridge

`src/preload/index.ts` — in the `auth:` section (line ~190), add after `switchDatabase`:
```ts
saveEmail: (email) => ipcRenderer.invoke('auth:saveEmail', email),
getSavedEmail: () => ipcRenderer.invoke('auth:getSavedEmail'),
savePassword: (email, password) => ipcRenderer.invoke('auth:savePassword', email, password),
getSavedPassword: (email) => ipcRenderer.invoke('auth:getSavedPassword', email),
clearCredentials: () => ipcRenderer.invoke('auth:clearCredentials'),
```

`src/preload/index.d.ts` — add to `AuthAPI` interface (after `switchDatabase` on line ~265):
```ts
saveEmail(email: string): Promise<void>
getSavedEmail(): Promise<string | null>
savePassword(email: string, password: string): Promise<void>
getSavedPassword(email: string): Promise<string | null>
clearCredentials(): Promise<void>
```

---

## Change 4 — authStore (`src/renderer/src/shared/stores/authStore.ts`)

Add a module-level pending prompt variable (above the store, after imports):
```ts
let pendingPasswordSave: { email: string; password: string } | null = null
export function takePendingPasswordSave(): { email: string; password: string } | null {
  const p = pendingPasswordSave
  pendingPasswordSave = null
  return p
}
```

**`signInWithEmail`** (line 178) — change return type `Promise<void>` → `Promise<boolean>`:
- At each early-return error path (lines ~184, ~189): add `return false` before the `return`
- After the catch block (line ~210): return `false`
- After the success `set(...)` call (line ~207), before closing the try block, add:
  ```ts
  window.api.auth.saveEmail(email).catch(() => {})
  pendingPasswordSave = { email, password }
  return true
  ```

Update the interface signature at line ~32: `signInWithEmail(email: string, password: string): Promise<boolean>`

**`signUpWithEmail`** (line ~214) — after the success `set({ currentUser: localUser, isAuthenticated: true, loading: false })` call (~line 255), add:
```ts
window.api.auth.saveEmail(email).catch(() => {})
```
(Do NOT set pendingPasswordSave here — signup mode doesn't prompt for password save.)

**`signInWithGoogle`** (line ~262) — in BOTH success branches (implicit flow ~line 309, PKCE flow ~line 335), after each `set({ currentUser: localUser, isAuthenticated: true ... })` call, add:
```ts
if (localUser.email) {
  window.api.auth.saveEmail(localUser.email).catch(() => {})
}
```

**`logout`** (line ~130) — after `await window.api.auth.clearSession()` (line ~138), add:
```ts
await window.api.auth.clearCredentials().catch(() => {})
```

---

## Change 5 — AppLayout.tsx (`src/renderer/src/AppLayout.tsx`)

Add `takePendingPasswordSave` to the authStore import line.

Add a one-time `useEffect` near the top of the component body (after existing store hooks, `addToast` is already available):
```ts
useEffect(() => {
  const pending = takePendingPasswordSave()
  if (!pending) return
  addToast({
    message: 'Save password to Keychain?',
    persistent: true,
    actions: [
      {
        label: 'Save',
        variant: 'accent' as const,
        onClick: async () => {
          await window.api.auth.savePassword(pending.email, pending.password).catch(() => {})
        }
      },
      { label: 'No thanks', variant: 'muted' as const, onClick: () => {} }
    ]
  })
}, []) // runs once on AppLayout mount — right after login transitions to main view
```

`addToast` is already destructured from `useToast()` in AppLayout. Do NOT add it to the dependency array — this must only fire once on mount.

---

## Change 6 — LoginScreen (`src/renderer/src/features/auth/LoginScreen.tsx`)

Add `useEffect` to the React import (line 1 currently has `useState, useCallback, type FormEvent, type KeyboardEvent`).

Add a `useEffect` that loads saved credentials on mount (after the existing state declarations, ~line 10):
```ts
useEffect(() => {
  let cancelled = false
  const load = async (): Promise<void> => {
    const savedEmail = await window.api.auth.getSavedEmail()
    if (!savedEmail || cancelled) return
    setEmail(savedEmail)
    const savedPassword = await window.api.auth.getSavedPassword(savedEmail)
    if (!savedPassword || cancelled) return
    setPassword(savedPassword)
  }
  load().catch(() => {})
  return () => { cancelled = true }
}, [])
```

---

## Edge cases

- If keytar fails (Keychain locked, unavailable): errors caught and swallowed — app works normally, no password saved
- Saved email exists but no Keychain entry: email pre-fills, password stays empty
- User clears the email field manually: they can type any email freely
- Multiple logins: each successful login overwrites the saved email JSON; old keytar entry persists until next `clearCredentials()` on logout
- Google OAuth: only email saved, no save-password toast
- Signup mode: email saved, no save-password prompt
- Dev mode: uses `saved-email.dev.json` to avoid conflicting with prod
- Do NOT save password from signup mode (set `pendingPasswordSave` only in `signInWithEmail`)
- Do NOT add `addToast` to the AppLayout useEffect dependency array

Before marking passes: true: read ui-reference.md and debug-learnings.md. Write tests for any new repository methods or utility functions. Run npm run test — all existing and new tests must pass. Run npm run typecheck — zero errors.
- **Spec Section:** N/A
- **Acceptance Criteria:** 
  - After a successful email/password login, the email is saved to userData/saved-email.json (saved-email.dev.json in dev mode)
  - A persistent toast 'Save password to Keychain?' appears with Save and No thanks buttons
  - Clicking Save stores the password in the OS Keychain via keytar (service 'ToDoozy', account = email) — visible in macOS Keychain Access
  - On next login screen load (after logout or token death), the email field is pre-filled from the saved JSON
  - If a Keychain password exists for the saved email, the password field is also pre-filled
  - After explicit logout, the saved email JSON and Keychain entry are preserved so re-sign-in is friction-free; only the Supabase session is cleared. (A separate 'Forget saved login on this device' Settings action can be added later for explicit credential wipe.)
  - Google OAuth login saves the email to JSON silently (no password prompt shown)
  - Signup mode saves the email but does NOT show the save-password prompt
  - npm run typecheck passes with zero errors
- **Passes:** true
- **Implemented:** 2026-06-10

---

### #67 — Project Archive & Restore
- **Description:** Add the ability to archive a project (hides it from the active sidebar, archives all its tasks), and restore it (brings it back as a personal project with all tasks unarchived). The trash/delete icon on active projects becomes an archive icon. Delete is only accessible from the Archive view when viewing an already-archived project (shown next to a Restore button). This replaces the inline confirmation UI in settings with standard undo-toast pattern.

**Every change below references exact file paths and line numbers as of this writing. Do not re-explore — follow the guide.**

---

## Change 1 — DB migration (SQLite + Supabase)

`src/main/database/migrations.ts` — add after `migration_23` body (line 668):
```ts
const migration_24: Migration = (db) => {
  db.exec(`ALTER TABLE projects ADD COLUMN is_archived INTEGER DEFAULT 0;`)
}
```
Append `migration_24` to the `migrations` array at line 670.

Also apply via `mcp__supabase__apply_migration`:
```sql
ALTER TABLE projects ADD COLUMN is_archived INTEGER DEFAULT 0;
```

---

## Change 2 — Types (`src/shared/types.ts`)

- `Project` interface (line 13–30): add `is_archived: number` after `deleted_at` (line 29)
- `UpdateProjectInput` interface (line 176–187): add `is_archived?: number` after `auto_archive_unit` (line 186)

---

## Change 3 — ProjectRepository (`src/main/repositories/ProjectRepository.ts`)

In `update()` (line 84–133), after the `auto_archive_unit` block (~line 127):
```ts
if (input.is_archived !== undefined) {
  sets.push('is_archived = ?')
  values.push(String(input.is_archived))
}
```

Add two new methods after `update()`:
```ts
archiveWithTasks(id: string): Project | undefined {
  const now = new Date().toISOString()
  this.db.transaction(() => {
    this.db.prepare(`UPDATE projects SET is_archived = 1, updated_at = ? WHERE id = ?`).run(now, id)
    this.db.prepare(`UPDATE tasks SET is_archived = 1, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL`).run(now, id)
  })()
  return this.findById(id)
}

unarchiveWithTasks(id: string): Project | undefined {
  const now = new Date().toISOString()
  this.db.transaction(() => {
    this.db.prepare(`UPDATE projects SET is_archived = 0, updated_at = ? WHERE id = ?`).run(now, id)
    this.db.prepare(`UPDATE tasks SET is_archived = 0, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL`).run(now, id)
  })()
  return this.findById(id)
}
```

---

## Change 4 — IPC handlers (`src/main/ipc-handlers.ts`)

After the `projects:updateSidebarOrder` handler (~line 460):
```ts
ipcMain.handle('projects:archiveWithTasks', (_e, id: string) => {
  return db.projects.archiveWithTasks(id)
})
ipcMain.handle('projects:unarchiveWithTasks', (_e, id: string) => {
  return db.projects.unarchiveWithTasks(id)
})
```

---

## Change 5 — Preload bridge

`src/preload/index.ts` — in the `projects:` block, after `updateSidebarOrder` (line 96):
```ts
archiveWithTasks: (id) => ipcRenderer.invoke('projects:archiveWithTasks', id),
unarchiveWithTasks: (id) => ipcRenderer.invoke('projects:unarchiveWithTasks', id),
```

`src/preload/index.d.ts` — in `ProjectsAPI` (line 126–147), after `updateSidebarOrder`:
```ts
archiveWithTasks(id: string): Promise<Project | undefined>
unarchiveWithTasks(id: string): Promise<Project | undefined>
```

---

## Change 6 — Project Store (`src/renderer/src/shared/stores/projectStore.ts`)

Add two new store actions (after `deleteProject`, ~line 157):
```ts
async archiveProject(id: string): Promise<Project | null> {
  try {
    const project = await window.api.projects.archiveWithTasks(id)
    if (project) {
      set((state) => ({ projects: { ...state.projects, [project.id]: project } }))
      import('../../services/PersonalSyncService').then(({ pushProjectArchive }) => {
        pushProjectArchive(id, 1).catch((err) => console.error('[ProjectStore] pushProjectArchive failed:', err))
      })
    }
    return project ?? null
  } catch (err) {
    set({ error: err instanceof Error ? err.message : 'Failed to archive project' })
    throw err
  }
},

async unarchiveProject(id: string): Promise<Project | null> {
  try {
    const project = await window.api.projects.unarchiveWithTasks(id)
    if (project) {
      set((state) => ({ projects: { ...state.projects, [project.id]: project } }))
      import('../../services/PersonalSyncService').then(({ pushProjectArchive }) => {
        pushProjectArchive(id, 0).catch((err) => console.error('[ProjectStore] pushProjectArchive failed:', err))
      })
    }
    return project ?? null
  } catch (err) {
    set({ error: err instanceof Error ? err.message : 'Failed to unarchive project' })
    throw err
  }
},
```

Add to the store interface (find the existing `deleteProject` signature and add alongside):
```ts
archiveProject(id: string): Promise<Project | null>
unarchiveProject(id: string): Promise<Project | null>
```

Add new `selectActiveProjects` selector after `selectAllProjects` (line 198):
```ts
export const selectActiveProjects = (state: ProjectState): Project[] =>
  Object.values(state.projects).filter((p) => p.is_archived !== 1)
```

---

## Change 7 — PersonalSyncService (`src/renderer/src/services/PersonalSyncService.ts`)

In `pushProject` parameter type (line 919–934), add `is_archived?: number` to the parameter object type.

In `pushProject` body, after the existing `auto_archive` update block (~line 966), add:
```ts
if (project.is_archived !== undefined) {
  await supabase.from('projects').update({ is_archived: project.is_archived }).eq('id', project.id)
}
```

In `pullProjectMetadata` (line 1461), update the SELECT at line 1466:
```ts
.select('name, color, icon, description, updated_at, is_archived')
```
In the remote→local update block (~line 1480), add `is_archived: remote.is_archived ?? 0`.
In the metadata-changed comparison (~line 1491), add `|| (local.is_archived !== (remote.is_archived ?? 0))`.

Add new exported function after `pushProject`:
```ts
export async function pushProjectArchive(projectId: string, isArchived: number): Promise<void> {
  if (!(await hasLiveSession('pushProjectArchive', `id=${projectId}`))) return
  try {
    const supabase = await getSupabase()
    const now = new Date().toISOString()
    const { error: projErr } = await supabase
      .from('projects')
      .update({ is_archived: isArchived, updated_at: now })
      .eq('id', projectId)
    if (projErr) logEvent('error', 'sync', `pushProjectArchive (project) failed: ${projErr.message}`, `project=${projectId}`)
    const { error: taskErr } = await supabase
      .from('tasks')
      .update({ is_archived: isArchived, updated_at: now })
      .eq('project_id', projectId)
    if (taskErr) logEvent('error', 'sync', `pushProjectArchive (tasks) failed: ${taskErr.message}`, `project=${projectId}`)
    markSynced()
  } catch (err) {
    logEvent('error', 'sync', `pushProjectArchive threw: ${err instanceof Error ? err.message : String(err)}`, `project=${projectId}`)
  }
}
```

---

## Change 8 — AppLayout.tsx (`src/renderer/src/AppLayout.tsx`)

**Imports (line 10):** Add `Archive` to lucide-react import (keep `Trash2` — still used for saved view delete at line 1321).

**Imports (line 29):** Add `selectActiveProjects` to projectStore import.

**Line 75:** Change `useProjectStore(selectAllProjects)` → `useProjectStore(selectActiveProjects)`. This makes `sortedProjects` exclude archived projects automatically.

**Pull new store actions** (add near other project store hooks):
```ts
const archiveProjectAction = useProjectStore((s) => s.archiveProject)
const unarchiveProjectAction = useProjectStore((s) => s.unarchiveProject)
```

**Replace `handleDeleteCurrentProject` entirely** (lines 1017–1061) with `handleArchiveCurrentProject`:

```ts
const handleArchiveCurrentProject = useCallback(async () => {
  if (!selectedProject) return
  if (selectedProject.is_default === 1) {
    addToast({ message: "Can't archive the default project", variant: 'danger' })
    return
  }
  const savedProject = selectedProject

  const doArchive = async (): Promise<void> => {
    try {
      await archiveProjectAction(savedProject.id)
      const updatedTasks: Record<string, Task> = {}
      for (const [tid, t] of Object.entries(useTaskStore.getState().tasks)) {
        updatedTasks[tid] = (t as Task).project_id === savedProject.id ? { ...(t as Task), is_archived: 1 } : (t as Task)
      }
      useTaskStore.setState({ tasks: updatedTasks })
      const remaining = sortedProjects.filter((p) => p.id !== savedProject.id)
      if (remaining.length > 0) setSelectedProject(remaining[0].id)
      else setView('my-day')
      addToast({
        message: `"${savedProject.name}" archived`,
        action: {
          label: 'Undo',
          onClick: async () => {
            await unarchiveProjectAction(savedProject.id)
            const tasks = { ...useTaskStore.getState().tasks }
            for (const [tid, t] of Object.entries(tasks)) {
              if ((t as Task).project_id === savedProject.id) tasks[tid] = { ...(t as Task), is_archived: 0 }
            }
            useTaskStore.setState({ tasks })
            setSelectedProject(savedProject.id)
            setView('project')
          }
        }
      })
    } catch (err) {
      addToast({ message: err instanceof Error ? err.message : 'Failed to archive project', variant: 'danger' })
    }
  }

  if (savedProject.is_shared === 1) {
    const members = await window.api.projects.getMembers(savedProject.id)
    const otherMembers = members.filter((m) => m.user_id !== currentUser?.id)
    const isOwner = savedProject.owner_id === currentUser?.id
    const message = `Archive "${savedProject.name}"? You will be removed from the shared project.${isOwner && otherMembers.length > 0 ? ' Ownership will be transferred to another member.' : ''}`
    addToast({
      message,
      persistent: true,
      actions: [
        {
          label: 'Archive',
          variant: 'danger' as const,
          onClick: async () => {
            if (isOwner && otherMembers.length > 0) {
              const firstMember = [...otherMembers].sort((a, b) => a.joined_at.localeCompare(b.joined_at))[0]
              try {
                const { getSupabase } = await import('./services/PersonalSyncService')
                const supabase = await getSupabase()
                await supabase.from('projects').update({ owner_id: firstMember.user_id }).eq('id', savedProject.id)
              } catch (err) { console.error('[Archive] Failed to transfer ownership:', err) }
            }
            if (currentUser) {
              try {
                const { removeSharedMember, unsubscribeFromProject } = await import('./services/SyncService')
                await removeSharedMember(savedProject.id, currentUser.id)
                await unsubscribeFromProject(savedProject.id)
              } catch (err) { console.error('[Archive] Failed to leave shared project:', err) }
            }
            await window.api.projects.update(savedProject.id, { is_shared: 0 })
            await doArchive()
          }
        },
        { label: 'Cancel', variant: 'muted' as const, onClick: () => {} }
      ]
    })
    return
  }
  await doArchive()
}, [selectedProject, sortedProjects, archiveProjectAction, unarchiveProjectAction, addToast, setView, setSelectedProject, currentUser])
```

**Update the header button** (lines 1271–1281):
- `onClick={handleDeleteCurrentProject}` → `onClick={handleArchiveCurrentProject}`
- `aria-label="Delete project"` → `aria-label="Archive project"`
- `<Trash2 size={16} />` → `<Archive size={16} />`
- Disabled condition: `sortedProjects.length <= 1 || selectedProject?.is_default === 1`
- Button class: change `hover:bg-danger/10 hover:text-danger` → `hover:bg-foreground/10 hover:text-foreground`
- Tooltip text: `selectedProject?.is_default === 1 ? "Can't archive the default project" : sortedProjects.length <= 1 ? "Can't archive the last project" : 'Archive project'`
- Remove the "Shift+click to skip confirmation" hint from the tooltip

---

## Change 9 — ArchiveView (`src/renderer/src/features/views/ArchiveView.tsx`)

**Imports:** Add `useViewStore` from stores, keep `selectAllProjects` for allProjects (Archive view needs all). Add `unarchiveProject`, `deleteProject`, `archiveProject` from project store. Add `RotateCcw` icon from lucide-react.

**`groupedByProject` useMemo** (lines 33–54): update to include archived projects that may have no archived tasks:
```ts
for (const project of allProjects) {
  if (byProject[project.id]?.length || project.is_archived === 1) {
    groups.push({ project, tasks: byProject[project.id] ?? [] })
  }
}
```

**Project header** (lines 240–258): add `group` class to the header div, and append project-level Restore/Delete buttons that appear on hover when `project.is_archived === 1`:

```tsx
{project.is_archived === 1 && (
  <>
    <button
      onClick={(e) => { e.stopPropagation(); void handleRestoreProject(project) }}
      className="ml-auto rounded px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted opacity-0 transition-opacity hover:bg-foreground/6 group-hover:opacity-100"
    >
      Restore Project
    </button>
    <button
      onClick={(e) => { e.stopPropagation(); handleDeleteProject(project) }}
      className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-danger opacity-0 transition-opacity hover:bg-danger/10 group-hover:opacity-100"
    >
      Delete Project
    </button>
  </>
)}
```

Add handlers:
```ts
const archiveProjectAction = useProjectStore((s) => s.archiveProject)
const unarchiveProjectAction = useProjectStore((s) => s.unarchiveProject)
const deleteProjectAction = useProjectStore((s) => s.deleteProject)

const handleRestoreProject = useCallback(async (project: Project) => {
  await unarchiveProjectAction(project.id)
  const tasks = { ...useTaskStore.getState().tasks }
  for (const [tid, t] of Object.entries(tasks)) {
    if ((t as Task).project_id === project.id) tasks[tid] = { ...(t as Task), is_archived: 0 }
  }
  useTaskStore.setState({ tasks })
  useViewStore.getState().setSelectedProject(project.id)
  useViewStore.getState().setView('project')
  addToast({
    message: `"${project.name}" restored`,
    action: {
      label: 'Undo',
      onClick: async () => {
        await archiveProjectAction(project.id)
        const tasks2 = { ...useTaskStore.getState().tasks }
        for (const [tid, t] of Object.entries(tasks2)) {
          if ((t as Task).project_id === project.id) tasks2[tid] = { ...(t as Task), is_archived: 1 }
        }
        useTaskStore.setState({ tasks: tasks2 })
        useViewStore.getState().setView('archive')
      }
    }
  })
}, [unarchiveProjectAction, archiveProjectAction, addToast])

const handleDeleteProject = useCallback((project: Project) => {
  addToast({
    message: `Permanently delete "${project.name}" and all its tasks?`,
    persistent: true,
    actions: [
      {
        label: 'Delete',
        variant: 'danger' as const,
        onClick: async () => {
          await deleteProjectAction(project.id)
          const remaining: Record<string, Task> = {}
          for (const [tid, t] of Object.entries(useTaskStore.getState().tasks)) {
            if ((t as Task).project_id !== project.id) remaining[tid] = t as Task
          }
          useTaskStore.setState({ tasks: remaining })
        }
      },
      { label: 'Cancel', variant: 'muted' as const, onClick: () => {} }
    ]
  })
}, [deleteProjectAction, addToast])
```

Also import `useTaskStore` and `useViewStore` if not already imported in ArchiveView.

---

## Change 10 — ProjectGeneralSettings (`src/renderer/src/features/projects/ProjectGeneralSettings.tsx`)

Replace the entire delete section (lines 105–132) with an archive button that uses the toast system, not inline confirmation:

```ts
const archiveProjectAction = useProjectStore((s) => s.archiveProject)

const handleArchive = async (): Promise<void> => {
  if (project.is_default === 1) {
    addToast({ message: "Can't archive the default project", variant: 'danger' })
    return
  }
  try {
    await archiveProjectAction(project.id)
    addToast({
      message: `"${project.name}" archived`,
      action: {
        label: 'Undo',
        onClick: async () => {
          const { unarchiveProject } = useProjectStore.getState()
          await unarchiveProject(project.id)
        }
      }
    })
    onClose()
  } catch (err) {
    addToast({ message: err instanceof Error ? err.message : 'Failed to archive project', variant: 'danger' })
  }
}
```

Replace the render section (lines 105–132) with:
```tsx
{project.is_default !== 1 && (
  <div className="mt-4 border-t border-border pt-4">
    <button
      onClick={() => void handleArchive()}
      className="rounded-lg border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6"
    >
      Archive Project
    </button>
  </div>
)}
```

---

## Change 11 — ProjectsSettingsContent (`src/renderer/src/features/settings/ProjectsSettingsContent.tsx`)

Lines 726–766 — rename `ProjectDeleteSection` → `ProjectArchiveSection`, replace the delete logic with archive:
- Import `archiveProject` from projectStore
- Remove the `confirmDelete` state pattern entirely
- Replace the delete button with an archive button with the same toast-undo pattern as Change 10 above
- Update the component name in the render call: `<ProjectArchiveSection ...>`
- Update the interface name to `ProjectArchiveSectionProps`

---

## Supabase/sync notes
- `is_archived` on the Supabase `projects` table defaults to 0 — existing projects are unaffected
- `pullProjectMetadata` now syncs `is_archived` bidirectionally
- `pushProjectArchive` does a batch UPDATE on both the project and all its tasks — no N+1

## Edge cases
- Default project: archive button disabled/guarded everywhere. Show toast "Can't archive the default project."
- Last project: if `sortedProjects.length <= 1` (only one active project), archive is disabled in header
- Shared project archive: requires persistent toast confirmation → leave shared project on Supabase → transfer ownership if owner → set local `is_shared = 0` → then archive
- Undo after shared project archive: only unarchives locally (restores `is_archived = 0`) — does NOT re-join the shared project
- Archived project not appearing in sidebar: guaranteed by `selectActiveProjects` filter
- ArchiveView empty state: if no archived tasks and no archived projects, existing empty state still shows

## Do NOT
- Do NOT add a right-click context menu to sidebar project items (none exists today)
- Do NOT show the undo toast for shared project archive (shared project leave is not undoable)
- Do NOT filter projects in `selectAllProjects` — keep that selector as-is, ArchiveView needs it
- Do NOT mark a project's tasks as individually restored when restoring at project level — restore ALL tasks wholesale

Before marking passes: true: read ui-reference.md and debug-learnings.md. Write tests for `archiveWithTasks` and `unarchiveWithTasks` repository methods. Run npm run test — all existing and new tests must pass. Run npm run typecheck — zero errors.
- **Spec Section:** N/A
- **Acceptance Criteria:** 
  - The project header trash icon is replaced by an archive icon (Archive from lucide-react). Clicking it archives the project + all its tasks and navigates to the next project. A toast with 'Undo' restores everything.
  - The default project's archive button is disabled (header icon is visually disabled; guard in handler prevents action).
  - If only one active (non-archived) project exists, the archive button is disabled.
  - Archiving a shared project shows a persistent confirmation toast warning about removal from the shared project. On confirm: ownership is transferred to the earliest-joined other member (if current user is owner), the user is removed from project_members on Supabase, the local project is set to is_shared=0, is_archived=1, and tasks are archived.
  - Archived projects do NOT appear in the sidebar project list.
  - The Archive view shows archived projects as groups, even if all their tasks are also archived. Each archived project group header reveals 'Restore Project' and 'Delete Project' buttons on hover (using opacity-0 + group-hover:opacity-100 — same pattern as TaskRow). The trash icon supports Shift+click to skip the confirm toast per ui-reference.md.
  - 'Restore Project' in Archive view: sets project + all tasks to is_archived=0, navigates to the project, shows undo toast.
  - 'Delete Project' in Archive view: shows persistent 'Permanently delete?' confirmation toast. On confirm: project and all tasks are hard-deleted from local SQLite and the store.
  - Project General Settings (right panel) has 'Archive Project' button replacing the old 'Delete Project' inline confirmation. Clicking it archives immediately with undo toast.
  - ProjectsSettingsContent (Settings → Projects) has the same archive button replacing delete.
  - is_archived is added to the SQLite projects table via migration_24 and to the Supabase projects table.
  - Archiving/restoring a project syncs is_archived to Supabase for both the project and all its tasks via pushProjectArchive.
  - npm run typecheck passes with zero errors. Vitest tests for archiveWithTasks and unarchiveWithTasks pass.
- **Passes:** true
- **Implemented:** 2026-06-10

### #89 — setAuth storm causes refresh_token_already_used → self-inflicted logout
- **Description:** ToDoozy task ID: b1ee3217-a382-4f92-b7e1-fa73d6252840 — a corresponding ToDoozy task exists; follow the CLAUDE.md ToDoozy task lifecycle for this story (In Progress when starting, Testing while running tests, Verifying when tests pass).
- **Spec Section:** N/A
- **Passes:** true
- **Implemented:** 2026-06-10

---

### #90 — started todoozy offline, then went online, clicked retry, connection stayed 'offline'
- **Description:** ToDoozy task ID: 1827d14e-aa3c-4c7c-9f2e-b3d4f9eccd55 — a corresponding ToDoozy task exists; follow the CLAUDE.md ToDoozy task lifecycle for this story (In Progress when starting, Testing while running tests, Verifying when tests pass).
- **Spec Section:** N/A
- **Passes:** true
- **Implemented:** 2026-06-10

---

### #91 — Expand Realtime coverage: per-user channel + activity_log on personal projects
- **Description:** ToDoozy task ID: 4c89a910-b3a8-48ea-b1f4-0847ad4e6028 — a corresponding ToDoozy task exists; follow the CLAUDE.md ToDoozy task lifecycle for this story (In Progress when starting, Testing while running tests, Verifying when tests pass).
- **Spec Section:** N/A
- **Passes:** true
- **Implemented:** 2026-06-10

---

### #92 — Batch task-detail edits — sync only when switching tasks / closing panel / blurring app
- **Description:** ToDoozy task ID: d174ec02-9041-4e5c-a065-c83e41c5565c — a corresponding ToDoozy task exists; follow the CLAUDE.md ToDoozy task lifecycle for this story (In Progress when starting, Testing while running tests, Verifying when tests pass).
- **Spec Section:** N/A
- **Passes:** true
- **Implemented:** 2026-06-10

---

### #93 — MCP create_label writes legacy projects.label_data instead of project_labels junction — label invisible in app
- **Description:** ToDoozy task ID: 2d4282aa-89dc-425f-911c-1ce498c9f78d — a corresponding ToDoozy task exists; follow the CLAUDE.md ToDoozy task lifecycle for this story (In Progress when starting, Testing while running tests, Verifying when tests pass).
- **Spec Section:** N/A
- **Passes:** true
- **Implemented:** 2026-06-10

---

### #94 — Allow removing password login for OAuth users (Edge Function with service_role)
- **Description:** ToDoozy task ID: 6a8adf77-7733-4c61-be46-4ee3ae1c5628 — a corresponding ToDoozy task exists; follow the CLAUDE.md ToDoozy task lifecycle for this story (In Progress when starting, Testing while running tests, Verifying when tests pass).
- **Spec Section:** N/A
- **Passes:** true
- **Implemented:** 2026-06-10

---

### #95 — Batch review doc — before/after screenshots + repro scenarios for stories #68-#94
- **Description:** No ToDoozy task exists for this story — SKIP the ToDoozy status lifecycle entirely.
- **Spec Section:** n/a — process/documentation story; spec is fully contained in the description
- **Passes:** true
- **Implemented:** 2026-06-10

---
