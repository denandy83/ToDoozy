# Story #111 — [Low] Security: shell:openExternal accepts arbitrary URL schemes — src/main/ipc-handlers.ts:974

**Risk class**: security-migration
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Invoke shell:openExternal with file:///etc/hosts from DevTools and confirm it is rejected while https URLs still open.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. `src/main/ipc-handlers.ts:974`: handler forwards any renderer string to `shell.openExternal`.
2. In the MAIN process handler, parse with `new URL(...)` and allowlist protocols: `https:`, `http:`, `mailto:`. Reject everything else with a logged warning (no empty catch), returning a typed error to the caller.
3. Malformed URLs (URL constructor throws) → same rejection path.
4. Vitest the validator as a pure function (allowed/blocked/malformed cases).
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- file://, smb://, arbitrary schemes are rejected in the main process regardless of caller
- http/https/mailto links still open
- Rejections are logged, not swallowed
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- src/main/ipc-handlers.ts

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
