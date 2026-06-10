import { describe, it, expect, vi } from 'vitest'
import {
  handleRemovePassword,
  type RemovePasswordClient,
  type GetUserResult,
  type AdminUpdateResult,
  type AuthUserLike
} from './removePassword'

function makeClient(opts: {
  getUserResult?: GetUserResult
  updateResults?: AdminUpdateResult[]
}): {
  client: RemovePasswordClient
  getUser: ReturnType<typeof vi.fn>
  updateUserById: ReturnType<typeof vi.fn>
} {
  const updateResults = opts.updateResults ?? [{ error: null }, { error: null }]
  let updateCall = 0
  const getUser = vi.fn(() =>
    Promise.resolve(opts.getUserResult ?? { data: { user: null }, error: { message: 'invalid JWT' } })
  )
  const updateUserById = vi.fn(() => Promise.resolve(updateResults[updateCall++] ?? { error: null }))
  const client = { auth: { getUser, admin: { updateUserById } } } as unknown as RemovePasswordClient
  return { client, getUser, updateUserById }
}

function googleUser(extra?: Partial<AuthUserLike>): GetUserResult {
  return {
    data: { user: { id: 'user-1', identities: [{ provider: 'google' }], ...extra } },
    error: null
  }
}

describe('handleRemovePassword — caller validation', () => {
  it('returns 401 when the Authorization header is missing', async () => {
    const { client, getUser } = makeClient({})
    const res = await handleRemovePassword(client, null)
    expect(res).toEqual({ status: 401, body: { ok: false, error: 'unauthorized' } })
    expect(getUser).not.toHaveBeenCalled()
  })

  it('returns 401 when the header is not a Bearer token', async () => {
    const { client, getUser } = makeClient({})
    const res = await handleRemovePassword(client, 'Basic dXNlcjpwdw==')
    expect(res.status).toBe(401)
    expect(getUser).not.toHaveBeenCalled()
  })

  it('returns 401 when the JWT does not resolve to a user', async () => {
    const { client, updateUserById } = makeClient({
      getUserResult: { data: { user: null }, error: { message: 'invalid JWT' } }
    })
    const res = await handleRemovePassword(client, 'Bearer bad-jwt')
    expect(res).toEqual({ status: 401, body: { ok: false, error: 'unauthorized' } })
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('extracts the JWT from the Bearer header and passes it to getUser', async () => {
    const { client, getUser } = makeClient({ getUserResult: googleUser() })
    await handleRemovePassword(client, 'Bearer my-jwt-token')
    expect(getUser).toHaveBeenCalledWith('my-jwt-token')
  })
})

describe('handleRemovePassword — only-sign-in-method guard', () => {
  it('rejects an email-only user without touching the admin API', async () => {
    const { client, updateUserById } = makeClient({
      getUserResult: {
        data: { user: { id: 'user-1', identities: [{ provider: 'email' }] } },
        error: null
      }
    })
    const res = await handleRemovePassword(client, 'Bearer jwt')
    expect(res).toEqual({ status: 200, body: { ok: false, error: 'no_oauth_identity' } })
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('rejects a user with no identities at all', async () => {
    const { client, updateUserById } = makeClient({
      getUserResult: { data: { user: { id: 'user-1', identities: null } }, error: null }
    })
    const res = await handleRemovePassword(client, 'Bearer jwt')
    expect(res.body).toEqual({ ok: false, error: 'no_oauth_identity' })
    expect(updateUserById).not.toHaveBeenCalled()
  })
})

describe('handleRemovePassword — removal', () => {
  it('clears the password and the has_password flag for an OAuth user', async () => {
    const { client, updateUserById } = makeClient({ getUserResult: googleUser() })
    const res = await handleRemovePassword(client, 'Bearer jwt')
    expect(res).toEqual({ status: 200, body: { ok: true } })
    expect(updateUserById).toHaveBeenNthCalledWith(1, 'user-1', { password: null })
    expect(updateUserById).toHaveBeenNthCalledWith(2, 'user-1', {
      user_metadata: { has_password: false }
    })
  })

  it('works for a user with both google and email identities', async () => {
    const { client } = makeClient({
      getUserResult: {
        data: {
          user: { id: 'user-1', identities: [{ provider: 'email' }, { provider: 'google' }] }
        },
        error: null
      }
    })
    const res = await handleRemovePassword(client, 'Bearer jwt')
    expect(res.body).toEqual({ ok: true })
  })

  it('returns 500 and skips the metadata write when clearing the password fails', async () => {
    const { client, updateUserById } = makeClient({
      getUserResult: googleUser(),
      updateResults: [{ error: { message: 'admin API down' } }]
    })
    const res = await handleRemovePassword(client, 'Bearer jwt')
    expect(res).toEqual({ status: 500, body: { ok: false, error: 'admin API down' } })
    expect(updateUserById).toHaveBeenCalledTimes(1)
  })

  it('returns 500 when clearing the has_password flag fails', async () => {
    const { client } = makeClient({
      getUserResult: googleUser(),
      updateResults: [{ error: null }, { error: { message: 'metadata write failed' } }]
    })
    const res = await handleRemovePassword(client, 'Bearer jwt')
    expect(res).toEqual({ status: 500, body: { ok: false, error: 'metadata write failed' } })
  })
})
