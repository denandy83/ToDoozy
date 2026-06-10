// Core logic for the remove-password edge function.
//
// Extracted into its own dependency-free module so the contract can be
// unit-tested under vitest (Node) while still importing cleanly into the
// Deno edge function via a relative path. Intentionally NO `npm:`/Deno
// imports here — only a minimal structural client surface (same pattern
// as mcp/projectLabels.ts, story #93).
//
// Why this exists (story #94): Supabase has no client-side API to clear
// `encrypted_password` — only the admin API can, and the service_role key
// must never reach the Electron renderer. This function lets an OAuth user
// who previously added a password revert to OAuth-only sign-in.

/** The slice of a GoTrue identity this handler cares about. */
export interface UserIdentityLike {
  provider: string
}

/** The slice of a GoTrue user this handler cares about. */
export interface AuthUserLike {
  id: string
  identities?: UserIdentityLike[] | null
}

export interface GetUserResult {
  data: { user: AuthUserLike | null }
  error: { message: string } | null
}

export interface AdminUpdateResult {
  error: { message: string } | null
}

/** Attribute payloads sent to the admin update endpoint. */
export type AdminUpdateAttributes =
  | { password: null }
  | { user_metadata: { has_password: boolean } }

/** Minimal Supabase admin-client surface needed to remove a password. */
export interface RemovePasswordClient {
  auth: {
    getUser(jwt: string): PromiseLike<GetUserResult>
    admin: {
      updateUserById(
        userId: string,
        attributes: AdminUpdateAttributes
      ): PromiseLike<AdminUpdateResult>
    }
  }
}

export interface RemovePasswordResponse {
  status: number
  body: { ok: boolean; error?: string }
}

/**
 * Validate the caller's JWT, refuse to strip the only sign-in method, then
 * clear the password via the admin API and reset the `has_password`
 * metadata flag (which `hasEmailIdentity` detection in the renderer reads,
 * since OAuth users who add a password don't gain an 'email' identity).
 *
 * Business rejections (`no_oauth_identity`) return 200 with `ok: false` so
 * `functions.invoke` callers can read the body from `data` — non-2xx
 * responses surface as an opaque FunctionsHttpError instead.
 */
export async function handleRemovePassword(
  client: RemovePasswordClient,
  authHeader: string | null
): Promise<RemovePasswordResponse> {
  const jwt = /^Bearer\s+(.+)$/i.exec(authHeader ?? '')?.[1]?.trim()
  if (!jwt) return { status: 401, body: { ok: false, error: 'unauthorized' } }

  const { data, error } = await client.auth.getUser(jwt)
  const user = data.user
  if (error || !user) return { status: 401, body: { ok: false, error: 'unauthorized' } }

  const hasOAuthIdentity = user.identities?.some((i) => i.provider !== 'email') ?? false
  if (!hasOAuthIdentity) return { status: 200, body: { ok: false, error: 'no_oauth_identity' } }

  const passwordResult = await client.auth.admin.updateUserById(user.id, { password: null })
  if (passwordResult.error) {
    return { status: 500, body: { ok: false, error: passwordResult.error.message } }
  }

  const metadataResult = await client.auth.admin.updateUserById(user.id, {
    user_metadata: { has_password: false }
  })
  if (metadataResult.error) {
    return { status: 500, body: { ok: false, error: metadataResult.error.message } }
  }

  return { status: 200, body: { ok: true } }
}
