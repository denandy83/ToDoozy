# Story #102 — [Medium] Bug: applyRemote LWW guards string-compare ISO timestamps — src/main/repositories/TaskRepository.ts:227

**Risk class**: data-writing
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Simulate a remote row with updated_at in +00:00 format one second newer than the local Z-format value and confirm applyRemote applies it.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. Pattern: `existing.updated_at >= remote.updated_at` as raw strings. Local format `...Z`, PostgREST `...+00:00` — lexical compare is wrong across formats. ProjectRepository.ts:167 and ProjectTemplateRepository.ts:124 already use Date.parse — copy that exact approach.
2. Fix every applyRemote (and any other updated_at comparison) in: TaskRepository.ts:~227, LabelRepository.ts:~189, StatusRepository.ts:~123, SettingsRepository.ts:~139, ThemeRepository.ts:~123, SavedViewRepository + ProjectAreaRepository equivalents. Grep `updated_at >=` / `updated_at >` across src/main/repositories to catch all.
3. Extract a tiny shared helper (e.g. `isNewer(a,b)` using Date.parse) in the repositories layer so the idiom can't drift again; use it everywhere.
4. Vitest: Z vs +00:00 pairs — equal instants, remote newer, local newer — assert apply/skip decisions per repo helper.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- All applyRemote guards compare timestamps numerically (Date.parse), no raw string compares remain (grep-verifiable)
- A remote row newer by 1s in +00:00 format is applied over a local Z-format value
- Equal-instant rows in different formats do not flip-flop (deterministic skip)
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- src/main/repositories/TaskRepository.ts
- src/main/repositories/ProjectRepository.ts
- AUDIT_CONTEXT.md

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
