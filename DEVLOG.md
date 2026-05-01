# ToDoozy — Developer Log

Reverse-chronological log of development sessions, decisions, and milestones.

---

## v1.5.5 — Sidebar color, profile settings, session-expired banner, label dedup (2026-04-29 – 2026-05-01)

**Session type:** Feature + bug fixes

**What was built/fixed:**

- **Sidebar color (visual)** — Added `ThemeConfig.sidebar` field mapped to `--color-sidebar` CSS variable. Sidebar.tsx switches to `bg-sidebar`. All 12 built-in themes updated. Supabase migration adds `sidebar` column to `user_themes` and back-fills existing rows. Sync paths (syncTables descriptors, PersonalSyncService pushTheme) updated to carry the new field.
- **Structural borders always visible** — Header line and sidebar borders switched to `border-foreground/10` so they're visible in every theme regardless of the border color setting.
- **SessionBanner overlay** — Session-expired and sync-paused banners now render as `absolute inset-0` overlays with solid red/amber backgrounds rather than sitting in layout flow.
- **Session-expired vs sync-paused distinction** — Added `isTokenPermanentlyDead` to authStore; `tryRestoreSession` sets it on permanent auth errors. SessionBanner renders a red "Session expired — Sign in again" variant when true, instead of the misleading amber retry prompt.
- **Profile settings (#65)** — New Profile tab in Settings: password management, display name, account info.
- **Duplicate label fix (LabelRepository)** — `findAllForUser` and `findAllWithUsage` now filter `labels.user_id = current_user OR user_id IS NULL`, so foreign members' labels never appear in the user's pickers.
- **Label collision consolidation** — Reconcile path and sync queue now handle MCP-induced duplicate label IDs: canonical label inserted first, junction table remapped, duplicate deleted.
- **Shared-project reconnect log names** — `scheduleSharedReconnect` now uses `getCachedProjectName` in all three reconnect log calls instead of raw project UUIDs.
- **Recurrence due-date parsing** — Due dates parsed as local midnight (not UTC) to prevent same-day re-clones in non-UTC timezones.
- **Member avatar reliability** — Profiles fetched via SECURITY DEFINER RPC to include email/password users; stale placeholder cache emails overridden by live props; `Unknown` replaced by `Member (uuid)` for profileless members.

**Key commits:** a118c5d (v1.5.5 bump), 2342ccf, 143dd2a, d0f0f34, ba0c2fb, 96fea43, 630e951, 8821ac2, e57dde3, fe829fd, 5daced3, fdd1abf, bf6fcf3, 6f91d17, edd2d9c, c0ad386, 081ba15, 691210b, 7ac248a, 90a5486

---

## v1.5.4 — Phantom reconcile pushes + shared-project label gap (2026-04-27)

**Session type:** Bug fix

**What was fixed:**

- **Phantom reconcile pushes** — `reconcileTable` was classifying already-synced rows as local-only and pushing them every cycle. The diff correctness condition was inverted; fixed so in-sync rows are skipped.
- **Shared-project label gap** — `task_labels` rows were not included in the reconcile scope for shared projects. Label assignments are now covered by the reconcile and propagate to all members.

**Key commits:** 85e4ca2 (v1.5.4 bump), 1301605

---

## v1.5.2 – v1.5.3 — Forever auth + notification panel fixes (2026-04-26)

**Session type:** Bug fixes

**What was fixed (v1.5.2 — Forever auth):**

- Supabase rotates `refresh_token` on every use. Our `onAuthStateChange` listener logged `TOKEN_REFRESHED` but never re-persisted the rotated token to safeStorage, so after one in-app rotation the next cold start hit "Refresh Token Not Found" — permanently dead. Fixed by attaching a `TOKEN_REFRESHED` / `SIGNED_IN` listener in `attachAuthInstrumentation` that persists the new session immediately (with `setTimeout(..., 0)` to avoid the auth-js `_acquireLock` deadlock: supabase/auth-js#762).
- Concurrent rotation paths (cold-start `setSession`, autoRefreshToken loop, sleep/wake timers, recovery timer ticks) could race and trip Supabase's 10s reuse-detection window. Fixed with an `async-mutex` single-flight wrapper (`safeSetSession`, `safeRefresh`).
- Recovery timer retried forever even on permanent errors (`refresh_token_not_found`, `session_not_found`, etc.). Now detects terminal errors, sets `permanentlyDead`, clears safeStorage, and stops.
- Added `app.requestSingleInstanceLock()` in Electron main to prevent multi-instance auth-client races.

**What was fixed (v1.5.3 — Notification panel):**

- Bell toggle: document outside-click handler was closing the panel before `togglePanel()` ran, so clicking the bell while open netted zero change. Fixed by testing against `panelRef.current?.parentElement` (the shared wrapper containing both bell and panel) instead of the panel ref itself.
- X → Trash2: replaced the redundant close button with a trash icon that triggers a persistent confirm toast before calling `notifications:deleteAll` (new IPC + `NotificationRepository.deleteAll()` + store action). Trash disabled when list is empty.

**Key commits:** e2c6ac7, f8b7569, e7fd413, 7f2ab11, 29eae22, 3b129e6, 8593936, 07fd262, 0c788a3

---

## v1.5.1 — Auto-recover dead Supabase sessions (2026-04-26)

**Session type:** Bug fix on `fix/session-recovery` (off v1.5.0)

**Symptom:** Renderer logs from a clean cold start showed `auth: SIGNED_OUT` events at boot, then every `pushSetting`/`pushTask` failed with `42501 — new row violates row-level security policy`. Tasks the user changed locally never reached Supabase. The 523-row reconcile push that fired on the previous boot turned out to be the v1.5.0 LWW pipeline correctly identifying drift accumulated during this very zombie state.

**Root cause:** `persistSession: false` (we manage tokens through Electron `safeStorage`) means a single failed `setSession` call leaves the supabase-js client without a session. `initAuth` only attempted that call once. On failure it set `isOffline: true` and seeded `currentUser` from local SQLite, so the rest of the app ran as if logged in — but every push went out anonymously and got 42501'd by RLS, and Realtime channels joined the WebSocket as anonymous listeners. There was no recovery loop, no UI signal, no session guard on the writes.

**Fix:**
- New module `src/renderer/src/services/sessionRecovery.ts` centralizes session handling: `requireSession()`, `tryRestoreSession(attempts)` with `[1s, 2s, 4s]` backoff, `startRecoveryTimer({onRecovered})` ticking every 30s, `stopRecoveryTimer()`.
- `authStore.initAuth` now retries `setSession` 3× before falling back; on fallback, the recovery timer runs and on success clears `isOffline`, switches DB, refreshes the local user, and drains `sync_queue` via `processSyncQueue()`.
- `PersonalSyncService.ts`: every push (8 functions) and every soft-delete (8 functions) gets a `hasLiveSession` guard at the top — no session, log a warn, skip. `subscribeToPersonalProject` is gated on `requireSession()` so we never join Realtime as anonymous.
- New `SessionBanner` component shown at the top of `App.tsx` when `isOffline === true`, with explicit "Retry now" / "Sign in again" actions. Amber styling matches the warn-log convention used elsewhere.
- `logout()` + `signInWithEmail()` call `stopRecoveryTimer()` to prevent stale timers post-logout; successful sign-in explicitly clears `isOffline`.

**Tests:** `npm run typecheck` clean. `npm run test` — only pre-existing date-dependent failures in `recurrenceUtils.test.ts` (5 tests, present before this change too); 725 passing. No tests added — the change is on the IPC/auth-IO boundary and is exercised by manual cold-start verification.

**Strategic context:** Aligns with the long-term goal of byte-equal local/cloud parity for the upcoming iOS app and multi-thousand-user scale. A silent-zombie session was a class of bug that would have produced silent data loss at scale.

**Follow-up in same release — Projects reconcile column mismatch + LWW format drift:** A second bug surfaced via `Reconcile: projects — failed=11`. `projectsDescriptor.toRemote` was returning the local row as-is, which included the local-only columns `is_default`, `is_shared`, `sidebar_order`, and `area_id`. Supabase's `projects` table doesn't have those columns and PostgREST rejected the upsert. Fix: `toRemote` now constructs an explicit remote payload with just the remote-existent columns. `ProjectRepository.applyRemote` was updated to preserve local-only fields on existing rows (omitted from the `ON CONFLICT DO UPDATE SET` list) and seed defaults for new ones. While in there, the LWW guard switched from string comparison to `Date.parse()` numeric comparison — Supabase returns timestamptz as `…+00:00` while local writes use `…Z`, and `'Z' > '+'` lexically, which would otherwise flag identical instants as drift. The user separately reported 523 then 181 redundant pushes across two sessions; with the session-recovery fix in place the queued backlog drained and current reconcile shows "skipped (no drift)" for tasks/statuses across all 10 personal projects.

---

## v1.5.0 — Uniform sync architecture (2026-04-25)

**Session type:** Architectural rebuild — 17-task workstream on `fix/realtime-wake-storm`

**What was built/fixed:**

- **Soft-delete everywhere.** Added `deleted_at TIMESTAMPTZ` + active-row indexes to all eight syncable tables (Supabase + local SQLite via versioned migrations). Every delete path now sets `deleted_at` instead of hard-DELETE; reads filter; the only hard-DELETE is the 30-day purge.
- **Generic two-way reconcile.** Built `reconcileTable<TLocal, TRemote>` in `src/renderer/src/services/syncTables.ts` — a single helper that diffs all eight tables, pushes local-only, pulls remote-only, applies LWW per row. Replaces eight bespoke per-table pull functions.
- **Per-(user, scope, table) high-water mark.** Added `sync_meta` table + `SyncMetaRepository` with primary key `(user_id, scope_id, table_name)` so project-scoped tables (tasks, statuses) don't shadow each other. Pre-reconcile fetches local + remote `max(updated_at)` and stored high-water in parallel; if both sides ≤ stored, the diff is skipped entirely. `findMaxUpdatedAt` was extended to include tombstones so soft-deletes bump the high-water and failed pushes retry.
- **Realtime UPDATE → soft-delete propagation.** The Realtime handlers now recognize `deleted_at` transitions and apply them locally. Cross-device deletes converge in seconds.
- **Resurrect protection.** `applyRemote` keeps remote's `deleted_at`, so a locally tombstoned row stays tombstoned even when a newer remote update arrives without clearing the tombstone.
- **30-day tombstone purge.** Supabase `pg_cron` job `purge-tombstones` runs `select public.purge_tombstones()` daily at 03:00 UTC. Local equivalent runs once on boot from `src/main/index.ts` after `initDatabase()`.
- **Storm fixes (also on this branch).** Realtime reconnect timer checks `channel.state === 'joined'` and skips rebuild if the lib already healed. `setAuth` deduped at the wrapper. `fullUpload` writes `last_sync_at` at the start as a sentinel; `initSync` wrapped in a shared in-flight promise. `App.tsx` syncShared effect switched from object/function deps to primitive `startupUserId`. `reconcile()` got in-flight guard + 30s cooldown. `pullNewTasks` / `pullStatuses` no longer push — polling is read-only, recovery owned by `sync_queue` and `reconcile()`.

**Test coverage added:**

- `PurgeService.test.ts` — 6 tests, retention boundary + multi-table + idempotency + byTable completeness.
- `SyncMetaRepository.test.ts` — 8 tests including scope isolation.
- `syncTables.test.ts` — 5 tests covering high-water short-circuit, push case, pull case, first-reconcile, failure-blocks-advance.
- All eight repository test suites updated for tombstone-inclusive `findMaxUpdatedAt` and the `applyRemote` LWW + tombstone-propagation contract.
- `TaskRepository.test.ts` — added explicit Scenario D (resurrect protection) test.

**Manual drift verification runbook:** documented in `scope.md` for the user to execute Scenarios A-D against a dev DB before tagging.

**Key commits:** TBD after squash merge to `main`.

---

## v1.4.0 – v1.4.5 — Theme import/export, Realtime auto-reconnect, sync hardening (2026-04-21 – 2026-04-25)

**Session type:** Feature implementation + bug fixes (multiple patch releases)

**What was built/fixed:**

- **Theme import / export (#62, v1.4.0)** — New Export and Import buttons in Settings → Themes. Exports current theme as JSON; imports any JSON theme file. Enables sharing custom color palettes between devices and users.
- **Theme save icon polish (#63, v1.4.0)** — Save icon in theme editor now only appears when color values differ from the persisted state, eliminating the "always unsaved" false positive.
- **Cmd+K UUID search (#64, v1.4.0)** — Command palette now matches against task UUIDs in addition to titles/labels/metadata. Direct navigation by pasting a task ID.
- **Timer mode picker (#62-adjacent, v1.4.0)** — The three competing timer toggles (Perpetual, Flowtime, Repetition) are replaced by a single "Default mode" segmented picker. Pressing play opens a fixed-size popup; a "Skip start dialog" toggle restores one-click behavior.
- **Notification panel bell toggle + trash-confirm (#v1.4.0)** — Bell now correctly toggles the panel closed. X replaced by Trash2 with persistent confirm toast before bulk-delete.
- **Update modal skipped-versions fix (#v1.4.1)** — Modal now concatenates notes from every intermediate version, not just the latest.
- **Auto-reconnect Realtime channels (v1.4.2)** — On channel drop (sleep/wake, network switch), a backoff reconnect is scheduled automatically. Previously channels stayed dead until app restart. In-app connection log added to Settings for diagnosing sync issues.
- **Shared-project sync bugs (v1.4.3)** — Batch pre-fetch of all referenced user IDs before task insert (fixes FK failures); placeholder rows for unknown members; high-water mark fix for incremental pull; auto-archive scoped to the originating device.
- **Offline debounce + label default (v1.4.4)** — High-frequency writes debounced before entering sync queue; new labels default to least-used color; What's New sync now logs completion.
- **Sync silent-failure paths + label dedup (v1.4.5)** — Error paths that swallowed exceptions now surface and retry; duplicate label rows (same name, different ID) consolidated; `task_labels` added to reconcile scope.

**Key commits:** cd05968, 3c01c28, 9359cea (v1.4.0), a463fa6 (v1.4.1), c175248, f9b247b (v1.4.2), 47bc120, d118a56 (v1.4.3), 51dc0f6, ffdc1cf (v1.4.4), 4fe36d7, b3e2689 (v1.4.5)

---

## v1.3.3 — DatePicker fix, label picker, sync dot, invite FK (2026-04-19 – 2026-04-20)

**Session type:** Bug fixes

**What was fixed:**

- **DatePicker keyboard-selected day** — `--keyboard-selected` CSS class was styled identically to `--selected`, causing today's day-of-month to appear highlighted in every navigated month. Fixed by splitting the CSS rules: only `--selected` gets the accent fill; `--keyboard-selected` is neutralized; today gets a subtle `box-shadow: inset` border.
- **Quick-add label picker shows all labels** — Labels loaded via `labels.findAll(userId)` instead of `labels.findByProjectId(...)`, deduped by lowercase name for display. Cross-project labels now linked to the target project on submit.
- **Sync dot false-positive red** — Staleness is now derived from `navigator.onLine`, `realtimeConnected`, and `pendingCount` with a 60s drain timer. Idle sessions stay green. A 30s interval re-evaluates the state independently of render cycles.
- **Invite FK failure** — `syncProjectDown` now batch-fetches every unique `owner_id` and `assigned_to` across remote tasks and ensures local user rows exist before inserting, eliminating the "FOREIGN KEY constraint failed" error on first join.
- **Email confirmation redirect** — `signUpWithEmail` now passes `emailRedirectTo` pointing to a GitHub Pages hosted confirmation page, replacing the localhost URL that browsers refused to connect to.

**Key commits:** 35d7869, 1b6c538, a523dbf, 2c73a3a, c851ff7, 26ee6bf (v1.3.3 bump)

---

## v1.3.1 — Performance, Update Banner, Reference URL Fix (2026-04-14)

**Session type:** Performance optimization + feature + bug fix

**What was built/fixed:**

- **Supabase disk IO optimization** — Adaptive polling intervals replace fixed 10s polling, compound indexes added for incremental sync queries, N+1 label/member lookups replaced with batch `.in()` queries. 23 files changed.
- **Realtime subscription dedup** — Personal Realtime channels deduplicated, invite channel names stabilized to prevent subscription churn.
- **Update restart banner** — Persistent banner at top of main content area when an auto-update finishes downloading, with version number and Restart button.
- **Reference URL fix** — URLs from the main task input now correctly propagate to `createTask`.

**Key commits:** 22da287, a64908c, 72ddd4b, 347e9b9

---

## v1.3.0 — Cookie Break Gamification (2026-04-13)

**Session type:** Feature implementation

**What was built:**

- **Cookie break gamification for flow timer** — Animated cookie rewards on break completion, cookie jar collection, streak tracking. 13 files changed.
- **Fix: cookie stats precision** — Seconds precision instead of minute rounding. 4 files changed.
- **Fix: cookie label rename** — Stats labels corrected to plural "Cookies".

**Key commits:** 3dc6153, 21d7985, 5ce883b

---

## v1.2.1 — Claude Desktop Config, Section Header Fix (2026-04-12)

**Session type:** Feature + bug fix

**What was built/fixed:**

- **Claude Desktop config section** — MCP settings page now shows a JSON config snippet for Claude Desktop.
- **Fix: section headers** — Update modal and release notes now render section headers correctly.

**Key commits:** 583a52d, a945aac

---

## v1.2.0 — Enhanced Timer, Stats Dashboard, Auth Fixes (2026-04-11–12)

**Session type:** Feature implementation + bug fixes

**What was built:**

- **Enhanced timer (#61)** — Long break support, flowtime (open-ended focus) mode, session stats summary. 10 files changed.
- **Stats: clickable KPI drilldown** — KPI cards open filtered task lists on click. 5 files changed.
- **Stats: enhanced dashboard** — Streaks at top, priority/project breakdown charts, day-of-week activity chart. 4 files changed.
- **Fix: RLS auth detection** — RLS violations detected as auth errors, automatic session refresh.
- **Fix: UUID DB regression** — Database naming regression, sync overhaul, timer fixes, stats enhancements. 17 files changed.

**Key commits:** 4aa78d1, bbe0d92, d175681, b97f906, 8f5da48, e1abdd3

---

## v1.1.6 — Stories #55-61, Update Modal, Sync and UX Fixes (2026-04-08 to 2026-04-11)

**Session type:** Feature implementation + bug fixes + releases

**What was built:**

- **My Day auto-add by due date (#55)** — Tasks due today automatically appear in My Day. 21 files changed.
- **Per-integration default project (#56)** — Telegram Bot and iOS Shortcut each have their own default project setting. 5 files changed.
- **AND/OR label filter logic (#57)** — Three-way operator toggle for label filters (AND/OR mode). 11 files changed.
- **Per-project auto-archive + My Day done-today filter (#58)** — Projects can auto-archive done tasks; My Day shows tasks completed today. 10 files changed.
- **Remote MCP server via Supabase Edge Function (#59)** — MCP tools accessible remotely through a Supabase edge function for AI integrations from anywhere. 20 files changed.
- **Natural language date & recurrence parsing (#60)** — Users can type dates naturally ("tomorrow", "next Monday", "every 2 weeks") with automatic parsing. 18 files changed.
- **Update available modal** — Auto-updater shows formatted release notes in a modal before install.
- **Notarization re-enabled** — Built-in notarization enabled in electron-builder config.

**Fixes (v1.1.1 through v1.1.6):**

- Updater restart properly quits/relaunches on macOS (was just hiding the window)
- UUID DB files cleaned up after migration to email-named DB
- Bidirectional sync: locally-newer tasks/statuses now push to Supabase
- Sync FK constraint failures, stale sync detection improvements
- Release notes loading from Supabase; deleted task resurrection on sync
- Inline updater display, notification bell, redundant section titles in Settings
- iOS Shortcut instructions updated with project name in notification
- Calendar, verification flow, and miscellaneous UX fixes

**Key commits:** 7a2bbdf, cf125a9, afea9bd, c93d169, 2a9da1b, cc8df26, bb02ffa, e7f3b49, 2447500, dc72ae7, 5c289c5

---

## 2026-04-08 — Telegram Bot Polish, iOS Shortcut, Sync Improvements, DB Naming (v1.1.0)

**Session type:** Feature polish + bug fixes

**What was built/fixed:**

- **iOS Shortcut integration** — New Integrations tab in Settings with setup instructions and inline copy-able API endpoint. Sub-tabs: Telegram Bot | iOS Shortcut.
- **Telegram Bot in-app settings** — Full Telegram Bot settings tab: connect Telegram ID, set default project, Supabase-backed storage, destructive remove with undo toast. Settings pulled from Supabase on tab open; removing ID also deletes from Supabase.
- **Telegram command improvements** — `/done` and `/recent` commands added. Bot commands registered with Telegram for autocomplete menu. `.list`, `.default`, `.prefix`, `.settings` commands. Dot prefix always runs built-in commands; slash checks project names first. Task list persists after completing (inline checkmark). PID file lock prevents duplicate instances.
- **Force Full Sync** — Manual sync trigger button in Settings > General.
- **Supabase sync improvements** — Polls every 10s for external changes; detects remote updates via `updated_at`; project metadata (name/color/icon) pulled from Supabase; project renames push to Supabase; `syncProjectDown`/`discoverRemoteMemberships` skip when offline.
- **Email-based DB naming** — DB file named after user email; in-memory DB before auth; separate session files for dev/prod; robust DB name resolution.
- **UX: text selection** — Disabled globally, allowed only in editable areas (prevents accidental selection during mouse navigation).
- **UX: offline banner** — Fixed layout (flush, no stray borders).
- **UX: tray badge** — Instant refresh on My Day toggle and status change.
- **Notarization disabled temporarily** — Was causing build hang; to be re-enabled after diagnosis.
- **Version bumped to 1.1.0**

**Key commits:** df508f4 (iOS Shortcut), 68b7404 (Telegram settings tab), f979ca0 (email DB), b00e9fb (force sync), 9db6bd0 (project metadata sync), 7d18cbe (Telegram /done /recent), 3165239 (bot commands), 889c361 (inline checkmarks), 227bfe6 (text selection), 74f9f7c (notarization), 31cf94a (version bump)

---

## 2026-04-04 — Full Task Rows in Saved Views + Multi-Sort (#53)

**Session type:** Feature implementation

**What was built:**
- **Full task rows in saved views (Story #53)** — Replaced minimal SavedViewTaskRow with full TaskRow component. Added multi-sort dropdown to filter bar for both saved views and project views. Sidebar saved views show colored dots. Migrated priority_auto_sort to new sort system. 4 files changed.

**Commits:** 721d9f8

---

## 2026-04-04 — Sidebar Customization (#52) + Supabase Sync Engine (#51)

**Session type:** Feature implementation

**What was built:**
- **Sidebar customization (Story #52)** — Sidebar always expanded, collapse removed, light/dark theme toggle replaces collapse button, Stats moved to footer, show/hide and reorder nav items in Settings, dynamic keyboard shortcuts. 6 files changed.
- **Supabase full sync engine (Story #51)** — Write-through sync hooks on all Zustand stores so every local write pushes to Supabase in background. Sync status indicator, offline detection, queue-and-flush for personal projects. 7 files changed.

**Commits:** f5925af, 24ebfad

---

## 2026-04-04 — Exclusion Filters (Story #50)

**Session type:** Feature implementation

**What was built:**
- **Exclusion filters (Story #50)** — Added "is not" exclusion filter support for all filter types (labels, status, priority, assignee, projects). Works in both the filter bar and saved views, allowing users to exclude tasks matching specific criteria. 12 files changed.

**Commits:** 9f12183

---

## 2026-04-03 — Features #44-49 + Drag-Drop Overhaul

**Session type:** Feature implementation + bug fix

**What was built:**
- **MCP task reorder (Story #44)** — Added `reorder_tasks` tool to the MCP server for AI-driven task ordering. 2 files changed.
- **Command palette filter fix (Story #45)** — Fixed label/assignee filters not clearing when navigating to a task from the command palette. 2 files changed.
- **Expanded filters (Story #46)** — Extended the filter bar with priority, status, due date, and keyword filters beyond the existing label filter. 9 files changed.
- **Saved views / smart lists (Story #47)** — Saved views with persistent filter configurations, accessible from the sidebar. 18 files changed.
- **Stats dashboard (Story #48)** — Productivity stats dashboard with Recharts for visual task analytics. 13 files changed.
- **Project areas/folders (Story #49)** — Sidebar grouping for projects using areas/folders. 12 files changed.
- **Drag-drop overhaul** — Rewrote drag UX with horizontal intent detection and full-row ghost rendering. 12 files changed.

**Commits:** a749fbe, 0e73df8, 43a6203, 0f394a2, dbb23d8, 1e2c9d4, e8839e8, 0d071f1, c0a9aa6

---

## 2026-04-03 — Settings reorganization + MCP activity logging (Stories #42-43)

**Session type:** Feature implementation

**What was built:**
- **Settings reorganization (Story #42)** — Consolidated 11 settings tabs down to 7: merged Themes + Priorities into Appearance with subtabs, merged Updates + What's New + MCP + Help into About with subtabs, absorbed Notifications into General as a section. Added section labels to General and Timer tabs. Extracted large components from UnifiedSettingsModal.tsx into separate files.
- **MCP activity logging (Story #43)** — Added activity log entries to all 22 mutating MCP tools so that AI-made changes (task CRUD, label assignment, status changes, project operations, etc.) appear in the activity timeline alongside user-initiated actions. 6 files changed.

---

## 2026-04-02 — v1.0.2–v1.0.6 releases, shared project hardening

**Session type:** Feature enhancements + bug fixes + releases

**What was built:**
- **v1.0.2** — Shared project reliability: realtime invite subscription with retry, stale session handling, duplicate label prevention, shared-user placeholder updates, multiselect assignee filter, member avatar click-to-filter, member display sync via Supabase, post-reinstall sync
- **v1.0.4** — Member display cache invalidation on Realtime events
- **v1.0.5** — What's New from GitHub releases, help search, activity log improvements, shared project fixes
- **v1.0.6** — Timer improvements, label search, member display reliability, GitHub-based What's New flow, bundled release notes fallback

---

## 2026-04-02 — Auto-Update Mechanism (Story #40)

**Session type:** Feature implementation

**What was built:**
- **Auto-Update Mechanism** — Integrated electron-updater with GitHub Releases as the update provider. Created UpdateService in main process with event handling for checking, download progress, and installation. Added UpdateDialog component, UpdateSettings section, and Zustand updateStore. App checks on launch and every 4 hours; manual check available in Settings. Dismissed versions only re-prompt on launch or manual check.

---

## 2026-04-01 (cont.) — Collaboration UX polish & real-time sync

**Session type:** Feature enhancements + bug fixes

**What was built:**
- **Remote membership discovery** — App discovers remote project memberships on startup and surfaces errors on failed invite acceptance.
- **Collaboration UX** — Avatar consistency across views, inline task assignment for shared projects, and real-time sync polish across 17 files.
- **Full real-time task sync** — Wired up complete real-time sync for shared projects across 59 files. Collaborator changes now reflect immediately.

---

## 2026-04-01 — Build fixes, launch-at-login, command palette operators

**Session type:** Bug fixes + feature enhancements

**What was built:**
- **Tray icon fix** — Icon template PNGs added via `extraResources` in electron-builder; path resolution updated to `process.resourcesPath` for packaged builds.
- **MCP server fix** — Broke the `electron` dependency chain by extracting `withTransaction` into `database/transaction.ts` so the MCP server's bundled chunk no longer imports Electron. Also fixed server path to use `app.getAppPath()`.
- **Launch at login** — New IPC handler + preload bridge for `app.setLoginItemSettings()`, UI toggle in General settings.
- **Gemini MCP instructions** — Added to McpSettingsContent alongside existing Claude Code/Desktop instructions.
- **Command palette inline operators** — Integrated `detectOperator` from smart input parser into CMD+K. Supports `p:`, `@`, `/`, `d:`, `s:` with popup suggestions and filter chips. Added `ExternalFilters` interface to search hook.
- **Removed custom recurrence** — Stripped non-functional "Custom" button from detail panel and context menu.
- **My Day status label** — Hide `[In Progress]` label when it matches the bucket name.
- **Codesign docs** — Added `codesign --force --deep --sign -` step to CLAUDE.md build instructions.

---

## 2026-03-31 — Features, fixes, and distribution packaging

**Session type:** Feature implementation + bug fixes + infrastructure

**What was built:**
- **Smart Recurrence Picker (Story #38)** — Structured picker UI, backend cloning logic, context menu integration, 46 tests.
- **Reference URL in quick-add** — `r:` operator for smart input; description toggle in quick-add window.
- **Cmd+K archive search** — "Include archived" checkbox and project/archive indicators in command palette results.
- **Distribution-ready build packaging** — electron-builder config for macOS DMG + ZIP, code signing instructions.
- **Multi-user data isolation** — All data scoped per authenticated user via `user_id` columns across all repositories.

**Fixes:**
- Autocomplete ranking: exact/prefix matches above substring (0c44196)
- Status cycling focus/scroll, click-opens-detail setting, My Day default project (5597ff5)
- Default new label color to least-used from palette (2883f5f)
- Removed mandatory in-progress status, fixed My Day done task positioning (eabe194)

**Commits:** 3fbb5ed, 0c44196, c1d43fe, 95444c1, cc3bec1, 5597ff5, 5eacf7b, 73a64e1, 2883f5f, eabe194

---

## 2026-03-31 — Smart Recurrence Picker (Story #38)

**Stories implemented:** #38
**Branch:** ralph/feature-38-smart-recurrence
**What was built:** Complete recurrence system — structured picker UI with interval/unit/day selection, Fixed vs After-completion modes, end dates, live preview. Backend completion logic clones recurring tasks with next due date. Task row repeat icon. Context menu integration. Shared recurrenceUtils.ts with 46 tests. UX polish: removed arrow spinners, fixed escape behavior, tab focuses active preset, arrow keys cycle presets, layout reorder for mode toggle.
**Decisions:** Canonical string storage format over RRULE (simpler, sufficient for personal task manager). After-completion mode hides day pickers (irrelevant). Presets expand picker pre-filled rather than being final answers. One-time migration clears all old recurrence rules.

---

## 2026-03-30 — Due Date Notifications (Story #37) + Calendar View Fixes

**Session type:** Feature implementation + bug fixes

**What was built:** Native macOS due date notifications (Story #37) that fire 15 minutes before a task's due time. Also fixed notification timezone bug, calendar view polish (tooltips, week numbers, My Day tasks, status sorting, drag support), and osascript dev fallback.

**Commits:** d3edc4b, 3ff0855, 72d0cbb

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
