import { describe, it, expect } from 'vitest'
import { PROJECT_COLORS, pickNextProjectColor } from './projectColors'

describe('pickNextProjectColor', () => {
  it('returns the first color when no projects exist', () => {
    expect(pickNextProjectColor([])).toBe('#6366f1')
  })

  it('returns the next unused color when the first is taken', () => {
    expect(pickNextProjectColor(['#6366f1'])).toBe('#8b5cf6')
  })

  it('skips all used colors and returns the first free one', () => {
    expect(pickNextProjectColor(['#6366f1', '#8b5cf6', '#ec4899'])).toBe('#ef4444')
  })

  it('returns a free color regardless of the order colors were used in', () => {
    expect(pickNextProjectColor(['#ec4899', '#6366f1'])).toBe('#8b5cf6')
  })

  it('treats colors case-insensitively', () => {
    expect(pickNextProjectColor(['#6366F1'])).toBe('#8b5cf6')
  })

  it('cycles deterministically by count when every color is in use', () => {
    // 8 colors used → length 8, 8 % 8 = 0 → first color
    expect(pickNextProjectColor(PROJECT_COLORS)).toBe(PROJECT_COLORS[0])
    // 9 colors used → length 9, 9 % 8 = 1 → second color
    expect(pickNextProjectColor([...PROJECT_COLORS, '#6366f1'])).toBe(PROJECT_COLORS[1])
  })

  it('cycles when all colors are used even if the duplicate casing differs', () => {
    const allUpper = PROJECT_COLORS.map((c) => c.toUpperCase())
    expect(pickNextProjectColor(allUpper)).toBe(PROJECT_COLORS[0])
  })
})
