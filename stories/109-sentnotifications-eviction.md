# Story #109 — [Low] Bug: sentNotifications set grows unbounded — src/main/notifications.ts:11

**Risk class**: shared-logic
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Let a due notification fire, advance past the due time, and confirm the sentNotifications entry is evicted.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. `sentNotifications` (`src/main/notifications.ts:11`) accumulates `taskId:leadKey` keys for process lifetime; `clearSentNotifications()` never runs on a schedule.
2. Store fire-time alongside the key (Map<string, number> instead of Set), and in the existing notification sweep evict entries whose associated due time is safely past (e.g. > 24h old).
3. Keep semantics: a key must survive long enough to prevent duplicate fires for the same due instant, including across suspend/resume.
4. Vitest the eviction predicate as a pure function.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- Entries are evicted after their due time passes (bounded memory)
- No duplicate notifications for the same task/lead within the active window
- Rescheduled tasks re-notify correctly after eviction
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- src/main/notifications.ts

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
