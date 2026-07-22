# Story #104 — [Medium] Performance: N+1 Supabase queries in discoverRemoteMemberships — src/renderer/src/services/SyncService.ts:776

**Risk class**: data-writing
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Sign in with multiple shared projects and confirm membership discovery issues a single batched project_members query (network tab).
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. `discoverRemoteMemberships` (`src/renderer/src/services/SyncService.ts:776-782`) issues one count query per candidate project id in a loop.
2. Replace with a single `.select('project_id')` + `.in('project_id', ids)` query on project_members; count client-side by grouping (Map<project_id, n>).
3. Preserve exact downstream semantics (what the per-project count was used for — read the surrounding code and keep the same threshold/branching).
4. Follow CLAUDE.md Supabase rules: no write on this read path.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- Membership discovery performs one batched query regardless of project count
- Behavior for each project (member/not, counts) identical to before
- No new write/RPC introduced on this read path
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- src/renderer/src/services/SyncService.ts
- CLAUDE.md

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
