# ToDoozy — Feature Reference

Complete feature inventory grouped by category. Each entry covers what it does, how it works technically, and current status.

---

## Task Management

### Task CRUD
- Create tasks via inline add-task input at the top of any list; supports smart input parsing
- Edit via detail panel (autosave 1s debounce on title and description)
- Complete by clicking the status button; `completed_date` auto-set when done status applied
- Archive/unarchive via context menu; archived tasks live in the Archive view
- Delete with confirmation; Shift+Delete bypasses confirmation; undo toast with 5s window
- **Status:** Complete

### Subtasks & Hierarchy
- Parent/child relationship via `parent_id` foreign key
- Expand/collapse chevron on any parent task; progress bar (done/total count)
- Subtask count badge on parent rows
- Sortable within parent; cascade delete when parent deleted
- Drag-and-drop: drop in top 20% = reorder above, middle 60% = make subtask, bottom 20% = reorder below
- **Status:** Complete

### Task Fields
- Title (autosave 1s), Status (dynamic from project), Priority (5 levels), Labels, Due date + optional time, Reference URL, Smart Recurrence (structured picker with validation + preview), Snooze presets
- `is_in_my_day`, `is_archived`, `is_template`, `parent_id`, `sort_order` flags
- `completed_date` auto-set; `snoozed_until` for snooze feature
- **Status:** Complete

### Bulk Selection
- Click to select; Shift+click for range; Cmd+click for additive
- Selected tasks show accent background (12% opacity) + accent border (15% opacity)
- Bulk actions via BulkContextMenu: status change, priority, labels, delete, copy, drag to project
- **Status:** Complete

### Multi-select Drag to Project
- When multiple tasks are selected, drag overlay shows count badge
- Drop onto any project in sidebar nav to move all selected tasks to that project in one action
- Undo toast with 5s window for bulk moves
- **Status:** Complete (2026-03-22)

### Copy Tasks to Clipboard
- Cmd+C copies selected task titles; single task as plain text, multiple as `- item` markdown list
- Also available in context menu
- **Status:** Complete

---

## Views & Navigation

### Sidebar
- Collapsible (56px collapsed to 600px expanded), pinnable, hover-to-expand when unpinned
- PROJECTS section lists all projects with task counts; drag-reorder in project settings
- Top section: My Day (Cmd+1); Bottom section: Archive (Cmd+2), Templates (Cmd+3)
- Settings gear button at bottom
- Droppable targets: dragging a task onto a nav item moves it to that view
- **Status:** Complete

### My Day View
- Cross-project view: tasks that are `is_in_my_day = true` OR `due_date = today`
- Tasks grouped by project buckets, each bucket showing the project's status sections
- Supports both list and kanban layout
- **Status:** Complete

### Calendar View
- Cross-project view showing all non-archived, non-template tasks with a due_date
- Monthly grid: 7-column Mon–Sun layout, navigate months with arrow buttons
- Weekly view: 7-day horizontal columns with more vertical space
- Toggle between month/week persisted via settings store (`calendar_layout` key)
- Today highlighted with accent color/border
- Overdue tasks (past due, not done) show in red; done tasks show strikethrough + muted
- Each task shows project color dot + title (truncated)
- Click task → select + open detail panel; drag between days → update due_date
- Right-click → context menu (same as other views)
- Sidebar shortcut: ⌘2
- **Status:** Complete

### Per-Project Views
- Each project in the sidebar has its own task list
- Tasks grouped by status sections (ordered: not-done first by `order_index`, done last)
- Per-project layout memory (list vs. kanban persists per project)
- **Status:** Complete

### Archive View
- All archived tasks across all projects
- Full task row interactions (click to open detail, context menu)
- **Status:** Complete

### Templates View
- Lists all task templates and project templates with search
- Save as Template via context menu; Use Template with project picker
- **Status:** Complete

### Kanban Toggle
- Cmd+L switches between list and kanban in My Day and per-project views
- Columns generated dynamically from project statuses
- Dragging between columns changes `status_id`
- Task cards show priority, labels, due date, assignee avatar
- **Status:** Complete

