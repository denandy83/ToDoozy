# ToDoozy — Developer Log

Reverse-chronological log of development sessions, decisions, and milestones.

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
