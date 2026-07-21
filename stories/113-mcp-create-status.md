# Story #113 — MCP create_status tool: let the MCP server create project statuses

**Risk class**: security-migration
**Verification tier**: full
**Demo statement**: Call the MCP `create_status` tool with a project_id and name "Testing" as an authenticated user who owns that project; a new status row appears in that project and is returned; calling it for a project the user does not own is rejected.

## Implementation guide

The ToDoozy MCP is the Supabase edge function at `supabase/functions/mcp/index.ts` (deployed at `…/functions/v1/mcp`). It currently exposes `list_statuses` but NO way to create a status — so bootstrapping a project's status set (e.g. adding "Testing"/"To Verify") must be done by hand in the UI. Add a `create_status` tool.

IMPORTANT: this story runs AFTER #96 (per-request auth context) and #97 (RLS/user-scoping) have landed on this branch. Build on their patterns — do not reintroduce module globals, and scope every DB access to the authenticated user.

1. Read the current `supabase/functions/mcp/index.ts` end-to-end first (it has changed under #96/#97). Study how `create_label` is defined and implemented — the new tool mirrors it exactly in shape:
   - Tool registration (~line 728): `create_label` entry in the tools array with an `inputSchema`.
   - Handler (~line 996): `async create_label(args)` in the handlers object, dispatched through the pure per-request `dispatchTool`.
2. Add the `create_status` tool registration:
   - name `create_status`, description "Create a new status in a project".
   - inputSchema properties: `project_id` (str, required), `name` (str, required), `color` (str, optional — hex, default `#888888`), `icon` (str, optional — default `circle`), `order_index` (number, optional — default: max(order_index)+1 in that project, else 0), `is_done` (boolean, optional — default false).
   - required: `['project_id','name']`.
3. Add the `create_status(args)` handler:
   - Resolve the authenticated user from the per-request context (same accessor the other write handlers use post-#97).
   - Authorize: confirm the user owns (or is a member with rights to) `project_id` — reuse the exact scoping helper #97 introduced for project-scoped writes. Reject (throw the same typed error other tools use) if not authorized. Never trust the caller's project_id without this check.
   - Insert into the Supabase `statuses` table: generate a UUID `id`, set `project_id`, `name`, `color`, `icon`, `order_index`, `is_done`, `created_at`/`updated_at` = now ISO. Match the column names/semantics used by `list_statuses` and the app's status rows.
   - Return the created status row (same result shape convention as `create_label`).
4. If `order_index` is omitted, compute next index = (max existing order_index for that project) + 1 so the new status sorts last; fall back to 0 if none.
5. Keep it testable per the #96/#97 pattern: factor any non-trivial pure logic (default resolution, order_index computation, the row builder) into the sibling helper module covered by Vitest, and add tests there. `supabase/functions/**` is Deno and outside `npm run typecheck`/Deno isn't installed locally, so the pure-helper + Vitest path is how this gets verified.
6. Optional stretch (only if low-cost and non-disruptive): also add `update_status` and `delete_status` mirroring the same auth-scoped pattern. Not required for acceptance — do not compromise create_status to fit them in.

Note in the commit body that the edge function must be redeployed (`supabase functions deploy mcp`) by a human before the tool is live — do NOT deploy from the loop.

## Acceptance criteria

- A `create_status` MCP tool is registered and dispatched through the post-#97 per-request context (no module-global auth).
- Creating a status in a project the authenticated user owns succeeds and returns the new row with correct defaults (color `#888888`, icon `circle`, is_done false, order_index sorting last when omitted).
- Creating a status for a project the user does NOT own/have rights to is rejected with the same typed error convention as other scoped tools — no row is written.
- Pure helper logic (defaults, order_index computation, row builder) is covered by Vitest.
- npm run typecheck passes with zero errors.
- npm run test passes (all existing and new tests).

## References

- supabase/functions/mcp/index.ts
- AUDIT_CONTEXT.md
- src/main/repositories/StatusRepository.ts (reference only — the local SQLite shape; the edge function writes to Supabase Postgres, do not import it)
