# ToDoozy — orchestrate build contract (harness-neutral)

This project is driven by the **orchestrate build system**. These rules apply to ANY coding
agent working here (Claude Code, Codex, or other) — the system is files + shell, not a harness.

## The state machine (never hand-edit)

- `prd.json` is a thin story index; `stories/NNN-*.md` are self-contained specs.
- **ALL backlog state changes go through `~/.claude/scripts/prd.sh`**:
  `doctor` (health: HEALTHY 0 · INIT 10 · MIGRATE 11 · RESET 12 · LOCKED 13) ·
  `next` · `start <id>` · `pass <id>` · `fail <id> [why]` · `archive` · `metric '<json>'` ·
  `unlock` · `recover`. Never edit `prd.json` or a story file's acceptance criteria directly.
- `.orchestrate.lock` is the in-flight mutex (freshness-based TTL). Respect it.

## Working a story (builder role)

1. `~/.claude/scripts/prd.sh next` → id + story file. Then `prd.sh start <id>`.
2. Read ONLY that story file + its referenced paths. It is self-contained: numbered guide,
   frozen acceptance criteria, risk class, verification tier, demo statement.
3. Implement exactly what it says. Run `npm run typecheck` and `npm run test` (exit 0 or N/A).
4. Verification is risk-weighted and INDEPENDENT: a separate fresh agent reviews against the
   acceptance criteria and must actually exercise the demo statement. The verifier's charter is
   `~/.claude/agents/independent-verifier.md` (readable as a plain prompt by any harness — spawn it
   via `~/.claude/scripts/agent-run.sh --harness <claude|codex> --prompt-file <brief>`).
   Verifiers fix only mechanical issues; logic findings go back to the builder. Max 2 fix rounds.
5. Outcome: commit `feat(#<id>): <title>` then `prd.sh pass <id>` — or `prd.sh fail <id> "<why>"`
   plus a line in `debug-learnings.md` (append via shell, never read-then-rewrite).
6. Emit dashboard milestones (fail-silent, optional but appreciated):
   `~/.claude/scripts/fm-event.sh <role> <state> "<detail>" --project ToDoozy --story <id>`.

## Hard rules

- Tests drive isolated/temp data only — never real user data or config.
- Never push to origin; the human-gated `no-mistakes` pipeline owns pushing.
- Acceptance criteria are frozen during a run; if a story is wrong, park it (`fail`), don't bend it.
- Scout tasks (investigations) write a report to `stories/scout/<slug>.md` — no diff, no verifier.
- Full reference: `~/.claude/docs/orchestrate-system.md`.
