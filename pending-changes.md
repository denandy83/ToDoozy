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
<!-- last processed: 2026-06-10 (session 2) — #69 scroll-wheel fix + #68 AI-native copy removal folded into CHANGELOG/RELEASE_NOTES v1.7.1 (untagged bucket; latest tag still v1.7.0). DEVLOG entry added. Internal commits (3a21e42 ralph completion-check, aa01e3b/4a99221 ralph model + doc processing, 7fa2d8b prd.json story planning #68–#94) intentionally NOT in user-facing docs. -->


## 2026-10-26 — Fix/Feature: backlog audit prepared for release
**What was broken:** Search missed remote tasks in unopened projects; editor hydration could overwrite descriptions; nested filtering/archive/order were inconsistent; failed sync writes could be lost or falsely reported as synced; project restore controls disappeared; MCP lacked safe status management and reference URLs; development snapshots and lint were broken.
**What changed:** Added explicit global search refresh with keyset pagination and account guards, user-edit-only description autosave, recursive task filtering and completion ordering, durable current-intent retries, owner-only project archive with a permanent restore list, atomic owner-checked MCP status operations, file reference handling, SQLite backup snapshots, and a working flat ESLint configuration. Updated vulnerable dependencies and Electron to 42.11.16.
**Release status:** User verified all 17 implementation items; they are Done. Applied 20261026075319_shared_label_realtime and 20261026075322_atomic_status_management, then deployed MCP v16. Prepared v1.10.0 package metadata and CHANGELOG. The signed app remains unpublished: this Mac lacks the no-mistakes pipeline, configured Developer ID distribution identity and notarization settings. The release host/pipeline location has been requested. No origin push or tag was made.
**Validation:** 1160 tests, TypeScript, Deno typecheck, build and lint pass (27 existing hook warnings); npm audit has zero advisories. Independent isolated reviews and an Electron 42.11.16 startup with a fresh synthetic database passed.
**Commit:** See codex/backlog-audit-2026-10-25 branch. This entry documents unreleased work; do not publish these notes as v1.9.0 changes.
