# ToDoozy — Developer Log

Reverse-chronological log of development sessions, decisions, and milestones.

---

## 2026-03-30 — Template Wizard Due Date Offsets (Story #36)

**Session type:** Feature implementation

**What was built:** Relative due date offsets for the template wizard (Story #36). When saving a project as a template, the wizard now asks whether to include due dates as relative offsets. Due dates are stored as day offsets from a reference date. When deploying a template, the user picks a deploy date and actual due dates are computed automatically. 11 files changed.

**Commits:** 2a84ede feat: add relative due date offsets to template wizard (#36)

---

## 2026-03-30 — Calendar View (Story #35)

**Session type:** Feature implementation

**What was built:** Calendar View (Story #35). New cross-project view accessible from the sidebar (⌘2) that shows all tasks with due dates organized in a calendar. Supports monthly grid and weekly layout with a toggle (persisted via settings store). Tasks display with project color dots, strikethrough for done tasks, and red for overdue. Click to select/open detail panel, drag between days to update due_date, right-click for context menu. 18 files changed.

**Commits:** 4eedfbc feat: implement Calendar View with monthly grid and weekly layout (#35)

---

## 2026-03-30 — Task Reference URL (Story #34)

**Session type:** Feature implementation

**What was built:** Task Reference URL field (Story #34). Added a `reference_url` column to the tasks table, an editable URL input in the detail panel below the task title, and a clickable link icon on task rows. URLs auto-prefix `https://` if no protocol is present. The field autosaves with a 1s debounce, and an X button clears the value. 14 files changed.

**Commits:** a404d09 feat: implement task reference URL field (#34)

---

## 2026-03-29 — Keyboard polish, date picker improvements, and node:sqlite migration

**Session type:** Bug fixes, UX improvements, infrastructure migration

**What was done:**
- Fixed quick-add window theme flash by destroying/recreating window and waiting for theme confirmation before showing
- Fixed status changes to respect default task position setting
- Fixed context menu labels in My Day, label portability on task move, and Shift+Delete on labels
- Achieved consistent ESC/Tab behavior across My Day and project views with a new global Escape popup stack
- Improved date picker keyboard navigation: Tab into time picker, clock toggle auto-sets +3h, X button in Tab sequence
- Added due dates inline on task rows with overdue styling
- Improved subtask keyboard navigation with arrow keys; My Day auto-selects first task
- Migrated from `better-sqlite3` to Node.js built-in `node:sqlite` (32 files changed), eliminating native module compilation

**Commits:** 30d8e2b, a2d9ba9, 4c7cbee, 131b383, f345670, 38442c7, 6eb3bf5, c689c08, 90615e5, 99e6d43, aee3cc6, a8a1804

---

## 2026-03-26 — Workflow & test suite hardening

**Session type:** Internal tooling / QA

**What was done:**
- Added `Verified` status to the ralph PRD workflow (`prd.json` now has `verified` field, separate from `passes` and `tested`)
- Wired ralph into the ToDoozy task lifecycle: In Progress when starting, Testing when passes+tested, Verified/Done for the user
- Fixed Vitest test suite for stories 31–33; added `.claude/worktrees/` exclusions to prevent worktree files from interfering with test discovery

**Commits:** 5ba02a6, 16ed0eb, e68458b

---

## 2026-03-25 — Story #33: In-App Help & Keyboard Shortcuts

**Session type:** Feature implementation

**What was built:** In-App Help & Keyboard Shortcuts (Story #33). Added a `?` icon button as its own row in the sidebar footer, a `KeyboardShortcutsModal` showing all shortcuts in 4 groups, a global `?` keydown listener in AppLayout, and a `HelpSettingsContent` tab in UnifiedSettingsModal with full feature documentation.

**Commits:** 3d209d9 feat: add story #33 — in-app help & keyboard shortcuts

---

## 2026-03-25 — Initial documentation baseline

**Session type:** Documentation audit + tooling setup

**What was established:**

This entry documents the state of the app as of the first full documentation pass. All features below are implemented and committed to the `main` branch.

### Implemented Stories (from implemented-stories.md + prd.json)

| # | Title | Date |
|---|-------|------|
| 1 | Scaffold Electron + React + TypeScript | 2026-03-20 |
| 2 | Database layer with versioned migrations | 2026-03-20 |
| 3 | Repository pattern | 2026-03-20 |
| 4 | IPC layer and preload bridge | 2026-03-20 |
| 5 | Zustand stores | 2026-03-20 |
| 6 | Supabase Auth — Login screen | 2026-03-20 |
| 7 | Projects and configurable statuses | 2026-03-20 |
| 8 | Task CRUD with basic list view | 2026-03-20 |
| 9 | Views and sidebar navigation | 2026-03-20 |
| 10 | Detail Panel — Task editor | 2026-03-20 |
| 11 | Subtasks and hierarchy | 2026-03-20 |
| 12 | Drag and drop | 2026-03-20 |
| 13 | Theme system | 2026-03-20 |
| 14 | Labels with filtering | 2026-03-20 |
| 15 | Priority system with visualizations | 2026-03-20 |
| 16 | Kanban toggle | 2026-03-20 |
| 17 | Context menu with flyout submenus | 2026-03-20 |
| 18 | Command palette with search operators | 2026-03-20 |
| 20 | Global quick-add window | 2026-03-21 |
| 21 | Smart input parsing (@label, p:, d:) | 2026-03-21 |
| 22 | Copy task titles to clipboard | 2026-03-21 |
| 23 | Per-project sidebar navigation | 2026-03-21 |
| 24 | macOS Tray Icon | 2026-03-21 |
| 25 | Task Templates & Project Templates | 2026-03-22 |
| 26 | MCP Server for AI Integration | 2026-03-22 |
| 27 | Rich Text Editor with Tiptap | 2026-03-22 |
| 28 | Global App Toggle Shortcut | 2026-03-22 |
| 29 | Pomodoro Timer | 2026-03-22 |
| 30 | Global Labels — Shared Across All Projects | 2026-03-22 |
| 31 | Fix Tab Order and Focus Management | 2026-03-22 |
| 32 | iCloud Drive File Attachments | 2026-03-22 |

### Recent bug fixes (since 2026-03-21)
- Fixed project delete and quick-add improvements (commit fa6d600)
- Fixed refresh projects and settings on every quick add focus (commit c402aa8)
- Multi-select drag to project, undo toast, drag UX improvements (commit 45e0133)

### Current branch state
- All work merged to `main`
- `prd.json` has 3 stories (30, 31, 32) with `passes: true`; stories 31 and 32 have `tested: false` — pending user verification

### Decisions made in this session
- Documentation system established: README.md, FEATURES.md, HELP.md, DEVLOG.md, CHANGELOG.md, RELEASE_NOTES.md
- Automated documentation hooks configured (Stop hook writes to pending-changes.md)
- /feature and /fix skills updated to log documentation entries
- CLAUDE.md updated with session-start rule to process pending-changes.md
