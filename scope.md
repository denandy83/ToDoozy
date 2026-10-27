# Scope

## 2026-06-17 — Task d5b138b1: label-identity divergence (ACTIVE)

**Invariant (user-confirmed):** every user's labels must be rows THEY own. In a shared project, a member missing a same-name label gets their OWN copy created (them as owner). Per-member same-name label rows all link to the shared project via `project_labels`.

**Confirmed facts (prod, read-only):**
- `dcfe5ded` = andycassiers@gmail.com = the user's ALT account (primary `4cf29d6b` = andy.cassiers@gmail.com). Alt is "sometimes used to test" → STILL ACTIVE → remap-only, never delete alt-owned label rows.
- Alt owns its own Personal project + is a member of shared `Todoozy Bugs` + `Crewlounge` (legit per-member, do NOT touch).
- Cloud divergence on the PRIMARY's Personal project (`1b8d1825`): task_labels point at ALT-owned labels though primary owns a clean same-name canonical: Todoozy `6a1b5cad`→`82cc13d9` (141), Grilled `22d70eea`→`387eb298` (12), Later `a6b01488`→`b44bb105` (9), Obsidian Vault `98b78ed7`→`e491d19b` (2).
- Local "healed" those same alt ids to primary ownership → same id, different owner local vs cloud.
- `labels_user_name_unique` = `(user_id, LOWER(name)) WHERE user_id IS NOT NULL` (NOT partial on deleted_at → tombstones occupy the slot).

**Root cause of `failed=N`:** labels reconcile pushes local `6a1b5cad` (user=primary) → cloud upsert hits the alt-owned cloud row of same id → fails with RLS/non-unique error → `consolidateLocalLabel` (which only fired on detected UNIQUE violations) never triggers → re-counts as failed every pass.

**Already shipped (prior sessions):** `LabelRepository.consolidate()` (+IPC/preload/tests), `consolidateLocalLabel`/`consolidateLabelOnRemote`, render-time `remapLabelsToCurrentUser`/`deduplicateLabelsByName`, apply-time `resolveLabelForCurrentUser` (cddff11). Broken uncommitted change: `adopt()` calling non-existent `window.api.labels.adopt`.

**Plan — code + tests this session; USER runs the prod heal:**
1. `LabelRepository.applyRemote`: sticky-ownership guard — a newer remote may update name/color/etc. but must NOT flip an existing row's non-null `user_id` to a different non-null user (LWW #3). Labels never legitimately change owner.
2. `ensureLabelsExistLocally(labelIds, projectId)`: stop creating divergence. own-label → `applyRemote` (preserve id); foreign/null-owner → resolve to current user's own same-name label (`adopt`: findByName or create new UUID) + `addToProject` + remap. Thread projectId from both callers (`pullTaskLabelsForTask`, `pullNewTasks`). Remove broken `adopt` IPC call by WIRING `adopt` through ipc/preload/d.ts.
3. Push self-heal: in labels `remoteUpsert` (syncTables) + `pushLabel` (PersonalSyncService), on ANY upsert error (not just detected unique-violation) attempt `consolidateLocalLabel`/`consolidateLabelOnRemote` when `local.user_id` is set; only re-throw if consolidation didn't apply. This drives the LOCAL divergence to converge (`failed→0`) on next reconcile.
4. Wire `labels.adopt` through `ipc-handlers.ts` + `preload/index.ts` + `preload/index.d.ts`.
5. Cloud heal (USER runs): committed, previewable, idempotent SQL `supabase/heal/2026-06-17-label-ownership.sql` — for the user's SOLO (single-member, owned) projects only, ensure canonical task_label present then delete the alt-owned dup; never delete alt label rows; never touch shared (>1 member) projects.
6. Tests: `adopt` (reuse/create), `applyRemote` sticky-ownership, `consolidate` divergent-owner convergence.

**Verify:** Vitest (deterministic) for repo logic; dev-DB copy for local self-heal; cloud SQL is preview-first + scoped + idempotent.

**STATUS 2026-06-17 — code shipped (commit pending), USER runs heal:**
- DONE 1–4: applyRemote sticky-ownership guard; ensureLabelsExistLocally adopt/preserve + projectId; push self-heal broadened (syncTables.remoteUpsert + PersonalSyncService.pushLabel); adopt wired (ipc/preload/d.ts). Typecheck + build + 963 Vitest green (incl. new adopt/sticky-ownership/divergence tests).
- DONE 5: cloud heal `supabase/heal/2026-06-17-label-ownership.sql` (preview→apply→verify). Read-only prod preview confirmed it captures all 10 divergent names (~212 links, all with a clean primary canonical, has_canonical=true) and excludes shared projects.
- PENDING (user): (a) sign in on a test/dev build, confirm `Reconcile: labels … failed=0` after the local self-heal converges; (b) run the cloud heal SQL STEP 0→1→2 in the Supabase SQL editor; (c) confirm chips render correctly. Then move task d5b138b1 Verifying→Done.
- Note: `dcfe5ded` is the user's alt (still used) → heal NEVER deletes alt label rows, only remaps the primary's solo-project task links + soft-deletes the stray cloud links.

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

