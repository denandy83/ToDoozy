# Story #97 — [High] Security: MCP tools run on service-role client, RLS bypassed — supabase/functions/mcp/index.ts:1207

**Risk class**: security-migration
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Call an MCP tool (e.g. get_task) with user A's API key passing a task id owned by user B and confirm it returns not-found/forbidden.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. In `supabase/functions/mcp/index.ts` (~1207), `authenticateRequest` builds an admin client with SUPABASE_SERVICE_ROLE_KEY used for ALL repo calls — RLS is bypassed.
2. Audit every repo class method in the edge function: any method taking an id (`TaskRepo.findById`, `StatusRepo.findById`, `ProjectRepo.findById`, `LabelRepo.findById`, and all update/delete-by-id) must scope to the authenticated user: filter `user_id = ctx.userId` or join through `project_members`/project ownership for shared entities.
3. Keep the service-role client (needed to bypass RLS for the api_keys lookup itself) but treat manual scoping as mandatory on every query — add the missing `.eq(...)`/join to each unscoped method.
4. Add unit-style checks (or a checklist in the PR body) enumerating every tool → repo call → scoping filter, so the verifier can confirm none is missed.
5. This story depends on #96's per-request context; implement after it (same file).
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- Every repo method reachable from a tool call filters by the authenticated user (ownership or membership)
- A crafted request for another user's task/project/label/status id returns not-found or forbidden, never the row
- Existing single-user MCP flows (create/list/complete task) still work
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- supabase/functions/mcp/index.ts
- AUDIT_CONTEXT.md

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
