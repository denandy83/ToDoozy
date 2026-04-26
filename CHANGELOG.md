# Changelog

All bug fixes and changes to ToDoozy. Most recent first.

---

## v1.5.2

- **My Day sort menu now actually sorts** — Picking Priority / Due Date / Title / etc. from the Sort menu in My Day did nothing previously. The view ignored the sort rules and StatusSection re-sorted internally regardless. Sort now applies within each bucket (Not Started / In Progress / Done), and the active sort is shown as literal `Field - ASC` / `Field - DESC` text instead of arrow icons.
- **Timer play button now opens a mode picker instead of silently choosing one** — When Flowtime, Repetition, and Perpetual were all toggleable in Settings, Perpetual silently won at the play button: enabling Flowtime then pressing play would still start a perpetual countdown, with Flowtime never reached. The three independent on/off toggles in Timer Settings have been replaced by a single "Default mode" segmented control (Flowtime / Timer) plus a "Default duration" sub-control inside Timer (Limited / Infinite). Pressing play opens a fixed-size popup pre-selected to your default — switch modes, pick reps, hit Enter. A new "Skip start dialog" toggle in Settings → Behavior keeps the one-click flow for users who don't want the popup. Existing `timer_perpetual` / `timer_flowtime_enabled` settings migrate cleanly: the prior flowtime preference becomes the default mode, perpetual becomes the default duration.

## v1.5.1

- **`project_templates` now syncs across devices** — Was `local-only feature` per the v1.5.0 scope (the SupabaseProjectTemplateRepository literally threw "not available in Supabase mode"). Promoted to a real synced table on Supabase with the same shape as local SQLite, RLS scoped to the owner, soft-delete column, partial indexes for active rows + tombstones. Local SQLite gained `deleted_at` via migration 23. Wired into the generic `reconcileTable` engine; new push/delete functions; the template store fires push on create/update/delete so changes propagate immediately.
- **`tasks.label_names` denorm dropped from push** — `pushTask` no longer writes the redundant `label_names` JSON column. The `task_labels` junction is the source of truth (already synced in v1.5.0) and the column was just denormalized cache that drifted on label rename. The shared-project Realtime fast-path keeps reading it as a fallback for old clients during transition.
- **`project_members.invited_by`** — Added column to Supabase, backfilled 3 rows from `project_invites.created_by`. The `accept_invite` RPC now populates `invited_by = invite.created_by` and `accepted_by = auth.uid()` so member rows carry their provenance. Local apply path passes it through.
- **`user_themes.created_at`** — Was missing on Supabase while local has it. Added the column (defaulted to `now()`, all 76 rows backfilled). `pushTheme` and the themes descriptor now propagate it.
- **`project_labels` is now a real Supabase junction table** — Project↔label associations were previously stored on Supabase as a denormalized JSON blob (`projects.label_data`) instead of a junction table, which caused: renaming a label silently broke its association on every project until the next push, two devices adding different labels to the same project at once clobbered each other (full-array overwrite), and per-association tombstoning was impossible. New `project_labels` table on Supabase with `(project_id, label_id, created_at, deleted_at)`, RLS scoped to project members, partial indexes for active rows + tombstones. Backfilled 70 rows from existing `label_data`. Full incremental push on add/remove + bespoke key-set reconcile (LWW on tombstones) so additions and removals propagate to other devices in seconds. The legacy `label_data` column is no longer written by this client (kept on Supabase for one release for safety).
- **Dropped two stale backup tables** on Supabase (`task_labels_backup_20260425`, `user_labels_backup_20260425`).
- **Projects reconcile fixed + `is_default` / `sidebar_order` / `area_id` now sync** — `Reconcile: projects — failed=N` was firing every cycle because `toRemote` was shipping local-only columns to Supabase. The proper fix: added `is_default INTEGER`, `sidebar_order INTEGER`, and `area_id UUID` to the Supabase `projects` table (with covering indexes) so the data actually syncs cross-device — your default project, sidebar ordering, and area assignments now follow you to every device. Only `is_shared` stays local-only because it's a derived cache of `project_members` (which is already synced on its own).
- **`applyRemote` LWW uses numeric epoch comparison** — `Date.parse()` for both sides, so a local row written as `…Z` and a remote row returned as `…+00:00` for the same instant no longer compare unequal (they used to, because `'Z' > '+'` lexically — the silent cause of redundant pushes).
- **Auto-recover dead Supabase sessions** — When `setSession` fails on cold start (network blip, expired refresh token), the app used to enter a silent "zombie" state: `currentUser` was set from local SQLite, Realtime channels joined the WebSocket without auth, and every push hit RLS 42501 because `auth.uid()` was null. Now `initAuth` retries `setSession` 3× with exponential backoff (1s/2s/4s) before falling back, and every 30 seconds while offline a recovery timer re-attempts restore. On success, the queue is drained and sync resumes — no logout/login required.
- **Session guards on every push and delete** — Every Supabase write (tasks, statuses, projects, labels, themes, settings, saved views, project areas, and their soft-deletes) now calls `requireSession()` first and skips cleanly with a warn-level log when there's no session, instead of issuing an anonymous request that gets rejected by RLS.
- **Realtime subscriptions gated on a live session** — `subscribeToPersonalProject` no longer joins the WebSocket when there's no session, so we don't end up with dead listeners that never receive events.
- **"Sync paused" banner when offline** — A persistent amber banner appears at the top of the app whenever the auth store is in offline-fallback mode, with "Retry now" and "Sign in again" actions. Users see the state immediately instead of silently losing changes to RLS.

