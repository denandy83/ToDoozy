# Pending Changes

Working file — entries written here during a session are processed into permanent docs at the start of the next session (or end of current session if explicit).

**How this works:**
- `/fix` appends a fix entry (rich context) after each confirmed fix
- `/feature` appends a feature entry (rich context) after each verified story
- The `SessionEnd` hook appends a fallback entry with git metadata
- At session start, if `.docs-pending` exists, Claude processes all entries below into CHANGELOG.md, RELEASE_NOTES.md, FEATURES.md, README.md, DEVLOG.md — then clears this file

**Entry format — Fix:**
```
## YYYY-MM-DD — Fix: <short title>
**What was broken:** <what the user experienced — specific, user-facing language>
**Root cause:** <what was actually wrong in the code>
**What was fixed:** <what changed and how it resolves the issue>
**User-facing impact:** <what the user now experiences — one sentence>
**Affected area:** <view/component/feature>
**Files changed:** <list of key files modified>
**Commit:** <hash>
```

**Entry format — Feature:**
```
## YYYY-MM-DD — Feature: <title>
**What it does:** <what the user can now do — concrete, user-facing>
**Why it was built:** <the problem it solves>
**How to use it:** <brief user-facing instructions>
**Technical summary:** <what was added: components, stores, IPC handlers, DB changes>
**Acceptance criteria met:** <list from the story>
**Affected views/components:** <list>
**Commit:** <hash>
```

**Entry format — Session-end fallback (hook):**
```
## YYYY-MM-DD — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
<commit hash> <subject> (<date>) — files: <changed file count>
```

---

<!-- entries below this line are added automatically -->

## 2026-04-16 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 6c5c53a chore: bump version to 1.3.2 (2026-04-16) — files: 2

## 2026-04-16 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- c4121e9 fix: enable double-click to edit saved view titles, auto-focus new views (2026-04-16) — files: 1

## 2026-04-19 — Fix: Quick-add shows all labels and avoids duplicates across projects
**What was broken:** In the quick-add popup, the `@` label picker only showed labels from the default project. If the user typed the name of a label that lived in another project, it wasn't found, so they'd hit "+ Create" and end up with a duplicate global label.
**Root cause:** `QuickAddApp.tsx` loaded labels via `labels.findByProjectId(targetProjectId)`, which returns only labels linked to the currently selected project through the `project_labels` junction.
**What was fixed:** Labels are now loaded once via `labels.findAll(userId)`, deduped by lowercase name for display. On submit, each attached label is linked to the selected project via `labels.addToProject` before `tasks.addLabel`, so a cross-project label picked from the popup gets connected to the task's project (same pattern already used in `AppLayout.tsx`).
**User-facing impact:** All of the user's labels appear in the quick-add picker, switching projects no longer hides them, and existing labels are reused instead of duplicated.
**Affected area:** Quick-add popup (`src/renderer/src/QuickAddApp.tsx`)
**Files changed:** src/renderer/src/QuickAddApp.tsx
**Commit:** 1b6c538

## 2026-04-19 — Fix: Sync status dot no longer goes red on idle
**What was broken:** After ~5 minutes of idle, the sidebar sync dot turned red with "Sync stale" — even when the app was genuinely up to date. With Realtime connected and no local edits, nothing refreshed `lastSyncedAt`, so the elapsed-time check eventually flipped the indicator falsely.
**Root cause:** `Sidebar.tsx` computed staleness as "last successful sync was >5min ago." That's a proxy for "something is wrong" but is false whenever the user is simply idle.
**What was fixed:** Staleness is now derived from three real signals on the syncStore: `navigator.onLine`, `realtimeConnected`, and `pendingCount` with last-sync age. The dot is red only when the device is offline, the Supabase Realtime channel is down, or local writes are queued but haven't drained in >60s. A 30s interval re-evaluates so the dot flips on its own without needing an unrelated render. The tooltip names the specific failure mode (Offline / Supabase unreachable / Sync stuck with count).
**User-facing impact:** Idle sessions stay green. Red means something is actually broken, and the tooltip explains which of the three.
**Affected area:** Sync status indicator (sidebar bottom-left dot)
**Files changed:** src/renderer/src/features/sidebar/Sidebar.tsx
**Commit:** a523dbf

## 2026-04-19 — Fix: Accepting invite no longer fails with FOREIGN KEY constraint
**What was broken:** When a newly invited user accepted an invite to a shared project, they saw "Failed to join project: Error invoking remote method 'tasks:create': Error: FOREIGN KEY constraint failed. Try logging out and back in." Logging out and back in did land them in the project, but the first attempt always failed.
**Root cause:** In `syncProjectDown` (`SyncService.ts`), the code ensured each task's `owner_id` had a local `users` row (falling back to a 'shared-user' placeholder) but did not do the same for `assigned_to`. If any task in the project was assigned to a user the accepting device had never seen locally, the `tasks(assigned_to) REFERENCES users(id)` FK tripped.
**What was fixed:** Before iterating tasks for insert, we now collect every unique `owner_id` and `assigned_to` across the remote tasks, batch a single `user_profiles` lookup for the missing IDs via `.in()`, and create local user rows (with real profile data if Supabase returns it, or a 'shared-user' placeholder otherwise).
**User-facing impact:** New collaborators accept an invite and land in the shared project immediately — no scary FK error, no need to log out and back in.
**Affected area:** Invite acceptance / shared project sync
**Files changed:** src/renderer/src/services/SyncService.ts
**Commit:** 2c73a3a

