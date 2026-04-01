# Changelog

All bug fixes and changes to ToDoozy. Most recent first.

---

## 2026-04-01

### Fixed
- **Tray icon missing in built app** — Icon template PNGs weren't being included in the packaged app. Added `extraResources` to electron-builder config and updated path resolution to use `process.resourcesPath`. (tray.ts, electron-builder.yml)
- **Built app crash on launch (code signing)** — Ad-hoc code signing produced mismatched Team IDs between the main binary and Electron Framework. Added codesign step to CLAUDE.md build instructions.
- **MCP server crash in built app** — The MCP server's bundled JS shared a chunk with the main process that imported `electron`, causing `MODULE_NOT_FOUND` when running with `ELECTRON_RUN_AS_NODE=1`. Extracted `withTransaction` into its own module to break the dependency chain.
- **MCP server path wrong in built app** — Server path pointed to non-existent `app/out/main/` instead of `app.asar/out/main/`. Fixed to use `app.getAppPath()`.
- **My Day redundant status label** — Tasks with status "In Progress" no longer show `[In Progress]` text in the In Progress bucket. Other non-default statuses still show their label.

### Added
- **Launch at login** — New "Launch at login" toggle in Settings > General. Uses Electron's `app.setLoginItemSettings()` API.
- **Gemini MCP instructions** — Added Google AI Studio setup instructions to the MCP settings panel.
- **Command palette inline operators** — CMD+K now supports `p:`, `@`, `/`, `d:`, `s:` operators with interactive popup suggestions. Selections become filter chips that combine with text search.

### Removed
- **Custom recurrence button** — Removed non-functional "Custom" button from recurrence picker and context menu.

## 2026-03-31

### Fixed
- **Autocomplete ranking** — Exact and prefix matches now rank above substring matches in label and project autocomplete. (0c44196)
- **Status cycling focus/scroll** — Fixed focus loss and scroll jumping when cycling task status; fixed click-opens-detail setting; fixed My Day default project assignment. (5597ff5)
- **Label color defaults** — New labels now default to the least-used color from the palette instead of always picking the first. (2883f5f)
- **In-progress status and My Day positioning** — Removed mandatory in-progress status requirement; fixed done tasks positioning incorrectly in My Day view. (eabe194)

### Added
- **Smart Recurrence Picker** — Replaced free-text custom recurrence with structured picker. Interval + unit selector, day-of-week toggles for weekly, day/ordinal picker for monthly, month+day for yearly. Fixed/After-completion toggle, optional end date. Live preview with next occurrence. Completing recurring tasks auto-clones with next due date and reset subtasks. Task row repeat icon with tooltip. Context menu smart defaults + "Custom..." option. (3fbb5ed, d1a0f1c)
- **Reference URL in quick-add** — The `r:` operator in quick-add and smart input now sets a reference URL on the new task. Description toggle added to quick-add window. (c1d43fe)
- **Cmd+K archive search** — Command palette now has an "include archived" checkbox; results show project name and archive indicators. (95444c1)
- **Distribution-ready build packaging** — Production build pipeline for macOS (DMG + ZIP), electron-builder config, code signing instructions. (5eacf7b)
- **Multi-user data isolation** — All data is now scoped per authenticated user, enabling safe multi-user access on the same database. (73a64e1)

## 2026-03-30

### Fixed
- **Notification timezone bug** — Fixed timezone handling in due date notifications so they fire at the correct local time. (3ff0855)
- **Calendar view polish** — Fixed tooltips, week numbers, My Day tasks display, status sorting, and drag support in the calendar view. (72d0cbb)

### Added
- **Due date notifications** — Native macOS notification alerts for tasks with due date+time. Notifications fire 15 minutes before due time. Clicking the notification navigates to the task. (d3edc4b)
- **Task reference URL field** — Tasks now have a `reference_url` field displayed as a clickable link icon on task rows and an editable URL input in the detail panel. URLs auto-prefix `https://` if missing. Autosave with 1s debounce. X button to clear. (a404d09)
- **Calendar View** — New cross-project Calendar view showing all tasks organized by due date. Supports monthly grid and weekly layout with a toggle. Navigate months/weeks with arrow buttons. Today highlighted with accent color. Overdue tasks in red. Click task to open detail panel. Drag tasks between days to update due dates. (4eedfbc)
- **Template Wizard — Relative Due Date Offsets** — When saving a project as a template, the wizard now asks whether to include due dates as relative offsets (days from a reference date). When deploying the template, actual due dates are computed from a user-chosen deploy date. (2a84ede)

## 2026-03-29

### Fixed
- **Quick-add window follows theme** — The quick-add popup now destroys on close and recreates fresh, waiting for theme confirmation before showing. No more dark flash on light themes. (4c7cbee)
- **Status changes respect default task position** — Changing a task's status now correctly applies the user's default position setting (top or bottom of list). (30d8e2b)
- **Context menu labels in My Day** — Fixed label display and portability when moving tasks between projects via context menu; fixed Shift+Delete on labels; fixed status ordering in My Day buckets. (a2d9ba9)
- **Consistent ESC/Tab behavior** — ESC and Tab now behave consistently across My Day and project views, following the global popup/overlay dismissal system. (131b383)
- **Hide clock icon when time is set** — The clock toggle in the date picker no longer shows when a time value is already present. (f345670)
- **Global Escape propagation** — Used `stopImmediatePropagation` in the global Escape handler to prevent events leaking through overlay layers. (c689c08)

### Added
- **Due date X button in Tab sequence** — The clear (X) button in the due date picker is now reachable as Tab subfield 3. (38442c7)
- **Clock toggle auto-sets time** — Clicking the clock icon sets time to +3 hours from now and focuses the time input. (6eb3bf5)
- **Tab into time picker and focus restore** — Tab now navigates into the time picker / clock field; focus is restored after label removal. (90615e5)
- **Global Escape popup system** — New centralized popup stack for Escape key handling; My Day auto-selects first task on view entry; subtask keyboard navigation improvements. (99e6d43)
- **Due dates in task rows, overdue styling** — Due dates now display inline on task rows with overdue styling; subtask UX and status label improvements. (a8a1804)

### Internal
- **Migrated from better-sqlite3 to node:sqlite** — Replaced the better-sqlite3 native module with Node.js built-in `node:sqlite`, eliminating native compilation requirements. 32 files changed. (aee3cc6)

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
