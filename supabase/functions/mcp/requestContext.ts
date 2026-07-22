// Per-request context plumbing for the MCP edge function (story #96).
//
// WHY THIS EXISTS — CONCURRENCY CONTRACT
// --------------------------------------
// The edge function previously stored per-request auth state (userId / client
// / repos / handlers) in module-level mutable `let` globals. `Deno.serve`
// overwrote those globals on every request and then `await`ed the mcp-lite
// HTTP handler. Because a single Deno isolate serves many requests
// concurrently, two in-flight requests raced on the same globals: request B
// could overwrite the globals while request A was suspended at an `await`, so
// A would resume and read B's userId / repositories — one user observing
// another user's data.
//
// THE FIX: the per-request context is now built inside the request handler and
// threaded EXPLICITLY through mcp-lite's own per-request `AuthInfo.extra`
// channel (mcp-lite constructs a fresh context object per request and hands it
// to every tool handler). `dispatchTool` is a PURE function of
// (toolName, args, ctx): it reads nothing from module scope, so two concurrent
// calls carrying different contexts cannot observe each other's state. No
// mutable per-request state may ever live in module scope again.
//
// This module is intentionally dependency-free (no `npm:` imports, no `Deno`
// globals) so the contract can be unit-tested under vitest (Node) while still
// importing cleanly into the Deno edge function via a relative path — the same
// pattern used by labelMutations.ts / projectLabels.ts.

/** A single MCP text content block. */
export interface TextContent {
  type: 'text'
  text: string
}

/** The MCP tool-call result envelope returned to the transport. */
export interface ToolCallResult {
  content: TextContent[]
  isError?: boolean
}

/** A tool handler: takes the raw args object and resolves to a plain result. */
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

/**
 * The minimal per-request context surface `dispatchTool` needs. The real
 * context (see index.ts `RequestContext`) carries userId/client/repos too, but
 * dispatch only ever touches the handler map — everything else is captured in
 * the handler closures the caller built for this request.
 */
export interface DispatchableContext {
  handlers: Record<string, ToolHandler>
}

/**
 * Key under which the typed per-request context is stashed inside
 * `AuthInfo.extra` (which mcp-lite types loosely as `Record<string, unknown>`).
 * Namespaced to avoid colliding with any provider-specific auth fields.
 */
const CONTEXT_KEY = '__todoozyRequestContext' as const

/** Wrap a typed per-request context for transport through `AuthInfo.extra`. */
export function packRequestContext<Ctx>(ctx: Ctx): Record<string, unknown> {
  return { [CONTEXT_KEY]: ctx }
}

/**
 * Recover the typed per-request context from `AuthInfo.extra`, or `undefined`
 * if the request was not authenticated / carried no context.
 */
export function unpackRequestContext<Ctx>(
  extra: Record<string, unknown> | undefined
): Ctx | undefined {
  if (!extra || !(CONTEXT_KEY in extra)) return undefined
  return extra[CONTEXT_KEY] as Ctx
}

/**
 * Dispatch a tool call against an EXPLICITLY supplied per-request context.
 *
 * Reads nothing from module scope, so concurrent invocations with distinct
 * contexts cannot cross-contaminate. Mirrors the JSON-stringified result /
 * error envelope the MCP transport expects.
 */
export async function dispatchTool<Ctx extends DispatchableContext>(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Ctx | undefined
): Promise<ToolCallResult> {
  if (!ctx) {
    return { content: [{ type: 'text', text: 'Not authenticated' }], isError: true }
  }
  const handler = ctx.handlers[toolName]
  if (!handler) {
    return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true }
  }
  try {
    const result = await handler(args)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (e) {
    return {
      content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
      isError: true
    }
  }
}
