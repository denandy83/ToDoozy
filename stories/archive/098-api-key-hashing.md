# Story #98 — [Medium] Security: API keys stored/compared in plaintext — supabase/migrations/003_create_api_keys.sql:2

**Risk class**: security-migration
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Inspect the api_keys table and confirm only hashes are stored, while MCP authentication with an existing plaintext key still succeeds.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. `api_keys.key` stores the raw key (`supabase/migrations/003_create_api_keys.sql:2`); `authenticateRequest` matches `.eq('key', apiKey)` (mcp/index.ts:~1211).
2. Write a NEW migration (never edit an applied one): add `key_hash text` column; backfill `key_hash = encode(digest(key,'sha256'),'hex')` (pgcrypto); after backfill, null-out/drop the plaintext `key` column.
3. Update `authenticateRequest` to hash the presented key with SHA-256 (Web Crypto `crypto.subtle.digest`) and match on `key_hash`.
4. Update whatever creates API keys (search repo + edge functions for inserts into api_keys) to store only the hash and return the plaintext once.
5. MIGRATION IS PRODUCTION-DB WORK: write the SQL file in-repo; applying it to the live project is a HUMAN-approved step — flag in commit body.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- api_keys stores only SHA-256 hashes; no plaintext column remains populated
- Existing keys keep working after backfill (hash of old plaintext matches)
- Key creation path returns plaintext once and persists only the hash
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- supabase/migrations/003_create_api_keys.sql
- supabase/functions/mcp/index.ts
- AUDIT_CONTEXT.md

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