## v1.5.0

- **Uniform sync architecture** — Every syncable table (tasks, statuses, projects, labels, themes, settings, saved views, project areas) now uses the same soft-delete + reconcile pipeline. Deletes set `deleted_at` and propagate via Supabase Realtime UPDATE events instead of hard DELETE so peers can converge after offline gaps.
- **Generic two-way reconcile** — A single `reconcileTable` helper diffs all eight tables, pushing local-only rows and pulling remote-only rows with last-writer-wins on `updated_at`. Replaces eight bespoke per-table pull functions that each had different gaps.
- **Per-(user, scope, table) high-water mark** — Idle reconcile now does N tiny `max(updated_at)` queries instead of N table scans; if neither side has new data since the stored high-water, the diff is skipped entirely. Per-project scoping prevents one project's high-water from masking another's drift.
- **Cross-device delete propagation** — Realtime UPDATE handlers now recognize `deleted_at` transitions and apply them locally as soft-deletes. Deletes made on one device disappear on every other device within seconds.
- **Resurrect protection** — A locally tombstoned row stays tombstoned even when a newer remote update arrives, as long as the remote keeps `deleted_at` set. Prevents zombie rows after Realtime gaps.
- **30-day tombstone purge** — Daily Supabase `pg_cron` job at 03:00 UTC plus a boot-time local sweep hard-DELETE rows tombstoned for more than 30 days. Keeps storage bounded and gives every honest peer time to see the tombstone before it disappears.
- **Realtime wake-from-sleep storm fix** — On macOS wake, supabase-js auto-rejoins channels; our reconnect timer was tearing down freshly-rejoined channels and looping every 2s. The timer-fire callback now checks `channel.state === 'joined'` and skips the rebuild if the lib already healed.
- **`setAuth` token-refresh fanout fix** — Token refresh used to push one `setAuth` per channel; identical tokens are now deduped at the wrapper layer in `lib/supabase.ts`.
- **`fullUpload` concurrency guard** — `initSync` now writes `last_sync_at` at the start as a sentinel and wraps its body in a shared in-flight promise. Prevents the parallel-callers-each-see-null race that produced a mass push storm of every project's tasks on boot.
- **Reconcile dedupe** — `reconcile()` now uses an in-flight guard plus a 30s cooldown, so the startup reconcile and the online-recovery reconcile no longer both fire on a transient WS hiccup.
- **`syncShared` effect deps fix** — `App.tsx` switched from object/function deps (`currentUser`, `hydrateProjects`) to a stable primitive (`startupUserId`). Stops the effect from re-firing on every auth-store mutation including token refresh.
- **`pullNewTasks` / `pullStatuses` no longer push** — Removed the "local newer → push" branch from polling pulls. Recovery is owned by `sync_queue` (mutation retries) and `reconcile()` (ID-set diff). Polling is read-only.