## 2026-04-19 — Fix: Email confirmation no longer lands on localhost
**What was broken:** After signing up with email/password, the confirmation email linked to a localhost URL. The browser showed "refused to connect," leaving the user confused even though the account was actually confirmed (login worked afterward).
**Root cause:** `authStore.signUpWithEmail` didn't pass `emailRedirectTo`, so Supabase fell back to the dashboard's Site URL — which was set to a local development address.
**What was fixed:** Added a static confirmation page at `docs/email-confirmed.html` served via GitHub Pages from the `main` branch `/docs` folder (Pages URL: `https://denandy83.github.io/ToDoozy/email-confirmed.html`). `signUpWithEmail` now passes that URL as `emailRedirectTo`, so Supabase's confirmation link lands on a styled "Email confirmed — open ToDoozy to sign in" page. Initially attempted via a Supabase Edge Function, but `*.supabase.co` function responses are forced to `text/plain` with a CSP sandbox, so HTML can't render there — hence the Pages pivot. One-time dashboard step: add the GitHub Pages URL to Supabase Auth > URL Configuration > Redirect URLs.
**User-facing impact:** Users who confirm their email land on a friendly "close this tab and open ToDoozy" page instead of a browser error page.
**Affected area:** Email/password signup flow
**Files changed:** src/renderer/src/shared/stores/authStore.ts, docs/email-confirmed.html (new)
**Commit:** c851ff7

## 2026-04-20 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 26ee6bf chore: bump version to 1.3.3 (2026-04-20) — files: 2
- 05118ed docs: changelog and release notes for v1.3.2 fixes (2026-04-20) — files: 6

## 2026-04-20 — Fix: DatePicker keyboard-selected day highlighted across months
**What was broken:** Opening the due date calendar with no date set highlighted today in every month as the user navigated; with a date like April 18 set, navigating to May also highlighted May 18 (and June 18, etc.) as if selected.
**Root cause:** `src/renderer/src/assets/main.css` applied the same accent-fill style to both `.react-datepicker__day--selected` and `.react-datepicker__day--keyboard-selected`. react-datepicker applies `--keyboard-selected` to the keyboard-focus day, which mirrors the selected day-of-month across navigated months and falls back to today when no date is selected, so it always rendered as "selected."
**What was fixed:** Split the rule so only `--selected` gets the accent fill. Added `:not(--selected)` overrides that neutralize `--keyboard-selected` to transparent and give `--today` a subtle accent-colored `box-shadow: inset` border (no layout shift) when it isn't the selected date.
**User-facing impact:** The calendar now shows exactly one filled day (the real due date), today is bordered, every other day renders neutrally as the user expects.
**Affected area:** DatePicker (shared component) — used everywhere due dates are edited (TaskRow inline, DetailPanel, quick-add, etc.)
**Files changed:** `src/renderer/src/assets/main.css`
**Commit:** 35d7869

