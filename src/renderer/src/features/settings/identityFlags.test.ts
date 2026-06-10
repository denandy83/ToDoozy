import { describe, it, expect } from 'vitest'
import { deriveIdentityFlags, canRemovePasswordLogin } from './identityFlags'

describe('deriveIdentityFlags', () => {
  it('email-only user: email identity yes, OAuth no', () => {
    const flags = deriveIdentityFlags({ identities: [{ provider: 'email' }] })
    expect(flags).toEqual({ hasEmailIdentity: true, hasOAuthIdentity: false })
  })

  it('google-only user without a password: no email identity', () => {
    const flags = deriveIdentityFlags({ identities: [{ provider: 'google' }] })
    expect(flags).toEqual({ hasEmailIdentity: false, hasOAuthIdentity: true })
  })

  it('google user who added a password: has_password flag counts as email identity', () => {
    const flags = deriveIdentityFlags({
      identities: [{ provider: 'google' }],
      user_metadata: { has_password: true }
    })
    expect(flags).toEqual({ hasEmailIdentity: true, hasOAuthIdentity: true })
  })

  it('google user after password removal: has_password false clears email identity', () => {
    const flags = deriveIdentityFlags({
      identities: [{ provider: 'google' }],
      user_metadata: { has_password: false }
    })
    expect(flags).toEqual({ hasEmailIdentity: false, hasOAuthIdentity: true })
  })

  it('user with both email and google identities', () => {
    const flags = deriveIdentityFlags({
      identities: [{ provider: 'email' }, { provider: 'google' }]
    })
    expect(flags).toEqual({ hasEmailIdentity: true, hasOAuthIdentity: true })
  })

  it('handles missing identities and metadata', () => {
    expect(deriveIdentityFlags({})).toEqual({ hasEmailIdentity: false, hasOAuthIdentity: false })
    expect(deriveIdentityFlags({ identities: null, user_metadata: null })).toEqual({
      hasEmailIdentity: false,
      hasOAuthIdentity: false
    })
  })
})

describe('canRemovePasswordLogin', () => {
  it('true only when the user has a password AND an OAuth fallback', () => {
    expect(canRemovePasswordLogin({ hasEmailIdentity: true, hasOAuthIdentity: true })).toBe(true)
  })

  it('false for email-only users (would strip the only sign-in method)', () => {
    expect(canRemovePasswordLogin({ hasEmailIdentity: true, hasOAuthIdentity: false })).toBe(false)
  })

  it('false for OAuth users without a password (nothing to remove)', () => {
    expect(canRemovePasswordLogin({ hasEmailIdentity: false, hasOAuthIdentity: true })).toBe(false)
  })

  it('false when neither flag is set', () => {
    expect(canRemovePasswordLogin({ hasEmailIdentity: false, hasOAuthIdentity: false })).toBe(false)
  })
})
