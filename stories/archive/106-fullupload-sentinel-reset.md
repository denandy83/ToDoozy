# Story #106 — [Medium] Bug: fullUpload leaves last_sync_at sentinel set on failure — src/renderer/src/services/PersonalSyncService.ts:1146

**Risk class**: data-writing
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Force fullUpload to fail midway (drop network), restart the app, and confirm initSync retries the full upload.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. `fullUpload` (`PersonalSyncService.ts:1146`) writes last_sync_at BEFORE pushing data (concurrency sentinel) and the real value at the end; the catch (~1299) leaves the sentinel set on failure, so later initSync skips the retry — account stays partially uploaded.
2. Preferred fix: stop using last_sync_at as the in-flight sentinel — rely on the existing `initSyncInFlight` flag for concurrency, and write last_sync_at ONLY on successful completion.
3. If the sentinel also guards cross-restart races, then in the catch: delete/reset last_sync_at before rethrowing/logging so the next initSync retries.
4. Trace every reader of last_sync_at first (grep) to confirm neither fix breaks reconcile's assumptions.
5. Vitest: simulate throw mid-upload → sentinel cleared → retry path taken on next init.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- A failed fullUpload leaves the account in a retry-on-next-launch state
- No double-upload when two initSync calls race (initSyncInFlight still guards)
- Successful upload sets last_sync_at exactly as before
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- src/renderer/src/services/PersonalSyncService.ts

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
