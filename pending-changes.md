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

<!-- session-end: 2026-03-25T07:11:41 -->
## 2026-03-25 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 45e0133 feat: multi-select drag to project, undo toast, drag UX improvements (2026-03-24) — files: 5
- fa6d600 fix: project delete and quick-add improvements (2026-03-24) — files: 3
- c402aa8 fix: refresh projects and settings on every quick add focus (2026-03-24) — files: 2
- f062612 wip: save ralph agent work before fix session (2026-03-24)
- 794d451 feat: add rolling dev database system to protect production data (2026-03-22)
- cc24751 feat: implement iCloud Drive file attachments (#32) (2026-03-22)
- a3fa7cd feat: fix tab order and focus management (#31) (2026-03-22)
- 04228b7 feat: implement global labels (#30) — labels shared across all projects (2026-03-22)
- 8e6725e feat: add stories #30-32 — global labels, tab order, iCloud attachments (2026-03-22)
- e44cae3 fix: label hydration, archive cascade, and My Day subtask bugs (2026-03-22)
