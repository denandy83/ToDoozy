import { describe, it, expect } from 'vitest'
import { chunkArray } from './PersonalSyncService'

describe('chunkArray', () => {
  it('returns an empty array for no items', () => {
    expect(chunkArray([], 500)).toEqual([])
  })

  it('returns a single chunk when items fit within size', () => {
    expect(chunkArray([1, 2, 3], 500)).toEqual([[1, 2, 3]])
  })

  it('splits into fixed-size chunks, last chunk holding the remainder', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('splits evenly when length is a multiple of size', () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('covers every item across chunks with no duplication or loss', () => {
    const items = Array.from({ length: 1201 }, (_, i) => i)
    const chunks = chunkArray(items, 500)
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 201])
    expect(chunks.flat()).toEqual(items)
  })

  it('yields a single chunk for a non-positive size', () => {
    expect(chunkArray([1, 2, 3], 0)).toEqual([[1, 2, 3]])
    expect(chunkArray([1, 2, 3], -5)).toEqual([[1, 2, 3]])
  })

  it('yields nothing for a non-positive size when there are no items', () => {
    expect(chunkArray([], 0)).toEqual([])
  })
})
