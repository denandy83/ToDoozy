## v1.1.0
## v1.1.0

- **Supabase Full Sync Engine** — All data syncs to Supabase automatically. Per-user SQLite databases. Offline detection. Shared projects read-only when offline. Force Full Sync button in Settings.
- **Sidebar Customization** — Always expanded, light/dark mode toggle, Stats in footer, toggleable/reorderable items, dynamic keyboard shortcuts.
- **Saved Views + Multi-Sort** — Full task rows in saved views, multi-field sort with drag-to-reorder.
- **Telegram Bot** — Create tasks via Telegram with smart parser. Commands: .help, .list, .default, .done, .recent, .myday. Deployed on Raspberry Pi via Docker.
- **iOS Shortcut Integration** — REST API via Supabase RPC for voice-to-task. Per-user API key. Step-by-step setup instructions in Settings > Integrations.
- **Settings > Integrations tab** — Unified tab with sub-tabs for Telegram Bot and iOS Shortcut. Shared default project selector. Inline copy fields for setup.
- **Stats View** — Visual stats dashboard.
- **Apple Developer signing** — App properly signed with Developer ID certificate.
- **Per-user databases** — Each user gets todoozy-{email}.db. In-memory placeholder before auth.
- **Text selection disabled globally** — No accidental selection on UI elements.
- **Project metadata sync** — Renames pull from Supabase every 10s.
- **Separate dev/prod auth sessions** — No more token conflicts when running both.
- **Instant tray badge** — My Day toggle and status changes update immediately.

## v1.0.7
### Added

- **Settings reorganization** — Consolidated 11 tabs down to 7 with subtabs and section labels. Themes + Priorities merged into Appearance. Updates + What's New + MCP + Help merged into About. Notifications absorbed into General. Every setting still accessible, just better organized
- **Expanded filter system** — New filter bar with priority, status, due date, assignee, and keyword filters alongside existing label filters. All filters combine with AND logic. "+ Filter" button reveals additional filter types as removable chips. Works across project views, My Day, and Calendar
- **Saved views / Smart lists** — Save any filter combination as a named view. Views appear in a collapsible "Views" sidebar section with live task count badges. Click to load, tweak filters live, "Update View" to persist changes. Broken filters (deleted labels/statuses) show warning indicators. Shared project views visible to all members. MCP tools for create, list, delete
- **Stats dashboard** — New Stats view (⌘3) with Recharts visualizations: daily completion bar charts, focus time charts, streak tracking with fire icon and gamification messaging, GitHub-style 90-day contribution heatmap, team leaderboards for shared projects. Filter by project and time range (7/30/90 days)
- **Project folders** — Group projects into collapsible folders in the sidebar. Per-user scoping (not synced in shared projects). Drag projects onto folder headers to assign, drag out to ungroup. Collapse state persists. Deleting a folder ungroups its projects. Full MCP tool support (create, list, update, delete, assign)
- **Drag-drop overhaul** — Complete rework of drag UX across the app. Items stay in place during drag (no shifting). Task ghost renders as full-width row clone with all icons/labels/buttons intact, locked horizontally, moves only vertically. Horizontal cursor detection replaces 750ms dwell timer for folder assignment: drag left = ungrouped, drag right = assign to folder. Cursor shows grab/grabbing hand throughout drag lifecycle
- **MCP activity logging** — All 22 mutating MCP tools now write activity log entries with proper action names and old/new values. AI-made changes appear in task detail activity timeline just like UI changes
- **MCP task reorder** — New reorder_tasks tool accepts ordered task ID array, validates all exist, warns if priority auto-sort may override visual order
- **Folder management in settings** — Merged Folders tab into unified "Sidebar & Folders" subtab. Inline rename (double-click or pencil icon), toast-confirmed delete with Shift+click bypass, new folder creation at top of list

### Fixed

- **Command palette filter clearing** — Navigating to a task via ⌘K now clears active label and assignee filters so the target task is always visible and scrolled into view
- **Sidebar icon sizing** — Fixed Projects section icon appearing smaller than other section icons due to missing flex-1 wrapper
- **Drag item shifting** — Replaced useSortable/SortableContext with useDraggable/useDroppable across TaskRow, KanbanCard, StatusSection, and KanbanColumn to eliminate item shifting during drag
- **Content fade during drag** — Removed the opacity-40 fade on the entire main content area during drag; only the dragged task row fades now
- **Text selection on sidebar labels** — Added select-none to prevent accidental text highlighting on "Projects" header
- **Sidebar naming** — Renamed "Saved Views" to "Views", "Area" to "Folder" throughout UI for clarity

## v1.0.6
### Added
- **Label search** — Search field in Settings → Labels to quickly find labels
- **Minimize on start toggle** — Settings → Timer option to keep the window open when starting a timer
- **Time Spent tracking** — Task detail shows total focus time and session count (e.g., "1h 3m spent in 2 sessions")
- **Tray double-click** — Double-click the menu bar icon to open the main window

### Fixed
- **Member display sync reliability** — Queued reloads prevent dropped updates; polling now invalidates avatar cache; null display values sync correctly
- **Duplicate labels in shared projects** — Realtime sync checks project labels first before creating
- **Timer logs on manual stop** — Stopping a timer now logs elapsed focus time instead of discarding it
- **Labels preserve original case** — Removed forced uppercase from label chips and filter bar
- **Removed bell icon from snooze** — Cleaner snooze UI in task detail
- **Fixed launch crash** — Resolved require() error for bundled release notes seeding

## v1.0.5
### Added
- **What's New** — Shows release notes from all versions, bundled at build time and refreshed from GitHub
- **Help search** — Search bar in the Help section to quickly find documentation
- **Help sections** — Added Calendar View, Recurrence, Snooze, Archiving, Sharing, Auto-Update, and Reference URL documentation
- **Activity log for all actions** — Every task action (create, status change, priority, labels, archive, assign, move, snooze, recurrence, reference URL, My Day pin) is now logged with user attribution
- **HELP.md update step** — The /feature skill now updates HELP.md and in-app help after each feature

### Fixed
- **Auto-archive excluded from shared projects** — Prevents cross-user conflicts from different archive settings
- **Duplicate labels in shared projects** — Realtime label sync now checks project labels before creating new ones
- **ESC closes keyboard shortcuts modal** — Global Escape handler now properly closes the Help popup
- **My Day hides assignee circle** — Task rows in My Day no longer show the assignee indicator
- **What's New always available** — Release notes bundled at build time; never depends on GitHub API availability

## v1.0.4
### Fixed
- Stale Supabase sessions force re-login instead of silent offline fallback
- Realtime invite subscription with status checking and retry
- Member display (color/initials) syncs via Realtime with cache invalidation
- Duplicate labels no longer created when syncing shared projects
- Shared-user placeholder profiles updated in place

## v1.0.3
### Fixed
- Shared member profiles now update correctly (no more 'shared-user' placeholders)

## v1.0.2
### Fixed
- Shared project state lost after reinstall
- Shared members showing as shared-user

### Added
- Member avatar assignee filter (multiselect, blur/hide)
- Member display sync across all project members
- All members shown in project header

## v1.0.1
- **Auto-Update** — Check for updates from Settings or automatically every 4 hours
- **Release Notes on Supabase** — What's New content now synced from Supabase

