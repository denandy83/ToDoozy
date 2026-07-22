# Story #103 — [Medium] Performance: WAL-mtime poll rehydrates all stores on own writes — src/main/index.ts:306

**Risk class**: shared-logic
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Edit a task title repeatedly and confirm the tasks-changed rehydrate cascade does not fire every second, while an external MCP write still triggers it.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. `src/main/index.ts:306`: 1s setInterval broadcasts `tasks-changed` whenever the DB WAL mtime advances — including this app's OWN writes. Renderer handler (`src/renderer/src/App.tsx:~351`) then rehydrates projects/statuses/labels/all tasks/task-labels/myDay/settings.
2. In the main process, track a `lastLocalWriteAt` timestamp: bump it in the repository write path (single choke point — e.g. the database service's run/exec wrapper for mutating statements).
3. In the poll tick, skip the broadcast when `walMtime <= lastLocalWriteAt + epsilon` (the change is attributable to this process). External writes (MCP server process, quick-add helper) still trigger.
4. Keep behavior conservative: when in doubt (clock skew, epsilon), broadcast — correctness over savings.
5. Verify manually per the demo statement; add a unit test for the attribution predicate if extracted as a pure function.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- Local-only edits no longer trigger the broadcast+rehydrate cascade each second
- External writes (e.g. MCP insert) still trigger tasks-changed within ~2s
- No missed-update regressions: rapid local edit followed by external write still rehydrates
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- src/main/index.ts
- src/renderer/src/App.tsx
- AUDIT_CONTEXT.md

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
