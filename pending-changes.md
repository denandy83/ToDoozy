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

## 2026-04-11 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 4aa78d1 feat: enhanced timer with long break, flowtime mode, session stats (#61) (2026-04-11) — files: 10

## 2026-04-11 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- b97f906 fix: detect RLS violations as auth errors, auto-refresh expired sessions (2026-04-11) — files: 2
- d175681 feat(stats): clickable KPI cards drill down into task lists (2026-04-11) — files: 5
- bbe0d92 feat(stats): enhanced dashboard with streaks at top, priority/project breakdown, day-of-week chart (2026-04-11) — files: 4

## 2026-04-11 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- b97f906 fix: detect RLS violations as auth errors, auto-refresh expired sessions (2026-04-11) — files: 2
- d175681 feat(stats): clickable KPI cards drill down into task lists (2026-04-11) — files: 5
- bbe0d92 feat(stats): enhanced dashboard with streaks at top, priority/project breakdown, day-of-week chart (2026-04-11) — files: 4

## 2026-04-12 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 87082b6 chore: bump version to 1.2.0 (2026-04-12) — files: 2
- e1abdd3 chore: stage remaining session changes (docs, NLP, MCP, quick-add) (2026-04-12) — files: 14
- 8f5da48 fix: UUID database regression, sync overhaul, timer fixes, stats enhancements (2026-04-12) — files: 17

## 2026-04-13 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 27ccedd chore: bump version to 1.2.1 (2026-04-12) — files: 2
- 583a52d feat: add Claude Desktop config section to MCP settings (2026-04-12) — files: 1
- a945aac fix: render section headers in update modal and release notes (2026-04-12) — files: 2

## 2026-04-13 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 21d7985 fix: cookie stats show seconds precision instead of rounding to minutes (2026-04-13) — files: 4
- 3dc6153 feat: add cookie break gamification for flow timer (2026-04-13) — files: 13

## 2026-04-13 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- fcdc3b3 chore: bump version to 1.3.0 (2026-04-13) — files: 2
- 5ce883b fix: rename cookie stats labels to plural "Cookies" (2026-04-13) — files: 1

## 2026-04-14 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- d669c62 chore: bump version to 1.3.1 (2026-04-14) — files: 2
- 22da287 perf: optimize Supabase disk IO — adaptive polling, indexes, N+1 fixes (2026-04-14) — files: 23

## 2026-04-16 — Feature: Update restart banner
**What it does:** After an auto-update downloads, a persistent banner appears at the top of the main content area showing the version number and a Restart button.
**Why it was built:** Previously, clicking "Install" on the update dialog made it disappear with no way to restart — the user had to manually navigate to Settings > About > Updates.
**How to use it:** When the banner appears, click Restart to apply the update. The banner stays visible until you restart.
**Technical summary:** New `UpdateReadyBanner` component renders when `updateStore.status.state === 'downloaded'`. Placed inside `<main>` in AppLayout, above the header. Calls the same `installUpdate()` → `autoUpdater.quitAndInstall()` path as Settings.
**Affected views/components:** AppLayout, new UpdateReadyBanner component
**Commit:** 72ddd4b
