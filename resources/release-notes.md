## v1.0.5
### Added
- **What's New from GitHub** — The What's New tab now shows release notes directly from GitHub releases
- **Help search** — Search bar in the Help section to quickly find documentation
- **Help sections** — Added Calendar View, Recurrence, Snooze, Archiving, Sharing, Auto-Update, and Reference URL documentation
- **Activity log for all actions** — Every task action (create, status change, priority, labels, archive, assign, move, snooze, recurrence, reference URL, My Day pin) is now logged with user attribution
- **HELP.md update step** — The /feature skill now updates HELP.md and in-app help after each feature

### Fixed
- **Auto-archive excluded from shared projects** — Prevents cross-user conflicts from different archive settings
- **Duplicate labels in shared projects** — Realtime label sync now checks project labels before creating new ones
- **ESC closes keyboard shortcuts modal** — Global Escape handler now properly closes the Help popup
- **My Day hides assignee circle** — Task rows in My Day no longer show the assignee indicator
- **What's New always fresh** — Tab now triggers a sync on open so new releases appear immediately after app update

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

