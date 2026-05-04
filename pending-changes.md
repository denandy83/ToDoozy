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

## 2026-05-01 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 35987ec feat: add story #67 — project archive & restore (2026-05-01) — files: 17
- dfb22d3 feat(#66): save login credentials — email pre-fill + Keychain password (2026-05-01) — files: 10
- 1b79d69 docs: process pending changes into CHANGELOG, RELEASE_NOTES, DEVLOG, FEATURES (2026-05-01) — files: 6
- cd5937a feat(#65): profile settings — display name, password management, forgot password (2026-05-01) — files: 9

## 2026-05-04 — Fix: Power-aware Realtime reconnect + give-up banner

**What was broken:** Closing the laptop lid for hours produced a stream of "Realtime sync anomaly: 25 events in 30s" notifications spaced ~30 minutes apart. macOS Power Nap dark-wakes were briefly running the JS event loop, supabase-js noticed the dead WebSocket, fired CHANNEL_ERROR across all channels, and fired reconnect attempts that flooded the Logs panel and tripped the anomaly notification. Same pattern on flaky Wi-Fi (hotel hotspot) — endless retries and notification spam, never settling, never giving the user a clear "we gave up" signal.

**Root cause:** Three independent gaps. (1) The renderer had no signal that the system was sleeping, so reconnect timers fired during dark-wakes. (2) The reconnect schedule retried forever with `[2s, 5s, 15s, 30s]` — no give-up state and no user-visible banner. (3) The anomaly detector counted `Channel CHANNEL_ERROR` / `Channel CLOSED` / `Reconnect …` log lines, which naturally cluster across all 11 channels in seconds whenever the WS goes down — so any disconnect tripped a "JWT-refresh storm" notification meant for genuine runaway loops.

**What was fixed:**
- **Power state bridge.** `src/main/index.ts` registers `powerMonitor.on('suspend' | 'resume')` and broadcasts to the renderer over a new `power:suspend` / `power:resume` IPC channel. Preload exposes it as `window.api.power.onSuspend / onResume`. New `src/renderer/src/services/powerState.ts` holds an `isSuspended()` flag, calls `pauseReconnectsForSuspend` on suspend (cancels pending reconnect timers without tearing down channels), and `forceReconnectAllPersonal / forceReconnectAllShared` on resume.
- **Reconnect gating + give-up.** `schedulePersonalReconnect` and `scheduleSharedReconnect` now bail early when `isSuspended() || !navigator.onLine`. Backoff bumped to `[5s, 15s, 30s, 60s]` capped at 4 attempts. After max attempts, `setConnectionLost(true)` and stop scheduling.
- **Connection-lost banner.** `SessionBanner` adds a `connectionLost` variant: "Connection lost — Retry now" with a Retry button that calls `forceReconnectAllPersonal()` + `forceReconnectAllShared()`. Takes priority over the auth-offline banner. Auto-clears when any channel resubscribes.
- **Online/offline event handlers (already present in `startOnlineMonitoring`)** now also pause/force-reconnect timers, so going `offline` immediately cancels pending retries and going `online` triggers a single force-reconnect across both services.
- **Anomaly hygiene.** `logStore.isAnomalySignal` excludes `Channel CHANNEL_ERROR`, `Channel TIMED_OUT`, `Channel CLOSED`, `Reconnect …`, and `Power: …`. The detector remains for true runaway loops (e.g. JWT-refresh storms which still fire `setAuth …` lines).
- **Don't regress v1.5.0 wake-from-sleep storm fix.** The `channel.state === 'joined'` auto-rejoin guard inside both reconnect paths is preserved.

**User-facing impact:** Closing the laptop lid no longer floods the notification panel with sync-anomaly alerts. After 4 failed reconnect attempts the app shows a single amber "Connection lost — Retry now" banner instead of looping silently forever; Retry rebuilds every channel.

**Affected area:** Realtime sync (personal + shared channels), session banner, logs/notification panel.

**Files changed:** `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/src/services/powerState.ts` (new), `src/renderer/src/services/PersonalSyncService.ts`, `src/renderer/src/services/SyncService.ts`, `src/renderer/src/shared/stores/syncStore.ts`, `src/renderer/src/shared/stores/logStore.ts`, `src/renderer/src/shared/components/SessionBanner.tsx`, `src/renderer/src/App.tsx`.

**Commit:** 8bdf339
