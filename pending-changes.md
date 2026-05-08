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

## 2026-05-04 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 3d5c1c8 merge: ralph/profile-settings-65 — stories #65, #66, #67 verified (2026-05-04) — files: 0
- 749bf4e chore(prd): mark stories #65, #66, #67 as verified (2026-05-04) — files: 1
- 5d3d9d7 fix(archive): hover-reveal Restore/Delete buttons on archived project headers (2026-05-04) — files: 2
- 41f1f9a docs(prd): update story #67 criterion #6 — buttons always visible (2026-05-04) — files: 1
- 9867af1 docs(ui-reference): codify shift+click skip-confirmation rule (2026-05-04) — files: 1
- c500150 fix(archive): support shift+click on Delete Project to skip confirm toast (2026-05-04) — files: 1
- aefc21f fix(archive): allow archiving the default project (2026-05-04) — files: 2
- b30f0c7 fix(auth): skip 'Save password to Keychain?' prompt when already saved (2026-05-04) — files: 1
- 142a6eb fix(profile): drop redundant 'Account' section label under Account subtab (2026-05-04) — files: 1
- cc37a95 feat(profile): split into Account and Password subtabs (2026-05-04) — files: 1
- 732163c feat(profile): add 'Forget Saved Login' action (2026-05-04) — files: 1
- e4686f0 fix(auth): preserve saved login on explicit logout (2026-05-04) — files: 2
- aeeb404 fix(profile): detect existing password via user_metadata.has_password (2026-05-04) — files: 1
- a316387 fix(profile): stop overwriting name input while typing (2026-05-04) — files: 1
- d89c70a docs: add realtime-resilience fix entry + bump documented commit marker (2026-05-04) — files: 2
- a5346ff feat: add story #67 — project archive & restore (2026-05-01) — files: 1
- 9c5f7fd feat: add story #66 — save login credentials (email pre-fill + keychain password) (2026-05-01) — files: 1
- d281aa4 fix(detail): use border-foreground/10 for detail panel structural border (2026-05-01) — files: 1
- c485360 chore: bump version to 1.6.0 (2026-05-01) — files: 2

## 2026-05-05 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 40c8a7f chore(release): bump version to 1.7.0 (2026-05-05) — files: 2
- 72097f6 feat(labels): cross-user label dedup, sync correctness, and reconcile fixes (2026-05-05) — files: 23

## 2026-05-08 — Fix: Splash dead-end when auth call hangs

**What was broken:** During a Supabase `us-east-1-az4` AZ outage on 2026-05-08, the OAuth child window loaded a Cloudflare 522 page (looking blank because its CSS also failed) and the user clicked "Continue with Google" repeatedly with no escape. Falling back to email/password also hung — `signInWithPassword` never resolved because GoTrue was wedged, and the splash screen (TD logo + progress bar) had no Cancel button. The only way out was Force Quit. Same trap on cold start with a stored session: `tryRestoreSession` could hang and the splash would never give way to the offline-fallback or login screen.

**Root cause:** Three unbounded awaits in `authStore.ts`. `signInWithEmail` awaited `supabase.auth.signInWithPassword` with no timeout, `signInWithGoogle` awaited `signInWithOAuth` / `setSession` / `exchangeCodeForSession` with no timeout, and `initAuth` awaited `tryRestoreSession(3)` with no timeout. The renderer shows the `SplashScreen` whenever `loading: true`, and that component had no escape hatch.

**What was fixed:**
- New `authTimeout<T>(p, ms, label)` helper races any promise against a setTimeout that rejects with a clear "auth server may be unreachable" error.
- New module-scope `authGeneration` counter — every sign-in attempt captures its generation; if it changes mid-flow (because the user cancelled or kicked off a new attempt), the in-flight handler exits without mutating state.
- New `cancelLoading()` action on `useAuthStore` — bumps generation and sets `loading: false`.
- Timeouts wrapped around: `signInWithPassword` (30s), `signInWithOAuth` (15s), `setSession` in implicit OAuth flow (15s), `exchangeCodeForSession` in PKCE OAuth flow (15s), and `tryRestoreSession` at cold start (20s; falls through to offline fallback on timeout instead of hanging).
- `SplashScreen` shows a "Cancel" link after 5 seconds of loading. Clicking it calls `cancelLoading()` and the user lands back on the login form. The 5s reveal delay prevents flicker on a healthy fast sign-in.

**User-facing impact:** Sign-in (Google or email/password) can no longer trap you on a frozen splash screen. After 5 seconds you see a Cancel link; after 30 seconds (or 15 for OAuth) you see a "Sign in timed out — auth server may be unreachable" message and are returned to the login screen. Cold start with a wedged auth server now drops you into offline mode after 20 seconds instead of hanging forever.

**Affected area:** Auth flow (login screen, splash screen, cold-start session restore).

**Files changed:** `src/renderer/src/shared/stores/authStore.ts`, `src/renderer/src/App.tsx`.

**Commit:** (filled at squash merge)