## 2026-10-25/26 — Codex backlog audit
- Synced GitHub main 9fddf7d → a920619 (v1.9.0) before edits; branch codex/backlog-audit-2026-10-25. GitHub had no open issues/PRs. The pre-existing Electron update was preserved during sync, then superseded by the verified security upgrade to 42.11.16.
- Live backlog snapshot remains local in .git/backlog-audit-2026-10-25.json: 22 in scope, 6 Later excluded. Three old runtime reports retired at the user's direction. Seventeen implementation items addressed; label data consolidation and historical password remediation remain operational work.
- Owner-only archive applies to every member. Settings → Projects → Archive provides persistent restoration, with a compound retryable project/task sync operation.
- Fixed recursive subtask filtering, archived visibility/counts, completion ordering and keyboard traversal; description search; editor autosave without hydration/blur writes; reference URL scheme handling; quick-add filter hint; WAL-safe per-user dev DB backups; ESLint configuration.
- Search explicitly refreshes all known projects on palette open, including unopened personal projects. Batched reads use keyset pagination, preserve newest duplicate versions, apply parents first, and guard account changes. Shared realtime refreshes the affected project and global stores, including deletions and label changes.
- Sync retry retains API errors, coalesces superseded operations and reads current SQLite state, handles composite settings IDs, preserves tombstone timestamps, batches writes, and prevents concurrent drains. Shared label definition changes fan out through project_labels events after migration deployment.
- MCP supports reference_url, rejects a foreign-project status, and adds atomic owner-only status create/update/delete/reorder/ensure. The RPC preserves default/done invariants and changes task completion state transactionally.
- Backend deployed after user verification on 2026-10-26: 20261026075319_shared_label_realtime.sql, then 20261026075322_atomic_status_management.sql, then MCP v16 (ACTIVE). Local migration filenames match production history. Status completion values explicitly match the deployed TEXT column using ISO UTC strings. All seven bundled runtime source files match local code; OPTIONS returned 204 and unauthenticated GET returned 401. No new security/performance advisory findings.
- Security dependencies updated within compatible ranges plus Electron 42.11.16 after checking official breaking changes. The root desktop manifest npm audit reported zero advisories after those updates; that check did not cover the separate Telegram bot lockfile. An isolated Electron 42.11.16 startup with synthetic configuration, a fresh database and blocked external requests reached the sign-in screen with the preload API available.
- Validation: TypeScript, 78 Vitest files / 1160 tests, Deno MCP typecheck, production build, and lint (zero errors, 27 existing hook warnings). Independent reviewers exercised task hierarchy, WAL snapshots, status SQL, queue/refresh paths, search pagination, and account-switch isolation with synthetic fixtures.
- No production auth or label-ownership mutations. prd.sh/verifier charter are absent on this Mac; empty prd stories untouched. Independent verification used the available Codex agents. No origin push per AGENTS.md.

## 2026-10-26 — Verification and release preparation
- User confirmed verification. All 17 implemented backlog items are Done with an explicit note that acceptance does not mean the signed Mac app has been published. The two operational tasks and the new task-only label removal follow-up remain open.
- Prepared v1.10.0 package/lockfile metadata and changelog; production build, typecheck and all 1160 tests passed again. Independent review confirmed completion-date behavior with a non-UTC database timezone.
- Application release remains pending: no no-mistakes executable/configured pipeline found on this Mac, no Developer ID distribution identity for the configured team HXNS28BT9C, and no notarization settings present. Only an Apple Development identity is available. Requested the release host/pipeline location; no origin push, tag or public release performed.

## 2026-10-26 — Release environment repair
- Installed official no-mistakes v1.84.0 (verified release SHA-256), initialized the local gate and launchd daemon, and configured the existing authenticated Codex runner. No direct origin push.
- Restored ignored public Supabase client configuration; the project auth settings endpoint accepted the key. Added production-build validation that rejects missing endpoints and server-side keys, plus isolated regressions. CI now runs typecheck, tests, lint and build using repository Actions variables containing only public client settings.
- Typecheck, production build, lint (zero errors, existing warnings) and 79 test files / 1164 tests passed. An actual build with empty settings failed with the intended configuration error.
- Xcode has no signed-in Apple account. It is waiting at the account sign-in sheet; user authentication requested before distribution-certificate and notarization setup.


## 2026-10-26 — Gate review follow-up

