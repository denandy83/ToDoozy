# Scope — Fix shared project join bugs (2026-04-24)

## Three reported bugs

1. **FK error on join**: "Failed to join project: tasks:create FOREIGN KEY constraint failed"
2. **Members show as UNKNOWN** in project header avatar tooltip / fallback email
3. **Invitee only sees 1 task** after accepting invite; force full sync + restart + re-login didn't help

## Root causes

### Bug 1 — UNIQUE constraint collision on placeholder email
`syncProjectDown` (`src/renderer/src/services/SyncService.ts:813-847`) pre-creates local `users` rows for every `owner_id` + `assigned_to` referenced by remote tasks. When `user_profiles` doesn't return a row for a missing user (RLS, deleted account, user hasn't confirmed email), the code inserts `email: 'shared-user'`. Because `users.email` has `UNIQUE NOT NULL`, the FIRST insert succeeds and EVERY SUBSEQUENT missing user silently fails (caught by `.catch(() => {})`). Then `tasks.create` trips the `users` FK because the row was never created.

Same placeholder pattern in:
- `src/renderer/src/services/SyncService.ts:725, 842, 923` (syncProjectDown, syncMembersDown)
- `src/renderer/src/services/PersonalSyncService.ts:763, 1027` (fullUpload, pullNewTasks)
- `src/renderer/src/AppLayout.tsx:266` (Realtime INSERT handler)

### Bug 1 secondary — `parent_id` ordering
Remote tasks are fetched without ORDER BY; subtasks iterated before parents trip the `parent_id` FK. `fullUpload` in PersonalSyncService already does `parents first, subtasks second` — but `syncProjectDown` / `pullNewTasks` don't.

### Bug 2 — local `users` row never created for new members
When a new member joins the owner's project (Realtime INSERT on `project_members`), `AppLayout.loadMembers` fetches the member list via `getSharedProjectMembers` (which hits `user_profiles`) and updates `display_color`/`display_initials` in local `project_members`. But it **never creates a matching row in the local `users` table**. `useMemberDisplay` reads email/display_name from the local `users` table — so it falls back to `'unknown'` and the tooltip shows nothing.

### Bug 3 — cascading from Bug 1
Invitee's `syncProjectDown` aborts after the FK throw, leaving only the tasks inserted BEFORE the throw. Subsequent app restarts re-run `syncProjectDown` on startup (App.tsx:52) — but it keeps throwing at the same spot. "Force Full Sync" only uploads, doesn't pull shared projects, so it can't recover this state. Fixing Bug 1 means the next startup cycle will complete the sync.

## Plan

### Fix 1a — Per-user unique placeholder email
Change `'shared-user'` → `'shared-user+' + uid + '@local'` everywhere it's inserted. Replace the sentinel check `email === 'shared-user'` with `email.startsWith('shared-user+')`. Centralize as helpers in a new tiny module to avoid drift:
- `src/shared/placeholderUser.ts` — `placeholderEmail(uid)` + `isPlaceholderEmail(email)`.

### Fix 1b — Sort tasks parents-first in `syncProjectDown` and `pullNewTasks`
Add a topological pre-sort before the insert loop.

### Fix 1c — Per-task try/catch in `syncProjectDown`
Wrap each task insert/update so a single failure doesn't abort the whole sync. Log the failure so we notice in diagnostics.

### Fix 2 — Upsert local `users` rows in `AppLayout.loadMembers`
After `getSharedProjectMembers` returns, create/update local `users` for each member with the real email + display_name from Supabase. Then call `invalidateMemberDisplay` (already present) to refresh the avatar cache.

### Fix 3 — Natural consequence of Fix 1
Next app launch re-runs `syncProjectDown` and succeeds. Optionally, extend "Force Full Sync" to also call `syncProjectDown` for shared projects so the user has an in-app recovery button (stretch).

## Files to touch

- `src/shared/placeholderUser.ts` (new, tiny helper)
- `src/renderer/src/services/SyncService.ts` (syncProjectDown, syncMembersDown, getSharedProjectMembers caller sites)
- `src/renderer/src/services/PersonalSyncService.ts` (fullUpload, pullNewTasks)
- `src/renderer/src/AppLayout.tsx` (loadMembers upsert; Realtime INSERT placeholder)
- `src/renderer/src/features/settings/GeneralSettingsContent.tsx` (Force Full Sync now also pulls shared projects)

## Out of scope

- Broader refactor to stop polling `user_profiles` on every sync.
- Changing users.email schema (keeping UNIQUE constraint).