---

## Detail Panel

### Panel Layout
- Resizable (bottom/side position toggleable in settings)
- Opens on task click; Escape closes and restores focus to the triggering task row
- **Status:** Complete

### Rich Text Editor (Tiptap)
- Replaced markdown textarea with Tiptap WYSIWYG
- Content stored as Markdown via `tiptap-markdown`
- Fixed toolbar: Bold, Italic, Strikethrough, Code, Link, Heading, Lists, Checklist, Code Block, Attach
- Floating bubble toolbar appears on text selection
- Slash commands: `/h1`, `/h2`, `/bullet`, `/numbered`, `/checklist`, `/code`, etc.
- Cmd+K for link editing with inline popover
- Image paste: images pasted inline into editor
- Interactive checklists (click to toggle)
- 1s autosave debounce
- **Status:** Complete

### File Attachments (iCloud Drive)
- Attach files via toolbar paperclip button (enabled when iCloud is configured)
- Files stored locally at `~/.todoozy/attachments/<task-id>/` + synced to `~/Library/Mobile Documents/...`
- Attachment cards below description: file type icon + truncated filename
- Hover X to remove; click to open in default macOS app
- Limits: 10 MB per file, 10 attachments per task; duplicate filename suffix
- Requires iCloud Drive toggle in Settings > iCloud
- Task deletion cascades to file cleanup
- **Status:** Complete (2026-03-22)

### Smart Recurrence Picker
- Structured picker replaces free-text input: Every [N] [days/weeks/months/years]
- Presets (Daily/Weekly/Monthly) expand picker pre-filled with today as reference
- Weekly: 7 day-of-week toggle buttons (M T W T F S S)
- Monthly: "On day [N]" or "On the [1st-last] [weekday]" (ordinal mode)
- Yearly: month dropdown + day input
- Fixed / After completion toggle (after-completion hides day pickers)
- Optional end date via "Ends: On date" with date picker
- Live preview line in accent color: "→ Every 2 weeks on Mon, Wed (next: Apr 14)"
- Completing a recurring task auto-creates a clone with next due date, reset subtasks, and copied labels
- Toast notification on clone creation with "Go to task" action
- Task row shows repeat icon (↻) with tooltip showing human-readable rule
- Context menu presets with smart defaults + "Custom..." to open detail panel
- Setting recurrence on a dateless task auto-sets due date to today
- Canonical storage format: `every:N:unit[:details][|until:YYYY-MM-DD]`
- Shared `recurrenceUtils.ts` with parse, serialize, describe, getNextOccurrence, isValid
- **Status:** Complete (2026-03-31)

### Snooze
- Presets: Later today, Tomorrow, Next week, Custom
- Sets `snoozed_until`; snoozed tasks hidden until that date
- **Status:** Complete

