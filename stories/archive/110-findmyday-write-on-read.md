# Story #110 — [Low] Performance: findMyDay performs repair UPDATE on every read — src/main/repositories/TaskRepository.ts:77

**Risk class**: data-writing
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Load My Day repeatedly with clean data and confirm no UPDATE statements run on the read path.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. `findMyDay` (`TaskRepository.ts:77`) and `findByProjectId` (via `repairOrphanedStatuses`, ~59) run a repair UPDATE on every read; when orphans exist it bumps updated_at → redundant sync re-pushes.
2. Guard the repair behind a cheap `SELECT EXISTS(...)` for orphaned statuses — run the UPDATE only when the check finds any.
3. Consider moving the repair to project-load/migration time; at minimum the existence check makes reads write-free in the steady state.
4. When repairing, evaluate whether bumping updated_at is desired (it re-syncs the row) — if the repair is purely local hygiene, preserve updated_at to avoid sync noise; document the choice in the code.
5. Vitest: clean data → no UPDATE executed (spy on db); orphaned status → repaired once, subsequent reads clean.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- Steady-state reads (no orphans) execute zero UPDATE statements
- Orphaned statuses still get repaired
- Repair no longer causes redundant sync pushes for untouched tasks (updated_at strategy documented)
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- src/main/repositories/TaskRepository.ts
- src/main/repositories/TaskRepository.test.ts

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
