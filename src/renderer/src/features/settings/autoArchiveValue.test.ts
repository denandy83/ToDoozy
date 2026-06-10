import { describe, it, expect } from 'vitest'
import { clampAutoArchiveValue } from './autoArchiveValue'

describe('clampAutoArchiveValue', () => {
  it('returns the parsed integer for a valid in-range value', () => {
    expect(clampAutoArchiveValue('3')).toBe(3)
    expect(clampAutoArchiveValue('42')).toBe(42)
    expect(clampAutoArchiveValue(7)).toBe(7)
  })

  it('clamps an empty / non-numeric field to the minimum (1)', () => {
    expect(clampAutoArchiveValue('')).toBe(1)
    expect(clampAutoArchiveValue('abc')).toBe(1)
  })

  it('clamps zero and negatives to the minimum (1)', () => {
    expect(clampAutoArchiveValue('0')).toBe(1)
    expect(clampAutoArchiveValue('-5')).toBe(1)
    expect(clampAutoArchiveValue(-12)).toBe(1)
  })

  it('clamps values above the maximum to 999', () => {
    expect(clampAutoArchiveValue('1000')).toBe(999)
    expect(clampAutoArchiveValue('99999')).toBe(999)
  })

  it('keeps the boundary values 1 and 999', () => {
    expect(clampAutoArchiveValue('1')).toBe(1)
    expect(clampAutoArchiveValue('999')).toBe(999)
  })

  it('parses leading integers from mixed input (parseInt semantics)', () => {
    expect(clampAutoArchiveValue('12px')).toBe(12)
  })
})
