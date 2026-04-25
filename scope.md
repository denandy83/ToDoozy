# Scope — Sync silent-failure paths + reconciliation pass (2026-04-25)

## Bug
Real-world repro: task `9a6f6ddb-b677-418c-be3e-20ef823a5768` exists in local SQLite but does NOT exist in Supabase. App showed green dot "synced just now" the entire time. Push silently failed; nothing surfaced — no log entry, no red dot, no queue entry. Pure ghost task.

## Root causes
1. **`PersonalSyncService.ts` — non-thrown errors** silently swallowed with only `console.error`. Every `pushXxx(...)` checks `if (error)` and only logs to console; does NOT enqueue, log to Logs panel, or flip status. Affects `pushTask`, `pushStatus`, `pushLabel`, `pushSettingImmediate`, `pushSavedView`, `pushProjectArea`, `pushTheme`, `pushProject`, plus all `delete*FromSupabase` paths.
2. **`PersonalSyncService.ts:133`** — `if (!session) return` early-exit is silent.
3. **`SyncService.ts` — `syncTaskChange` / `syncStatusChange`** — Supabase responses not checked for `error`. Silent failure for shared projects too.
4. **`taskStore.ts:59-61`** — `syncIfShared` outer catch only `console.error`s. (Inner functions usually handle, but if anything bubbles out, swallowed silently.)
5. **`syncStore.setLastSynced()`** flips status to `'synced'` after every successful op without checking queue/error state. Indicator means "last op succeeded" not "everything is in sync".
6. **No reconciliation pass** — drift between local and Supabase is never detected/repaired.

## Plan

### Part A — Route silent errors through proper channels
- New helper `reportPushFailure(context, error, table, rowId, payload, operation)` in `PersonalSyncService.ts`:
  - `console.error` (kept for dev)
  - `logEvent('error', 'sync', ...)` so it appears in Settings → Logs and counts toward anomaly detector
  - `window.api.sync.enqueue(...)` so the next reconnect drain picks it up
  - `useSyncStore.setError(...)` so the dot turns red
  - Refresh `pendingCount` so the queue-stuck tooltip stays accurate
- Apply to every `if (error)` branch and every `catch` in PersonalSyncService.
- Apply equivalent fix in SyncService.ts `syncTaskChange` / `syncStatusChange` (check for non-thrown errors).
- For `if (!session) return`: add `logEvent('warn', 'sync', 'pushXxx skipped — no session', ...)`. Don't enqueue (we can't push without auth; reconcile picks it up after re-auth).

### Part B — Honest sync indicator
- Modify `syncStore.setLastSynced()`: only flip to `'synced'` and bump `lastSyncedAt` when `pendingCount === 0` AND `errorMessage === null` AND `status !== 'offline'`. Otherwise leave both unchanged.
- After successful queue drain in `processSyncQueue`: clear errorMessage, refresh pendingCount, then call setLastSynced.
- New `refreshPendingCount()` helper in syncStore that re-reads the queue count.
- Bump pendingCount on enqueue (via reportPushFailure) and refresh on dequeue (via processSyncQueue).

### Part C — Reconcile pass
- Add `reconcile(userId)` to PersonalSyncService:
  - For each personal project: list local task IDs vs remote task IDs; push local-only via `pushTask` (parents-first), pull remote-only via existing `pullNewTasks` flow.
  - Reconcile `user_labels`: push local-only.
  - Silent on success (no toast/notification).
  - Notification only if `pushed + pulled > 10`.
- Triggers:
  - **App startup** — call `reconcile()` after `initSync()` completes.
  - **Reconnect** — call `reconcile()` from `handleOnline` in `startOnlineMonitoring`.
  - **Manual** — new "Reconcile" button next to "Force Full Sync" in `GeneralSettingsContent.tsx` that calls `reconcile()` and shows pushed/pulled counts.

## Files to touch
- `src/renderer/src/services/PersonalSyncService.ts` — error helper, error routing, reconcile fn, startup trigger, reconnect trigger
- `src/renderer/src/services/SyncService.ts` — error routing in syncTaskChange/syncStatusChange + queue-drain status clean-up
- `src/renderer/src/shared/stores/taskStore.ts` — replace catch console.error with logEvent
- `src/renderer/src/shared/stores/syncStore.ts` — honest setLastSynced + refreshPendingCount
- `src/renderer/src/App.tsx` — trigger reconcile after initSync
- `src/renderer/src/features/settings/GeneralSettingsContent.tsx` — Reconcile button

## Acceptance
- [ ] Repro: simulate Supabase upsert error response → status flips to 'error', entry in Logs panel, item in `sync_queue`
- [ ] On reconnect, queue drains, status returns to 'synced'
- [ ] "Synced just now" only appears when sync_queue empty AND no recent errors
- [ ] Manually delete a task row from Supabase, restart app → reconcile silently re-pushes via existing `pushTask`
- [ ] Reconcile finding >10 items shows a notification
- [ ] Reconcile button in Settings → Sync
- [ ] All silent `console.error` paths now also route through `logStore` + `sync_queue` + `setError`
- [ ] Vitest coverage for reconcile diff and honest setLastSynced semantics
