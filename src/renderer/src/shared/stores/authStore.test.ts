import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Hoisted so the mock factory below can reference it (vi.mock is hoisted above
// normal imports). signUpMock stands in for supabase.auth.signUp.
const { signUpMock } = vi.hoisted(() => ({ signUpMock: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  getSupabase: async () => ({ auth: { signUp: signUpMock } }),
  parseAuthTokensFromUrl: () => null
}))

describe('useAuthStore — info message vs error (#71)', () => {
  beforeEach(() => {
    signUpMock.mockReset()
    vi.stubGlobal('window', {
      ...globalThis.window,
      api: { auth: { saveEmail: vi.fn().mockResolvedValue(undefined) } }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets infoMessage (not error) when sign up returns no session', async () => {
    // Supabase returns a user but no session when email confirmation is required.
    signUpMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@b.com', user_metadata: {} }, session: null },
      error: null
    })

    const { useAuthStore } = await import('./authStore')
    // Seed a stale error to prove the success path clears it.
    useAuthStore.setState({ error: 'previous error', infoMessage: null })

    await useAuthStore.getState().signUpWithEmail('a@b.com', 'password123')

    const state = useAuthStore.getState()
    expect(state.infoMessage).toBe('Check your email for a confirmation link.')
    expect(state.error).toBeNull()
    expect(state.loading).toBe(false)
    expect(state.isAuthenticated).toBe(false)
  })

  it('keeps the message in error (not infoMessage) on a real sign up error', async () => {
    signUpMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered' }
    })

    const { useAuthStore } = await import('./authStore')
    useAuthStore.setState({ error: null, infoMessage: null })

    await useAuthStore.getState().signUpWithEmail('a@b.com', 'password123')

    const state = useAuthStore.getState()
    expect(state.error).toBe('User already registered')
    expect(state.infoMessage).toBeNull()
    expect(state.loading).toBe(false)
  })

  it('clearInfoMessage resets the field to null', async () => {
    const { useAuthStore } = await import('./authStore')
    useAuthStore.setState({ infoMessage: 'something' })
    useAuthStore.getState().clearInfoMessage()
    expect(useAuthStore.getState().infoMessage).toBeNull()
  })
})
