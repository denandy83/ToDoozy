# Changelog

All bug fixes and changes to ToDoozy. Most recent first.

---

## 2026-03-29

### Fixed
- **Quick-add window follows theme** — The Cmd+Shift+Space quick-add popup now always opens with the correct theme. Previously it flashed dark before switching to light.

## 2026-03-26

### Internal
- **Verified status in workflow** — Added `Verified` status to the ralph PRD workflow and wired ToDoozy task lifecycle (In Progress → Testing → Verified → Done).
- **Test suite fixes** — Fixed Vitest tests for stories 31–33 and added worktree exclusions to prevent false failures.

## 2026-03-25

### Added
- **In-app help & keyboard shortcuts modal** — A `?` button in the sidebar footer opens a centered modal showing all keyboard shortcuts grouped into 4 sections: Navigation, Tasks, Detail Panel, Global.
- **Global `?` hotkey** — Press `?` anywhere outside a text input to open the shortcuts modal.
- **Help tab in Settings** — Settings modal now has a Help tab with full feature documentation covering every major feature.

## 2026-03-22

### Fixed
- **Multi-select drag to project** — Selecting multiple tasks and dragging onto a sidebar project now moves all of them atomically. Undo toast shows for 5s.
- **Drag UX improvements** — Drag overlay now shows count badge when multiple tasks are selected. Drag intent thresholds refined.
- **Project delete** — Fixed edge case where deleting a project could leave orphaned tasks in the store.
- **Quick-add improvements** — Project list and settings now refresh on every quick-add window focus, preventing stale project data.
- **Quick-add focus retry** — Auto-focus now retries at 50/150/300ms to handle slower window creation.

## 2026-03-21

### Fixed
- **Per-project sidebar nav** — Replaced Backlog view with per-project sidebar navigation; each project remembers its last layout mode.
- **Status ordering** — Statuses now consistently ordered everywhere: default first, middle statuses by `order_index`, done status last.

---

*Entries before 2026-03-21 are not captured in this changelog (pre-documentation system).*
