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