- The outer executor reports deploying the exact task-status guard SQL as `20261026094537_task_status_assignment_guard`; the local filename and test references now match that history. SQL bytes remain unchanged (Git blob `53f17146fae986da0e9ec9a0f779b2baecdbe953`). No production query or deployment was performed in this review phase.
- The supplied independent PostgreSQL 17 verification passed 16/16 cases on a9aad656, including independent sessions, RLS, ISO TEXT dates, and deadlock rollback followed by explicit retry. Automatic application retry was outside that verifier's scope; the pending MCP source adds bounded retry only for SQLSTATE 40P01 and 40001 on the complete atomic status RPC.
- The outer executor reports MCP v17 active from exact 8096fde: all eight bundled files match, own API-key authentication and verify_jwt=false are preserved, Deno check and independent status-RPC retry checks passed, and OPTIONS/unauthenticated GET returned 204/401. No MCP deployment was performed in this review phase. The signed application remains unpublished and the gate remains in progress.
- R4 and review-1 share the retained `readAll`/`readAllIn` repair: tasks/statuses paginate before watermarks, label definitions and project/task junctions paginate before application, and queue reconciliation/cleanup reads all remote rows. `syncPull.integration.test.ts` covers more than 1,000 tasks, statuses, labels and junctions, failed-page watermark retention, and both queued cleanup paths.


## 2026-10-26 — Archive versions and shared sync lifetime

- Prepared the additive `20261026102717_project_archive_version.sql` migration; it remains unapplied in this phase. Archive actions have an independent version that generic project metadata cannot overwrite. Local actions persist their queue entry atomically; delayed producers only drain current durable intent. Older imported task rows inherit the applicable archive action, while later individual choices remain guarded. Remote task IDs are paged and equal patches are sent in batches of at most 200.
- Shared task/status writes and implicit-context pull paths use captured account/database APIs and clients, including queue feedback and UI routing. Original R9 rename/task-choice and R11 tombstone/timestamp behavior remains covered by isolated regressions. Fresh full-branch review and the outer Test phase remain required; the application and gate are still pending.


## 2026-10-26 — Legacy compatibility containment and review repairs

- The outer executor reports applying `20261026105740_disable_legacy_status_consistency_guard.sql` after 17/17 independent containment checks. The identical rollback artifact is included locally. `enforce_task_status_assignment` remains enabled; `enforce_status_task_consistency` is disabled for deployed v1.9 compatibility and is not re-enabled here. MCP v17 remains active. Direct legacy status edits retain their prior unsent-reassignment/completion limitations; no global direct-status consistency is claimed.
- Desktop status deletion now records its selected replacement atomically with local reassignment and sends the complete owner-only `manage_project_status` RPC during delivery/retry. Store mutations retain their originating database before awaiting. Shared label additions write the actual junction and bounded retries preserve current intent. The task-only label-removal follow-up remains open.
- The unapplied archive-version migration now distinguishes versioned, timestamped legacy-action, and metadata statements by targeted columns, preserves accepted state on equal-version conflicts, and fences stale task cascades. The new `20261026111055_task_label_addition_realtime.sql` migration emits task notifications after junction additions without changing task versions. Both new migrations remain unapplied in this phase; production was not queried or deployed. The original applied guard SQL is unchanged. The application/gate remain pending.


## 2026-10-26 — Archive activation requires a coordinated writer upgrade

The pending archive and task-label notification migrations remain undeployed. The candidate MCP task writer carries an explicit task archive version; live MCP v17 remains active until the outer executor independently verifies and coordinates deployment. Unambiguous older MCP partial archive updates and the v1.9 project archive/restore protocol are supported by the pending guard. Legacy full-row task updates cannot distinguish a genuine archive choice from stale metadata carrying the same flag, so their archive behavior is not compatible with activating the new guard.

Activation requires a paused-writer maintenance window: prepare, review, sign and notarize the v1.10 artifact offline; verify the exact SQL and candidate runtime; confirm all old desktop and MCP writers are paused; apply the verified pending migrations to expand the schema and activate the guards; deploy and verify the candidate MCP; then install/start signed v1.10 clients and resume only upgraded writers. New desktop/MCP writers require the archive columns and must not run before schema expansion. If old writers cannot be controlled, defer activation or independently design a separate compatibility expansion phase. The Apple distribution key is still absent and the signed client rollout is not ready. Do not deploy the new guard while shipped v1.9 full-row writers remain in use; an unsigned build or authentication changes do not satisfy this deployment requirement. The existing task status assignment guard stays enabled, the applied legacy status consistency rollback stays disabled, and applied migration files remain unchanged.


## 2026-10-26 — Task-label assignment convergence repair