## v1.3.3

- **Fix: DatePicker only highlights the real due date** — Opening the calendar with no due date set used to show today filled across every month you navigated to, and with a date like April 18 set, navigating to May would also highlight May 18. Now only the actual selected date gets the accent fill, today shows a subtle accent-colored border when it isn't the selected date, and every other day renders neutrally

## v1.3.2

- **Fix: Quick-add label picker shows all labels** — The `@` picker in the quick-add popup now lists every label the user has access to, not just labels linked to the default project, and picking a label from another project links it into the selected project on submit instead of creating a duplicate
- **Fix: Sync dot no longer goes red on idle** — The sidebar sync indicator used to turn red after 5 minutes of inactivity even when the app was genuinely up to date. It's now driven by real signals (internet connection, Supabase Realtime channel, unflushed local writes) and the tooltip names which one failed
- **Fix: Accepting an invite no longer fails with a FOREIGN KEY error** — When a new user joined a shared project, the initial sync could fail with "FOREIGN KEY constraint failed" if any task was assigned to a user their device had never seen. The sync now pre-fetches every referenced user and ensures local user rows exist before inserting any tasks
- **Fix: Email confirmation lands on a real page** — Clicking the email confirmation link after signing up used to send users to a localhost URL the browser refused to connect to. A new hosted confirmation page now shows a friendly "Email confirmed — open ToDoozy to sign in" message

## v1.3.1

- **Update restart banner** — After an auto-update downloads, a persistent banner appears at the top of the app with the version number and a Restart button, so users always know a new version is ready
- **Realtime subscription dedup** — Fixed subscription churn by deduplicating personal Realtime channels and stabilizing invite channel names
- **Supabase disk IO optimization** — Adaptive polling intervals, compound indexes for incremental sync, batch N+1 queries for labels and members
- **Reference URL fix** — Reference URLs entered in the main task input are now correctly passed through to the created task

## v1.3.0

- **Cookie break gamification** — Flow timer now rewards breaks with animated cookie treats, a cookie jar collection, and streak tracking to encourage healthy work patterns
- **Fix: cookie stats precision** — Cookie stats now show seconds precision instead of rounding to minutes
- **Fix: cookie label rename** — Cookie stats labels updated to plural "Cookies" for consistency

## v1.2.1

- **Claude Desktop config in MCP settings** — Settings > Integrations > MCP Server now shows a Claude Desktop JSON config snippet for easy copy-paste setup
- **Fix: section headers in update modal** — Section headers now render correctly in the update available modal and release notes display

## v1.2.0

