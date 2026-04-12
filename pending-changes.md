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
