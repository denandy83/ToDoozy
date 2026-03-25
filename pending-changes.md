# Pending Changes

Working file — captures changes during each session for processing into CHANGELOG.md, RELEASE_NOTES.md, and other docs.

**How this works:**
- `/fix` appends a bug fix entry after each successful fix
- `/feature` appends a feature entry after each story is verified
- The Stop hook appends recent git commits as a fallback
- At session start (or next day), Claude reads this file, processes entries into the permanent docs, then clears this file

**Format for entries:**

```
## YYYY-MM-DD — Fix: <short title>
**User-facing:** <one sentence describing what was broken and what the fix does>
**Affected area:** <component/feature/view>
**Commit:** <hash if known>
```

```
## YYYY-MM-DD — Feature: <title>
**User-facing:** <one sentence describing what the user can now do>
**Details:** <brief technical summary>
**Commit:** <hash if known>
```

---

<!-- entries below this line are added automatically -->

<!-- session-end: 2026-03-25T07:11:41 -->
## 2026-03-25 — Git commits (unprocessed)
- 45e0133 feat: multi-select drag to project, undo toast, drag UX improvements (2026-03-24)
- fa6d600 fix: project delete and quick-add improvements (2026-03-24)
- c402aa8 fix: refresh projects and settings on every quick add focus (2026-03-24)
- f062612 wip: save ralph agent work before fix session (2026-03-24)
- 794d451 feat: add rolling dev database system to protect production data (2026-03-22)
- cc24751 feat: implement iCloud Drive file attachments (#32) (2026-03-22)
- a3fa7cd feat: fix tab order and focus management (#31) (2026-03-22)
- 04228b7 feat: implement global labels (#30) — labels shared across all projects (2026-03-22)
- 8e6725e feat: add stories #30-32 — global labels, tab order, iCloud attachments (2026-03-22)
- e44cae3 fix: label hydration, archive cascade, and My Day subtask bugs (2026-03-22)