## 2026-04-21 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- a463fa6 fix: update modal renders notes for every skipped version (v1.4.1) (2026-04-21) — files: 7
- 6a02d86 chore: bump version to 1.4.0 (2026-04-21) — files: 2
- 57e443c fix: restore Apply Theme + add rename pencil for custom themes (2026-04-21) — files: 1
- 9359cea feat(#64): Cmd+K palette matches against task UUID (2026-04-21) — files: 3
- 3c01c28 fix(#63): only show theme Save icon when color values actually differ (2026-04-21) — files: 5
- cd05968 feat(#62): import and export themes as JSON (2026-04-21) — files: 8
- 3db90cb feat: add stories #62-#64 — theme import/export + save-icon polish + Cmd+K UUID search (2026-04-20) — files: 2
- 3626163 docs: changelog and release notes for DatePicker keyboard-selected fix (2026-04-20) — files: 5

## 2026-04-22 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- f9b247b chore: bump version to 1.4.2 (2026-04-22) — files: 2
- c175248 feat: auto-reconnect Realtime channels + in-app connection log (2026-04-22) — files: 5

## 2026-04-24 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- ffdc1cf chore: bump version to 1.4.4 (2026-04-24) — files: 2
- a1c2a25 chore: restore implemented-stories.md (should never be truncated) (2026-04-24) — files: 1
- 51dc0f6 fix: offline debounce, AND label default, and What's New observability (2026-04-24) — files: 11
- f67cab3 feat: log sync events that were invisible during shared-project bug (2026-04-24) — files: 3
- d118a56 chore: bump version to 1.4.3 (2026-04-24) — files: 2
- 47bc120 fix: shared-project sync bugs (join FK, unknown members, missing tasks, wrong-device auto-archive) (2026-04-24) — files: 8

## 2026-04-25 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 0d196b4 wip: theme schema migration, applyRemote timestamp preservation, realtime instrumentation (2026-04-24) — files: 29

## 2026-04-25 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- b3e2689 chore: bump version to 1.4.5 (2026-04-25) — files: 2
- 4fe36d7 fix: sync silent-failure paths, label dedup, and task_labels gap (2026-04-25) — files: 30

## 2026-04-25 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 97433df wip: save state before fix realtime reconnect storm (2026-04-25) — files: 3

## 2026-04-25 — Refactor: Uniform sync architecture (v1.5.0)
**What was broken:** Sync between local SQLite and Supabase was best-effort with several gaps. Deletes were propagated by hard-DELETE so any peer that was offline at the wrong moment never saw the delete and would resurrect the row on next push. Custom themes had no two-way sync at all. Per-table pull logic had a "local newer → push" branch that re-pushed every task on every poll cycle whenever local timestamps got ahead of remote. macOS wake-from-sleep produced a 2s reconnect loop because the lib's auto-rejoin raced our manual rebuild. Token refresh fanned `setAuth` out one push per channel. `initSync` had no concurrency guard so concurrent callers each launched a parallel `fullUpload`, producing a mass push storm of every project's tasks on boot.
**Root cause:** No `deleted_at` columns, eight bespoke pull functions each with different gaps, no single source of truth for "what is the newest row I've seen on this (user, scope, table)?", and no idempotency guards on the entry points (`reconcile`, `initSync`).
**What was fixed:**
- Added `deleted_at TIMESTAMPTZ` + active-row indexes to all eight syncable tables on both Supabase and local SQLite via versioned migrations.
- Switched every delete path from hard DELETE to UPDATE deleted_at; reads filter; the only hard-DELETE is the 30-day purge.
- Built `reconcileTable<TLocal, TRemote>` — a single generic helper that diffs all eight tables, pushes local-only, pulls remote-only, applies LWW per row, and reports stats.
- Added `sync_meta(user_id, scope_id, table_name)` storing per-(user, scope, table) `high_water` and `last_reconciled_at`. Project-scoped tables (tasks, statuses) use project_id as scope_id; user-scoped tables use user_id.
- High-water short-circuit: pre-reconcile, fetch local + remote `max(updated_at)` and stored high-water in parallel; if both sides ≤ stored, skip the diff entirely. `findMaxUpdatedAt` now includes tombstones so soft-deletes bump the high-water and failed pushes retry.
- Realtime UPDATE handlers now recognize `deleted_at` transitions and apply them as soft-deletes locally.
- Resurrect protection: applyRemote keeps `deleted_at` from the remote row, so a tombstoned local row stays tombstoned even when the remote sends a newer non-tombstone-clearing update.
- 30-day tombstone purge: Supabase `pg_cron` job `purge-tombstones` at `0 3 * * *` plus a boot-time `purgeOldTombstones(db)` in the Electron main process.
- Realtime reconnect timer now checks `channel.state === 'joined'` at fire time and skips the rebuild if supabase-js already healed.
- `setAuth` deduped at the wrapper layer; token refresh no longer fans out per channel.
- `fullUpload` writes `last_sync_at` at the START as a sentinel; `initSync` body wrapped in a shared in-flight promise.
- `App.tsx` syncShared effect deps switched from `currentUser` / `hydrateProjects` to primitive `startupUserId`.
- `reconcile()` got an in-flight guard + 30s cooldown.
- Removed the "local newer → push" branch from `pullNewTasks` and `pullStatuses` — polling is now read-only.
**User-facing impact:** Cross-device sync is now byte-equal: anything you change anywhere shows up everywhere within seconds (online) or on reconnect (offline). Deletes propagate cleanly without zombies. Custom themes sync. Wake from sleep no longer produces a connection storm. Boot is quieter and faster.
**Affected area:** Sync, schema, all repositories, Realtime, Electron main process startup.
**Files changed:** src/main/database/migrations.ts, src/main/repositories/{Task,Label,Project,Status,Theme,Settings,SavedView,ProjectArea,SyncMeta}Repository.ts (+ tests), src/main/services/PurgeService.ts (new + tests), src/main/index.ts, src/main/ipc-handlers.ts, src/preload/index.ts, src/preload/index.d.ts, src/renderer/src/services/syncTables.ts (new + tests), src/renderer/src/services/PersonalSyncService.ts, src/renderer/src/services/SyncService.ts, src/renderer/src/lib/supabase.ts, src/renderer/src/App.tsx. Supabase migrations: deleted_at columns, indexes, purge_tombstones() function + pg_cron schedule.
**Commit:** <fill in after squash merge to main>

## 2026-04-26 — Fix: Auto-recover dead Supabase sessions (v1.5.1)
**What was broken:** On cold start with a flaky network or expired refresh token, `setSession` would fail once and the app would silently fall back to "offline mode" — `currentUser` got set from local SQLite, Realtime channels joined the WebSocket without auth, and every push hit RLS 42501 because `auth.uid()` was null. The user had no indication anything was wrong, but every change they made was rejected and never reached the cloud. Logging out and logging back in was the only fix.
**Root cause:** `initAuth()` only called `setSession` once with no retry, and there was no recovery loop — if the single attempt failed (transient network blip, slow DNS, refresh-token race), the app permanently stayed in zombie mode. Worse, every push function blindly called `supabase.from(...).upsert(...)` without verifying a session existed first, so the requests went out as anonymous and were rejected by RLS. Realtime subscriptions also joined the WebSocket without checking, producing dead listeners.
**What was fixed:**
- Created `src/renderer/src/services/sessionRecovery.ts` exporting `requireSession()`, `tryRestoreSession(attempts)`, `startRecoveryTimer({onRecovered})`, and `stopRecoveryTimer()`.
- `initAuth()` now calls `tryRestoreSession(3)` (1s/2s/4s exponential backoff) before falling back to offline mode.
- When offline-fallback is the final state, `startRecoveryTimer()` starts a 30s background loop. On successful restore it clears `isOffline`, switches the DB, refreshes the local user, and calls `processSyncQueue()` to drain pending changes.
- Every push function in `PersonalSyncService.ts` (pushTask, pushStatus, pushLabel, pushSetting, pushSavedView, pushProjectArea, pushTheme, pushProject) and every soft-delete (deleteTaskFromSupabase + 7 siblings) now calls `requireSession()` first and skips cleanly with a warn-level log if there's no session.
- `subscribeToPersonalProject()` is gated on `requireSession()` — no more dead Realtime listeners.
- Added `SessionBanner` component (top of app) shown while `isOffline === true`, with "Retry now" and "Sign in again" actions.
- `logout()` and `signInWithEmail()` call `stopRecoveryTimer()` to prevent stale timers from firing post-logout. Successful sign-in also explicitly clears `isOffline`.
**User-facing impact:** When the network blips or a refresh token momentarily fails, the app now retries, recovers automatically within 30 seconds, and pushes any queued changes. If recovery fails for an extended period, an amber banner appears with explicit retry/sign-in actions. No more silent data loss to RLS 42501.
**Affected area:** Auth, sync, Realtime, root layout.
**Files changed:** src/renderer/src/services/sessionRecovery.ts (new), src/renderer/src/services/PersonalSyncService.ts, src/renderer/src/shared/stores/authStore.ts, src/renderer/src/shared/components/SessionBanner.tsx (new), src/renderer/src/App.tsx, package.json (1.5.0 → 1.5.1).
**Commit:** <fill in after squash merge to main>

## 2026-04-26 — Fix: Projects reconcile failed=N + LWW timestamp format drift (v1.5.1 follow-up)
**What was broken:** Every reconcile cycle logged `Reconcile: projects — pushed=0 pulled=0 inSync=0 failed=N` for personal-project rows. None propagated, so any project edit (rename, color change, area assignment, etc.) made on one device never reached the cloud or other devices.
**Root cause:** Two distinct issues in the projects sync path: (1) `projectsDescriptor.toRemote` returned `local` as-is, which includes the local-only columns `is_default`, `is_shared`, `sidebar_order`, and `area_id`. Supabase's `projects` table doesn't have those columns, so PostgREST rejected the upsert with "column does not exist" — silently caught and counted as `failed`. (2) `ProjectRepository.applyRemote` then bound `undefined` for those same fields when applying remote rows back, and it compared `existing.updated_at >= remote.updated_at` as plain strings — but local writes use `…Z` form and Supabase returns `…+00:00` form for the same instant, so the lexical comparison flagged equal moments as drift.
**What was fixed:**
- `projectsDescriptor.toRemote` now constructs an explicit object with only the remote-existent columns. Local-only metadata stays local.
- `ProjectRepository.applyRemote` now reads `existing` once and either keeps its local-only values (UPSERT branch omits them from the `SET` list) or seeds defaults for brand-new rows. The LWW guard uses `Date.parse()` numeric comparison so format-equivalent timestamps compare equal.
**User-facing impact:** Project changes (rename, color, area, default flag) now sync cross-device on the same cycle. The `Reconcile: projects — failed=N` warning disappears.
**Affected area:** Sync (projects table only — task/status/label/etc. paths unchanged here).
**Files changed:** src/renderer/src/services/syncTables.ts, src/main/repositories/ProjectRepository.ts.
**Commit:** <fill in after squash merge to main>

## 2026-04-26 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 07fd262 fix: project_labels junction table on Supabase + incremental sync (2026-04-26) — files: 9
- 8593936 fix: sync is_default/sidebar_order/area_id instead of stripping them (2026-04-26) — files: 5
- 3b129e6 chore: bump version to 1.5.1 (2026-04-26) — files: 1

## 2026-04-26 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 29eae22 fix: full schema parity — project_templates, label_names, invited_by, themes.created_at (2026-04-26) — files: 16

## 2026-04-26 — Fix: Forever auth — persist rotated refresh tokens, single-flight refresh, terminal-error detection (v1.5.2)
**What was broken:** Users were being silently kicked out of their session every ~hour of usage, then forced to sign in again on the next cold start. The Logs panel showed `Session restore attempt 1/1 failed — Invalid Refresh Token: Refresh Token Not Found` repeating every 30 seconds forever, with `setAuth #N` counters climbing while no real work could happen.
**Root cause:** Three compounding issues.
(1) Supabase rotates the `refresh_token` on every use. With `autoRefreshToken: true`, supabase-js silently rotates the access+refresh pair roughly hourly while the app runs and emits `TOKEN_REFRESHED`. Our `onAuthStateChange` listener only logged the event and never re-persisted the rotated session to safeStorage. So after one in-app rotation, safeStorage still held the original (now-revoked) refresh_token, and the next cold start hit "Refresh Token Not Found" — terminally dead. (2) Concurrent rotation paths (cold-start `setSession`, autoRefreshToken loop, sleep/wake timer fanouts, recovery timer ticks) could race and trip Supabase's reuse-detection, killing the entire session chain. (3) The recovery loop in `sessionRecovery.ts` retried `setSession` every 30 seconds forever, even when the error was a permanent `refresh_token_not_found` — wasting cycles and producing noise that masked real issues.
**What was fixed:**
- `src/renderer/src/lib/supabase.ts` — `attachAuthInstrumentation` now listens for `TOKEN_REFRESHED` and `SIGNED_IN` and persists the rotated session to safeStorage; on `SIGNED_OUT` it clears stored tokens. All async work in the listener is wrapped in `setTimeout(..., 0)` to avoid the auth-js `_acquireLock` deadlock (community-confirmed bug, supabase/auth-js#762, supabase/supabase-js#2013).
- Added `async-mutex` dependency. Introduced `safeSetSession()` and `safeRefresh()` exports that wrap Supabase's token-rotating ops in a single-flight mutex, so a cold-start restore can't race with autoRefresh, and parallel timers can't fire two rotations within Supabase's 10-second reuse-detection window.
- `src/renderer/src/services/sessionRecovery.ts` — `tryRestoreSession` now uses `safeSetSession`. Permanent error codes (`refresh_token_not_found`, `refresh_token_already_used`, `session_not_found`, `bad_jwt`, `user_not_found`) and matching error-message patterns flag the session as `permanentlyDead`, clear safeStorage, and stop the recovery timer. Transient errors (network) keep retrying as before. Exports `resetPermanentlyDeadFlag()` for the auth store to call on successful sign-in.
- `src/renderer/src/shared/stores/authStore.ts` — `signInWithEmail` and both branches of `signInWithGoogle` now call `resetPermanentlyDeadFlag()` and explicitly clear `isOffline` after a successful login.
- `src/main/index.ts` — Added `app.requestSingleInstanceLock()`. A second app launch hands its argv (deep links) to the existing instance and quits, eliminating multi-instance auth-client races. Skipped when `TODOOZY_USER_DATA` is set so dev/test multi-instance mode still works.
**User-facing impact:** After signing in once on v1.5.2, you stay signed in indefinitely — the app correctly persists every silent token rotation, so refresh tokens stay valid forever (until you explicitly sign out, sign out elsewhere with global scope, or Supabase's optional inactivity timeout elapses, which we don't enable). When the refresh chain genuinely is dead, the recovery loop now stops after detecting it and the SessionBanner's "Sign in again" is the only path forward — no more 30-second retry noise.
**Affected area:** Auth, sync, Electron main process startup.
**Files changed:** package.json, src/renderer/src/lib/supabase.ts, src/renderer/src/services/sessionRecovery.ts, src/renderer/src/shared/stores/authStore.ts, src/main/index.ts.
**Commit:** <fill in after squash merge to main>

## 2026-04-26 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 638df07 chore: update doc trackers (2026-04-26) — files: 2
- 7f2ab11 fix: diagnostic logging + accurate count for task_labels reconcile push (2026-04-26) — files: 1
- e7fd413 fix: numeric timestamp compare in reconcileTable (2026-04-26) — files: 1
- f8b7569 fix: clear stuck syncStore.status='offline' after sign-in / recovery (2026-04-26) — files: 1
- c0b43c3 fix: don't set reconcile cooldown on pre-session no-op (2026-04-26) — files: 1
- e2c6ac7 fix: forever auth — persist rotated refresh tokens + single-flight refresh + terminal-error detection (v1.5.2) (2026-04-26) — files: 7

## 2026-04-26 — Fix: Sort menu now applies in My Day view
**What was broken:** Picking a sort option (Priority, Due Date, Title, etc.) from the Sort menu in My Day did nothing — the task order looked identical regardless of which field or direction you chose. Only project views responded to the sort menu.
**Root cause:** Two layered issues. (1) `MyDayView.tsx` ignored `labelStore.sortRules` and used a local `prioritySortFn` that only honored the legacy `priority_auto_sort` setting + `order_index`. (2) Even if the parent had pre-sorted the tasks, `StatusSection.tsx` re-sorted them internally unless `disableDrag={true}` was passed, throwing away the parent's order. `TaskListView` already passed `disableDrag={!isCustomSort}`; My Day did not.
**What was fixed:** MyDayView now reads `sortRules` and feeds `createSortComparator(sortRules, statusOrderMap)` — building a cross-project status order map (default first, done last, others by `order_index`). When an explicit (non-custom) sort is active, it passes `disableDrag={!isCustomSort}` to StatusSection so the pre-sorted order is honored. Sort applies *within* each My Day bucket (Not Started / In Progress / Done) — buckets stay grouped. Adjacent UX polish: `SortDropdown` now shows literal `ASC` / `DESC` text instead of chevron icons, and the collapsed summary reads e.g. `Priority - DESC, Created - ASC`.
**User-facing impact:** The Sort menu in My Day now actually sorts. Priority Descending puts URGENT/HIGH at the top of each bucket; Title Ascending alphabetizes; etc. The active sort is visible in the Sort button label as `Field - DIR` instead of an arrow icon.
**Affected area:** My Day view, shared FilterBar SortDropdown.
**Files changed:** src/renderer/src/features/views/MyDayView.tsx, src/renderer/src/shared/components/FilterBar.tsx
**Commit:** 4178711

## 2026-04-26 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 9de27c1 chore(workflow): rename Verified → Verifying in lifecycle docs (2026-04-26) — files: 2
- 4047889 chore(workflow): align ToDoozy task lifecycle in CLAUDE.md, /fix, and /feature (2026-04-26) — files: 3
- fee8cef docs: My Day sort fix changelog + debug-learnings entries (2026-04-26) — files: 5

## 2026-04-26 — Fix: Timer mode picker replaces silent-perpetual bug
**What was broken:** With Flowtime mode and Perpetual mode both toggled on in Timer Settings, pressing the play button on a task silently ignored Flowtime and started a non-Flowtime perpetual countdown. The bug came from three independent on/off toggles (`timer_perpetual`, `timer_repetition_enabled`, `timer_flowtime_enabled`) racing for the same "what does play do?" decision in `TimerPlayButton.handleClick` — perpetual short-circuited first and the popup with the Flowtime toggle was never reached.
**Root cause:** `TimerPlayButton.tsx` had three short-circuit paths checked in order: perpetual → direct perpetual start (no popup, `isFlowtime: false` hard-coded); else if neither repetition nor flowtime → direct countdown; else → popup. The "competing toggles" model in settings made it possible to enable mutually exclusive things simultaneously, and the order of checks gave perpetual the win.
**What was fixed:** Modeled the timer choice cleanly as `mode: Flowtime | Timer` with a `Timer.duration: Limited | Infinite` sub-choice. Pressing play now always opens a 260×224px fixed-size popup (so toggling between options doesn't resize/jump) pre-selected to the user's defaults; Enter confirms, Escape closes. Settings replaced the three toggles with a single segmented "Default mode" picker plus a "Default duration" sub-picker, and added a "Skip start dialog" toggle in Behavior for users who prefer one-click instant start. Read-side migration in `useTimerSettings.ts` derives the new `defaultMode` from the legacy `timer_flowtime_enabled` and the new `defaultDuration` from the legacy `timer_perpetual`, so existing user settings carry over without a DB migration. The popup is positioned via `useLayoutEffect` from the button's `getBoundingClientRect`, with viewport clamping (flips above the button when there's no room below, clamps to viewport when neither side fits) and reflow on every mode/duration change. `ContextMenuSubmenus.tsx` (the right-click "Start timer with…" preset list) was updated to read `defaultDuration` instead of the removed booleans.
**User-facing impact:** Pressing play with Flowtime as your default starts in Flowtime — the perpetual setting no longer overrides it. The popup is always the same size, both options are always reachable, and power users can disable the popup entirely with one toggle.
**Affected area:** Timer play button, Timer settings, right-click "Start timer with…" submenu.
**Files changed:** src/renderer/src/shared/components/TimerPlayButton.tsx, src/renderer/src/shared/components/TimerPlayButton.test.ts (new — regression for Gabriel's bug), src/renderer/src/shared/hooks/useTimerSettings.ts, src/renderer/src/features/settings/TimerSettingsContent.tsx, src/renderer/src/shared/components/ContextMenuSubmenus.tsx
**Commit:** aa5d8c4

## 2026-04-26 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- cbcaf7a docs: bump .last-documented-commit after HELP sync (2026-04-26) — files: 1

## 2026-04-26 — Fix: Notification panel — bell toggles closed + trash replaces X with delete-all confirm (v1.5.3)
**What was broken:** Two issues in the notification panel: (1) clicking the bell icon while the panel was open did nothing visible — the panel stayed open. (2) The header had an X icon that just closed the panel, duplicating what Escape, click-outside, or the bell already do; there was no way to clear notifications in bulk except marking them read.
**Root cause:** (1) `NotificationPanel.tsx` registered a document-level `mousedown` handler that called `closePanel()` whenever the click target was outside `panelRef`. The bell button is rendered as a sibling of the panel (both inside a shared `<div className="relative">` in `AppLayout`), so the bell is "outside" the panel ref. Clicking the bell while open: the document handler fired first → closed the panel; then the bell's `onClick` fired `togglePanel()` → re-opened it. Net effect: appeared to do nothing. (2) The X-as-close action was a holdover from before the bell fully owned the toggle; bulk-delete didn't exist at all in the data layer.
**What was fixed:**
- `NotificationPanel.tsx` outside-click handler now tests against `panelRef.current?.parentElement` instead of `panelRef.current`. Both bell and panel sit inside that wrapper, so the bell counts as "inside" — its click bypasses the close-on-outside path and `togglePanel()` runs correctly.
- Replaced the X icon with `Trash2` (lucide-react). Clicking it pops a persistent toast (`addToast({ persistent: true, actions: [Delete (danger), Cancel (muted)] })`) at the bottom — same Toast component used everywhere else for destructive confirms. Toast auto-closes on Enter/Escape via the existing global handler in `Toast.tsx`. The trash button is `disabled` (with reduced opacity, cursor-not-allowed, no hover) when `notifications.length === 0`.
- New data path: `NotificationRepository.deleteAll()` (`DELETE FROM notifications`, returns row count) + 2 vitest cases. New IPC handler `notifications:deleteAll`. New preload binding `window.api.notifications.deleteAll()`. New store action `deleteAllNotifications()` that clears the local state to `[]` with `unreadCount: 0` after the IPC succeeds.
**User-facing impact:** The bell now opens *and* closes the panel like a proper toggle. The X is replaced by a trash icon that asks "Delete all N notifications?" before clearing them, matching the rest of the app's destructive-confirm pattern. Empty list disables the trash so misclicks do nothing.
**Affected area:** Notification panel (header + delete flow), notification store, NotificationRepository, IPC + preload bridge.
**Files changed:** src/main/repositories/NotificationRepository.ts, src/main/repositories/NotificationRepository.test.ts, src/main/ipc-handlers.ts, src/preload/index.ts, src/preload/index.d.ts, src/renderer/src/shared/stores/notificationStore.ts, src/renderer/src/features/collaboration/NotificationPanel.tsx
**Commit:** 0c788a3

## 2026-04-26 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 3398fee docs: bump .last-documented-commit to HEAD post-v1.5.3 docs (2026-04-26) — files: 1

## 2026-04-27 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 85e4ca2 chore: bump version to 1.5.4 (2026-04-27) — files: 2
- 1301605 fix(sync): eliminate phantom reconcile pushes + close shared-project label gap (2026-04-27) — files: 9

## 2026-04-30 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->

## 2026-04-30 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- a118c5d chore: bump version to 1.5.5 (2026-04-29) — files: 2
- a118c5d chore: bump version to 1.5.5 (2026-04-29) — files: 2
- 2342ccf chore(mcp): pass p_owner_id to share_project RPC + commit migration (2026-04-29) — files: 2
- 2342ccf chore(mcp): pass p_owner_id to share_project RPC + commit migration (2026-04-29) — files: 2
- 143dd2a feat(logs): include project name in subscription + reconcile logs; auto-demote solo shared projects (2026-04-29) — files: 3
- 143dd2a feat(logs): include project name in subscription + reconcile logs; auto-demote solo shared projects (2026-04-29) — files: 3
- d0f0f34 chore(sync): trim diagnostic logging in label consolidation (2026-04-29) — files: 2
- d0f0f34 chore(sync): trim diagnostic logging in label consolidation (2026-04-29) — files: 2
- ba0c2fb fix(sync): coerce consolidate params to primitives across IPC boundary (2026-04-29) — files: 3

- ba0c2fb fix(sync): coerce consolidate params to primitives across IPC boundary (2026-04-29) — files: 3
## 2026-04-30 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 96fea43 fix(sync): consolidate must insert canonical label before junction remap (2026-04-29) — files: 7
- 96fea43 fix(sync): consolidate must insert canonical label before junction remap (2026-04-29) — files: 7
- a118c5d chore: bump version to 1.5.5 (2026-04-29) — files: 2
- 630e951 fix(sync): wire label collision consolidation into reconcile path too (2026-04-29) — files: 1
- 630e951 fix(sync): wire label collision consolidation into reconcile path too (2026-04-29) — files: 1
- 2342ccf chore(mcp): pass p_owner_id to share_project RPC + commit migration (2026-04-29) — files: 2
- 143dd2a feat(logs): include project name in subscription + reconcile logs; auto-demote solo shared projects (2026-04-29) — files: 3
- 8821ac2 fix(sync): silence label/project push noise from MCP-induced collisions (2026-04-29) — files: 7
- 8821ac2 fix(sync): silence label/project push noise from MCP-induced collisions (2026-04-29) — files: 7
- d0f0f34 chore(sync): trim diagnostic logging in label consolidation (2026-04-29) — files: 2
- e57dde3 fix(sync): replace user_profiles view queries with get_user_profiles RPC (2026-04-29) — files: 2
- e57dde3 fix(sync): replace user_profiles view queries with get_user_profiles RPC (2026-04-29) — files: 2
- ba0c2fb fix(sync): coerce consolidate params to primitives across IPC boundary (2026-04-29) — files: 3
- fe829fd fix(avatars): fetch member profiles via SECURITY DEFINER RPC to include email/password users (2026-04-29) — files: 2
- fe829fd fix(avatars): fetch member profiles via SECURITY DEFINER RPC to include email/password users (2026-04-29) — files: 2
- 96fea43 fix(sync): consolidate must insert canonical label before junction remap (2026-04-29) — files: 7
- 5daced3 fix(avatars): show Member (uuid) instead of Unknown for profileless members (2026-04-29) — files: 1
- 5daced3 fix(avatars): show Member (uuid) instead of Unknown for profileless members (2026-04-29) — files: 1
- 630e951 fix(sync): wire label collision consolidation into reconcile path too (2026-04-29) — files: 1
- fdd1abf fix(avatars): use props data for members with stale/placeholder cache emails (2026-04-28) — files: 1
- fdd1abf fix(avatars): use props data for members with stale/placeholder cache emails (2026-04-28) — files: 1
- 8821ac2 fix(sync): silence label/project push noise from MCP-induced collisions (2026-04-29) — files: 7
- bf6fcf3 fix(recurrence): parse due dates as local midnight to prevent same-day re-clone (2026-04-28) — files: 4
- bf6fcf3 fix(recurrence): parse due dates as local midnight to prevent same-day re-clone (2026-04-28) — files: 4
- e57dde3 fix(sync): replace user_profiles view queries with get_user_profiles RPC (2026-04-29) — files: 2
- 6f91d17 fix(collab): consistent member display — filter Shared User, placeholder emails, UUID initials (2026-04-28) — files: 2
- 6f91d17 fix(collab): consistent member display — filter Shared User, placeholder emails, UUID initials (2026-04-28) — files: 2
- fe829fd fix(avatars): fetch member profiles via SECURITY DEFINER RPC to include email/password users (2026-04-29) — files: 2
- edd2d9c fix: member privacy leak, phantom sort pushes, and MCP label ID collision (2026-04-28) — files: 5
- edd2d9c fix: member privacy leak, phantom sort pushes, and MCP label ID collision (2026-04-28) — files: 5
- 5daced3 fix(avatars): show Member (uuid) instead of Unknown for profileless members (2026-04-29) — files: 1
- fdd1abf fix(avatars): use props data for members with stale/placeholder cache emails (2026-04-28) — files: 1
- bf6fcf3 fix(recurrence): parse due dates as local midnight to prevent same-day re-clone (2026-04-28) — files: 4
- 6f91d17 fix(collab): consistent member display — filter Shared User, placeholder emails, UUID initials (2026-04-28) — files: 2
- edd2d9c fix: member privacy leak, phantom sort pushes, and MCP label ID collision (2026-04-28) — files: 5

## 2026-04-30 — Fix: Session-expired banner + shared project names in reconnect logs
**What was broken:** When a user's session was permanently invalidated (e.g., due to the setAuth storm consuming the refresh token), the app showed the generic amber "Sync paused / Retry now" banner — which was misleading because retrying is pointless for a dead token. Also, shared project channels showed raw UUIDs in "Reconnect in" and "Reconnect skipped" log entries instead of project names.
**Root cause:** (1) `isPermanentlyDead` was a module-level variable in sessionRecovery.ts never written to React state, so the banner couldn't distinguish a permanently dead session from a temporary offline state. (2) `scheduleSharedReconnect` in SyncService.ts used `projectId` directly in reconnect log calls even though `getCachedProjectName` was already available.
**What was fixed:** Added `isTokenPermanentlyDead: boolean` to authStore state, set it when `tryRestoreSession` detects a permanent auth error, and updated SessionBanner to render a red "Session expired — Sign in again" variant when the flag is true. Fixed the three reconnect log calls in SyncService.ts to use the cached project name.
**User-facing impact:** Users with a dead session now see a clear red banner with a single "Sign in again" button instead of an unhelpful amber retry prompt. Log entries for shared project reconnects now show names like "Crewlounge" instead of raw UUIDs.
**Affected area:** Settings → offline banner; realtime reconnect logs
**Files changed:** src/renderer/src/shared/stores/authStore.ts, src/renderer/src/shared/components/SessionBanner.tsx, src/renderer/src/services/SyncService.ts
**Commit:** c0ad3869722e7970c2fd801a8c522a0d99f7aa48

## 2026-04-30 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 70949b8 chore: document session-expired banner fix and log name improvements (2026-04-30) — files: 5

## 2026-04-30 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 912bac8 feat: add story #65 — profile settings, password management, forgot password (2026-04-30) — files: 2

## 2026-04-30 — Feature: Sidebar color + visible structural borders + SessionBanner overlay
**What it does:** Three visual improvements: (1) A new "Sidebar" color field in Settings → Theme gives independent control over the left panel background (previously auto-derived, now customizable). (2) Structural dividers (header line, sidebar top/bottom, sidebar right border) now use `border-foreground/10` — always visible in every theme regardless of the Border color setting. (3) The session-expired and sync-paused banners now overlay the header as a solid banner instead of sitting below it.
**Why it was built:** In dark themes, the border color was nearly identical to the background color making the structural header line invisible. The sidebar had no independent color control. The session banner was positioned in the layout flow rather than as an overlay.
**Technical summary:** Added ThemeConfig.sidebar field mapped to --color-sidebar CSS var. Updated all 12 built-in themes with sidebar values. Sidebar.tsx uses bg-sidebar instead of bg-surface; structural borders switched to border-foreground/10. SessionBanner upgraded to absolute inset-0 overlay with solid red/amber background and white text. All sync paths (syncTables.ts toRemote/fromRemote, PersonalSyncService pushTheme) updated to carry the sidebar field. Supabase migration 20260501000000 adds sidebar column to user_themes and back-fills existing rows.
**Affected views/components:** Sidebar, AppLayout header, SessionBanner, ThemeSettingsContent, ThemePreview, useThemeApplicator, syncTables, PersonalSyncService
**Commit:** 081ba15, 691210b
