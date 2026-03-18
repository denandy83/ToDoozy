# ToDoozy

## Project Overview
Electron desktop todo app built with React 19, TypeScript (strict), Tailwind CSS 4, better-sqlite3, and @dnd-kit.

## How to Work
1. Read `prd.json` to find the next story where `passes: false`
2. Read `REBUILD_SPEC.md` at the section referenced in `spec_section` for full details
3. Implement the feature
4. Run `npm run typecheck` — fix all errors
5. Run `npm run dev` to verify it compiles (kill the process after confirming)
6. Update `prd.json` to set `passes: true` for the completed story
7. Git commit with conventional commit message
8. If `progress.txt` exists, append learnings or decisions made

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

## UX Consistency (see REBUILD_SPEC.md §35)
- Use shared components everywhere: StatusButton, PriorityIndicator, LabelChip, LabelPicker, Toast, Modal, Avatar, EmptyState
- Selection: accent bg at 12% opacity + accent border at 15%
- Hover: bg-foreground/6 with faint border
- Destructive actions: always red, always at bottom, always with undo
- Escape always closes topmost overlay
- All animations respect prefers-reduced-motion

## Testing
- Write Vitest unit tests for all repository methods, filter logic, and utility functions.
- Test files live next to source files: `TaskRepository.test.ts` alongside `TaskRepository.ts`.

## Style
- Minimal, monochrome-first design. Color comes from themes and priority/label accents.
- All animations respect `prefers-reduced-motion`.
- Keyboard-first: every feature must be usable without a mouse.