- **Enhanced timer with long break, flowtime mode, session stats (#61)** — Timer now supports long breaks, flowtime (open-ended focus) mode, and a session stats summary after each work cycle
- **Stats: clickable KPI cards** — Dashboard KPI cards now drill down into filtered task lists when clicked
- **Stats: enhanced dashboard** — Streaks displayed at top, plus new priority/project breakdown charts and day-of-week activity chart
- **Fix: RLS auth detection** — RLS policy violations are now detected as auth errors and trigger automatic session refresh
- **Fix: UUID database regression** — Fixed UUID database naming regression, sync overhaul, timer fixes, and stats enhancements

## v1.1.6

- **My Day auto-add based on due date** — Tasks with a due date matching today are automatically added to the My Day view (#55)
- **Per-integration default project for Telegram and iOS Shortcut** — Each integration (Telegram Bot, iOS Shortcut) can now have its own default project for task creation (#56)
- **AND/OR label filter logic** — Label filters now support AND/OR operator toggle, letting you require all selected labels or match any of them (#57)
- **Per-project auto-archive and My Day done-today filter** — Projects can auto-archive completed tasks after a configurable period; My Day shows tasks completed today in a separate section (#58)
- **Remote MCP server via Supabase Edge Function** — ToDoozy's MCP tools can now be accessed remotely through a Supabase edge function, enabling AI integrations from anywhere (#59)
- **Natural language date & recurrence parsing** — Users can type dates naturally (e.g., "tomorrow", "next Monday", "every 2 weeks") and they are parsed automatically into structured dates and recurrence rules (#60)
- **Update available modal with release notes** — The auto-updater now shows a modal with formatted release notes when an update is available
- **Fix: updater restart** — Updater restart now properly quits and relaunches the app on macOS instead of just hiding the window
- **Fix: UUID DB cleanup** — Stale UUID-named database files are deleted after migrating to the email-named database
- **Fix: bidirectional sync** — Locally-newer tasks and statuses are now pushed to Supabase during sync, not just pulled
- **Fix: iOS Shortcut instructions** — Updated iOS Shortcut setup instructions to include project name in the notification
- **Fix: sync FK failures and stale detection** — Fixed foreign key constraint failures during sync, improved stale sync detection, moved MCP tab, and fixed iOS Shortcut headers
- **Fix: redundant section titles** — Removed duplicate section titles in Settings > About (v1.1.4)
- **Fix: inline updater and notification bell** — Fixed inline updater display, restart behavior, notification bell, and release notes DB storage (v1.1.3)
- **Fix: release notes and delete resurrection** — Release notes now load from Supabase correctly; fixed deleted tasks reappearing after sync (v1.1.2)
- **Notarization enabled** — Built-in notarization re-enabled in electron-builder
- **Fix: verification, sync gaps, calendar and UX** — Fixed verification flow issues, sync gaps, calendar display bugs, and miscellaneous UX improvements (v1.1.1)

## v1.1.0

- **Settings reorganization** — Reorganized Settings modal from 11 tabs to 7: General, Projects, Appearance (Theme + Priority Display subtabs), Labels, Timer, About (Updates + What's New + Integrations + Help subtabs). Added section labels throughout. No settings removed or renamed.
- **MCP activity logging** — All 22 mutating MCP tools now create activity log entries, so AI-made changes (task creation, updates, label changes, etc.) appear in the activity timeline alongside user actions.
- **iOS Shortcut integration** — New Integrations tab in Settings with iOS Shortcut setup instructions and an inline copy-able API endpoint. Sub-tabs added to Integrations: Telegram Bot | iOS Shortcut.
- **Telegram Bot settings in-app** — Full Telegram Bot configuration tab in Settings: connect your Telegram ID, set a default project, manage bot settings without editing config files.
- **Telegram /done and /recent commands** — `/done` shows recently completed tasks (filtered to done-status tasks only); `/recent` shows open tasks added recently. Task list persists after completing — a checkmark replaces the done task inline.
- **Telegram bot commands menu** — Bot commands registered with Telegram for autocomplete menu support. `.list`, `.default`, `.prefix`, `.settings` commands added. Dot-prefixed commands always run built-in bot commands; slash prefix checks project names first.
- **Telegram PID file lock** — Prevents duplicate bot instances from starting.
- **Force Full Sync button** — Added to Settings > General > Sync section for manually triggering a complete Supabase sync.
- **Supabase project metadata sync** — Project name, color, and icon now pulled from Supabase on sync, keeping local data in sync with remote changes.
- **Email-based DB filename** — Database file now named after the authenticated user's email address (e.g., `todoozy-user@example.com.db`) instead of a UUID, making it easier to identify. In-memory DB used before auth to avoid creating stale files.
- **Separate auth session files** — Dev and production environments now use separate session storage files to prevent cross-contamination.
- **Sync: poll for remote updates** — Supabase polled every 10s for externally created/updated tasks. `pullNewTasks` also detects remote updates via `updated_at`. `syncProjectDown` and `discoverRemoteMemberships` skip gracefully when offline.
- **Sync: push project updates** — Project renames and edits now push to Supabase.
- **Sync: pull new tasks on project switch** — New tasks from Supabase are fetched when switching projects.
- **Fix: text selection** — Text selection disabled globally; allowed only in editable areas (inputs, textareas, detail panel editor). Prevents accidental text highlighting during mouse navigation.
- **Fix: offline banner** — Offline banner uses `border-border` for flush layout; removed extraneous borders.
- **Fix: tray badge refresh** — Tray badge count updates instantly on My Day toggle and status change.
- **Fix: notarization** — Notarization temporarily disabled (was causing build hang); will be re-enabled once the hang is diagnosed.
- **Fix: Settings logging** — Added logging for Supabase settings pull failures to aid debugging.
- **Fix: sync store exports** — Added missing `syncStore` exports and `selectSortRules` to barrel file.

## v1.0.7

- **Full task rows in saved views + multi-sort** — Saved views now use the full TaskRow component with all task info (status, labels, priority, due date, etc.). Multi-sort with stackable sort rules in both saved views and project views. Sidebar saved views show colored dots. Priority auto-sort migrated to new sort system (#53)
- **Sidebar customization** — Sidebar always expanded (collapse removed), light/dark theme toggle replaces collapse button, Stats moved to footer, show/hide and reorder nav items in Settings, dynamic keyboard shortcuts (#52)
- **Supabase full sync engine** — Write-through sync hooks on all Zustand stores so every local write pushes to Supabase in background. Sync status indicator, offline detection, queue-and-flush for personal projects (#51)
- **Exclusion filters ("is not")** — Added "is not" exclusion filter support for all filter types (labels, status, priority, assignee, projects) in saved views and the filter bar (#50)
- **Saved views / smart lists** — Added saved views with persistent filter configurations for reusable smart lists (#47)
- **Stats dashboard** — Added productivity stats dashboard with Recharts for visual task analytics (#48)
- **Project areas/folders** — Added project areas and folders for sidebar grouping and organization (#49)
- **Expanded filter system** — Added priority, status, due date, and keyword filters to the filter bar (#46)
- **MCP task reorder tool** — Added `reorder_tasks` tool for task ordering via MCP (#44)
- **Drag-drop UX overhaul** — Overhauled drag UX with horizontal intent detection and full-row ghost rendering
- **Fix: Command palette filter clearing** — Fixed label/assignee filters not clearing on task navigation in command palette (#45)

## v1.0.6

- **Timer improvements** — Enhanced timer UX and reliability
- **Label search** — Improved label search and filtering
- **Member display reliability** — Fixed member avatar display and cache invalidation for shared projects
- **What's New from GitHub** — What's New tab now syncs release notes directly from GitHub releases, with bundled fallback for offline use
- **Help search** — Added search functionality to the help/documentation tab
- **Activity log improvements** — Enhanced activity log display and entries

## v1.0.5

- **What's New syncs from GitHub** — Release notes are fetched from GitHub API and cached locally; bundled fallback ensures content is always available
- **Help search** — Searchable help content in Settings
- **Activity log** — Improved activity logging for task changes
- **Shared project fixes** — Fixed stale sessions, invite polling, realtime member display sync, duplicate label prevention, and shared-user placeholder updates

## v1.0.4

- **Member display cache** — Fixed member display cache invalidation on Realtime member events

## v1.0.2

- **Realtime invite subscription** — Fixed invite subscription with status checking and retry logic
- **Stale session handling** — Fixed stale sessions, invite polling, and realtime member display sync
- **Duplicate label prevention** — Prevented duplicate labels when syncing shared projects
- **Shared-user placeholders** — Updated shared-user placeholders in place instead of delete+recreate
- **Member avatar border** — Reduced member avatar border width from 2px to 1px
- **Multiselect assignee filter** — Added multiselect assignee filter with hover highlight on member avatars
- **Member avatar click filter** — Member avatars show all members; click filters by assignee
- **Member display sync** — Synced member display customizations (color, initials) via Supabase
- **Post-reinstall sync** — Re-sync shared project state and member profiles after reinstall

## v1.0.0

- **Auto-Update Mechanism** — Added Sparkle-style auto-update system using electron-updater with GitHub Releases as the update provider. App checks for updates on launch and every 4 hours. Update dialog shows version number, release notes, and Install & Restart / Not Now buttons. Download progress bar during update download. Settings page displays current version with manual Check for Updates button.

## 2026-04-01 (cont.)

### Fixed
- **Remote membership discovery on startup** — App now discovers remote project memberships on startup, and shows proper error messages when invite acceptance fails. (2be9304)
- **Full real-time task sync for shared projects** — Wired up complete real-time sync so changes by collaborators in shared projects are reflected immediately. (09b3b16)

### Added
- **Collaboration UX improvements** — Avatar consistency across views, inline task assignment for shared projects, and real-time sync polish. (c6d7eb0)

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