The task-only label-removal follow-up (bc87b45b-d256-4490-980d-40452847197e) is implemented in source with local assignment versions and durable pending choices. Complete, successful paged snapshots can remove obsolete assignments, including empty results; pending or concurrent local additions/removals remain protected. Ordinary task metadata writes no longer recreate cached assignments. Personal/shared eager, buffered and queued delivery use explicit choices, with canonical remapping and version-specific acknowledgement. Project palette addition/removal reconciliation uses the association's addition/removal clock; removing a project label only clears chips cached for that project.

This source repair awaits independent verification and release validation; it is not user-verified or shipped. The local SQLite migration does not require new Supabase DDL. Applied SQL stays immutable; the pending archive and notification SQL remains undeployed. Historical operational data cleanup and auth follow-ups remain open. Coordinated activation above still requires the missing Developer ID signing key and paused legacy writers; production cleanup is not part of this repair.


## 2026-10-26 — Ordered task-label delivery and removal notifications

Task-label writes are ordered per originating account/database and task across eager, buffered, queued, legacy and reconciliation delivery. Ready tasks and completed batches can progress independently; pending additions share project palette reads and bounded batches of at most 200 rows. Removing a displayed canonical label resolves same-name foreign assignment IDs for that task, retaining unrelated assignments, palettes and definitions.

The pending task-label notification migration now includes effective soft and hard removals, alongside additions/restorations, while preserving task metadata timestamps, no-op suppression, transaction rollback and invoker access checks. Source and pending SQL still await independent exact-head verification and the coordinated paused-writer client/backend rollout above. No applied migration or deployed backend has changed; this is not a user-verified or shipped release.


## 2026-10-26 — Label clocks and Telegram polling watchdog

Project-label removal/addition versions are generated transactionally after valid known same-name family addition/removal clocks. Tombstones and removal commands share the captured removal version. Same-tick and rolled-back local clocks cannot cause a previously acknowledged remote addition to be mistaken for a later re-add.

The original unlabeled non-Later bot watchdog item (e3d3132d-6b4e-49b8-9420-2ecb994083ac) is implemented in source: polling errors are sanitized, recovery is single-flight with bounded backoff and graceful stop, heartbeat/backlog checks detect stalled consumers, and failed recovery exits for the existing Docker restart policy. Synthetic tests execute the pinned library; CI includes package typecheck/test/build. See packages/telegram-bot/README.md for the unexecuted deployment and rollback recipe. This implementation awaits independent exact-head verification and production rollout; it is not user-verified or deployed. No production credentials, service settings or data were accessed or changed. Applied SQL and all earlier label/status/archive protocols are preserved; signed client, pending migrations and candidate MCP still require the coordinated paused-writer rollout above.

## 2026-10-26 — Project-link delivery convergence and bot runtime

Project-link writers share a current-intent boundary across eager/queued delivery, full upload, reconciliation and removal/restoration. Each bounded write rereads the originating database before and after delivery, reasserts changed local choice even if an overlapping delivery already acknowledged it, and retains failed repair as queued work. This is in-process convergence, not protection against concurrent cross-device writes. Association clocks use the existing JavaScript `toLowerCase()` family equivalence, including accented names; no identity merge or new normalization is introduced.

Bot generated output is excluded narrowly from lint while handwritten source/tests/config remain covered. The candidate container uses Node 22.23.2, matching CI; polling behavior, Compose restart policy and grace period are preserved. These source repairs await outer exact-SHA verification and rollout. No applied or pending SQL, production data/configuration or running service changed. The signed client and candidate MCP remain subject to the coordinated paused-writer rollout above.

Focused store/reconciliation regressions use isolated SQLite plus PGlite and synthetic transport. The status/store fixture deliberately omits unrelated user-scoped tables/bootstrap services; errors from those unavailable paths are not evidence for full-backend readiness. Project-link, assignment, queue and observer end-state assertions remain enforced. Full repository gates and independent exact-SHA execution remain outer-executor work. Bot package checks and Compose parsing ran on local Node 22.23.2 with synthetic environment; Docker CLI was present but its daemon was unavailable, so no image was built or started.


## 2026-10-26 — Consolidation receipts and nested bot dependencies

Task-label consolidation selects the complete highest-version assignment independently of acknowledgement state. Remapped or still-pending canonical work receives a fresh local version and a transactional queue command, so receipts for pre-remap physical identities cannot acknowledge the new delivery. No global identity merge or data cleanup is performed.

The bot dependency tree is separately audited from the desktop. Its candidate lock retains SDK 0.66.0, uses the maintained Cypress request fork for injected and peer transports, and patches compatible form-data, qs, ws and uuid versions. Separate full root and bot audits include dev dependencies; no advisory is suppressed. Installed advisory presence was not evidence of exploitation in this bot. Clean development and production-pruned installs plus localhost synthetic transport checks are source-readiness evidence only; no container build, live Telegram access or deployment occurred. All SQL and the coordinated signed-client/MCP rollout boundary remain unchanged.
