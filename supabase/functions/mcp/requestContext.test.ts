import { describe, it, expect } from 'vitest'
import {
  packRequestContext,
  unpackRequestContext,
  dispatchTool,
  type DispatchableContext,
  type ToolHandler
} from './requestContext'

/**
 * A stub per-request context that mirrors the real one closely enough to
 * exercise the concurrency contract: each context carries its own userId and a
 * `whoami` handler that reports the userId captured in ITS OWN closure.
 */
interface StubContext extends DispatchableContext {
  userId: string
}

/** Build a stub context whose handlers close over `userId`. */
function makeContext(userId: string, extra: Record<string, ToolHandler> = {}): StubContext {
  return {
    userId,
    handlers: {
      // Awaits a turn of the event loop before reporting identity, so that a
      // shared-mutable-global implementation would be observably corrupted by
      // an interleaved request.
      async whoami() {
        await new Promise((resolve) => setTimeout(resolve, 0))
        return { userId }
      },
      ...extra
    }
  }
}

/** Pull the parsed JSON payload out of a successful dispatch result. */
function parseResult<T>(result: { content: Array<{ text: string }> }): T {
  return JSON.parse(result.content[0].text) as T
}

describe('packRequestContext / unpackRequestContext', () => {
  it('round-trips a typed context through the AuthInfo.extra channel', () => {
    const ctx = makeContext('user-1')
    const extra = packRequestContext(ctx)
    expect(unpackRequestContext<StubContext>(extra)).toBe(ctx)
  })

  it('returns undefined when extra is missing', () => {
    expect(unpackRequestContext<StubContext>(undefined)).toBeUndefined()
  })

  it('returns undefined when extra carries no context key', () => {
    expect(unpackRequestContext<StubContext>({ some: 'other-field' })).toBeUndefined()
  })

  it('keeps two packed contexts fully independent', () => {
    const a = packRequestContext(makeContext('user-a'))
    const b = packRequestContext(makeContext('user-b'))
    expect(unpackRequestContext<StubContext>(a)).not.toBe(unpackRequestContext<StubContext>(b))
    expect(unpackRequestContext<StubContext>(a)?.userId).toBe('user-a')
    expect(unpackRequestContext<StubContext>(b)?.userId).toBe('user-b')
  })
})

describe('dispatchTool', () => {
  it('returns a Not authenticated error when no context is supplied', async () => {
    const result = await dispatchTool('whoami', {}, undefined)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Not authenticated')
  })

  it('returns an Unknown tool error when the handler is absent', async () => {
    const result = await dispatchTool('does_not_exist', {}, makeContext('user-1'))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('Unknown tool: does_not_exist')
  })

  it('JSON-stringifies the handler result on success', async () => {
    const result = await dispatchTool('whoami', {}, makeContext('user-1'))
    expect(result.isError).toBeUndefined()
    expect(parseResult<{ userId: string }>(result)).toEqual({ userId: 'user-1' })
  })

  it('surfaces a thrown Error message as an error result', async () => {
    const ctx = makeContext('user-1', {
      async boom() {
        throw new Error('kaboom')
      }
    })
    const result = await dispatchTool('boom', {}, ctx)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('kaboom')
  })

  it('surfaces a thrown non-Error value as an error result', async () => {
    const ctx = makeContext('user-1', {
      async boom() {
        throw 'plain-string-failure'
      }
    })
    const result = await dispatchTool('boom', {}, ctx)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('plain-string-failure')
  })
})

describe('concurrency contract (story #96)', () => {
  it('never lets two interleaved requests observe each other userId', async () => {
    const ctxA = makeContext('user-A')
    const ctxB = makeContext('user-B')

    // Fire both dispatches concurrently. Each handler awaits a macrotask before
    // resolving, guaranteeing the two calls interleave. Because dispatchTool is
    // a pure function of the context it is HANDED (never a shared module
    // global), each call can only ever see its own context.
    const [resA, resB] = await Promise.all([
      dispatchTool('whoami', {}, ctxA),
      dispatchTool('whoami', {}, ctxB)
    ])

    expect(parseResult<{ userId: string }>(resA)).toEqual({ userId: 'user-A' })
    expect(parseResult<{ userId: string }>(resB)).toEqual({ userId: 'user-B' })
  })

  it('holds under many heavily-interleaved concurrent requests', async () => {
    const dispatches = Array.from({ length: 50 }, (_, i) =>
      dispatchTool('whoami', {}, makeContext(`user-${i}`))
    )
    const results = await Promise.all(dispatches)
    results.forEach((result, i) => {
      expect(parseResult<{ userId: string }>(result)).toEqual({ userId: `user-${i}` })
    })
  })
})
