import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// sessionRecovery imports getSupabase + safeSetSession from the supabase lib —
// mock the whole module so no real client (or window.api) is ever constructed.
const safeSetSessionMock = vi.fn()
const getSessionMock = vi.fn()
vi.mock('../lib/supabase', () => ({
  getSupabase: vi.fn(async () => ({
    auth: { getSession: getSessionMock }
  })),
  safeSetSession: (tokens: { access_token: string; refresh_token: string }) =>
    safeSetSessionMock(tokens)
}))

vi.mock('../shared/stores/logStore', () => ({
  logEvent: vi.fn()
}))

const storedGetSession = vi.fn()
const clearSession = vi.fn()

import {
  tryRestoreSession,
  startRecoveryTimer,
  stopRecoveryTimer,
  resetPermanentlyDeadFlag,
  isPermanentlyDead
} from './sessionRecovery'

const VALID_TOKENS = JSON.stringify({ access_token: 'at', refresh_token: 'rt' })
const FAKE_SESSION = { access_token: 'at2', refresh_token: 'rt2' }

beforeEach(() => {
  vi.useFakeTimers()
  safeSetSessionMock.mockReset()
  storedGetSession.mockReset().mockResolvedValue(VALID_TOKENS)
  clearSession.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('window', {
    api: { auth: { getSession: storedGetSession, clearSession } }
  })
  resetPermanentlyDeadFlag()
})

afterEach(() => {
  stopRecoveryTimer()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('tryRestoreSession', () => {
  it('returns true when setSession succeeds', async () => {
    safeSetSessionMock.mockResolvedValue({ session: FAKE_SESSION, error: null })
    await expect(tryRestoreSession(1)).resolves.toBe(true)
    expect(safeSetSessionMock).toHaveBeenCalledTimes(1)
    expect(isPermanentlyDead()).toBe(false)
  })

  it('returns false when no tokens are stored', async () => {
    storedGetSession.mockResolvedValue(null)
    await expect(tryRestoreSession(1)).resolves.toBe(false)
    expect(safeSetSessionMock).not.toHaveBeenCalled()
  })

  it('flags permanent death and clears tokens on refresh_token_already_used', async () => {
    safeSetSessionMock.mockResolvedValue({
      session: null,
      error: { message: 'Invalid Refresh Token', code: 'refresh_token_already_used' }
    })
    await expect(tryRestoreSession(3)).resolves.toBe(false)
    // Fail-fast: no retries against a dead token chain
    expect(safeSetSessionMock).toHaveBeenCalledTimes(1)
    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(isPermanentlyDead()).toBe(true)
  })

  it('detects permanent death from message text when error.code is missing', async () => {
    safeSetSessionMock.mockResolvedValue({
      session: null,
      error: { message: 'Invalid Refresh Token: Already Used' }
    })
    await expect(tryRestoreSession(1)).resolves.toBe(false)
    expect(isPermanentlyDead()).toBe(true)
    expect(clearSession).toHaveBeenCalledTimes(1)
  })

  it('does not flag permanent death on transient errors, and retries', async () => {
    safeSetSessionMock.mockResolvedValue({
      session: null,
      error: { message: 'fetch failed' }
    })
    const result = tryRestoreSession(2)
    // second attempt waits on the 1s backoff timer
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(result).resolves.toBe(false)
    expect(safeSetSessionMock).toHaveBeenCalledTimes(2)
    expect(isPermanentlyDead()).toBe(false)
    expect(clearSession).not.toHaveBeenCalled()
  })
})

describe('startRecoveryTimer', () => {
  it('fires onRecovered and stops after a successful restore tick', async () => {
    safeSetSessionMock.mockResolvedValue({ session: FAKE_SESSION, error: null })
    const onRecovered = vi.fn()
    const onPermanentlyDead = vi.fn()
    startRecoveryTimer({ onRecovered, onPermanentlyDead })

    await vi.advanceTimersByTimeAsync(30_000)
    expect(onRecovered).toHaveBeenCalledTimes(1)
    expect(onPermanentlyDead).not.toHaveBeenCalled()

    // Timer stopped — no further ticks
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onRecovered).toHaveBeenCalledTimes(1)
  })

  it('fires onPermanentlyDead and stops when the token dies during a tick', async () => {
    safeSetSessionMock.mockResolvedValue({
      session: null,
      error: { message: 'Invalid Refresh Token', code: 'refresh_token_already_used' }
    })
    const onRecovered = vi.fn()
    const onPermanentlyDead = vi.fn()
    startRecoveryTimer({ onRecovered, onPermanentlyDead })

    await vi.advanceTimersByTimeAsync(30_000)
    expect(onPermanentlyDead).toHaveBeenCalledTimes(1)
    expect(onRecovered).not.toHaveBeenCalled()

    // Timer stopped — the dead token is not retried forever
    await vi.advanceTimersByTimeAsync(60_000)
    expect(safeSetSessionMock).toHaveBeenCalledTimes(1)
    expect(onPermanentlyDead).toHaveBeenCalledTimes(1)
  })

  it('tolerates a missing onPermanentlyDead handler', async () => {
    safeSetSessionMock.mockResolvedValue({
      session: null,
      error: { message: 'session not found', code: 'session_not_found' }
    })
    startRecoveryTimer({ onRecovered: vi.fn() })
    await expect(vi.advanceTimersByTimeAsync(30_000)).resolves.not.toThrow()
    expect(isPermanentlyDead()).toBe(true)
  })

  it('refuses to start when the token is already known dead', async () => {
    safeSetSessionMock.mockResolvedValue({
      session: null,
      error: { message: 'x', code: 'refresh_token_not_found' }
    })
    await tryRestoreSession(1)
    expect(isPermanentlyDead()).toBe(true)

    const onRecovered = vi.fn()
    startRecoveryTimer({ onRecovered })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(onRecovered).not.toHaveBeenCalled()
    // only the initial tryRestoreSession call — the timer never ticked
    expect(safeSetSessionMock).toHaveBeenCalledTimes(1)
  })
})
