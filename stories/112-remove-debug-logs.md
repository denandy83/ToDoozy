# Story #112 — [Low] Maintainability: debug console.log in hot label store paths — src/renderer/src/shared/stores/taskStore.ts:705

**Risk class**: ui-logic
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: smoke
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Add and remove a label on a task and confirm no debug console.log output appears in DevTools.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. `taskStore.ts` addLabel/removeLabel emit verbose console.log at ~705-712 and ~733-774.
2. Remove them, or route through the project's existing logging utility behind a debug flag if one exists (grep for logEvent/logger in the renderer before choosing).
3. While there, scan the rest of taskStore for the same pattern and clean consistently. Do not touch console.error/warn used for real failures (empty-catch rule).
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- No console.log output on label add/remove in normal operation
- Real error logging (console.error/warn) preserved
- Label add/remove behavior unchanged
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- src/renderer/src/shared/stores/taskStore.ts

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
