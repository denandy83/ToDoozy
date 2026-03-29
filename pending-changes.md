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

## 2026-03-29 — Fix: Quick-add window doesn't follow theme
**What was broken:** The quick-add popup (Cmd+Shift+Space) always opened with the dark theme, even when the app was set to a light theme. The theme would visibly flash/switch after opening.
**Root cause:** The quick-add window was persisted (hidden/shown) between uses. It loaded CSS with hardcoded dark defaults and only applied the theme asynchronously after becoming visible.
**What was fixed:** The quick-add window is now destroyed on close and recreated fresh each time. It stays hidden until the renderer confirms the theme has been applied, then shows — eliminating the flash.
**User-facing impact:** Quick-add always opens with the correct theme instantly.
**Affected area:** Quick-add window
**Files changed:** src/main/quick-add.ts, src/renderer/src/QuickAddApp.tsx, src/main/ipc-handlers.ts, src/preload/index.ts, src/preload/index.d.ts, src/renderer/src/shared/hooks/useThemeApplicator.ts
**Commit:** 4c7cbee
