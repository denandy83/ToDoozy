# Pending Changes

Working file — entries written here during a session are processed into permanent docs at the start of the next session (or end of current session if explicit).

**How this works:**
- `/fix` appends a fix entry (rich context) after each confirmed fix
- `/feature` appends a feature entry (rich context) after each verified story
- The `SessionEnd` hook appends a fallback entry with git metadata
- At session start, if `.docs-pending` exists, Claude processes all entries below into CHANGELOG.md, RELEASE_NOTES.md, FEATURES.md, README.md, DEVLOG.md — then clears this file

## 2026-03-31 — Feature: Smart Recurrence Picker
**What it does:** Users can set structured recurrence rules with a picker instead of typing free text. Completing a recurring task auto-creates a clone with the next due date.
**Why it was built:** The old custom recurrence input accepted any text with no validation or feedback. Users had no way to know if their entry would work.
**How to use it:** Open a task's detail panel, click any recurrence preset (Daily/Weekly/Monthly) or Custom to expand the picker. Set interval, unit, specific days, mode (Fixed/After completion), and optional end date. Live preview confirms the rule.
**Technical summary:** New `recurrenceUtils.ts` shared utility. Replaced `DetailRecurrence.tsx` with structured picker. `completeRecurringTask()` in TaskRepository clones tasks in a transaction. New IPC handler + preload bridge. Task row repeat icon. Context menu smart defaults + "Custom...". Migration clears old rules.
**Acceptance criteria met:** All 24 criteria verified.
**Affected views/components:** DetailRecurrence, TaskRow, ContextMenu, ContextMenuSubmenus, TaskRepository, taskStore, AppLayout (toast), mcp-server
**Commit:** 3fbb5ed, d1a0f1c

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

## 2026-03-30 — Session end (git fallback)
<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->
- 3fbb5ed feat: implement Smart Recurrence Picker with structured rules and task cloning (#38) (2026-03-30) — files: 23
