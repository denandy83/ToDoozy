# Story #107 — [Medium] Inconsistency: many components exceed 150-line rule — src/renderer/src/AppLayout.tsx:1

**Risk class**: ui-logic
<!-- one of: cosmetic-ui | ui-logic | shared-logic | data-writing | security-migration -->
**Verification tier**: full
<!-- smoke (cosmetic-ui, ui-logic wiring) | full (shared-logic, data-writing, security-migration) -->
**Demo statement**: Use the app normally across My Day, filters, task rows and shared-project realtime; behavior is identical with the worst-offender components split and the realtime callback extracted into a hook.
<!-- One sentence a human could literally perform to see this working,
     e.g. "open the app, tap the egg nine times, the chick appears".
     The verifier must actually perform or drive this. -->

## Implementation guide

1. Scope THIS story to the worst offenders only: AppLayout.tsx (1682), FilterBar.tsx (1567), MyDayView.tsx (1020), TaskRow.tsx (987). (Full 150-line compliance across ~30 files is follow-up work, not this story.)
2. AppLayout: extract the shared-project Realtime callback (lines ~240-458, per-field manual casting) into `useSharedProjectRealtime` hook under features/ or shared/hooks/; extract other cohesive blocks (menus, panels) into subcomponents.
3. FilterBar / MyDayView / TaskRow: extract logical sub-sections into hooks + subcomponents; keep props typed, no behavior change, pure mechanical moves.
4. ZERO functional changes: no renamed exports used elsewhere, no state shape changes. Move + import only.
5. Each extracted unit lands next to its feature per the folder structure rule; components stay under 150 lines where feasible, hooks hold the logic.
<!-- Numbered steps with exact file paths, current code snippets with line numbers,
     exact new code or pseudocode, migrations, type changes, edge-case checklist.
     Self-contained: the builder reads ONLY this file plus the references below. -->

## Acceptance criteria

<!-- FROZEN once the run starts. Builders and verifiers may not edit this file;
     only prd.sh mutates backlog state, on the orchestrator's instruction. -->
- AppLayout realtime callback lives in a dedicated typed hook; AppLayout.tsx substantially reduced
- FilterBar, MyDayView, TaskRow split into subcomponents/hooks with no behavior change
- No visual or interaction regressions across the touched views (manual smoke per demo)
- npm run typecheck passes with zero errors
- npm run test passes (all existing and new tests)

## References

<!-- Paths only, never inlined content. The builder decides what to open. -->
- src/renderer/src/AppLayout.tsx
- src/renderer/src/features/
- CLAUDE.md

<!-- Contract: this file stays under ~4k tokens. If a story needs more, it is
     two stories — split it before the run, not during. -->

<!-- SCOUT variant: for an investigate/plan/reproduce/audit task (no code change),
     set the index entry's kind to "scout", skip acceptance/verification, and replace
     the guide with the question to answer + where to look. The deliverable is a report
     at stories/scout/<slug>.md, not a diff. The orchestrator runs it without a verifier
     or branch. See /orchestrate "Ship or scout?". -->
