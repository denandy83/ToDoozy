import { describe, it, expect, vi, beforeEach } from 'vitest'

// `electron` is not available in the node test environment (importing it returns a
// path string, not the API), so stub nativeImage.createFromBuffer with a fake.
// vi.hoisted lets the mock fn exist before the hoisted vi.mock factory runs.
const { createFromBuffer } = vi.hoisted(() => ({
  createFromBuffer: vi.fn((buf: Buffer, opts?: { scaleFactor?: number }) => ({
    __isNativeImage: true,
    byteLength: buf.length,
    sigHex: buf.slice(0, 8).toString('hex'),
    scaleFactor: opts?.scaleFactor
  }))
}))

interface FakeImage {
  __isNativeImage: boolean
  byteLength: number
  sigHex: string
  scaleFactor?: number
}

vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer
  }
}))

import { getPriorityDotIcon } from './priority-icons'

describe('getPriorityDotIcon', () => {
  beforeEach(() => {
    createFromBuffer.mockClear()
  })

  it('returns a NativeImage for priorities 1–4', () => {
    for (const p of [1, 2, 3, 4]) {
      const icon = getPriorityDotIcon(p)
      expect(icon).toBeDefined()
      expect((icon as unknown as FakeImage).__isNativeImage).toBe(true)
    }
  })

  it('returns undefined for priority 0 (None)', () => {
    expect(getPriorityDotIcon(0)).toBeUndefined()
    expect(createFromBuffer).not.toHaveBeenCalled()
  })

  it('returns undefined for unknown / out-of-range priorities', () => {
    expect(getPriorityDotIcon(5)).toBeUndefined()
    expect(getPriorityDotIcon(-1)).toBeUndefined()
    expect(getPriorityDotIcon(99)).toBeUndefined()
  })

  it('decodes a non-empty PNG buffer at scaleFactor 2.0', () => {
    // Assert on the returned image (cache-independent): the fake records the
    // decoded buffer's PNG signature, byte length, and scaleFactor.
    const icon = getPriorityDotIcon(4) as unknown as FakeImage
    expect(icon.byteLength).toBeGreaterThan(0)
    expect(icon.sigHex).toBe('89504e470d0a1a0a') // PNG magic bytes
    expect(icon.scaleFactor).toBe(2.0)
  })

  it('caches the NativeImage so it is only built once per priority', () => {
    // Prime the cache (may or may not call createFromBuffer depending on prior
    // tests), then clear call history and confirm a repeat lookup reuses the cache.
    const first = getPriorityDotIcon(2)
    createFromBuffer.mockClear()
    const second = getPriorityDotIcon(2)
    expect(second).toBe(first)
    expect(createFromBuffer).not.toHaveBeenCalled()
  })
})
