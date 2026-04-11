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

## 2026-04-08 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- c93d169 feat: per-project auto-archive and My Day done-today filter (#58) (2026-04-08) — files: 10
- afea9bd feat: AND/OR label filter logic with three-way operator toggle (#57) (2026-04-08) — files: 11
- cf125a9 feat: per-integration default project for Telegram & iOS Shortcut (#56) (2026-04-08) — files: 5
- 7a2bbdf feat: My Day auto-add based on due date (#55) (2026-04-08) — files: 21

## 2026-04-11 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 2a9da1b feat: show update available modal with release notes (2026-04-11) — files: 2
- cc8df26 fix: updater restart hides window instead of quitting on macOS (2026-04-11) — files: 2
- 992960a temp: test quit button for updater restart fix (2026-04-11) — files: 3
- c1e2eb8 fix: delete UUID DB after migrating to email-named DB (2026-04-11) — files: 1
- bb02ffa fix: bidirectional sync — push locally-newer tasks and statuses to Supabase (2026-04-11) — files: 1
- 4c2da57 fix: update iOS Shortcut instructions with project name in notification (2026-04-11) — files: 1
- 7b3ea5a fix: sync FK failures, stale sync detection, MCP tab move, iOS shortcut headers (2026-04-11) — files: 5
- 5c289c5 fix: remove redundant section titles in Settings > About (v1.1.4) (2026-04-09) — files: 3
- dc72ae7 fix: inline updater, restart fix, notification bell, release notes DB fix (v1.1.3) (2026-04-09) — files: 10
- 2447500 fix: release notes from Supabase, delete task resurrection fix (v1.1.2) (2026-04-09) — files: 8
- 1fe6db0 chore: enable built-in notarization in electron-builder (2026-04-08) — files: 2
- e7f3b49 fix: verification fixes, sync gaps, calendar & UX improvements (v1.1.1) (2026-04-08) — files: 32
