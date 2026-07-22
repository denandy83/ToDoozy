# Story #99 — [Medium] Security: session tokens written plaintext when safeStorage unavailable — src/main/ipc-handlers.ts:41

**Risk class**: security-migration
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: With safeStorage encryption mocked unavailable, sign in and confirm no plaintext .auth-session file is written and a warning surfaces.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. `storeEncryptedSession` (`src/main/ipc-handlers.ts:41`) falls back to writing raw session JSON (access+refresh token) to `.auth-session` when `safeStorage.isEncryptionAvailable()` is false.
2. Change the fallback: do NOT persist plaintext. Log a clear warning (existing logger) and surface a one-time toast/banner to the renderer ("session won't persist across restarts — OS keychain unavailable").
3. On read (`loadEncryptedSession` or equivalent), handle the legacy plaintext file: if it parses as plaintext JSON, migrate it (encrypt if now available) or delete it after use.
4. Vitest: unit-test the store/load pair with safeStorage mocked unavailable → nothing written; mocked available → round-trips.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- No code path writes access/refresh tokens to disk unencrypted
- When encryption is unavailable the user is informed and the app still runs (session just not persisted)
- Legacy plaintext .auth-session files are migrated or removed on next launch
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- src/main/ipc-handlers.ts
- AUDIT_CONTEXT.md

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
