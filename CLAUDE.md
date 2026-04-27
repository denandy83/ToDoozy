# ToDoozy

## What Is This
ToDoozy is a collaborative, keyboard-driven, AI-native task manager built with Electron. Read `REBUILD_SPEC.md` for the complete 37-section product specification.

## Your Task
1. Read `prd.json` to find the next story where `passes` is `false`
2. Read `REBUILD_SPEC.md` at the section referenced in `spec_section` for full implementation details
3. Implement the feature completely — not a stub, not a skeleton, the real thing
4. Follow all Architecture Rules and UX Consistency rules below
5. Run `npm run typecheck` — loop and fix until zero errors
6. Run `npm run dev` to verify it compiles (use port 5200), then kill the process
7. Write Vitest tests for any new repository methods or utility functions added in this story — run `npm run test` and loop until all tests pass
8. Update `prd.json` to set `passes: true` and `tested: true` for the completed story (`verified` stays `false` — that is set manually by the user after acceptance criteria review)
9. Git commit with a conventional commit message describing what was built
10. Append any decisions, blockers, or learnings to `progress.txt`
11. If there are more stories with `passes: false`, exit normally — you will be called again for the next one
12. If ALL stories have `passes: true`, output exactly `<promise>COMPLETE</promise>` and exit

## Important Context
- `.env` has Supabase credentials (`SUPABASE_URL` and `SUPABASE_ANON_KEY`)
- `ToDoozy.png` (1024x1024) is the app icon — copy to `resources/icon.png` during scaffolding
- Supabase project is live at `https://znmgsyjkaftbnhtlcxrm.supabase.co` with email/password and Google OAuth enabled
- Dev server must use port **5200** (ports 5173-5185 are occupied)
- Set `server: { port: 5200 }` in `electron.vite.config.ts` renderer config

## Dev Server
- Port: **5200**
- In `electron.vite.config.ts`, set `server: { port: 5200 }` in the renderer config

## Dev Database
Never run migrations or destructive operations against the production database. Use dev DB copies:
- `./dev-db.sh create feature` — Create a dev DB copy for feature work (ralph does this automatically)
- `./dev-db.sh create bugfix` — Create a dev DB copy for bug fixes
- `export TODOOZY_DEV_DB=$(./dev-db.sh create bugfix) && npm run dev` — Start dev server on a copy
- Rolling limit: 5 copies per type, oldest auto-deleted
- The `TODOOZY_DEV_DB` env var overrides the DB path in both the Electron app and MCP server
- When starting a bug fix session, create a bugfix dev DB. Every 5 bugs, create a fresh one.

## Key Commands
- `npm run dev` — Start development server
- `npm run build` — Production build
- `npm run typecheck` — TypeScript type checking
- `npm run test` — Run Vitest tests
- `npm run lint` — ESLint check
- `npm run dist:mac` — Build macOS distributable (DMG + ZIP in `dist/`)

## Distribution Build
`npm run dist:mac` builds and signs with the Developer ID certificate automatically. No manual re-signing needed.

## Scope File (`scope.md`)
When investigating bugs, planning features, or exploring the codebase for any multi-file change:
1. **Write findings to `scope.md` as you go** — don't hold everything in context. List affected files, decisions, and what doesn't need changing.
2. **Consult `scope.md` before exploring** — if a previous session already mapped the area, start from there instead of re-exploring.
3. **Update `scope.md` after completing changes** — mark items as done, note what actually changed vs what was planned, remove stale sections.
4. **Delete completed scopes** — once all items are done and committed, clear the file so it's ready for the next task.

This prevents expensive re-exploration across sessions and keeps investigation costs proportional to the actual unknowns.

## Architecture Rules
- Zero `any` types. Strict TypeScript. Every prop interface must be defined.
- Feature-based folder structure under `src/renderer/src/features/`.
- All database access goes through repository classes (TaskRepository, LabelRepository, etc.). Never write raw SQL in IPC handlers.
- All state management via Zustand stores. No prop-drilling beyond 1 level. No useState for shared state.
- Components must be under 150 lines. Extract hooks for reusable logic.
- Every IPC handler must have a matching typed method in the preload bridge.
- Use versioned migrations (schema_version table), never try/catch ALTER TABLE.
- All primary keys are UUIDs. All timestamps are ISO 8601 UTC.
- Empty catch blocks are forbidden. All errors must be logged or surfaced to the user.
- SQL injection prevention: column whitelist for update queries.
- Foreign keys enabled (`PRAGMA foreign_keys = ON`).

