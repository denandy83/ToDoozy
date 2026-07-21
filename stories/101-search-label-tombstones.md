# Story #101 — [Medium] Bug: task search label filters ignore task_labels tombstones — src/main/repositories/TaskRepository.ts:579

**Risk class**: shared-logic
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Search by a label, remove that label from a matching task, re-run the search and confirm the task no longer matches.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. `TaskRepository.search` label branches: ~579 (label_ids OR), ~585 (label_id), ~658 (exclude_label_ids subquery) join/sub-select task_labels without `tl.deleted_at IS NULL`.
2. Add `AND tl.deleted_at IS NULL` to each branch, including the inner SELECT of the exclusion subquery.
3. Grep the rest of TaskRepository for other task_labels reads missing the guard while you're there.
4. Vitest: task with label soft-removed → not matched by include filter, not wrongly excluded by exclude filter.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- Label include filters ignore tombstoned task_labels rows
- exclude_label_ids no longer excludes tasks whose label link is tombstoned
- Search results match the task detail panel's live label state
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
