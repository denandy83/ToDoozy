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
7. Update `prd.json` to set `passes: true` for the completed story
8. Git commit with a conventional commit message describing what was built
9. Append any decisions, blockers, or learnings to `progress.txt`
10. If there are more stories with `passes: false`, exit normally — you will be called again for the next one
11. If ALL stories have `passes: true`, output exactly `<promise>COMPLETE</promise>` and exit

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

## Issue Tracking via ToDoozy MCP
When you encounter a bug, improvement idea, or feature request that is NOT being fixed right now, create a task in the user's ToDoozy app via MCP tools. Use the Personal project (`1b8d1825-8f5f-48da-b1d3-1dd2e4554d85`) and assign the appropriate labels:
- **Bug**: label `Todoozy` (`82cc13d9`) + label `bug` (`8a67ae36`)
- **Improvement**: label `Todoozy` (`82cc13d9`) + label `improvement` (`a9bb75e0`)
- **Feature**: label `Todoozy` (`82cc13d9`) + label `Feature` (`163f1cf0`)

Task title should be clear and actionable. Description should include enough context to understand and reproduce the issue later. Do NOT silently skip issues — always log them.

When tackling a bug/improvement/feature from the ToDoozy task list:
- **Starting work**: Move the task to In Progress (`b85b1973-ebc9-469b-b44c-52c3b91d4197`)
- **Implementation done (ralph passes)**: Move the task to Testing (`26686d55-1cfb-4fcd-ad19-674436b2392f`)
- **User confirms tested**: Move the task to Done (`6c3b0144-8629-486f-8b10-d9fc4e5c35f5`)