## Supabase Performance Rules
- **Realtime-first, polling-fallback.** Never poll alongside an active Realtime subscription. Use `syncStore.realtimeConnected` to toggle.
- **Filter every Realtime subscription.** Never subscribe to a table without a filter — unfiltered subs force WAL decoding for ALL rows across ALL users.
- **No N+1 queries to Supabase.** Use `.in()` batch queries instead of per-item loops. This applies to label resolution, member loading, and any list-of-IDs lookup.
- **No write-through on read paths.** Polling/pull functions must never call RPCs or upserts. Use SELECT to check for changes; only write when the user initiates a mutation.
- **Compound indexes for incremental sync.** Any table queried with `WHERE project_id = ? AND updated_at > ?` must have a compound index on `(project_id, updated_at)`.
- **Debounce high-frequency writes.** Settings, preferences, and non-critical metadata should be debounced (5s) before pushing to Supabase.
- **Subscribe to active context only.** Personal projects: subscribe only to the active project's Realtime channel, not all projects. Shared projects: subscribe per-project as needed.
- **Batch sync queue flushes.** Group queued changes by table and batch-upsert, don't process one-by-one.
- **Index all foreign keys.** Every FK in Supabase must have a covering index (Supabase performance advisor flags these).
- **No duplicate Realtime channels.** Track subscribed channels in a Set; check before subscribing.

## UX Consistency (see REBUILD_SPEC.md §35)
- Use shared components everywhere: StatusButton, PriorityIndicator, LabelChip, LabelPicker, DatePicker, Toast, ContextMenu, Modal, Avatar, EmptyState
- Selection: accent bg at 12% opacity + accent border at 15% opacity
- Hover: bg-foreground/6 with faint border
- Destructive actions: always red, always at bottom of menus, always with undo toast
- Flyout submenus: open on hover (150ms delay), open right unless near viewport edge
- Autosave: 1s debounce on all text inputs
- Escape always closes topmost overlay/panel/menu
- All animations respect `prefers-reduced-motion`
- Keyboard-first: every feature must be usable without a mouse

## Typography Scale
- View title: `text-3xl font-light tracking-[0.15em] uppercase`
- Section label: `text-[10px] font-bold uppercase tracking-[0.3em]`
- Task title: `text-[15px] font-light tracking-tight`
- Metadata: `text-[10px] font-bold uppercase tracking-widest`
- Badge/chip: `text-[9px] font-bold uppercase tracking-wider`
- Button label: `text-[11px] font-bold uppercase tracking-widest`
- Body text: `text-sm font-light`

## Testing
- Write Vitest unit tests for all repository methods, filter logic, and utility functions.
- Test files live next to source files: `TaskRepository.test.ts` alongside `TaskRepository.ts`.

## Style
- Minimal, monochrome-first design. Color comes from themes and priority/label accents.
- All animations respect `prefers-reduced-motion`.
- Keyboard-first: every feature must be usable without a mouse.

## Documentation System

### Session Start
At the start of every session (or when resuming after a new day), check if `.docs-pending` exists in the project root. If it does:
1. Read `pending-changes.md` — it contains unprocessed fix/feature entries and raw git commits
2. Process entries into the permanent docs:
   - Append fix entries to `CHANGELOG.md` under today's date heading
   - Append feature entries to `RELEASE_NOTES.md` under today's date heading
   - Update `FEATURES.md` for any new features (add or update the relevant section)
   - Update `README.md` feature table if significant new features were added
   - Append a summary entry to `DEVLOG.md`
   - Update the in-app "What's New" setting (see below)
3. Clear the processed entries from `pending-changes.md` (keep the file header/format section)
4. Write the current HEAD commit hash to `.last-documented-commit`
5. Delete `.docs-pending`

### Session End (automatic via hook)
The `SessionEnd` hook runs `.claude/hooks/docs-session-end.sh` automatically. It captures recent git commits into `pending-changes.md` and writes `.docs-pending`. No action needed from Claude.

### Documentation Files
- `README.md` — project overview, tech stack, feature table. Update feature table when new features ship.
- `FEATURES.md` — complete feature inventory with technical details. Update when features are added or change.
- `HELP.md` — end-user guide. Update when user-facing behavior changes.
- `DEVLOG.md` — reverse-chronological dev log. Append an entry for each significant session.
- `CHANGELOG.md` — all bug fixes and changes, dated. Append after every fix.
- `RELEASE_NOTES.md` — user-facing daily release notes. Append after every user-visible change.
- `pending-changes.md` — working file, session-scoped. Written by /fix and /feature skills + SessionEnd hook. Cleared after processing.
- `implemented-stories.md` — permanent log of all implemented stories. NEVER delete entries from this file.

### In-App "What's New" (Settings → What's New)
The "What's New" tab displays release notes sourced from the `release_notes` table on Supabase. The data flow:

