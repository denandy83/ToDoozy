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
