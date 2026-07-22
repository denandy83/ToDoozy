# Story #105 — [Medium] Performance: N+1 label resolution + row-by-row task_labels upserts on upload — src/renderer/src/services/SyncService.ts:336

**Risk class**: data-writing
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Share a project with ~50 labeled tasks and confirm task_labels upload happens as batched upserts, not one request per row.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. `uploadProjectToSupabase` (`SyncService.ts:336-343`): per task, getLabels then per-label findById. Batch: collect all label ids across tasks first, one local batch fetch, build rows in memory.
2. `PersonalSyncService.ts:1272-1287` (fullUpload): task_labels upserted one row at a time — collect all rows and upsert as one (or chunked ~500) batch, mirroring how reconcile already batches.
3. Keep conflict semantics identical (same onConflict columns as the per-row calls used).
4. Watch remote task_labels schema: composite PK, no deleted_at (hard DELETE) — per AUDIT_CONTEXT.md.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- First-time project share uploads task_labels in batches (verify via network tab: O(1-2) requests, not O(rows))
- fullUpload batches task_labels the same way
- Uploaded data identical to before (same rows, same conflict handling)
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- src/renderer/src/services/SyncService.ts
- src/renderer/src/services/PersonalSyncService.ts
- AUDIT_CONTEXT.md

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
