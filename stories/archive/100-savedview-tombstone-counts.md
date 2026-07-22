# Story #100 — [Medium] Bug: saved-view match count includes soft-deleted tasks/labels — src/main/repositories/SavedViewRepository.ts:189

**Risk class**: shared-logic
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Create a saved view matching a task, delete the task, and confirm the sidebar count decrements immediately.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. `countMatchingTasks` (`src/main/repositories/SavedViewRepository.ts:189`) builds WHERE without `t.deleted_at IS NULL`; label sub-selects at ~204/210/252 join `task_labels` without `tl.deleted_at IS NULL` (and don't check `l.deleted_at`).
2. Add `t.deleted_at IS NULL` to the base conditions.
3. Add `AND tl.deleted_at IS NULL` to every task_labels sub-select; where labels are joined, also guard `l.deleted_at IS NULL`.
4. Compare with the actual view rendering path to ensure count and render use identical predicates.
5. Vitest in SavedViewRepository.test.ts: seed task+label, soft-delete task → count drops; soft-remove label → label-filtered count drops.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- Soft-deleted tasks are excluded from every saved-view count
- Tasks whose matching label link is tombstoned no longer count for label-filtered views
- Counts equal the number of rows the view actually renders for the same filters
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- src/main/repositories/SavedViewRepository.ts
- src/main/repositories/SavedViewRepository.test.ts

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
