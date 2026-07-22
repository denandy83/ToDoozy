# Story #96 — [Critical] Security: MCP edge function stores per-request auth in module globals — supabase/functions/mcp/index.ts:1245

**Risk class**: security-migration
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Send two concurrent MCP requests authenticated as two different users and confirm each response contains only that user's own data.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. Open `supabase/functions/mcp/index.ts`. At ~1245-1248, `Deno.serve` writes `_authUserId`, `_authClient`, `_authRepos`, `_authHandlers` into module-level variables, then `await httpHandler(req)` (~1251). Concurrent requests overwrite these mid-flight.
2. Refactor to per-request context: build `{ userId, client, repos, handlers }` inside the request handler and pass it down explicitly (constructor/parameter injection into the tool handler dispatch), OR wrap the request in `AsyncLocalStorage.run(ctx, ...)`.
3. Delete the module-level mutable auth variables entirely — grep the file for `_auth` and remove every global read/write.
4. Redeploy the edge function (supabase functions deploy mcp) is a HUMAN step — note it in the PR/commit body, do not deploy from the loop.
5. Add a regression test if the function has a test harness; otherwise document the concurrency contract at the top of the file.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- No module-level mutable variable holds per-request auth state (grep `_auth` returns no globals)
- Two interleaved requests with different API keys cannot observe each other's userId/repos (unit-testable by invoking the handler concurrently with stubbed auth)
- All existing MCP tools still function against the per-request context
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- supabase/functions/mcp/index.ts
- AUDIT_CONTEXT.md
- CLAUDE.md

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