1. **App launch**: `syncReleaseNotes()` (in `src/main/services/ReleaseNotesService.ts`) fetches every row from the `release_notes` table on Supabase, concatenates them as versioned markdown, and writes the result to the local `whats_new` setting (stored under `user_id = ''` so it stays device-local and never participates in personal sync). Logs `Release notes synced (N versions)` per launch.
2. **Tab open**: The renderer re-runs the sync and re-reads the cache, so any release published since the last cold start appears without needing a restart.
3. **Offline / Supabase unavailable**: The previously cached `whats_new` markdown is rendered as-is — no bundled fallback file exists.

**Authoring releases**: write directly to the Supabase `release_notes` table (via the `set_whats_new` MCP tool, the `/buildit` pipeline, or the SQL editor). GitHub releases are unrelated to in-app What's New now — they're for distribution only.

A notification dot appears on the tab when new content is available (compares the first `## v` header against the user's `whats_new_seen` setting). `whats_new_seen` is per-user (stored under the real user_id) and syncs across devices.

### Version Format
All documentation (CHANGELOG.md, RELEASE_NOTES.md, in-app What's New) uses **version headers** (`## vX.Y.Z`) instead of date headers. The version comes from `package.json`. Bump the version when cutting a release:
- **Patch** (1.0.1): bug fixes only
- **Minor** (1.1.0): new features (may include fixes)
- **Major** (2.0.0): breaking changes

Within a version section, items are flat bullets — no category sub-headers. Each bullet is `- **Title** — Description`.

## Issue Tracking via ToDoozy MCP
When you encounter a bug, improvement idea, or feature request that is NOT being fixed right now, create a task in the user's ToDoozy app via MCP tools. Use the Personal project (`1b8d1825-8f5f-48da-b1d3-1dd2e4554d85`) and assign the appropriate labels:
- **Bug**: label `Todoozy` (`82cc13d9`) + label `bug` (`8a67ae36`)
- **Improvement**: label `Todoozy` (`82cc13d9`) + label `improvement` (`a9bb75e0`)
- **Feature**: label `Todoozy` (`82cc13d9`) + label `Feature` (`163f1cf0`)

Task title should be clear and actionable. Description should include enough context to understand and reproduce the issue later. Do NOT silently skip issues — always log them.

**Status IDs — Personal project (`1b8d1825-8f5f-48da-b1d3-1dd2e4554d85`):**
- Not Started: `869ebe82-f249-4a81-b53a-ca23480b6e8c`
- In Progress: `b85b1973-ebc9-469b-b44c-52c3b91d4197`
- Testing: `26686d55-1cfb-4fcd-ad19-674436b2392f`
- Verifying: `a4f8e2d1-9b3c-4e7f-8a1d-5c6b7e8f9a0b`
- Done: `6c3b0144-8629-486f-8b10-d9fc4e5c35f5`

When tackling a bug/improvement/feature from the ToDoozy task list, follow this lifecycle exactly:
- **Starting work** (the moment the user says "let's fix X" / "add feature Y"): Move to **In Progress** (`b85b1973-ebc9-469b-b44c-52c3b91d4197`)
- **Implementation done, starting to run tests/typecheck**: Move to **Testing** (`26686d55-1cfb-4fcd-ad19-674436b2392f`)
- **All automated tests pass** (`npm run typecheck` + relevant Vitest tests green): Move to **Verifying** (`a4f8e2d1-9b3c-4e7f-8a1d-5c6b7e8f9a0b`)
- **User confirms it works** ("yup that works", "confirmed", "ship it", etc.): Move to **Done** (`6c3b0144-8629-486f-8b10-d9fc4e5c35f5`)

The status must reflect reality at every transition — never leave a task in Testing once tests have passed, and never leave a task in Verifying once the user has confirmed. Move it the moment the trigger fires.

For **ralph stories** specifically: if a corresponding ToDoozy task exists (search by story title or `(#NN)` in the title), follow the same lifecycle — In Progress when starting, Testing while running tests, Verifying when tests pass, Done when the user confirms.

## "Show me ToDoozy bugs"

When the user asks for "ToDoozy bugs", "todoozy bugs", "list the bugs", or any equivalent phrasing, return the union (deduplicated) of:

1. **Every task in the "Todoozy Bugs" shared project** (`cc513242-3bfa-439b-a933-ab2513fc2953`) — regardless of labels. Include all open statuses, exclude Done/archived unless the user asks otherwise.
2. **Every task across ALL projects** that has BOTH of these labels:
   - `Todoozy` (`82cc13d9-2a78-47aa-ad25-3de837c390c5`)
   - `Bug` (`8a67ae36-1ed8-4283-93b3-e58ef460cfb7`)

Group the output by source (shared project vs cross-project labels) and show: id (short), title, status, project, priority. Dedupe by id when a task qualifies under both. Default to open tasks only; include Done/archived only if the user asks.

Use `search_tasks` with `label_ids` (returns OR, so filter in jq for both labels present) plus `list_tasks` on the shared project, merge, dedupe.
