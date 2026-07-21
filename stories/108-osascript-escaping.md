# Story #108 — [Low] Security: dev osascript notification injectable via task title — src/main/notifications.ts:87

**Risk class**: security-migration
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: In dev, create a task titled with a double quote and AppleScript payload, trigger its notification, and confirm no injection occurs.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. `src/main/notifications.ts:87` (dev branch): title/body interpolated into `osascript -e 'display notification "..." with title "..."'` — only single quotes escaped; `"` and `\` break the AppleScript string context.
2. Preferred: drop the osascript path and use Electron's Notification API in dev too (it works in dev on macOS when the app has a bundle id; verify).
3. If osascript must stay: pass strings via argv (`osascript -e 'on run argv' ...`) or escape `\` and `"` for the AppleScript context in addition to shell quoting.
4. Unit-test the escaping function with hostile titles if that route is taken.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- A task title containing `" & do shell script "..." & "` produces a literal notification, no execution
- Dev notifications still appear
- Production notification path untouched
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