### Task Reference URL
- Each task has an optional `reference_url` field for linking to external resources (PRs, docs, tickets, etc.)
- Detail panel shows an editable URL input below the title; URLs auto-prefix `https://` if no protocol is provided
- Task rows display a clickable link icon when a reference URL is set, opening it in the default browser
- Autosave with 1s debounce; X button to clear the URL
- **Status:** Complete (2026-03-30, Story #34)

### Activity Log
- Timeline of task changes (create, update, status change, etc.)
- Stored in `activity_log` table with user, action, metadata
- **Status:** Complete

---

## Drag & Drop

### Within a Project
- @dnd-kit with PointerSensor (8px threshold) and KeyboardSensor
- Drop intent by Y-position: top 20% = above (reorder), middle 60% = inside (make subtask), bottom 20% = below (reorder)
- Batch SQLite transactions for reordering
- Ghost card overlay while dragging
- **Status:** Complete

### Cross-view Drag
- Drag task onto sidebar nav items (My Day, project) to move it there
- Multi-select drag: drag overlay with count badge; all selected tasks move together
- Undo toast after cross-project moves
- **Status:** Complete

### Kanban Column Drag
- Drag between kanban columns changes `status_id`
- **Status:** Complete

---

## Smart Input & Search

### Smart Input Parser
- Inline parsing in all task creation inputs (add-task rows, quick-add window)
- `@label` — assign or create label; popup suggests matching labels
- `p:priority` — set priority (e.g., `p:high`, `p:urgent`)
- `d:date` — set due date (e.g., `d:today`, `d:tomorrow`, `d:monday`, `d:Jan 15`)
- Popup suggestions for labels and priorities as user types
- **Status:** Complete

### Command Palette
- Cmd+K modal; substring match by default
- Operators: `p:high`, `l:work`, `s:done`, `due:today`, `has:subtasks` (combinable)
- Results show priority dot, badge, title, labels, status, due date
- Max 12 results; click to select and open detail panel
- Escape closes
- **Status:** Complete

---

## Labels

### Global Labels
- Labels are global entities shared across all projects
- `project_labels` junction table links labels to projects; label picker shows only labels added to current project
- Creating a label matching an existing global name silently adds it to the project (with toast)
- **Status:** Complete (2026-03-22, Story #30)

### Label Management
- Label CRUD in Settings > Labels: name, color, usage counts (projects + tasks)
- Edit globally: name/color changes apply everywhere the label is used
- Delete: choose "Remove from project" (unlinks) or "Delete everywhere" (removes all task references)
- All destructive actions are red with undo toast
- **Status:** Complete

### Label Filtering
- Filter bar in every view: click a label chip to filter, click again to clear
- Filter only shows labels assigned to active (non-archived) tasks in the current project
- Hide/blur filter modes; auto-clears on view switch
- **Status:** Complete

---

## Priority System

### Priority Levels
- 5 levels: None, Low, Normal, High, Urgent
- Configurable colors per level
- **Status:** Complete

### Priority Visualizations (toggleable in Settings > Priorities)
- Color bar (1.5px left border)
- Badges (icon + label)
- Background tint (3%/6%)
- Font weight variation
- Auto-sort by priority within status sections
- Live preview in settings
- **Status:** Complete

---

## Projects

### Project CRUD
- Create via "+ New Project" in sidebar; name, color (8-color palette), emoji icon
- Edit in project settings (name, color, icon)
- Delete project (with confirmation and task cleanup)
- Default "Personal" project auto-created on first login
- **Status:** Complete

### Configurable Statuses
- Per-project status CRUD: name, color, type (not_started/in_progress/done)
- 3 defaults seeded: Not Started, In Progress, Done
- Deleting a status requires reassigning tasks to another status
- Status order: default first, middle by `order_index`, done last — enforced everywhere
- Drag-reorder in project settings
- **Status:** Complete

---

## Theme System

- 8-color palette as CSS custom properties
- 12 built-in themes: 6 dark (Midnight, Obsidian, Forest, Ocean, Crimson, Violet), 6 light variants
- Settings > Themes: mode toggle, preset dropdown, color pickers (8 per theme), live UI preview
- Apply button required to persist; create and save custom themes
- **Status:** Complete

---

## Context Menu

- Right-click any task for compact context menu
- Status row (dynamic from project statuses)
- Flyout submenus on hover (150ms delay): Priority, Recurrence, Labels, Snooze, Focus
- Pin/Unpin My Day, Add Subtask, Duplicate, Delete
- Smart viewport positioning; submenus open left/right based on available space
- Bulk context menu for multi-selected tasks
- **Status:** Complete

---

## Templates

### Task Templates
- Save any task as a template via context menu
- Templates are global across all projects
- Templates view with search; use via context menu or Templates view
- **Status:** Complete

### Project Templates
- Save a full project (tasks, statuses, structure) as a template
- Deploy via multi-step wizard: choose template, set project name/color, preview tasks
- Edit and delete project templates
- **Status:** Complete

### Template Wizard — Relative Due Date Offsets
- When saving a project as a template, the wizard asks whether to include due dates as relative offsets
- Due dates are stored as day offsets relative to a reference date (e.g., "+5 days", "+14 days")
- When deploying, the user picks a deploy/start date; actual due dates are computed from that date
- Tasks without due dates are unaffected
- **Status:** Complete (2026-03-30, Story #36)

---

## Timer (Pomodoro)

- Per-task timer triggered via play button on hover (task rows)
- Presets: 25/10/5 min (configurable in Settings > Timer)
- Tray countdown: active timer shown in menu bar
- Pause/resume/stop controls in timer overlay
- Break timer after session completion
- Repetition/session mode (auto-repeat)
- Activity log entry on session completion
- Sound + system notifications
- **Status:** Complete

---

## System Features

### Global Quick-Add Window
- Cmd+Shift+Space (configurable) opens frameless floating window from anywhere on macOS
- Creates task in My Day; closes on submit, Escape, or blur
- Refreshes project list and settings on every focus
- Window destroyed on close and recreated fresh; waits for theme confirmation before showing (no flash)
- **Status:** Complete

### Global App Toggle
- Cmd+Shift+B (configurable in Settings > General) shows/hides main window
- Persists across app restarts; works across macOS Spaces
- Requires auth session to open
- **Status:** Complete

### macOS Tray Icon
- Persistent menu bar icon with task badge count
- Left-click menu: My Day task list with complete/open actions
- Right-click: Quick Add, Open ToDoozy, Settings, Quit
- Close-to-tray behavior (window close hides to tray, doesn't quit)
- Dock icon click reopens main window
- **Status:** Complete

### Supabase Authentication
- Email/password and Google OAuth via Supabase Auth
- Session stored encrypted via Electron safeStorage
- Auto-login on launch if valid token exists
- Graceful offline fallback
- **Status:** Complete

---

## AI Integration (MCP Server)

- Standalone MCP server using stdio transport (`@modelcontextprotocol/sdk`)
- Connect any MCP-compatible AI client (Claude Desktop, etc.)
- Tools: create/update/delete/list tasks and subtasks, manage projects/labels/statuses, search, My Day management, templates
- Enable/disable in Settings > MCP; copy config to clipboard
- **Status:** Complete

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+1 | My Day |
| Cmd+2 | Archive |
| Cmd+3 | Templates |
| Cmd+K | Command palette |
| Cmd+L | Toggle list/kanban |
| Cmd+C | Copy selected task titles |
| Cmd+Shift+Space | Quick add (global) |
| Cmd+Shift+B | Toggle app window (global, configurable) |
| Escape | Close topmost overlay/panel/menu (via popup stack) |
| Enter/Space | Open detail panel for focused task |
| Tab | Cycle fields in detail panel (including date picker subfields) |
| Arrow Up/Down | Navigate tasks and subtasks |

---

### Global Escape Popup System
- Centralized popup stack manages Escape key dismissal order
- Topmost overlay (modal, menu, flyout, detail panel) always closes first
- `stopImmediatePropagation` prevents Escape from leaking through layers
- **Status:** Complete (2026-03-29)

### Date Picker Keyboard Navigation
- Tab cycles through date field, time field, and clear (X) button as subfields
- Clock toggle auto-sets time to +3 hours from now and focuses time input
- Clock icon hidden when a time value is already set
- **Status:** Complete (2026-03-29)

### Due Dates in Task Rows
- Due dates display inline on task rows
- Overdue tasks show red styling for past-due dates
- **Status:** Complete (2026-03-29)

### Subtask Keyboard Navigation
- Arrow keys navigate through subtask lists
- My Day auto-selects first task on view entry
- **Status:** Complete (2026-03-29)

---

## Internal / Infrastructure

### Database: node:sqlite Migration
- Replaced `better-sqlite3` native module with Node.js built-in `node:sqlite`
- Eliminates native compilation requirements and Electron rebuild issues
- 32 files changed across repositories, migrations, and IPC handlers
- **Status:** Complete (2026-03-28, commit aee3cc6)

---

## Known Issues / Status Notes

- Story #31 (Tab focus management): `passes: true`, `tested: false` — implementation complete, awaiting user verification
- Story #32 (iCloud attachments): `passes: true`, `tested: false` — implementation complete, awaiting user verification
- `new-features.md` lists several backlog items not yet implemented: configurable date locale, per-view statuses
