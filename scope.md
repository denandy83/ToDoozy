# Scope

## 2026-06-10 — Batch overview/acceptance doc (MOVED INTO RALPH: story #95 in prd.json)

> **Do NOT build this manually.** It is now story #95 in `prd.json` (and `prd-fable.json`) on `ralph/sync-hardening` — the running Fable batch builds it after #90–#94, with checkpointing (`review/checklist.json`) and worktree-based before-shots. The 02:45 resume watcher relaunches it like any other story if a usage limit kills it. Only build manually if ralph gave up (see `resume-245.log` for GIVE UP lines); resume from the checklist, spec below.

User-requested deliverable: a full overview doc of every story shipped in batch 1 (#68–#88, branch `ralph/audit-fixes`) and batch 2 (#89–#94, branch `ralph/sync-hardening`), so the user can verify each fix and move its ToDoozy task from Verifying → Done.

**Per story include:** story id + title, commit hash (`git log --grep "(#NN)"`), category (fix/feature/improvement), what changed (plain language), and a verification path per the story's nature:
1. **Visually-obvious UI changes** (confirmation-link color #71, project colors #73, tray dots #79, context menu rehaul #83, archive rows #86…): TRUE before/after screenshots — check out the parent commit of the story's commit, run app (`/screenshot` skill, port 5200, dev DB copy via `./dev-db.sh create feature`), capture "before"; capture "after" on HEAD.
2. **Interaction bugs** (#69 scroll wheel, #70 last-digit delete, #72 'less' click, #75/#76 NLP date chip…): "after" screenshot + step-by-step repro scenario (do X → before: Y happened → now: Z must happen).
3. **Sync/MCP/auth stories** (#74, #77, #85, #87, #88, all #89–#94): no screenshots; concrete verification scenario instead — exact MCP tool calls, two-window/two-account sync steps, what to check in activity feed / Supabase. Remember the SCOPE GUARD stories (#88, #93, #94) need `supabase functions deploy` by the USER first — flag those entries as "deploy before testing".

**Sources:** `archive/2026-06-10-audit-fixes/prd.json` (batch 1 stories after ralph archives it), `prd-fable.json` (batch 2), `progress.txt`, per-story commits, ToDoozy task descriptions (story headers carry task IDs).

**Output:** HTML report (consult design skills per global CLAUDE.md: impeccable + emil-design-eng + web-design-guidelines + design-taste-frontend + minimalist-ui flavor; ToDoozy monochrome aesthetic) at `review/batch-review-2026-06.html` with screenshots in `review/img/`. Doc doubles as the acceptance checklist — order entries to match the Verifying pile.

**Trigger:** batch 2 ralph (launched by detached `batch2-handoff.sh`, log `batch2-handoff.log`) is NOT a session-tracked task. Either the live session wires a watcher when batch 1's notification arrives, or a fresh session starts here when the user says "build the batch overview doc". Check batch 2 state first: `git log --oneline ralph/sync-hardening` + `jq '[.stories[] | select(.passes == false)] | length' prd.json`.

## 2026-06-10 — Ralph runbook for the audited backlog (ACTIVE)

Two prepared batches; descriptions in prd files are verbatim copies of the audited ToDoozy task descriptions (each story header carries its ToDoozy task ID for the status lifecycle).

**Batch 1 — Opus 4.8, 21 stories (#68–#88), branch `ralph/audit-fixes` (current prd.json):**
```
./ralph.sh --tool claude 25
```
Small/medium fixes in dependency order (pendingScroll → go-to-task → menu rehaul; labels-in-view → saved-view counts). Story #88 (MCP addLabel) is code-only — carries a SCOPE GUARD against deploying.

**Batch 2 — Fable 5, 6 stories (#89–#94), AFTER batch 1 is reviewed:**
```
git checkout -b ralph/sync-hardening
cp prd-fable.json prd.json
git add prd.json && git commit -m "feat: load sync-hardening stories #89–#94"
RALPH_MODEL=claude-fable-5 ./ralph.sh --tool claude 8
```
Sync/auth surface in order: setAuth gaps → offline retry → Realtime coverage → batch edits → MCP label junction → remove-password. The two edge-fn stories are code-only (SCOPE GUARD).

**Manual user steps after the runs (ralph is forbidden from these):**
- `supabase functions deploy mcp` (stories #88, #93) and `deploy remove-password` (#94)
- One-time backfill of legacy `label_data` links into `project_labels` (#93 description, step 5)
- Verify the Verifying pile in-app (8 pre-existing + everything ralph lands there)

**NOT in any batch:** `cbc728c9` (Gabriel What's New — blocked on his app version/logs), the 3 `Later`-labeled features, all Verifying tasks.

## 2026-06-10 — ToDoozy task-tracker audit (descriptions only; NO code changed)

All 46 open tasks labeled `Todoozy` (excl. `Later`) were fact-checked against HEAD `d4c9f69` and their ToDoozy descriptions rewritten as self-contained, ralph-ready implementation guides (file:line root causes, numbered fix plans, edge cases, tests, status-check lines). **The descriptions in ToDoozy are now the single source of truth per task** — start there, not here.

### Findings index (by verdict)

**ALREADY FIXED in code — recommend verify-once-and-close (currently Not Started):**
- `2433e979` MCP updates → live refresh exists (WAL-mtime poll, main/index.ts:298)
- `728b8b08` activity_log NOT NULL on assign_label (edge fn fetches task.project_id)
- `89e5c4de` project_labels FK ordering (72097f6; ≈duplicate of 80388508)
- `1cd6ec4c` recurrenceUtils tests — re-ran 2026-06-10: 47/47 pass

**Verifying (fix shipped, descriptions now contain exact manual verification steps):**
- `3fa6299c` project archive/restore (#67) · `1babcdcc` save login (#66) · `8d03ed24` profile editor (#65)
- `278476e4` + `4bda5b72` power-aware reconnect / give-up banner (both = commit 8bdf339, verify together)
- `e20a72ae` shared-label re-add (72097f6, needs two-account test) · `a2251ad5` MCP create_project owner_id · `80388508` 409 FK project_labels

**DUPLICATES — flagged in descriptions, awaiting user decision to close:**
- `1b958040` → 3fa6299c · `8f1af047` → 1babcdcc · `ba0d2086` → 856d3d46 (its old body described an already-fixed dnd-kit issue)

**PARTIALLY FIXED — remaining scope narrowed & documented:**
- `41183299` MCP silent drop → only `addLabel`/`remove_label_from_task` left
- `b1ee3217` setAuth storm → 2 gaps: PersonalSyncService.ts:83 bypasses authMutex; recovery timer never sets `isTokenPermanentlyDead`
- `1827d14e` offline retry → SessionBanner handleRetry ignores result + no Realtime re-subscribe after recovery
- `07a1f88a` MCP activity → remote edge fn logs, local mcp-server.ts doesn't
- `8b6b6b3d` labels-in-view filter → MyDay done; SavedViewListView is the gap

**STILL VALID, ralph-ready:** `c18e314c` `7a6830d9` (quick-add NLP) · `6b762989` `493d85fd` `3de51a1f` (sidebar) · `d6e06073` `7c8aefa0` (archive UX) · `381660b5` `b0aef29d` (settings/auth UI) · `ccca14d1` (label push) · `b1f620ae` `f1f6a8cb` `f0f90144` (views/sort) · `1a17c4fc` `4c9e9266` (timer/tray) · `6a8adf77` (remove-password edge fn) · `856d3d46` (context menu, canonical) · `9838a89a` (trivial) · `d174ec02` `4c89a910` (sync improvements, stale line numbers corrected)

**USER DECISIONS (2026-06-10, second pass):**
- Duplicates CLOSED (Done): `1b958040`, `8f1af047`, `ba0d2086`
- `b38ab88b` markdown view → CLOSED (moot — Tiptap WYSIWYG covers it)
- `7b1f8dd7` edit-moves-task → CLOSED (correct-by-design under `updated_at` sort)
- `381660b5` scroll-changes-number → interpretation CONFIRMED (Settings number inputs); fix plan stands
- Moved to `Later` (out of the Todoozy view): `45114a06` app tiers, `360e8565` Telegram TWA, `7716ca1f` label is_archived
- `cbc728c9` Gabriel What's New → RLS hypothesis RULED OUT by live anon-key test (table readable, 34 rows). New top hypothesis: Gabriel on an old app version predating the Supabase release_notes flow. Blocked on his app version + logs.
- All 46 audited tasks carry the `FableVerified` label (`94c74319`); the 4 code-verified fixes were moved to Verifying.
- Vault `bugs.md`: never used (created 2026-05-21, zero entries; referenced by /bug, /fix Phase 0, load-lessons.sh). Decision: no backfill — ToDoozy is the source of truth for the pre-existing backlog; bugs.md captures NEW bugs from here on.

### Cross-cutting facts discovered (reusable)
- `LabelFilterBar.tsx` is dead code (wired into no view).
- `detailPanelStore.ts` does not exist — panel state lives in taskStore.
- `.claude/plans/synchronous-enchanting-tiger.md` referenced by old context-menu task does not exist.
- Local MCP server (`src/main/mcp-server.ts`) logs no activity at all; remote edge fn does.
- `release_notes` Supabase table has no RLS policy in any migration file.
