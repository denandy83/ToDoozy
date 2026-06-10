// Derives sign-in-method flags from a GoTrue user (story #94).
//
// OAuth users who add a password do NOT gain an 'email' identity — GoTrue
// only sets encrypted_password. The app therefore mirrors password state in
// the `has_password` user_metadata flag (set on add/change at
// ProfileSettingsContent.handlePasswordSave, cleared by the remove-password
// edge function), and email-login detection must OR the two signals.

/** The slice of a GoTrue identity this module cares about. */
export interface IdentityLike {
  provider: string
}

/** The slice of a GoTrue user this module cares about. */
export interface IdentityUserLike {
  identities?: IdentityLike[] | null
  user_metadata?: Record<string, unknown> | null
}

export interface IdentityFlags {
  /** The user can sign in with email + password. */
  hasEmailIdentity: boolean
  /** The user has at least one non-email (OAuth) identity. */
  hasOAuthIdentity: boolean
}

export function deriveIdentityFlags(user: IdentityUserLike): IdentityFlags {
  const identities = user.identities ?? []
  const hasEmailProvider = identities.some((i) => i.provider === 'email')
  const hasPasswordFlag = ((user.user_metadata ?? {})['has_password'] as boolean | undefined) ?? false
  return {
    hasEmailIdentity: hasEmailProvider || hasPasswordFlag,
    hasOAuthIdentity: identities.some((i) => i.provider !== 'email')
  }
}

/**
 * Removing password login is only offered when the user actually has one
 * AND has another way in afterwards — never strip the only sign-in method.
 * (The remove-password edge function enforces the same rule server-side.)
 */
export function canRemovePasswordLogin(flags: IdentityFlags): boolean {
  return flags.hasEmailIdentity && flags.hasOAuthIdentity
}
